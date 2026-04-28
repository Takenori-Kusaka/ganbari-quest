// tests/unit/services/pmf-survey-service.test.ts
// #1598 (ADR-0023 §3.6 §5 I7): PMF 判定アンケートサービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/runtime/env', () => ({
	getEnv: () => ({
		APP_BASE_URL: 'http://localhost:5173',
		OPS_SECRET_KEY: 'test-survey-secret-key-32-bytes!',
		AUTH_MODE: 'local',
	}),
}));

// ============================================================
// Mocks
// ============================================================

const mockListAllTenants = vi.fn();
const mockFindTenantMembers = vi.fn();
const mockFindUserById = vi.fn();
const settingsStore = new Map<string, string>();
const mockGetSetting = vi.fn(async (key: string, tenantId: string) =>
	settingsStore.get(`${tenantId}:${key}`),
);
const mockSetSetting = vi.fn(async (key: string, value: string, tenantId: string) => {
	settingsStore.set(`${tenantId}:${key}`, value);
});

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			listAllTenants: mockListAllTenants,
			findTenantMembers: mockFindTenantMembers,
			findUserById: mockFindUserById,
		},
		settings: {
			getSetting: mockGetSetting,
			setSetting: mockSetSetting,
			getSettings: vi.fn(),
		},
	}),
}));

const mockSendPmfSurvey = vi.fn(async (_params: unknown) => true);

vi.mock('../../../src/lib/server/services/email-service', () => ({
	sendPmfSurveyEmail: (params: unknown) => mockSendPmfSurvey(params),
}));

import {
	aggregateSurveyResponses,
	daysSinceCreated,
	getCurrentRound,
	hasAnsweredSurvey,
	PMF_SURVEY_MIN_TENURE_DAYS,
	PMF_THRESHOLD,
	type PmfSurveyResponse,
	runPmfSurveyDistribution,
	saveSurveyResponse,
} from '../../../src/lib/server/services/pmf-survey-service';

// ============================================================
// Helpers
// ============================================================

const NOW = new Date('2026-06-15T01:00:00Z');

function makeTenant(
	overrides: Partial<{
		tenantId: string;
		createdAt: string;
	}> = {},
) {
	return {
		tenantId: overrides.tenantId ?? 't-1',
		name: 'テスト家族',
		ownerId: 'u-1',
		status: 'active',
		plan: 'standard-monthly',
		planExpiresAt: '2027-01-01T00:00:00Z',
		lastActiveAt: '2026-06-14T00:00:00Z',
		createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
		updatedAt: '2026-04-01T00:00:00Z',
	};
}

function setupSingleTenantWithOwner(tenant = makeTenant()) {
	mockListAllTenants.mockResolvedValueOnce([tenant]);
	mockFindTenantMembers.mockResolvedValueOnce([
		{ userId: 'u-1', tenantId: tenant.tenantId, role: 'owner', joinedAt: '2026-01-01' },
	]);
	mockFindUserById.mockResolvedValueOnce({
		userId: 'u-1',
		email: 'owner@example.com',
		provider: 'cognito',
		displayName: 'テスト オーナー',
		createdAt: '2026-01-01',
		updatedAt: '2026-01-01',
	});
}

beforeEach(() => {
	settingsStore.clear();
	mockListAllTenants.mockReset();
	mockFindTenantMembers.mockReset();
	mockFindUserById.mockReset();
	mockGetSetting.mockClear();
	mockSetSetting.mockClear();
	mockSendPmfSurvey.mockClear();
	mockSendPmfSurvey.mockImplementation(async () => true);
});

afterEach(() => {
	vi.clearAllTimers();
});

// ============================================================
// helpers (pure)
// ============================================================

describe('#1598 pmf-survey-service — pure helpers', () => {
	it('getCurrentRound returns YYYY-H1 for January-June', () => {
		expect(getCurrentRound(new Date('2026-01-01'))).toBe('2026-H1');
		expect(getCurrentRound(new Date('2026-06-30'))).toBe('2026-H1');
	});

	it('getCurrentRound returns YYYY-H2 for July-December', () => {
		expect(getCurrentRound(new Date('2026-07-01'))).toBe('2026-H2');
		expect(getCurrentRound(new Date('2026-12-31'))).toBe('2026-H2');
	});

	it('daysSinceCreated returns floored day count', () => {
		expect(daysSinceCreated('2026-01-01T00:00:00Z', new Date('2026-01-15T12:00:00Z'))).toBe(14);
	});

	it('PMF_SURVEY_MIN_TENURE_DAYS is 14', () => {
		expect(PMF_SURVEY_MIN_TENURE_DAYS).toBe(14);
	});

	it('PMF_THRESHOLD is 0.4 (Sean Ellis 40%)', () => {
		expect(PMF_THRESHOLD).toBe(0.4);
	});
});

// ============================================================
// distribution (cron)
// ============================================================

