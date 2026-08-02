// tests/unit/architecture/contract-state-matrix-ssot.test.ts
// #4181 AC2 — 設計書 (matrix) と実装 (classifyContractState) の対応を機械検証する。
//
// ## 何が壊れるか
//
// `contract-state-matrix.md` は **人間向けの表**で、実装は **その写し**である（matrix が SSOT）。
// 片方だけ動くと乖離する:
//
//   (a) 表に状態を足したのに実装が追随しない → **新しい状態が分類されず素通りする**
//   (b) 実装に状態を足したのに表に無い       → **表を読んだ人が実装を誤解する**
//
// **(a) と (b) は逆向きなので、両方を assert する。** 片方だけの guard はもう片方を通す。
//
// 装置 ratchet (チーム憲章 #4175 §4.5) に従い **新規 script は作らず** `tests/unit/architecture/` に置く。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INVALID_CONTRACT_STATES, VALID_CONTRACT_STATES } from '$lib/domain/contract-state';

const MATRIX = 'docs/design/billing-redesign/contract-state-matrix.md';

/**
 * matrix の表から状態 id を拾う。
 *
 * 行頭が `| **S1** |` / `| **X1** |` の形（§4 の 2 つの表）だけを拾う。
 * 本文中の `S1` 言及（散文）を拾うと、表から消えたのに検出できなくなる。
 */
function idsFromMatrix(prefix: 'S' | 'X'): string[] {
	const md = readFileSync(MATRIX, 'utf8');
	const ids = new Set<string>();
	for (const line of md.split('\n')) {
		const m = /^\|\s*\*\*([SX]\d+)\*\*\s*\|/.exec(line);
		if (m?.[1]?.startsWith(prefix)) ids.add(m[1]);
	}
	return [...ids].sort();
}

describe('#4181 AC2 matrix と classifyContractState の対応', () => {
	it('正常状態 S* が表と実装で一致する', () => {
		const fromMatrix = idsFromMatrix('S');

		// 母数が空なら「一致している」ではなく「検査できていない」。
		// 表の書式が変わって 0 件になったとき、緑で素通りさせない (#4084 と同じ形)。
		expect(fromMatrix.length, `${MATRIX} から S* を 1 件も抽出できませんでした`).toBeGreaterThan(0);

		expect(
			[...VALID_CONTRACT_STATES].sort(),
			`表 (${MATRIX} §4) と実装 ($lib/domain/contract-state) の S* が食い違っています。` +
				'表に足したなら実装に、実装に足したなら表に、同じ PR で反映してください',
		).toEqual(fromMatrix);
	});

	it('不正状態 X* が表と実装で一致する', () => {
		const fromMatrix = idsFromMatrix('X');
		expect(fromMatrix.length, `${MATRIX} から X* を 1 件も抽出できませんでした`).toBeGreaterThan(0);

		expect(
			[...INVALID_CONTRACT_STATES].sort(),
			`表 (${MATRIX} §4 不正状態) と実装の X* が食い違っています`,
		).toEqual(fromMatrix);
	});

	it('実装が matrix を SSOT として名指ししている', () => {
		const src = readFileSync('src/lib/domain/contract-state.ts', 'utf8');
		expect(
			src,
			'実装が SSOT (matrix) への参照を持っていません。参照が無いと、次に読む人が' +
				'どちらが正なのか判断できません',
		).toContain('contract-state-matrix.md');
	});
});
