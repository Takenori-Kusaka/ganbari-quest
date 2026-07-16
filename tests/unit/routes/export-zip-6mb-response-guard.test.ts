// tests/unit/routes/export-zip-6mb-response-guard.test.ts
// #3694 AC2/AC3: export ZIP 直 DL の 6MB response cap 整合。
//
// AWS 本番 (aws-prod) は Function URL (BUFFERED) の response 6MB hard cap を超える ZIP が
// edge で沈黙切断される。構築 ZIP が実効上限を超えたら、直 DL せず明示エラー (400) +
// クラウド共有導線を返すこと (ADR-0062)。NUC / local は制約なしで従来通り直 DL を許可する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------
const mockExportFamilyData = vi.fn();
const mockExportFamilyDataForZip = vi.fn();
vi.mock('$lib/server/services/export-service', () => ({
	exportFamilyData: (...args: unknown[]) => mockExportFamilyData(...args),
	// #3518-1: ZIP 経路は checksum 計算文字列を data.json に流用する exportFamilyDataForZip を使う。
	exportFamilyDataForZip: (...args: unknown[]) => mockExportFamilyDataForZip(...args),
}));

const mockBuildFullBackupZip = vi.fn();
vi.mock('$lib/server/services/backup-archive', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/services/backup-archive')>();
	return {
		...actual,
		buildFullBackupZip: (...args: unknown[]) => mockBuildFullBackupZip(...args),
	};
});

const mockResolveFullPlanTier = vi.fn();
const mockGetPlanLimits = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	getPlanLimits: (...args: unknown[]) => mockGetPlanLimits(...args),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireRole: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resetEnvForTesting } from '../../../src/lib/runtime/env';
import { GET } from '../../../src/routes/api/v1/export/+server';

const originalFnName = process.env.AWS_LAMBDA_FUNCTION_NAME;

function makeEvent(format: string, awsMode: boolean) {
	if (awsMode) process.env.AWS_LAMBDA_FUNCTION_NAME = 'ganbari-quest-app';
	else delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	resetEnvForTesting();
	return {
		url: new URL(`https://x/api/v1/export?format=${format}`),
		locals: { context: { tenantId: 't1', licenseStatus: 'active', plan: 'standard' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

beforeEach(() => {
	mockExportFamilyData.mockResolvedValue({ version: 1, family: { children: [] }, data: {} });
	mockExportFamilyDataForZip.mockResolvedValue({
		exportData: { version: 1, family: { children: [] }, data: {} },
		dataJson: '{"version":1,"family":{"children":[]},"data":{}}',
	});
	mockResolveFullPlanTier.mockResolvedValue('standard');
	mockGetPlanLimits.mockReturnValue({ canExport: true });
});

afterEach(() => {
	if (originalFnName === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	else process.env.AWS_LAMBDA_FUNCTION_NAME = originalFnName;
	resetEnvForTesting();
	vi.clearAllMocks();
});

describe('#3694 export ZIP — 6MB response cap guard', () => {
	it('aws-prod: 実効上限超の ZIP は 400 + クラウド共有導線 (直 DL しない)', async () => {
		// 6MB 超の構築 ZIP を模す
		mockBuildFullBackupZip.mockResolvedValue(new Uint8Array(6 * 1024 * 1024 + 1));
		const res = await GET(makeEvent('zip', true));
		expect(res.status).toBe(400);
		const bodyText = await res.text();
		expect(bodyText).toContain('クラウド共有');
		expect(res.headers.get('Content-Type')).not.toBe('application/zip');
	});

	it('aws-prod: 実効上限内の ZIP は従来通り application/zip で直 DL', async () => {
		mockBuildFullBackupZip.mockResolvedValue(new Uint8Array(1024));
		const res = await GET(makeEvent('zip', true));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/zip');
	});

	it('local: Function URL 制約なし — 大きな ZIP でも直 DL を許可する', async () => {
		mockBuildFullBackupZip.mockResolvedValue(new Uint8Array(20 * 1024 * 1024));
		const res = await GET(makeEvent('zip', false));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/zip');
	});
});
