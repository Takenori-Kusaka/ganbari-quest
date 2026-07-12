// #3575: hashSeed の string childId 化 (FNV-1a 文字列イテレーション) の決定性を固定する。
// 要件は「同一入力 → 同一出力」の決定性のみ。旧 number 版との分布互換は不要
// (§12.2 cutover の backup import は id 非保全 = 自然キー再解決のため)。
import { describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import { hashSeed } from '$lib/server/services/child-challenge-service';

describe('hashSeed (#3575 string id 決定性)', () => {
	it('同一入力は常に同一 seed を返す (決定性)', () => {
		const a = hashSeed(asChildId('903'), '2026-06-29');
		const b = hashSeed(asChildId('903'), '2026-06-29');
		expect(a).toBe(b);
	});

	it('golden value: 入力→出力の対応を固定する (実装変更の意図しない drift を検出)', () => {
		// FNV-1a over '903:2026-06-29' の固定値 (この値が変わる変更は persist 済 seed 由来の
		// 決定性説明と食い違うため、意図的変更時のみ更新する)
		expect(hashSeed(asChildId('903'), '2026-06-29')).toBe(2547006666);
	});

	it('childId が異なれば seed も変わる (child 間独立性)', () => {
		expect(hashSeed(asChildId('903'), '2026-06-29')).not.toBe(
			hashSeed(asChildId('904'), '2026-06-29'),
		);
	});

	it('weekStart が異なれば seed も変わる (週間独立性)', () => {
		expect(hashSeed(asChildId('903'), '2026-06-29')).not.toBe(
			hashSeed(asChildId('903'), '2026-07-06'),
		);
	});

	it('uuid 形式の childId (DSQL 移行後の値空間) でも決定的に動作する', () => {
		const uuid = asChildId('4b7c1c02-9f6e-4d0a-8f0e-6a2f0c9d3b11');
		expect(hashSeed(uuid, '2026-06-29')).toBe(hashSeed(uuid, '2026-06-29'));
		expect(hashSeed(uuid, '2026-06-29')).not.toBe(hashSeed(asChildId('903'), '2026-06-29'));
	});
});
