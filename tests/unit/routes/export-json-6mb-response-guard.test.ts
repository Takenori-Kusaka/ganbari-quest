// tests/unit/routes/export-json-6mb-response-guard.test.ts
// #3775 ①: JSON export (format=json、既定) の 6MB response cap 整合。
//
// #3770 (#3694) は ZIP response / OCR request に guard を入れたが、JSON export 直 DL 経路が
// 未 guard のまま残っていた。aws-prod (Function URL BUFFERED) は response も 6MB hard cap で、
// 6MB 超の JSON body は edge で沈黙切断され「ダウンロード不能」になる。実効上限を超えたら
// 直 DL せず明示エラー (400) + クラウド共有導線を返すこと (ADR-0062)。NUC / local は制約なし。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------
const mockExportFamilyData = vi.fn();
vi.mock('$lib/server/services/export-service', () => ({
	exportFamilyData: (...args: unknown[]) => mockExportFamilyData(...args),
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

function makeEvent(awsMode: boolean) {
	if (awsMode) process.env.AWS_LAMBDA_FUNCTION_NAME = 'ganbari-quest-app';
	else delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	resetEnvForTesting();
	return {
		// format 未指定 = 既定 json
		url: new URL('https://x/api/v1/export'),
		locals: { context: { tenantId: 't1', licenseStatus: 'active', plan: 'standard' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

/** JSON.stringify した結果が指定バイト数を超える export data を作る。 */
function makeLargeExportData(byteLength: number) {
	return { version: 1, family: { children: [] }, blob: 'x'.repeat(byteLength) };
}

beforeEach(() => {
	mockExportFamilyData.mockResolvedValue({ version: 1, family: { children: [] }, data: {} });
	mockResolveFullPlanTier.mockResolvedValue('standard');
	mockGetPlanLimits.mockReturnValue({ canExport: true });
});

afterEach(() => {
	if (originalFnName === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	else process.env.AWS_LAMBDA_FUNCTION_NAME = originalFnName;
	resetEnvForTesting();
	vi.clearAllMocks();
});

describe('#3775 export JSON — 6MB response cap guard', () => {
	it('aws-prod: 実効上限超の JSON は 400 + クラウド共有導線 (直 DL しない)', async () => {
		mockExportFamilyData.mockResolvedValue(makeLargeExportData(6 * 1024 * 1024));
		const res = await GET(makeEvent(true));
		expect(res.status).toBe(400);
		const bodyText = await res.text();
		expect(bodyText).toContain('クラウド共有');
		expect(res.headers.get('Content-Type')).not.toContain('application/json; charset=utf-8');
	});

	it('aws-prod: 実効上限内の JSON は従来通り application/json で直 DL', async () => {
		mockExportFamilyData.mockResolvedValue(makeLargeExportData(1024));
		const res = await GET(makeEvent(true));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
	});

	it('local: Function URL 制約なし — 大きな JSON でも直 DL を許可する', async () => {
		mockExportFamilyData.mockResolvedValue(makeLargeExportData(20 * 1024 * 1024));
		const res = await GET(makeEvent(false));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
	});

	it('aws-prod: 日本語マルチバイトは byte 長で判定する (char 長ではない)', async () => {
		// 「あ」= UTF-8 3 bytes。char 長 2.5M でも byte 長 ~7.5M で上限超になる。
		const data = { version: 1, family: { children: [] }, blob: 'あ'.repeat(2.5 * 1024 * 1024) };
		mockExportFamilyData.mockResolvedValue(data);
		const res = await GET(makeEvent(true));
		expect(res.status).toBe(400);
	});
});
