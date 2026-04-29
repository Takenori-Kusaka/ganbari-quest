// tests/unit/services/graduation-service.test.ts
// 卒業フロー サービスユニットテスト (#1603 / ADR-0023 §3.8 / §5 I10)

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

import {
	calculateUsagePeriodDays,
	GRADUATION_MESSAGE_MAX_LENGTH,
	GRADUATION_NICKNAME_MAX_LENGTH,
	getGraduationStats,
	recordGraduationConsent,
} from '../../../src/lib/server/services/graduation-service';

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

describe('graduation-service', () => {
	describe('recordGraduationConsent', () => {
		it('承諾あり (consented=true) で保存できる', async () => {
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: 'たろうくん家',
				consented: true,
				userPoints: 1500,
				usagePeriodDays: 365,
				message: '長い間ありがとうございました。',
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.record.tenantId).toBe('tenant-1');
			expect(result.record.nickname).toBe('たろうくん家');
			expect(result.record.consented).toBe(true);
			expect(result.record.userPoints).toBe(1500);
			expect(result.record.usagePeriodDays).toBe(365);
			expect(result.record.message).toBe('長い間ありがとうございました。');
		});

		it('承諾なし (consented=false) でも保存できる (KPI には含む)', async () => {
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: '匿名の卒業生',
				consented: false,
				userPoints: 800,
				usagePeriodDays: 200,
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.record.consented).toBe(false);
			expect(result.record.message).toBeNull();
		});

		it('nickname が空の場合 NICKNAME_REQUIRED エラー', async () => {
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: '',
				consented: true,
				userPoints: 100,
				usagePeriodDays: 30,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error).toBe('NICKNAME_REQUIRED');
		});

		it('nickname が空白のみでも NICKNAME_REQUIRED エラー', async () => {
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: '   ',
				consented: false,
				userPoints: 100,
				usagePeriodDays: 30,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error).toBe('NICKNAME_REQUIRED');
		});

		it('nickname が 30 文字超で NICKNAME_TOO_LONG エラー', async () => {
			const longNickname = 'a'.repeat(GRADUATION_NICKNAME_MAX_LENGTH + 1);
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: longNickname,
				consented: true,
				userPoints: 100,
				usagePeriodDays: 30,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error).toBe('NICKNAME_TOO_LONG');
		});

		it('message が 500 文字超で MESSAGE_TOO_LONG エラー', async () => {
			const longMessage = 'あ'.repeat(GRADUATION_MESSAGE_MAX_LENGTH + 1);
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: 'テスト家',
				consented: true,
				userPoints: 100,
				usagePeriodDays: 30,
				message: longMessage,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error).toBe('MESSAGE_TOO_LONG');
		});

		it('userPoints / usagePeriodDays は負数を 0 に丸める', async () => {
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: 'テスト家',
				consented: false,
				userPoints: -50,
				usagePeriodDays: -10,
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.record.userPoints).toBe(0);
			expect(result.record.usagePeriodDays).toBe(0);
		});

		it('nickname の前後空白は trim される', async () => {
			const result = await recordGraduationConsent({
				tenantId: 'tenant-1',
				nickname: '  たろう家  ',
				consented: true,
				userPoints: 0,
				usagePeriodDays: 0,
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.record.nickname).toBe('たろう家');
		});
	});

	describe('getGraduationStats', () => {
		it('データが無いときは 0 件 + graduationRate=0', async () => {
			const stats = await getGraduationStats(90);
			expect(stats.totalGraduations).toBe(0);
			expect(stats.consentedCount).toBe(0);
			expect(stats.avgUsagePeriodDays).toBe(0);
			expect(stats.totalCancellations).toBe(0);
			expect(stats.graduationRate).toBe(0);
			expect(stats.publicSamples).toEqual([]);
		});

		it('卒業者数 / 平均利用期間 / 公開承諾数を集計できる', async () => {
			await recordGraduationConsent({
				tenantId: 't1',
				nickname: 'A 家',
				consented: true,
				userPoints: 1000,
				usagePeriodDays: 365,
				message: 'ありがとうございました',
			});
			await recordGraduationConsent({
				tenantId: 't2',
				nickname: 'B 家',
				consented: false,
				userPoints: 500,
				usagePeriodDays: 200,
			});
			await recordGraduationConsent({
				tenantId: 't3',
				nickname: 'C 家',
				consented: true,
				userPoints: 2000,
				usagePeriodDays: 600,
				message: '感謝',
			});

			const stats = await getGraduationStats(90);
			expect(stats.totalGraduations).toBe(3);
			expect(stats.consentedCount).toBe(2);
			expect(stats.avgUsagePeriodDays).toBe(388.3); // (365+200+600)/3 = 388.33...
		});

		it('公開可能事例 (consented=true かつ message あり) のみ publicSamples に含む', async () => {
			await recordGraduationConsent({
				tenantId: 't1',
				nickname: 'A 家',
				consented: true,
				userPoints: 1000,
				usagePeriodDays: 365,
				message: 'message-a',
			});
			await recordGraduationConsent({
				tenantId: 't2',
				nickname: 'B 家',
				consented: false,
				userPoints: 500,
				usagePeriodDays: 200,
				message: 'message-b-not-public',
			});
			await recordGraduationConsent({
				tenantId: 't3',
				nickname: 'C 家',
				consented: true,
				userPoints: 0,
				usagePeriodDays: 0,
				// message なし
			});

			const stats = await getGraduationStats(90);
			expect(stats.publicSamples).toHaveLength(1);
			expect(stats.publicSamples[0]?.nickname).toBe('A 家');
			expect(stats.publicSamples[0]?.message).toBe('message-a');
		});
	});

	describe('calculateUsagePeriodDays', () => {
		it('利用日数を正しく計算する', () => {
			const created = new Date('2026-01-01T00:00:00Z').toISOString();
			const now = new Date('2026-04-01T00:00:00Z');
			const days = calculateUsagePeriodDays(created, now);
			expect(days).toBe(90);
		});

		it('未来の日付の場合は 0 を返す', () => {
			const created = new Date('2027-01-01T00:00:00Z').toISOString();
			const now = new Date('2026-01-01T00:00:00Z');
			expect(calculateUsagePeriodDays(created, now)).toBe(0);
		});

		it('不正な日付文字列の場合は 0 を返す', () => {
			expect(calculateUsagePeriodDays('not-a-date')).toBe(0);
		});

		it('同日の場合は 0 を返す', () => {
			const created = new Date('2026-04-01T00:00:00Z').toISOString();
			const now = new Date('2026-04-01T00:00:00Z');
			expect(calculateUsagePeriodDays(created, now)).toBe(0);
		});
	});
});
