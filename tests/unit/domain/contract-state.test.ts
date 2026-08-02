// tests/unit/domain/contract-state.test.ts
// #4181 AC1 — `families` の 4 列を contract-state-matrix.md §4 の S1〜S6 / X1〜X4 に分類する。
//
// ## なぜ表だけでは足りないか
//
// 契約状態の書き手は **9 箇所**ある（matrix §5）。表は「どの組み合わせが正しいか」を
// 人間向けに書いたもので、**新しい webhook handler が表に無い組み合わせを書いても誰も気づかない**。
// 4 列は課金状態そのもので、顧客の請求と機能解放に直結する。
//
// ## 本 test が固定する契約
//
// 分類は **4 列の全組み合わせ (4 × 2 × 2 × 2 = 32) に対して全域**であること。
// 「どれにも当てはまらない」を暗黙に S1 や X1 へ丸めると、**表に無い状態が正常として通る**。
// 当てはまらないものは `UNCLASSIFIED` として明示的に返す（silent gap を作らない、AC4 整合）。

import { describe, expect, it } from 'vitest';
import {
	type ContractStateClassification,
	classifyContractState,
	isInvalidContractState,
} from '$lib/domain/contract-state';

/** matrix §4 の 4 列。`sub` / `exp` は「あり/なし」だけが分類に効く。 */
function row(
	status: string,
	plan: string | null,
	sub: string | null,
	exp: string | null,
): Parameters<typeof classifyContractState>[0] {
	return { status, plan, stripeSubscriptionId: sub, planExpiresAt: exp };
}

const PLAN = 'standard';
const SUB = 'sub_123';
const EXP = '2026-09-01T00:00:00.000Z';

describe('#4181 AC1 classifyContractState — matrix §4 の正常状態', () => {
	it('S1 未課金: active / plan なし / sub なし / exp なし', () => {
		expect(classifyContractState(row('active', null, null, null))).toBe('S1');
	});

	it('S2 課金中: active / plan あり / sub あり / exp なし', () => {
		expect(classifyContractState(row('active', PLAN, SUB, null))).toBe('S2');
	});

	it('S3 支払い失敗猶予: grace_period / plan あり / sub あり / exp あり', () => {
		expect(classifyContractState(row('grace_period', PLAN, SUB, EXP))).toBe('S3');
	});

	// S4 の exp は matrix で「任意」
	it.each([null, EXP])('S4 停止: suspended / plan あり / sub あり / exp=%s', (exp) => {
		expect(classifyContractState(row('suspended', PLAN, SUB, exp))).toBe('S4');
	});

	it('S5 契約終了: suspended / plan なし / sub なし / exp なし', () => {
		expect(classifyContractState(row('suspended', null, null, null))).toBe('S5');
	});

	// S6 は matrix §4 で plan / sub / exp が「任意」。**他のどの判定よりも先に効く**
	// （terminated は退会済みの印で、4 列の残骸が何であれ意味が変わらないため）。
	it.each([
		[null, null, null],
		[PLAN, SUB, EXP],
		[PLAN, null, null],
	])('S6 退会済: terminated は plan/sub/exp が任意 (%s,%s,%s)', (plan, sub, exp) => {
		expect(classifyContractState(row('terminated', plan, sub, exp))).toBe('S6');
	});
});

describe('#4181 AC1 classifyContractState — matrix §4 の不正状態', () => {
	// X1: 契約が無いのにプランだけ残る
	it('X1 sub なし + plan あり', () => {
		expect(classifyContractState(row('suspended', PLAN, null, null))).toBe('X1');
	});

	// X2: 課金しているのにプラン不明 → planTier が standard に丸められ premium 契約者が standard 扱いになる
	it('X2 sub あり + plan なし', () => {
		expect(classifyContractState(row('suspended', null, SUB, null))).toBe('X2');
	});

	// X3: active に期限は無い。dunning / 解約の残骸 (matrix §5 D2)
	it('X3 status=active + exp あり', () => {
		expect(classifyContractState(row('active', PLAN, SUB, EXP))).toBe('X3');
	});

	// X4: 猶予の対象となる契約が存在しない
	it('X4 status=grace_period + sub なし', () => {
		expect(classifyContractState(row('grace_period', PLAN, null, EXP))).toBe('X4');
	});

	it('isInvalidContractState が X* だけを true にする', () => {
		expect(isInvalidContractState('X1')).toBe(true);
		expect(isInvalidContractState('X4')).toBe(true);
		expect(isInvalidContractState('S2')).toBe(false);
		// UNCLASSIFIED は「不正と判っている」ではなく「表に無い」。両者を混ぜない
		expect(isInvalidContractState('UNCLASSIFIED')).toBe(false);
	});
});

describe('#4181 AC1 classifyContractState — 4 列の全組み合わせで全域である', () => {
	const STATUSES = ['active', 'grace_period', 'suspended', 'terminated'];
	const ALL: { input: ReturnType<typeof row>; result: ContractStateClassification }[] = [];

	for (const status of STATUSES) {
		for (const plan of [null, PLAN]) {
			for (const sub of [null, SUB]) {
				for (const exp of [null, EXP]) {
					const input = row(status, plan, sub, exp);
					ALL.push({ input, result: classifyContractState(input) });
				}
			}
		}
	}

	it('32 通りすべてが例外なく分類される', () => {
		expect(ALL).toHaveLength(32);
		for (const { input, result } of ALL) {
			expect(result, `未分類で落ちた: ${JSON.stringify(input)}`).toBeTruthy();
		}
	});

	// **表が全域でないことを、丸めずに可視化する。**
	// matrix §4 は 32 通りのうち 2 つを定義していない。ここを S* に丸めると
	// 「表に無い状態が正常として通る」ことになり、本 Issue の目的を裏切る。
	it('表に無い 2 通りは UNCLASSIFIED として明示される (丸めない)', () => {
		const unclassified = ALL.filter((e) => e.result === 'UNCLASSIFIED').map((e) => e.input);

		expect(unclassified).toEqual([
			// 猶予なのに期限が無い
			row('grace_period', PLAN, SUB, null),
			// 契約が無いのに期限だけ残る (suspended 版。active 版は X3 が拾う)
			row('suspended', null, null, EXP),
		]);
	});
});
