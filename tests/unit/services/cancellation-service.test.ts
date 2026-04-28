// tests/unit/services/cancellation-service.test.ts
// 解約理由ヒアリング サービスユニットテスト (#1596 / ADR-0023 §3.8 / I3)

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCELLATION_CATEGORY } from '../../../src/lib/domain/labels';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

// Discord 通知は外部副作用なのでモック化
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyCancellationWithReason: vi.fn(async () => undefined),
}));

import {
	getCancellationReasonAggregation,
	searchCancellationFreeText,
	submitCancellationReason,
} from '../../../src/lib/server/services/cancellation-service';

beforeAll(() => {
	const created = createTestDb();
	sqlite = created.sqlite;
	testDb = created.db;
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	resetAllTables(sqlite);
});

describe('cancellation-service', () => {
	describe('submitCancellationReason', () => {
		it('卒業カテゴリで保存できる', async () => {
			const result = await submitCancellationReason({
				tenantId: 'tenant-1',
				category: CANCELLATION_CATEGORY.GRADUATION,
				freeText: '子供が自律してくれました。ありがとうございました！',
				planAtCancellation: 'monthly',
				stripeSubscriptionId: 'sub_test_1',
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.record.category).toBe(CANCELLATION_CATEGORY.GRADUATION);
				expect(result.record.freeText).toContain('自律');
				expect(result.record.tenantId).toBe('tenant-1');
				expect(result.record.planAtCancellation).toBe('monthly');
			}
		});

		it('離反カテゴリで保存できる（自由記述空）', async () => {
			const result = await submitCancellationReason({
				tenantId: 'tenant-2',
				category: CANCELLATION_CATEGORY.CHURN,
				freeText: '',
				planAtCancellation: 'free',
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.record.category).toBe(CANCELLATION_CATEGORY.CHURN);
				expect(result.record.freeText).toBeNull();
			}
		});

		it('中断カテゴリで保存できる', async () => {
			const result = await submitCancellationReason({
				tenantId: 'tenant-3',
				category: CANCELLATION_CATEGORY.PAUSE,
				freeText: '引っ越し予定で一時停止します',
				planAtCancellation: 'family-yearly',
			});

			expect(result.ok).toBe(true);
		});

		it('不正なカテゴリは INVALID_CATEGORY エラー', async () => {
			const result = await submitCancellationReason({
				tenantId: 'tenant-4',
				category: 'invalid-category',
				freeText: null,
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('INVALID_CATEGORY');
			}
		});

		it('空文字カテゴリは INVALID_CATEGORY エラー', async () => {
			const result = await submitCancellationReason({
				tenantId: 'tenant-5',
				category: '',
				freeText: null,
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('INVALID_CATEGORY');
			}
		});

		it('1000 文字を超える自由記述は FREE_TEXT_TOO_LONG エラー', async () => {
			const longText = 'あ'.repeat(1001);
			const result = await submitCancellationReason({
				tenantId: 'tenant-6',
				category: CANCELLATION_CATEGORY.CHURN,
				freeText: longText,
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('FREE_TEXT_TOO_LONG');
			}
		});

		it('1000 文字ちょうどは保存可', async () => {
			const exactText = 'い'.repeat(1000);
			const result = await submitCancellationReason({
				tenantId: 'tenant-7',
				category: CANCELLATION_CATEGORY.CHURN,
				freeText: exactText,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.record.freeText).toHaveLength(1000);
			}
		});

		it('Discord 通知関数が呼び出される', async () => {
			const { notifyCancellationWithReason } = await import(
				'$lib/server/services/discord-notify-service'
			);

			await submitCancellationReason({
				tenantId: 'tenant-discord',
				category: CANCELLATION_CATEGORY.GRADUATION,
				freeText: 'thanks',
				planAtCancellation: 'monthly',
			});

			expect(notifyCancellationWithReason).toHaveBeenCalledWith(
				expect.objectContaining({
					tenantId: 'tenant-discord',
					category: CANCELLATION_CATEGORY.GRADUATION,
					freeText: 'thanks',
					plan: 'monthly',
				}),
			);
		});
	});

	describe('getCancellationReasonAggregation', () => {
		it('カテゴリ別集計を返す', async () => {
			await submitCancellationReason({
				tenantId: 't1',
				category: CANCELLATION_CATEGORY.GRADUATION,
				freeText: 'ok',
			});
			await submitCancellationReason({
				tenantId: 't2',
				category: CANCELLATION_CATEGORY.GRADUATION,
				freeText: 'ok',
			});
			await submitCancellationReason({
				tenantId: 't3',
				category: CANCELLATION_CATEGORY.CHURN,
				freeText: 'sad',
			});

			const agg = await getCancellationReasonAggregation();
			expect(agg.total).toBe(3);

			const grad = agg.breakdown.find(
				(b: { category: string; count: number; percentage: number }) =>
					b.category === CANCELLATION_CATEGORY.GRADUATION,
			);
			expect(grad?.count).toBe(2);
			expect(grad?.percentage).toBeCloseTo(66.7, 0);

			const churn = agg.breakdown.find(
				(b: { category: string; count: number; percentage: number }) =>
					b.category === CANCELLATION_CATEGORY.CHURN,
			);
			expect(churn?.count).toBe(1);

			const pause = agg.breakdown.find(
				(b: { category: string; count: number; percentage: number }) =>
					b.category === CANCELLATION_CATEGORY.PAUSE,
			);
			expect(pause?.count).toBe(0);
			expect(pause?.percentage).toBe(0);
		});

		it('データ無しなら全カテゴリ 0 を返す', async () => {
			const agg = await getCancellationReasonAggregation();
			expect(agg.total).toBe(0);
			expect(agg.breakdown).toHaveLength(3);
			for (const row of agg.breakdown) {
				expect(row.count).toBe(0);
				expect(row.percentage).toBe(0);
			}
		});
	});

	describe('searchCancellationFreeText', () => {
		it('自由記述キーワード検索（部分一致）', async () => {
			await submitCancellationReason({
				tenantId: 't1',
				category: CANCELLATION_CATEGORY.CHURN,
				freeText: '操作が複雑でした',
			});
			await submitCancellationReason({
				tenantId: 't2',
				category: CANCELLATION_CATEGORY.GRADUATION,
				freeText: '子供が自律して必要なくなりました',
			});

			const hits = await searchCancellationFreeText('複雑');
			expect(hits).toHaveLength(1);
			expect(hits[0]?.freeText).toContain('複雑');
		});

		it('検索クエリが空なら全 freeText 件を返す（最新順）', async () => {
			await submitCancellationReason({
				tenantId: 't1',
				category: CANCELLATION_CATEGORY.CHURN,
				freeText: 'first',
			});
			await submitCancellationReason({
				tenantId: 't2',
				category: CANCELLATION_CATEGORY.PAUSE,
				freeText: 'second',
			});

			const hits = await searchCancellationFreeText('');
			expect(hits).toHaveLength(2);
		});

		it('freeText が null のレコードはヒットしない', async () => {
			await submitCancellationReason({
				tenantId: 't1',
				category: CANCELLATION_CATEGORY.CHURN,
				freeText: '',
			});

			const hits = await searchCancellationFreeText('');
			expect(hits).toHaveLength(0);
		});
	});
});
