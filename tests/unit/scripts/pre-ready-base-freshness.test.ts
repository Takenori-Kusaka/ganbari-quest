/**
 * pre-ready の base 鮮度検査 (#4390)
 *
 * 背景 (実測): #4322 が develop 側で PR テンプレートを 11 → 7 セクションに作り替えたあと、
 * 旧構成のまま残っていた 6 PR が rebase した瞬間に `必須セクションの存在確認` で全滅した。
 * branch tip では「旧 SSOT と旧 body」が整合しているため pre-ready は ALL PASS を返し、
 * rebase して初めて赤になる。pre-ready が branch を単体でしか見ておらず、
 * **base の移動で自分の判定が黙って無効になることを検出できない**のが根本原因。
 *
 * 本 test は判定の中核 (`classifyBaseDrift`) を pin する:
 *   - base が動いていない通常ケースを止めない (回帰。ここで止まると全 PR が止まる)
 *   - base は動いたが検査基準は動いていない → 警告のみ (日に何度も動くので止めない)
 *   - base が動き、かつ **pre-ready の検査基準そのもの** が動いた → BLOCK (#4322 の実害形)
 */

import { describe, expect, it } from 'vitest';
import {
	buildBaseDriftBlockMessage,
	buildBaseDriftNote,
	classifyBaseDrift,
	isGateSsotPath,
	PRE_READY_GATE_SSOT_PREFIXES,
} from '../../../scripts/pre-ready.mjs';

describe('classifyBaseDrift — base 鮮度の 3 分類 (#4390)', () => {
	it('base が動いていなければ fresh (通常ケースを止めない)', () => {
		const r = classifyBaseDrift({ behind: 0, baseChangedFiles: [] });
		expect(r.level).toBe('fresh');
		expect(r.gateFiles).toEqual([]);
	});

	it('base が動いても検査基準を含まなければ behind-only (警告のみ)', () => {
		const r = classifyBaseDrift({
			behind: 12,
			baseChangedFiles: ['src/lib/server/services/activity-service.ts', 'docs/CLAUDE.md'],
		});
		expect(r.level).toBe('behind-only');
		expect(r.gateFiles).toEqual([]);
	});

	it('base の差分が PR テンプレート SSOT を含めば gate-ssot-moved (#4322 の実害形)', () => {
		const r = classifyBaseDrift({
			behind: 3,
			baseChangedFiles: [
				'src/routes/+page.svelte',
				'.github/PR_TEMPLATE_SECTIONS.json',
				'.github/PULL_REQUEST_TEMPLATE.md',
			],
		});
		expect(r.level).toBe('gate-ssot-moved');
		expect(r.gateFiles).toEqual([
			'.github/PR_TEMPLATE_SECTIONS.json',
			'.github/PULL_REQUEST_TEMPLATE.md',
		]);
	});

	it('base の差分が pre-ready が spawn する検査 script を含めば gate-ssot-moved', () => {
		const r = classifyBaseDrift({
			behind: 1,
			baseChangedFiles: ['scripts/check-pr-body.mjs'],
		});
		expect(r.level).toBe('gate-ssot-moved');
	});

	it('behind > 0 でも baseChangedFiles が空なら behind-only に倒す (差分取得失敗を BLOCK にしない)', () => {
		const r = classifyBaseDrift({ behind: 5, baseChangedFiles: [] });
		expect(r.level).toBe('behind-only');
	});

	it('behind が 0 なら検査基準が動いていても fresh (自分の branch に取り込み済み)', () => {
		// behind 0 = base の commit は既に HEAD に入っている。取り込み済みの変更で止めない。
		const r = classifyBaseDrift({
			behind: 0,
			baseChangedFiles: ['.github/PR_TEMPLATE_SECTIONS.json'],
		});
		expect(r.level).toBe('fresh');
	});
});

describe('isGateSsotPath — 検査基準の判定 (#4390)', () => {
	it('scripts/lib/ci/ 配下は prefix で一括して検査基準扱い', () => {
		expect(PRE_READY_GATE_SSOT_PREFIXES).toContain('scripts/lib/ci/');
		expect(isGateSsotPath('scripts/lib/ci/pr-body-sections.mjs')).toBe(true);
	});

	it('検査基準でない path は false (over-block しない)', () => {
		expect(isGateSsotPath('src/lib/domain/labels.ts')).toBe(false);
		expect(isGateSsotPath('docs/decisions/README.md')).toBe(false);
		// 名前が似ているだけの path を拾わない
		expect(isGateSsotPath('tests/unit/scripts/check-pr-body.test.ts')).toBe(false);
	});

	it('Windows の \\ 区切りでも同じ判定になる', () => {
		expect(isGateSsotPath('.github\\PR_TEMPLATE_SECTIONS.json')).toBe(true);
		expect(isGateSsotPath('scripts\\lib\\ci\\resolve-base-branch.mjs')).toBe(true);
	});
});

describe('BLOCK / 警告の文言 (#4390)', () => {
	it('BLOCK 文言は「何が動いたか」と「どうすれば直るか」を両方持つ', () => {
		const msg = buildBaseDriftBlockMessage('develop', 3, ['.github/PR_TEMPLATE_SECTIONS.json']);
		expect(msg).toContain('.github/PR_TEMPLATE_SECTIONS.json');
		expect(msg).toContain('git rebase origin/develop');
		// 「なぜ止めたか」= 判定が無効になっている、が読み取れること
		expect(msg).toContain('検査基準');
	});

	it('警告文言は commit 数と base 名を持ち、rebase を促すが止めない旨を書く', () => {
		const note = buildBaseDriftNote('develop', 12);
		expect(note).toContain('12');
		expect(note).toContain('develop');
	});
});
