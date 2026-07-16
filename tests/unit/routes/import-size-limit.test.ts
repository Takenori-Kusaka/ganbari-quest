// tests/unit/routes/import-size-limit.test.ts
// #3325 AC3: POST /api/v1/import が実行環境の実効上限 (resolveMaxImportBytes) で受理判定し、
// 超過時は「沈黙のハング」ではなく明示エラー + クラウド共有経由の復元案内を返すことを検証する。
// (旧実装は固定 100MB で AWS Function URL 6MB 実態と乖離し、超過 body は edge で弾かれていた)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 実効上限を小さく mock して route の受理判定パスを決定的に検証する (1KB)。
const TEST_MAX_BYTES = 1024;

vi.mock('$lib/server/services/import-limit', () => ({
	resolveMaxImportBytes: () => TEST_MAX_BYTES,
	toDisplayMb: (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10,
}));

const mockParseBackupZip = vi.fn();
vi.mock('$lib/server/services/backup-archive', () => ({
	parseBackupZip: (...args: unknown[]) => mockParseBackupZip(...args),
}));

const mockValidateExportData = vi.fn();
vi.mock('$lib/server/services/import-service', () => ({
	importFamilyData: vi.fn(),
	previewImport: vi.fn(),
	validateExportData: (...args: unknown[]) => mockValidateExportData(...args),
	verifyChecksum: vi.fn(),
}));

vi.mock('$lib/server/services/replace-import-service', () => ({
	AtomicReplaceError: class extends Error {},
	replaceImportAtomic: vi.fn(),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireRole: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { POST } from '../../../src/routes/api/v1/import/+server';

function locals(): App.Locals {
	return { context: { tenantId: 't-1', role: 'parent' } } as unknown as App.Locals;
}

async function postZip(sizeBytes: number): Promise<Response> {
	const url = new URL('http://localhost/api/v1/import?mode=preview');
	const request = new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/zip' },
		body: new Uint8Array(sizeBytes),
	});
	return (await POST({ request, url, locals: locals() } as never)) as Response;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('#3325 POST /api/v1/import — 実効上限の受理判定', () => {
	it('上限超過 ZIP は 400 + クラウド共有経由の復元案内を明示して返す (沈黙のハング禁止)', async () => {
		const res = await postZip(TEST_MAX_BYTES + 1);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('VALIDATION_ERROR');
		expect(body.error.message).toContain('ファイルサイズが大きすぎます');
		expect(body.error.message).toContain('クラウド共有');
		// 超過 body は ZIP 解析に進まない
		expect(mockParseBackupZip).not.toHaveBeenCalled();
	});

	it('上限以内の ZIP は受理され ZIP 解析へ進む', async () => {
		mockParseBackupZip.mockResolvedValue({ ok: true, value: { body: {}, staticFiles: {} } });
		mockValidateExportData.mockReturnValue({ valid: false, error: 'stop-here' });
		const res = await postZip(TEST_MAX_BYTES - 1);
		expect(mockParseBackupZip).toHaveBeenCalledTimes(1);
		// validate で意図的に止めている (受理判定の検証が目的)
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.message).toBe('stop-here');
	});
});
