// tests/unit/routes/export-cloud-plan-vs-quota.test.ts (#4710)
//
// **契約済みの顧客に「契約してください」と案内しない**ことを route 応答で固定する。
//
// # なぜ必要か
//
// `POST /api/v1/export/cloud` は起票時に 2 つの理由で同期的に弾く:
//   1. プラン未達 … その tier にクラウドエクスポート機能が無い (free: maxCloudExports=0)
//   2. 保管上限 … 機能はあるが枠が埋まっている (standard=3 / family=10)
//
// 旧実装は両方を素の `Error` で throw し、route が `message.includes('スタンダード') ||
// message.includes('上限')` で拾って**両方とも** `planLimitError('standard', …)` に潰していた。
// 結果、**スタンダード契約中の顧客が 3 件目で上限に達すると「この機能はスタンダードプラン以上で
// ご利用いただけます」**と返っていた (#4710 の症状そのもの)。既に契約しているので次の行動が無く、
// family (最上位・10 件) の顧客に至ってはアップグレード先すら存在しない。
//
// 加えて部分一致判定はプラン名を変えた瞬間に外れ、403 が 500 に化ける。
//
// # 何を fail させるか
//
// 上限到達の応答にプラン案内文言が戻ること / 上限到達が 500 になること /
// 逆にプラン未達の応答から tier 案内が消えること。

import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockPlanTier = 'standard';
let mockStoredCount = 0;

// #4767 (QM): 保管数は「顧客が一覧で見て削除できる live 行」で数える (listCloudExports と同じ述語)。
// 期限切れ / DL 回数を使い切った行は数えない。
const FUTURE = '2999-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';
let mockExpiredCount = 0;
function liveRow(i: number, expiresAt: string) {
	return {
		id: `e-${i}`,
		tenantId: 't-1',
		pinCode: `00000${i}`,
		expiresAt,
		downloadCount: 0,
		maxDownloads: 3,
		status: 'ready',
	};
}
const mockCloudExportRepo = {
	countByTenant: vi.fn(async () => mockStoredCount + mockExpiredCount),
	findByTenant: vi.fn(async () => [
		...Array.from({ length: mockStoredCount }, (_, i) => liveRow(i, FUTURE)),
		...Array.from({ length: mockExpiredCount }, (_, i) => liveRow(100 + i, PAST)),
	]),
	findByPin: vi.fn(async () => null),
	insert: vi.fn(async (input: Record<string, unknown>) => ({ id: '1', ...input })),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ cloudExport: mockCloudExportRepo }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: vi.fn(async () => mockPlanTier),
	getPlanLimits: (tier: string) =>
		({
			free: { maxCloudExports: 0 },
			standard: { maxCloudExports: 3 },
			family: { maxCloudExports: 10 },
		})[tier] ?? { maxCloudExports: 0 },
}));

// build 経路 (cron) は本 test の対象外。module 読み込みだけ通す。
vi.mock('$lib/server/services/export-service', () => ({
	exportFamilyData: vi.fn(),
	exportFamilyDataForZip: vi.fn(),
}));

import { POST } from '../../../src/routes/api/v1/export/cloud/+server';

interface ApiErrorBody {
	error: { code: string; message: string; userMessage: string };
}

async function postCloudExport(tier: string, storedCount: number, expiredCount = 0) {
	mockPlanTier = tier;
	mockStoredCount = storedCount;
	mockExpiredCount = expiredCount;
	const res = (await POST({
		request: new Request('http://localhost/api/v1/export/cloud', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ exportType: 'template' }),
		}),
		locals: {
			context: { tenantId: 't-1', role: 'owner', licenseStatus: 'active', plan: tier },
		},
	} as never)) as Response;
	return { status: res.status, body: (await res.json()) as ApiErrorBody };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockCloudExportRepo.findByPin.mockImplementation(async () => null);
	mockCloudExportRepo.insert.mockImplementation(async (input: Record<string, unknown>) => ({
		id: '1',
		...input,
	}));
});

describe('#4710 POST /api/v1/export/cloud — プラン未達と保管上限を混同しない', () => {
	it('期限切れの残骸は保管枠を食わない (画面の枠表示 2 / 3 と 403 が食い違わない、QM #4767)', async () => {
		// live 2 件 + 期限切れ 5 件: 旧実装は全 7 行を数えて 403 にしていた
		const { status } = await postCloudExport('standard', 2, 5);
		expect(status).toBe(201);
	});

	it('DL 回数を使い切った行は期限内なら枠を食う (S3 に残る PII の ZIP に天井を残す、QM #4767)', async () => {
		// この test だけ差し替える (mockResolvedValue は clearAllMocks で戻らないため Once)
		mockCloudExportRepo.findByTenant.mockResolvedValueOnce(
			Array.from({ length: 3 }, (_, i) => ({ ...liveRow(i, FUTURE), downloadCount: 3 })),
		);
		const { status, body } = await postCloudExport('standard', 0);
		expect(status).toBe(403);
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
	});

	it('プラン未達 (free) は 403 + 要求 tier を案内する', async () => {
		const { status, body } = await postCloudExport('free', 0);

		expect(status).toBe(403);
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		expect(body.error.userMessage).toContain('スタンダードプラン以上');
	});

	it('保管上限 (standard 契約中) は 403 だが、プランではなく削除を案内する', async () => {
		const { status, body } = await postCloudExport('standard', 3);

		expect(status).toBe(403);
		// 契約済みの顧客に「契約してください」と言わない。userMessage / message の両方を見る
		// (管理画面は message を、ADR-0062 の契約は userMessage を読むため、どちらも顧客に届く)。
		for (const shown of [body.error.userMessage, body.error.message]) {
			expect(shown).not.toContain('スタンダードプラン以上');
			expect(shown).not.toContain('アップグレード');
			expect(shown).toContain('削除');
			// 次に何件まで保管できるかが分かる
			expect(shown).toContain('3件');
		}
	});

	it('保管上限 (family = 最上位) でもプラン案内に落ちない', async () => {
		const { status, body } = await postCloudExport('family', 10);

		expect(status).toBe(403);
		expect(body.error.userMessage).not.toContain('アップグレード');
		expect(body.error.userMessage).toContain('10件');
	});

	it('上限内なら 201 で起票される (上の 403 が単なる無条件拒否でないことの対照)', async () => {
		mockPlanTier = 'standard';
		mockStoredCount = 1;
		const res = (await POST({
			request: new Request('http://localhost/api/v1/export/cloud', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ exportType: 'template' }),
			}),
			locals: {
				context: { tenantId: 't-1', role: 'owner', licenseStatus: 'active', plan: 'standard' },
			},
		} as never)) as Response;

		expect(res.status).toBe(201);
		expect(mockCloudExportRepo.insert).toHaveBeenCalledOnce();
	});
});
