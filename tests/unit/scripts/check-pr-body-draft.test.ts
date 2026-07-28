/**
 * tests/unit/scripts/check-pr-body-draft.test.ts (#3997)
 *
 * Draft PR に対して Ready 化要件だけを deferred する挙動の回帰テスト。
 *
 * 固定する不変条件 (#3997 AC):
 *   1. Draft では `unchecked-ready-checklist` / `po-decision-brief-*` が push を止めない
 *   2. Ready では従来どおり両方が発火する
 *   3. deferred したことが必ず出力に出る (無言 skip にしない — #3969 の逆行防止)
 *   4. Draft でも体裁系 gate (必須セクション / 禁止語 / mojibake / AC 4 列 / 変更タイプ /
 *      CONFLICTING / hotfix env) は enforce され続ける
 */

import { describe, expect, it } from 'vitest';

import {
	extractIsDraft,
	formatDraftDeferredGates,
	parseArgs,
	partitionReadyOnlyViolations,
	READY_ONLY_GATES,
	READY_ONLY_VIOLATION_IDS,
	resolveDraftState,
} from '../../../scripts/check-pr-body.mjs';

/** 実運用で observed した violation id を並べた fixture (#3989 の実 fail + 体裁系)。 */
const VIOLATIONS = [
	{ id: 'unchecked-ready-checklist', issue: '#1481', message: '未チェック 3 件' },
	{ id: 'po-decision-brief-missing-section', issue: '#3962', message: 'ブリーフ欠落' },
	{ id: 'missing-required-sections', issue: '#1718', message: 'セクション欠落' },
	{ id: 'forbidden-terms', issue: '#1763', message: '禁止語混入' },
	{ id: 'mojibake-bom', issue: '#2562', message: 'BOM' },
	{ id: 'ac-map-incomplete', issue: '#1775', message: 'AC 4 列未記入' },
	{ id: 'change-type-unselected', issue: '#3846', message: '変更タイプ未選択' },
	{ id: 'mergeable-conflicting', issue: '#1672', message: 'CONFLICTING' },
	{ id: 'hotfix-env-distribution-incomplete', issue: '#2343', message: '配布証跡なし' },
];

describe('READY_ONLY_GATES (SSOT)', () => {
	it('Ready 化要件だけを列挙する (Ready checklist + PO 決裁ブリーフ 3 形態)', () => {
		expect([...READY_ONLY_VIOLATION_IDS].sort()).toEqual([
			'po-decision-brief-missing-diagram',
			'po-decision-brief-missing-section',
			'po-decision-brief-unfilled-placeholder',
			'unchecked-ready-checklist',
		]);
	});

	it('体裁 / 事実性の gate を Ready 限定に格下げしていない (ADR-0006 assertion 弱体化防止)', () => {
		for (const id of [
			'missing-required-sections',
			'forbidden-terms',
			'mojibake-bom',
			'mojibake-heuristic',
			'ac-map-incomplete',
			'ac-map-missing',
			'change-type-unselected',
			'mergeable-conflicting',
			'hotfix-env-distribution-incomplete',
			'self-review-evidence-missing',
		]) {
			expect(READY_ONLY_VIOLATION_IDS.has(id), `${id} が Draft で無効化されている`).toBe(false);
		}
	});
});

