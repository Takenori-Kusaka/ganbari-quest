// Issue #4536: graphify-refresh PR body 生成 SSOT (scripts/graphify-refresh-pr-body.mjs) の unit test。
//
// back-merge-pr-body.test.ts と同型: 検証の核心は自動発行 graphify-refresh PR の body が
// 「生成時点で」PR body gate 群 (check-pr-body / Verify AC map / pr-template-gate 6 job /
// PR チェックリスト完了確認) を pass すること。gate ロジックは再実装せず、CI と同一の
// SSOT 関数 (実 template / 実 PR_TEMPLATE_SECTIONS.json 入力) を import して assert する。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAcVerification } from '../../../scripts/check-ac-verification-map.mjs';
import { checkMergeGateChecklist } from '../../../scripts/check-merge-gate-checklist.mjs';
import {
	extractRequiredSections,
	findMissingSections,
	findUncheckedReadyChecklist,
	scanForbiddenTerms,
} from '../../../scripts/check-pr-body.mjs';
import {
	GRAPHIFY_REFRESH_LABELS,
	parseArgs,
	renderGraphifyRefreshPrBody,
	SECTIONS_SSOT_PATH,
	TEMPLATE_PATH,
	validateGraphifyRefreshPrBody,
} from '../../../scripts/graphify-refresh-pr-body.mjs';
import {
	checkClosingKeyword,
	checkCustomerValue,
	checkIssueReference,
	checkSectionPresence,
} from '../../../scripts/pr-template-gate-checks.mjs';

const template = readFileSync(TEMPLATE_PATH, 'utf-8');
const ssotSections: string[] = JSON.parse(readFileSync(SECTIONS_SSOT_PATH, 'utf-8')).sections;

const input = {
	branch: 'chore/graphify-refresh',
	sha: '2cd488fe3abc1234567890deadbeef001122334',
};

const body = renderGraphifyRefreshPrBody(input);
const labels = [...GRAPHIFY_REFRESH_LABELS];

describe('renderGraphifyRefreshPrBody (#4536: template gate 準拠 body の生成)', () => {
	it('必須セクション見出しが完全一致で全て存在する (check-pr-body SSOT)', () => {
		const required = extractRequiredSections(template);
		// 件数はマジックナンバーで固定しない (back-merge-pr-body.test.ts と同型の理由)。
		expect(required).toEqual(ssotSections);
		expect(findMissingSections(body, required)).toEqual([]);
	});

	it('禁止語 0 件 (check-pr-body FORBIDDEN_TERMS)', () => {
		expect(scanForbiddenTerms(body)).toEqual([]);
	});

	it('Ready checklist に未チェック残置なし', () => {
		expect(findUncheckedReadyChecklist(body)).toEqual([]);
	});

	it('develop HEAD SHA (短縮 7 桁) を参照する (再生成起点の出典明示)', () => {
		expect(body).toContain('2cd488f');
	});

	it('#4536 (機構導入 Issue) を no-issue-close 宣言付きで参照する (独自 close 対象を持たない)', () => {
		expect(body).toContain('#4536');
		expect(body).toContain('<!-- no-issue-close:');
	});
});

describe('CI gate 個別 pass (#4536: 無手作業で body-gate green)', () => {
	it('`Verify AC map in PR body` (feature lane) が PASS する', () => {
		const result = checkAcVerification({ body, labels, lane: 'feature' });
		expect(result.ok).toBe(true);
	});

	it('`必須セクションの存在確認` (実 PR_TEMPLATE_SECTIONS.json) が PASS する', () => {
		const result = checkSectionPresence({
			body,
			labels,
			template,
			ssotSections,
			integrationSsotSections: null,
			lane: 'feature',
		});
		expect(result.ok).toBe(true);
	});

	it('pr-template-gate 残り 2 check (issue-reference / customer-value) が PASS する', () => {
		const checkInput = {
			body,
			labels,
			template,
			ssotSections,
			integrationSsotSections: null,
			lane: 'feature' as const,
		};
		expect(checkIssueReference(checkInput).ok, 'issue-reference').toBe(true);
		expect(checkCustomerValue(checkInput).ok, 'customer-value').toBe(true);
	});

	it('closing-keyword check は no-issue-close 宣言で skip される (機械生成 exempt)', () => {
		const result = checkClosingKeyword({
			body,
			labels,
			template,
			ssotSections,
			integrationSsotSections: null,
			lane: 'feature',
		});
		expect(result.ok).toBe(true);
		expect(result.skipped).toBe(true);
	});

	it('`PR チェックリスト完了確認` (feature lane) が PASS する', () => {
		const result = checkMergeGateChecklist({ body, labels, lane: 'feature' });
		expect(result.ok).toBe(true);
	});
});

describe('validateGraphifyRefreshPrBody (#4536: 生成時自己検証 = 生成→検証→fail)', () => {
	it('生成 body は違反 0 件', () => {
		expect(validateGraphifyRefreshPrBody(body)).toEqual([]);
	});

	it('必須セクションを 1 つ削ると違反を検出する (自己検証が空洞でないこと、ADR-0006)', () => {
		const tampered = body.replace('## 変更内容', '## 変更点');
		const violations = validateGraphifyRefreshPrBody(tampered);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.map((v) => v.gate).join(' ')).toContain('missing-required-sections');
	});

	it('禁止語 (未完遂マーカー) が混入すると違反を検出する', () => {
		// 禁止語 scan は body 全文が対象なので、特定行を狙った `.replace` にはしない
		// (back-merge-pr-body.test.ts と同じ理由、#4097 教訓)。
		const tampered = `${body}\n\n**補足**: あとで対応TODO\n`;
		expect(tampered, '禁止語が実際に混入していること').toContain('あとで対応TODO');
		const violations = validateGraphifyRefreshPrBody(tampered);
		expect(violations.map((v) => v.gate).join(' ')).toContain('forbidden-terms');
	});
});

describe('parseArgs (CLI 引数)', () => {
	it('--key value / --key=value を解釈する', () => {
		expect(parseArgs(['--branch', 'chore/graphify-refresh', '--sha=abc123'])).toEqual({
			branch: 'chore/graphify-refresh',
			sha: 'abc123',
		});
	});
});
