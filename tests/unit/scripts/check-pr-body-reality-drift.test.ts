// tests/unit/scripts/check-pr-body-reality-drift.test.ts
// #4170 AC1 / AC3 / AC5 — 統合 PR 本文と GitHub 実態の乖離を機械照合する。
//
// ## 実害（第19回統合監査 #4152、merge 直前に 4 回）
//
// | # | ずれた内容 | 本 test の対応 |
// |---|---|---|
// | 1 | `Closes #4129` を「追加した」が実 PR body に無かった | **AC2 で実装済**（`checkClosesLanded`） |
// | 2 | 「#4129 は open 継続が正しい」→ 実測 **CLOSED** | **AC1**: `checkStateClaims` |
// | 3 | accepted-residual の受容理由が実測と不一致（世代数 1 件 → 実測 3 件） | **AC3**: `checkClaimedCounts`（件数の形のみ） |
// | 4 | 「起票した Issue（3 件）」→ 実際 **4 件**。label も本文 `state:needs-po` / 実測 `state:needs-dev` + `status:on-hold` | **AC3**（件数）+ **AC1**（label） |
//
// 4 件とも adversarial reviewer が見つけており、audit-manager の目視では追いつかなかった。
// **執筆と merge の間に間隔がある限り構造的に再発する**（Issue 根本原因）。
//
// ## 設計上の制約（あえて narrow にしている）
//
// 本文は自然文なので、「本文が何を主張しているか」を完全に読み取ることはできない。
// **誤検出する gate は無視されるようになり、gate として死ぬ**ので、**確信が持てる形だけを拾う**:
//
// - state 主張: **同一行**に `#N` と状態語（`open` / `CLOSED` 等）が両方あるときだけ
// - label 主張: **同一行**に `#N` と `` `state:*` `` / `` `status:*` `` が両方あるときだけ
// - 件数主張: `(N 件)` 等が**行末寄り**にあり、**直後に markdown 表が始まる**ときだけ
//
// **拾えないもの**は PR 本文に明記する（gate の射程を誤解させない）。

import { describe, expect, it } from 'vitest';
import {
	checkClaimedCounts,
	checkStateClaims,
	extractCountClaims,
	extractStateClaims,
} from '../../../scripts/check-pr-body.mjs';

describe('#4170 AC1 — 本文の state / label 主張を実測と突合', () => {
	describe('抽出（extractStateClaims）', () => {
		it('同一行に #N と状態語があるときだけ拾う', () => {
			const body = [
				'- #4129 は AC 5 件すべて `[ ]` / open 継続が正しい',
				'- #4130 の話。別行に open と書いてあっても拾わない',
				'open',
			].join('\n');
			const claims = extractStateClaims(body);
			expect(claims.map((c) => c.number)).toEqual([4129]);
			expect(claims[0].claimedState).toBe('OPEN');
		});

		it('同一行に #N と state: / status: label があるとき拾う', () => {
			const body = '| #4131 | 起票済 | `state:needs-po` |';
			const claims = extractStateClaims(body);
			expect(claims[0].number).toBe(4131);
			expect(claims[0].claimedLabels).toEqual(['state:needs-po']);
		});

		it('code fence 内は拾わない（例示を主張と読み違えない）', () => {
			const body = ['```', '#4129 は open', '```'].join('\n');
			expect(extractStateClaims(body)).toEqual([]);
		});
	});

	describe('突合（checkStateClaims）', () => {
		const live = new Map([
			[4129, { state: 'CLOSED', labels: ['state:needs-dev', 'status:on-hold'] }],
			[4131, { state: 'OPEN', labels: ['state:needs-dev', 'status:on-hold'] }],
		]);

		// 実害 #2 の再現
		it('open と書いたが実測 CLOSED なら violation', () => {
			const v = checkStateClaims('- #4129 は open 継続が正しい', live);
			expect(v).not.toBeNull();
			expect(v?.message).toContain('#4129');
			expect(v?.message).toContain('CLOSED');
		});

		// 実害 #4 の再現
		it('本文 state:needs-po / 実測 state:needs-dev + status:on-hold なら violation', () => {
			const v = checkStateClaims('| #4131 | 起票済 | `state:needs-po` |', live);
			expect(v).not.toBeNull();
			expect(v?.message).toContain('state:needs-po');
			expect(v?.message).toContain('state:needs-dev');
		});

		it('一致していれば null', () => {
			const v = checkStateClaims('| #4131 | `state:needs-dev` | open |', live);
			expect(v).toBeNull();
		});

		// 実測できなかったものを「一致」と扱わない（fail-closed、ADR-0006）
		it('実測が取れていない番号は violation にする（黙って通さない）', () => {
			const v = checkStateClaims('- #9999 は open', new Map());
			expect(v, '実測不能を silent pass にすると gate が空洞化する').not.toBeNull();
			expect(v?.message).toContain('#9999');
		});
	});
});

describe('#4170 AC3 — 本文が主張する件数と表の行数の一致', () => {
	describe('抽出（extractCountClaims）', () => {
		it('件数主張の直後に表があるときだけ拾う', () => {
			const body = [
				'### 起票した Issue (3 件)',
				'',
				'| Issue | 内容 |',
				'|---|---|',
				'| #1 | a |',
				'| #2 | b |',
			].join('\n');
			const claims = extractCountClaims(body);
			expect(claims).toHaveLength(1);
			expect(claims[0].claimed).toBe(3);
			expect(claims[0].actualRows).toBe(2);
		});

		it('表が続かない件数記述は拾わない（本文中の「3 件」等）', () => {
			const body = '今回は 3 件の指摘があった。詳細は後述する。\n\n本文が続く。';
			expect(extractCountClaims(body)).toEqual([]);
		});

		it('template のプレースホルダ行は数えない', () => {
			const body = [
				'### 含有 PR 一覧 (0 件)',
				'',
				'| PR | title |',
				'|---|---|',
				'| #NNNN | `<title>` |',
			].join('\n');
			const claims = extractCountClaims(body);
			expect(claims[0].actualRows, 'プレースホルダは実データではない').toBe(0);
		});
	});

	// 実害 #4 の再現
	it('「3 件」と書いて表が 4 行なら violation', () => {
		const body = [
			'### 起票した Issue (3 件)',
			'',
			'| Issue | 内容 |',
			'|---|---|',
			'| #1 | a |',
			'| #2 | b |',
			'| #3 | c |',
			'| #4 | d |',
		].join('\n');
		const v = checkClaimedCounts(body);
		expect(v).not.toBeNull();
		expect(v?.message).toContain('3');
		expect(v?.message).toContain('4');
	});

	it('一致していれば null', () => {
		const body = ['### 起票 (2 件)', '', '| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join(
			'\n',
		);
		expect(checkClaimedCounts(body)).toBeNull();
	});
});
