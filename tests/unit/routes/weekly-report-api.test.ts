// tests/unit/routes/weekly-report-api.test.ts
// #735: /api/v1/admin/weekly-report のプランゲート検証
//
// HP の /pricing で「週次メールレポート」は standard+ 特典として明示されているのに、
// 旧実装は全テナント（無料プラン含む）に配信していた。本テストは
//  - free プランでは sendWeeklyReportEmail が 1 度も呼ばれない
//  - standard / family プランでは各子供分 sendWeeklyReportEmail が呼ばれる
//  - テナント情報が取れない場合は安全側に倒して送信しない
//  - CRON_SECRET が不一致なら 401（プランゲートより前に弾く）
// の 4 点を保証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---

const mockSendWeeklyReportEmail = vi.fn();
vi.mock('$lib/server/services/email-service', () => ({
	sendWeeklyReportEmail: (...args: unknown[]) => mockSendWeeklyReportEmail(...args),
}));

const mockGetLicenseInfo = vi.fn();
vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
}));

const mockResolveFullPlanTier = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/admin/weekly-report/+server');

// --- ヘルパ ---

type ChildReport = {
	childName: string;
	weekStart: string;
	weekEnd: string;
	totalActivities: number;
	totalPoints: number;
	categories: { name: string; count: number; points: number }[];
};

function makeChildren(count: number): ChildReport[] {
	return Array.from({ length: count }, (_, i) => ({
		childName: `子供${i + 1}`,
		weekStart: '2026-04-01',
		weekEnd: '2026-04-07',
		totalActivities: 5,
		totalPoints: 50,
		categories: [{ name: 'うんどう', count: 5, points: 50 }],
	}));
}

function makeEvent(
	opts: {
		tenantId?: string;
		ownerEmail?: string;
		childCount?: number;
		cronSecret?: string | null;
	} = {},
) {
	const body = JSON.stringify({
		tenantId: opts.tenantId ?? 'tenant-test',
		ownerEmail: opts.ownerEmail ?? 'parent@example.com',
		children: makeChildren(opts.childCount ?? 2),
	});
	const headers = new Headers({ 'Content-Type': 'application/json' });
	if (opts.cronSecret !== null && opts.cronSecret !== undefined) {
		headers.set('x-cron-secret', opts.cronSecret);
	}
	const request = new Request('http://localhost/api/v1/admin/weekly-report', {
		method: 'POST',
		headers,
		body,
	});
	return { request } as unknown as Parameters<typeof POST>[0];
}

function primeLicense(tier: 'free' | 'standard' | 'family' | null) {
	if (tier === null) {
		mockGetLicenseInfo.mockResolvedValue(null);
		return;
	}
	mockGetLicenseInfo.mockResolvedValue({
		plan: tier === 'free' ? 'free' : `${tier}_monthly`,
		status: tier === 'free' ? 'none' : 'active',
		tenantName: 'Test Tenant',
		createdAt: '2026-01-01',
		updatedAt: '2026-01-01',
	});
	mockResolveFullPlanTier.mockResolvedValue(tier);
}

// --- テスト ---

