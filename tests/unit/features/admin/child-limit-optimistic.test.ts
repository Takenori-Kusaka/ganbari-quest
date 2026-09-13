// tests/unit/features/admin/child-limit-optimistic.test.ts
// #4919: 楽観追加件数を加味した上限バナー/ボタンの切り替え計算を固定する。
// E2E (admin-children-add-reflects-immediately.spec.ts) は「一覧へ反映される」「成功文言が出る」を
// 検証し、本 unit test は上限到達の境界値 (プラン切替インフラを要さずに決定的に検証できる部分) を担う。

import { describe, expect, it } from 'vitest';
import { computeOptimisticChildLimit } from '../../../../src/lib/features/admin/child-limit-optimistic';

describe('#4919 computeOptimisticChildLimit', () => {
	it('limit が undefined ならそのまま返す (無制限プラン等)', () => {
		expect(computeOptimisticChildLimit(undefined, 1)).toBeUndefined();
	});

	it('楽観追加が 0 件なら limit をそのまま返す', () => {
		const limit = { allowed: true, current: 1, max: 2 };
		expect(computeOptimisticChildLimit(limit, 0)).toBe(limit);
	});

	it('楽観追加後も上限未満なら allowed のまま current だけ増える', () => {
		const limit = { allowed: true, current: 0, max: 2 };
		expect(computeOptimisticChildLimit(limit, 1)).toEqual({ allowed: true, current: 1, max: 2 });
	});

	it('楽観追加で上限に到達すると allowed が即座に false へ切り替わる', () => {
		// #4919 AC1: 「上限到達時はその場でバナー/ボタンが切り替わる」の境界値
		const limit = { allowed: true, current: 1, max: 2 };
		expect(computeOptimisticChildLimit(limit, 1)).toEqual({ allowed: false, current: 2, max: 2 });
	});

	it('max が null (無制限) なら current が増えても常に allowed', () => {
		const limit = { allowed: true, current: 5, max: null };
		expect(computeOptimisticChildLimit(limit, 3)).toEqual({ allowed: true, current: 8, max: null });
	});

	it('複数件の楽観追加を一度に加算できる', () => {
		const limit = { allowed: true, current: 0, max: 3 };
		expect(computeOptimisticChildLimit(limit, 3)).toEqual({ allowed: false, current: 3, max: 3 });
	});
});