describe('partitionReadyOnlyViolations (#3997 AC1 / AC2)', () => {
	it('Draft: Ready 化要件 2 件だけが deferred され、残りは enforce される', () => {
		const { enforced, deferred } = partitionReadyOnlyViolations(VIOLATIONS, true);
		expect(deferred.map((v) => v.id)).toEqual([
			'unchecked-ready-checklist',
			'po-decision-brief-missing-section',
		]);
		expect(enforced.map((v) => v.id)).toEqual([
			'missing-required-sections',
			'forbidden-terms',
			'mojibake-bom',
			'ac-map-incomplete',
			'change-type-unselected',
			'mergeable-conflicting',
			'hotfix-env-distribution-incomplete',
		]);
	});

	it('Ready: 1 件も deferred せず全件 enforce (従来挙動と完全一致)', () => {
		const { enforced, deferred } = partitionReadyOnlyViolations(VIOLATIONS, false);
		expect(deferred).toEqual([]);
		expect(enforced).toEqual(VIOLATIONS);
	});

	it('Draft でも Ready 化要件以外が 1 件でもあれば fail 側に残る', () => {
		const { enforced } = partitionReadyOnlyViolations(
			[
				{ id: 'unchecked-ready-checklist', issue: '#1481', message: 'x' },
				{ id: 'forbidden-terms', issue: '#1763', message: 'y' },
			],
			true,
		);
		expect(enforced).toHaveLength(1);
		expect(enforced[0]?.id).toBe('forbidden-terms');
	});
});

describe('resolveDraftState (#3997 — 未解決は Ready 扱いで fail-closed)', () => {
	it('--pr で isDraft=true が取れたら Draft', () => {
		expect(resolveDraftState({ pr: '3989', draft: false }, true)).toEqual({
			isDraft: true,
			source: 'gh',
		});
	});

	it('--pr で isDraft=false なら Ready (全 gate enforce)', () => {
		expect(resolveDraftState({ pr: '3989', draft: false }, false).isDraft).toBe(false);
	});

	it('--pr 指定時は --draft フラグを無視する (Ready PR の gate を手動で外せない)', () => {
		expect(resolveDraftState({ pr: '3989', draft: true }, false).isDraft).toBe(false);
	});

	it('--pr 指定で gh から取得できなければ Ready 扱い (未解決を緩和方向に倒さない)', () => {
		expect(resolveDraftState({ pr: '3989', draft: true }, null)).toEqual({
			isDraft: false,
			source: 'unresolved',
		});
	});

	it('--body-file dry-run では --draft 申告を採用する', () => {
		expect(resolveDraftState({ pr: null, draft: true }, null)).toEqual({
			isDraft: true,
			source: 'flag',
		});
	});

	it('--body-file dry-run で申告なしなら Ready 扱い', () => {
		expect(resolveDraftState({ pr: null, draft: false }, null).isDraft).toBe(false);
	});
});

describe('extractIsDraft (#3997)', () => {
	it('isDraft を boolean で取り出す', () => {
		expect(extractIsDraft('{"isDraft":true}')).toBe(true);
		expect(extractIsDraft('{"isDraft":false}')).toBe(false);
	});

	it('parse 不能 / field 欠落 / boolean でない → null (未解決)', () => {
		expect(extractIsDraft('not json')).toBe(null);
		expect(extractIsDraft('{}')).toBe(null);
		expect(extractIsDraft('{"isDraft":"true"}')).toBe(null);
		expect(extractIsDraft('')).toBe(null);
	});
});

describe('formatDraftDeferredGates (#3997 AC3 — 無言 skip にしない)', () => {
	it('deferred 0 件でも NOTE と gate 名を必ず出す', () => {
		const lines = formatDraftDeferredGates([], 3989);
		expect(lines[0]).toContain('PR #3989 は Draft のため');
		for (const gate of READY_ONLY_GATES) {
			expect(lines.some((l) => l.includes(gate.name))).toBe(true);
		}
		expect(lines.some((l) => l.includes('Ready 化'))).toBe(true);
	});

	it('deferred した gate は「未達」と明示される', () => {
		const lines = formatDraftDeferredGates(
			[{ id: 'unchecked-ready-checklist', message: 'x' }],
			3989,
		);
		const line = lines.find((l) => l.includes('Ready for Review'));
		expect(line).toContain('未達');
	});
});

describe('parseArgs --draft (#3997)', () => {
	it('--draft を受け取る / 既定は false', () => {
		expect(parseArgs(['--body-file', 'x.md', '--draft']).draft).toBe(true);
		expect(parseArgs(['--body-file', 'x.md']).draft).toBe(false);
	});
});