describe('POST /api/v1/admin/weekly-report (#735 プランゲート)', () => {
	const ORIGINAL_ENV = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		// CRON_SECRET / AUTH_MODE は各テストで明示的に設定
		process.env = { ...ORIGINAL_ENV };
		delete process.env.CRON_SECRET;
		delete process.env.AUTH_MODE;
		process.env.AUTH_MODE = 'local'; // default: 認証をバイパス（CRON_SECRET 未設定でも通す）
		mockSendWeeklyReportEmail.mockResolvedValue(true);
	});

	it('無料プランは送信スキップし skipped:"free_plan" を返す（SES コスト流出防止）', async () => {
		primeLicense('free');

		const response = await POST(makeEvent({ childCount: 3 }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.sent).toBe(0);
		expect(body.total).toBe(3);
		expect(body.skipped).toBe('free_plan');
		// ガード条件: send が 1 度も呼ばれていないこと（無料ユーザーに 1 通でも届けば NG）
		expect(mockSendWeeklyReportEmail).not.toHaveBeenCalled();
	});

	it('standard プランでは全子供分 sendWeeklyReportEmail が呼ばれる', async () => {
		primeLicense('standard');

		const response = await POST(makeEvent({ childCount: 2, ownerEmail: 'pro@example.com' }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.sent).toBe(2);
		expect(body.total).toBe(2);
		expect(body.skipped).toBeUndefined();
		expect(mockSendWeeklyReportEmail).toHaveBeenCalledTimes(2);
		// 宛先は全て ownerEmail
		for (const call of mockSendWeeklyReportEmail.mock.calls) {
			expect(call[0]).toBe('pro@example.com');
		}
	});

	it('family プランでは全子供分 sendWeeklyReportEmail が呼ばれる', async () => {
		primeLicense('family');

		const response = await POST(makeEvent({ childCount: 4 }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.sent).toBe(4);
		expect(body.total).toBe(4);
		expect(mockSendWeeklyReportEmail).toHaveBeenCalledTimes(4);
	});

	it('トライアル中（tier=standard）は free ではないので送信される', async () => {
		// resolveFullPlanTier がトライアル解決済みで standard を返すケース
		mockGetLicenseInfo.mockResolvedValue({
			plan: 'free',
			status: 'none',
			tenantName: 'Trial Tenant',
			createdAt: '2026-01-01',
			updatedAt: '2026-01-01',
		});
		mockResolveFullPlanTier.mockResolvedValue('standard');

		const response = await POST(makeEvent({ childCount: 1 }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.sent).toBe(1);
		expect(mockSendWeeklyReportEmail).toHaveBeenCalledTimes(1);
	});

	it('テナント情報が見つからない場合は送信スキップ（安全側）', async () => {
		primeLicense(null);

		const response = await POST(makeEvent({ childCount: 2 }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.sent).toBe(0);
		expect(body.skipped).toBe('tenant_not_found');
		expect(mockSendWeeklyReportEmail).not.toHaveBeenCalled();
		// プラン解決すら呼ばれない（先に弾く）
		expect(mockResolveFullPlanTier).not.toHaveBeenCalled();
	});

	it('CRON_SECRET が設定されていて x-cron-secret ヘッダが不一致なら 401（プラン解決前に拒否）', async () => {
		process.env.AUTH_MODE = 'saas';
		process.env.CRON_SECRET = 'correct-secret';

		const response = await POST(makeEvent({ cronSecret: 'wrong-secret' }));

		expect(response.status).toBe(401);
		expect(mockGetLicenseInfo).not.toHaveBeenCalled();
		expect(mockSendWeeklyReportEmail).not.toHaveBeenCalled();
	});

	it('CRON_SECRET が一致しプランが standard なら正常に送信される', async () => {
		process.env.AUTH_MODE = 'saas';
		process.env.CRON_SECRET = 'correct-secret';
		primeLicense('standard');

		const response = await POST(makeEvent({ cronSecret: 'correct-secret', childCount: 1 }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.sent).toBe(1);
	});

	it('SaaS モード + CRON_SECRET 未設定は 500（運用ミスの早期検知）', async () => {
		process.env.AUTH_MODE = 'saas';
		delete process.env.CRON_SECRET;

		const response = await POST(makeEvent({}));

		expect(response.status).toBe(500);
		expect(mockGetLicenseInfo).not.toHaveBeenCalled();
		expect(mockSendWeeklyReportEmail).not.toHaveBeenCalled();
	});

	it('一部の送信が失敗しても全件試行し sent は成功数のみカウント', async () => {
		primeLicense('family');
		// 1 件目成功、2 件目失敗、3 件目成功
		mockSendWeeklyReportEmail
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);

		const response = await POST(makeEvent({ childCount: 3 }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.sent).toBe(2);
		expect(body.total).toBe(3);
		expect(mockSendWeeklyReportEmail).toHaveBeenCalledTimes(3);
	});
});