describe('#1598 pmf-survey-service — distribution', () => {
	it('14 日未満経過のテナントには送信しない', async () => {
		setupSingleTenantWithOwner(makeTenant({ createdAt: '2026-06-10T00:00:00Z' }));
		const result = await runPmfSurveyDistribution({ now: NOW });
		expect(result.sent).toBe(0);
		expect(result.skippedTenure).toBe(1);
		expect(mockSendPmfSurvey).not.toHaveBeenCalled();
	});

	it('14 日以上経過 + 未送信なら送信する + 重複ガードを保存する', async () => {
		setupSingleTenantWithOwner(makeTenant({ createdAt: '2026-01-01T00:00:00Z' }));
		const result = await runPmfSurveyDistribution({ now: NOW });
		expect(result.sent).toBe(1);
		expect(result.scanned).toBe(1);
		expect(mockSendPmfSurvey).toHaveBeenCalledOnce();
		const sentKey = `t-1:pmf_survey_sent_${getCurrentRound(NOW)}`;
		expect(settingsStore.has(sentKey)).toBe(true);
	});

	it('同一 round で 2 回目は重複送信ガードでスキップ', async () => {
		// 1 回目: 送信成功 + 履歴保存
		setupSingleTenantWithOwner(makeTenant({ createdAt: '2026-01-01T00:00:00Z' }));
		await runPmfSurveyDistribution({ now: NOW });
		expect(mockSendPmfSurvey).toHaveBeenCalledOnce();

		// 2 回目: 同じテナントで再実行 → 重複ガード
		setupSingleTenantWithOwner(makeTenant({ createdAt: '2026-01-01T00:00:00Z' }));
		mockSendPmfSurvey.mockClear();
		const result = await runPmfSurveyDistribution({ now: NOW });
		expect(result.sent).toBe(0);
		expect(result.skippedAlreadySent).toBe(1);
		expect(mockSendPmfSurvey).not.toHaveBeenCalled();
	});

	it('dryRun: true なら実送信せず件数だけ返す', async () => {
		setupSingleTenantWithOwner(makeTenant({ createdAt: '2026-01-01T00:00:00Z' }));
		const result = await runPmfSurveyDistribution({ now: NOW, dryRun: true });
		expect(result.sent).toBe(1);
		expect(result.dryRun).toBe(true);
		expect(mockSendPmfSurvey).not.toHaveBeenCalled();
	});

	it('オーナー member が無いテナントはスキップ', async () => {
		const tenant = makeTenant({ createdAt: '2026-01-01T00:00:00Z' });
		mockListAllTenants.mockResolvedValueOnce([tenant]);
		mockFindTenantMembers.mockResolvedValueOnce([]);
		const result = await runPmfSurveyDistribution({ now: NOW });
		expect(result.skippedNoOwner).toBe(1);
		expect(result.sent).toBe(0);
	});

	it('年 6 回上限に達していたらスキップ (lifecycle-emails 共有カウンタ)', async () => {
		const tenant = makeTenant({ createdAt: '2026-01-01T00:00:00Z' });
		// 既に 6 回送信済みを模擬
		settingsStore.set(`t-1:marketing_email_count_2026`, '6');
		setupSingleTenantWithOwner(tenant);
		const result = await runPmfSurveyDistribution({ now: NOW });
		expect(result.skippedRateLimit).toBe(1);
		expect(result.sent).toBe(0);
		expect(mockSendPmfSurvey).not.toHaveBeenCalled();
	});

	it('round 指定があればその round で配信判定する', async () => {
		setupSingleTenantWithOwner(makeTenant({ createdAt: '2026-01-01T00:00:00Z' }));
		const result = await runPmfSurveyDistribution({ now: NOW, round: '2026-H2' });
		expect(result.round).toBe('2026-H2');
		expect(result.sent).toBe(1);
		expect(settingsStore.has('t-1:pmf_survey_sent_2026-H2')).toBe(true);
	});
});

// ============================================================
// 回答の保存 / 重複チェック
// ============================================================

describe('#1598 pmf-survey-service — response storage', () => {
	const ROUND = '2026-H1';
	const RESPONSE: PmfSurveyResponse = {
		tenantId: 't-1',
		round: ROUND,
		q1: 'very',
		q2: 'こどもが自分から記録するようになった',
		q3: 'lp',
		q4: '',
		answeredAt: '2026-06-15T05:00:00Z',
	};

	it('saveSurveyResponse + hasAnsweredSurvey が連動する', async () => {
		expect(await hasAnsweredSurvey('t-1', ROUND)).toBe(false);
		await saveSurveyResponse(RESPONSE);
		expect(await hasAnsweredSurvey('t-1', ROUND)).toBe(true);
	});

	it('別 round では別管理 (重複しない)', async () => {
		await saveSurveyResponse(RESPONSE);
		expect(await hasAnsweredSurvey('t-1', '2026-H2')).toBe(false);
	});
});

// ============================================================
// 集計
// ============================================================

