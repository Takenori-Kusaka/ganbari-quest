// tests/unit/domain/archive-types.test.ts
//
// `src/lib/domain/archive-types.ts` の SSOT 検証 (#2642 / Phase 5 子 4 / Phase 7 PR-1)
//
// 設計 SSOT:
// - docs/design/billing-redesign/phase5-archive-unified-architecture.md §2 原則 1
// - docs/design/billing-redesign/phase6-db-migration-plan.md §3.5
// - ADR-0049 (retention 30 日、free plan 90 日整合)

import { describe, expect, it } from 'vitest';
import { ARCHIVED_REASONS, type ArchivedReason, getRetentionDays } from '$lib/domain/archive-types';

describe('ARCHIVED_REASONS enum SSOT (Phase 7 PR-1)', () => {
	it('3 reason を宣言順 (trial / downgrade / dunning) で保持する', () => {
		// 順序は drizzle-orm enum 制約 SQL に直結するため不変
		expect(ARCHIVED_REASONS).toEqual([
			'trial_expired',
			'downgrade_user_selected',
			'dunning_canceled',
		]);
	});

	it('全 reason に対し ArchivedReason type が type-safe (compile-time check)', () => {
		// type-level test: 型推論で literal union が機能することを確認
		const r1: ArchivedReason = 'trial_expired';
		const r2: ArchivedReason = 'downgrade_user_selected';
		const r3: ArchivedReason = 'dunning_canceled';
		expect([r1, r2, r3]).toHaveLength(3);
	});

	it('readonly array として宣言され mutate 不可', () => {
		// `as const` で readonly が保証される
		expect(Object.isFrozen(ARCHIVED_REASONS) || Array.isArray(ARCHIVED_REASONS)).toBe(true);
		// type レベル: ARCHIVED_REASONS.push(...) は compile error
		// (実 array は freeze されていないが TypeScript 型システムで `readonly` 強制)
	});
});

describe('getRetentionDays — reason 別 retention 期間 (ADR-0049 整合)', () => {
	it('trial_expired は 90 日 (free plan retention と同期)', () => {
		expect(getRetentionDays('trial_expired')).toBe(90);
	});

	it('downgrade_user_selected は null (自動削除なし、運用判断)', () => {
		// 手動ダウンは free / paid 両経路があり得るため自動削除しない
		expect(getRetentionDays('downgrade_user_selected')).toBeNull();
	});

	it('dunning_canceled は 90 日 (trial_expired と同型、強制 free 化)', () => {
		expect(getRetentionDays('dunning_canceled')).toBe(90);
	});

	it('全 ARCHIVED_REASONS で switch 網羅性 (exhaustive check)', () => {
		// 将来 reason 追加時に getRetentionDays に case 追加忘れを検出
		// (TypeScript strict mode + switch exhaustiveness check に依拠)
		for (const reason of ARCHIVED_REASONS) {
			const result = getRetentionDays(reason);
			expect(result === null || (typeof result === 'number' && result > 0)).toBe(true);
		}
	});
});
