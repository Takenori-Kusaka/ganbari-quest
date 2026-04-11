// tests/unit/services/request-context-memoize.test.ts
// #788: request-context によるリクエスト単位 memoize 動作テスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory trial_history store
let trialRows: Array<{
	id: number;
	tenantId: string;
	startDate: string;
	endDate: string;
	tier: string;
	source: string;
	campaignId: string | null;
	createdAt: string;
}> = [];
let nextId = 1;

const findLatestByTenant = vi.fn(async (tenantId: string) => {
	const rows = trialRows.filter((r) => r.tenantId === tenantId).sort((a, b) => b.id - a.id);
	return rows[0];
});
const insert = vi.fn(
	async (input: {
		tenantId: string;
		startDate: string;
		endDate: string;
		tier: string;
		source: string;
		campaignId?: string | null;
	}) => {
		trialRows.push({
			id: nextId++,
			tenantId: input.tenantId,
			startDate: input.startDate,
			endDate: input.endDate,
			tier: input.tier,
			source: input.source,
			campaignId: input.campaignId ?? null,
			createdAt: new Date().toISOString(),
		});
	},
);

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		trialHistory: { findLatestByTenant, insert },
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
	getAuthProvider: () => ({}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runWithRequestContext } from '$lib/server/request-context';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { getTrialStatus, startTrial } from '$lib/server/services/trial-service';

function seedActiveFamilyTrial(tenantId: string) {
	const today = new Date();
	const end = new Date(today);
	end.setDate(end.getDate() + 7);
	const fmt = (d: Date) => d.toISOString().slice(0, 10);
	trialRows.push({
		id: nextId++,
		tenantId,
		startDate: fmt(today),
		endDate: fmt(end),
		tier: 'family',
		source: 'user_initiated',
		campaignId: null,
		createdAt: new Date().toISOString(),
	});
}

describe('request-context memoize (#788)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		trialRows = [];
		nextId = 1;
	});

	describe('getTrialStatus', () => {
		it('同一リクエスト内で複数回呼んでも DB アクセスは1回だけ', async () => {
			seedActiveFamilyTrial('tenant-a');

			await runWithRequestContext(async () => {
				await getTrialStatus('tenant-a');
				await getTrialStatus('tenant-a');
				await getTrialStatus('tenant-a');
			});

			expect(findLatestByTenant).toHaveBeenCalledTimes(1);
		});

		it('リクエストコンテキスト外では毎回 DB を叩く（後方互換）', async () => {
			seedActiveFamilyTrial('tenant-b');

			// コンテキスト外: キャッシュなし、毎回 DB
			await getTrialStatus('tenant-b');
			await getTrialStatus('tenant-b');

			expect(findLatestByTenant).toHaveBeenCalledTimes(2);
		});

		it('異なるテナントはそれぞれキャッシュされる', async () => {
			seedActiveFamilyTrial('tenant-c');
			seedActiveFamilyTrial('tenant-d');

			await runWithRequestContext(async () => {
				await getTrialStatus('tenant-c');
				await getTrialStatus('tenant-d');
				await getTrialStatus('tenant-c'); // cached
				await getTrialStatus('tenant-d'); // cached
			});

			expect(findLatestByTenant).toHaveBeenCalledTimes(2);
		});

		it('別リクエスト間ではキャッシュが独立している', async () => {
			seedActiveFamilyTrial('tenant-e');

			await runWithRequestContext(async () => {
				await getTrialStatus('tenant-e');
			});
			await runWithRequestContext(async () => {
				await getTrialStatus('tenant-e');
			});

			// 各リクエストで1回ずつ = 合計2回
			expect(findLatestByTenant).toHaveBeenCalledTimes(2);
		});
	});

	describe('resolveFullPlanTier', () => {
		it('同一リクエスト内で複数回呼んでも DB アクセスは1回だけ', async () => {
			seedActiveFamilyTrial('tenant-f');

			await runWithRequestContext(async () => {
				// layout が呼ぶ
				const t1 = await resolveFullPlanTier('tenant-f', 'none', undefined);
				// child page.server.ts が呼ぶ
				const t2 = await resolveFullPlanTier('tenant-f', 'none', undefined);
				// 内部サービスが呼ぶ
				const t3 = await resolveFullPlanTier('tenant-f', 'none', undefined);
				expect(t1).toBe('family');
				expect(t2).toBe('family');
				expect(t3).toBe('family');
			});

			expect(findLatestByTenant).toHaveBeenCalledTimes(1);
		});

		it('ライセンス状態が異なればキャッシュキーが別になる', async () => {
			seedActiveFamilyTrial('tenant-g');

			await runWithRequestContext(async () => {
				await resolveFullPlanTier('tenant-g', 'none', undefined);
				await resolveFullPlanTier('tenant-g', 'active', 'standard-monthly');
			});

			// それぞれ resolveFullPlanTier の planTier キャッシュは別だが、
			// getTrialStatus は同じ tenantId で1回だけ呼ばれる
			expect(findLatestByTenant).toHaveBeenCalledTimes(1);
		});
	});

	describe('invalidation', () => {
		it('startTrial 後は同一リクエスト内でも再度 DB が叩かれる', async () => {
			// 事前データなし（isTrialActive=false）の状態からスタート
			await runWithRequestContext(async () => {
				await getTrialStatus('tenant-h'); // 1回目: DB hit (結果: 未使用)

				await startTrial({
					tenantId: 'tenant-h',
					source: 'user_initiated',
					tier: 'standard',
				});

				// startTrial は内部で getTrialStatus を1回呼ぶ。ただしキャッシュから返る。
				// insert 後に invalidate しているので、下の getTrialStatus は DB を再度叩く。
				const status = await getTrialStatus('tenant-h');
				expect(status.isTrialActive).toBe(true);
			});

			// 1回目 + invalidate 後の再読み込み1回 = 2回
			expect(findLatestByTenant).toHaveBeenCalledTimes(2);
		});
	});

	describe('ネストされた runWithRequestContext', () => {
		it('内側の runWithRequestContext は新しいストアを作らず外側を共有する', async () => {
			seedActiveFamilyTrial('tenant-i');

			await runWithRequestContext(async () => {
				await getTrialStatus('tenant-i'); // 1回目: DB hit
				await runWithRequestContext(async () => {
					await getTrialStatus('tenant-i'); // キャッシュヒット（外側のストアを使う）
				});
				await getTrialStatus('tenant-i'); // キャッシュヒット
			});

			expect(findLatestByTenant).toHaveBeenCalledTimes(1);
		});
	});
});