describe('#1598 pmf-survey-service — aggregation', () => {
	const ROUND = '2026-H1';

	function seedResponse(
		tenantId: string,
		q1: PmfSurveyResponse['q1'],
		q3: PmfSurveyResponse['q3'],
	) {
		const r: PmfSurveyResponse = {
			tenantId,
			round: ROUND,
			q1,
			q2: `benefit-${tenantId}`,
			q3,
			q4: q1 === 'not' ? `disappointment-${tenantId}` : '',
			answeredAt: '2026-06-15T05:00:00Z',
		};
		settingsStore.set(`${tenantId}:pmf_survey_response_${ROUND}`, JSON.stringify(r));
	}

	it('回答ゼロでも空集計を返し pmfAchieved=false', async () => {
		mockListAllTenants.mockResolvedValueOnce([]);
		const agg = await aggregateSurveyResponses(ROUND);
		expect(agg.totalResponses).toBe(0);
		expect(agg.pmfAchieved).toBe(false);
		expect(agg.seanEllisScore).toBe(0);
	});

	it('「とても残念」が 40% 超なら pmfAchieved=true', async () => {
		const tenants = [
			makeTenant({ tenantId: 't-1' }),
			makeTenant({ tenantId: 't-2' }),
			makeTenant({ tenantId: 't-3' }),
		];
		mockListAllTenants.mockResolvedValueOnce(tenants);
		seedResponse('t-1', 'very', 'lp');
		seedResponse('t-2', 'very', 'media');
		seedResponse('t-3', 'somewhat', 'friend');

		const agg = await aggregateSurveyResponses(ROUND);
		expect(agg.totalResponses).toBe(3);
		expect(agg.q1Counts.very).toBe(2);
		expect(agg.q1Counts.somewhat).toBe(1);
		// 2/3 ≒ 0.667 > 0.4
		expect(agg.seanEllisScore).toBeCloseTo(2 / 3, 5);
		expect(agg.pmfAchieved).toBe(true);
	});

	it('「とても残念」が 40% 未満なら pmfAchieved=false', async () => {
		const tenants = [
			makeTenant({ tenantId: 't-1' }),
			makeTenant({ tenantId: 't-2' }),
			makeTenant({ tenantId: 't-3' }),
		];
		mockListAllTenants.mockResolvedValueOnce(tenants);
		seedResponse('t-1', 'very', 'lp');
		seedResponse('t-2', 'somewhat', 'media');
		seedResponse('t-3', 'not', 'friend');

		const agg = await aggregateSurveyResponses(ROUND);
		expect(agg.q1Counts.very).toBe(1);
		// 1/3 ≒ 0.333 < 0.4
		expect(agg.seanEllisScore).toBeCloseTo(1 / 3, 5);
		expect(agg.pmfAchieved).toBe(false);
	});

	it('Sean Ellis Score は N/A を母数から除外する', async () => {
		const tenants = [
			makeTenant({ tenantId: 't-1' }),
			makeTenant({ tenantId: 't-2' }),
			makeTenant({ tenantId: 't-3' }),
		];
		mockListAllTenants.mockResolvedValueOnce(tenants);
		seedResponse('t-1', 'very', 'lp');
		seedResponse('t-2', 'somewhat', 'media');
		seedResponse('t-3', 'na', 'friend'); // N/A は母数から除外

		const agg = await aggregateSurveyResponses(ROUND);
		// totalResponses は 3 (N/A 含む)
		expect(agg.totalResponses).toBe(3);
		// seanEllisScore は very/(very+somewhat+not) = 1/2 = 0.5
		expect(agg.seanEllisScore).toBe(0.5);
		expect(agg.pmfAchieved).toBe(true);
	});

	it('Q3 認知経路の集計が機能する', async () => {
		const tenants = [makeTenant({ tenantId: 't-1' }), makeTenant({ tenantId: 't-2' })];
		mockListAllTenants.mockResolvedValueOnce(tenants);
		seedResponse('t-1', 'very', 'lp');
		seedResponse('t-2', 'somewhat', 'lp');

		const agg = await aggregateSurveyResponses(ROUND);
		expect(agg.q3Counts.lp).toBe(2);
		expect(agg.q3Counts.media).toBe(0);
	});

	it('Q2 / Q4 自由記述を tenantId 付きで一覧化', async () => {
		const tenants = [makeTenant({ tenantId: 't-1' }), makeTenant({ tenantId: 't-2' })];
		mockListAllTenants.mockResolvedValueOnce(tenants);
		seedResponse('t-1', 'very', 'lp');
		seedResponse('t-2', 'not', 'media'); // Q4 disappointment 入り

		const agg = await aggregateSurveyResponses(ROUND);
		expect(agg.q2Texts).toHaveLength(2);
		expect(agg.q4Texts).toHaveLength(1);
		expect(agg.q4Texts[0]?.tenantId).toBe('t-2');
	});
});
