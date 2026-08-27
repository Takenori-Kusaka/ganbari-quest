// tests/unit/routes/import-cloud-pending-pin-4717.test.ts
//
// #4717: 発行直後（生成待ち）の PIN で取り込むと 500「システムに問題が発生しました」になり、
// 受け取った側（祖父母 / 別端末）が障害と誤認していた。AWS の build cron は 5 分毎のため、
// 発行〜5 分の窓では **必ず** この状態に当たる。
//
// 本 test は route の分類 (失敗理由 → HTTP 種別) を固定する:
//   - 生成待ち (pending / building) → 409 + 「準備中」案内 (500 ではない)
//   - 生成失敗 (failed)             → 409 + 作り直し案内
//   - 無効 PIN / 期限切れ / DL 上限 → 400 (従来どおり)
//   - 想定外の例外だけが 500

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_LABELS } from '$lib/domain/labels';

const mockFetchCloudExportByPin = vi.fn();

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 't-1',
	getAuthMode: () => 'cognito',
	// route が import する認可ヘルパ (owner で通す)
	requireRole: () => undefined,
	requireOwnerOrParent: () => undefined,
}));

vi.mock('$lib/server/services/cloud-export-service', async () => {
	// CloudExportFetchError は実体を使う (route は instanceof で分類するため)
	const actual = await vi.importActual<
		typeof import('../../../src/lib/server/services/cloud-export-service')
	>('../../../src/lib/server/services/cloud-export-service');
	return {
		...actual,
		fetchCloudExportByPin: (...args: unknown[]) => mockFetchCloudExportByPin(...args),
		consumeCloudExportDownload: vi.fn(),
	};
});

import { CloudExportFetchError } from '../../../src/lib/server/services/cloud-export-service';
import { POST } from '../../../src/routes/api/v1/import/cloud/+server';

function callPost(pinCode = 'ABC123'): Promise<Response> {
	const request = new Request('http://localhost/api/v1/import/cloud?mode=preview', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ pinCode }),
	});
	return POST({
		request,
		url: new URL('http://localhost/api/v1/import/cloud?mode=preview'),
		locals: { context: { tenantId: 't-1', role: 'owner' } },
	} as never) as Promise<Response>;
}

describe('#4717 生成待ち PIN の取込 (POST /api/v1/import/cloud)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('生成待ち (not-ready) は 409 + 「準備中」案内 を返す (500 ではない)', async () => {
		mockFetchCloudExportByPin.mockRejectedValue(
			new CloudExportFetchError('not-ready', SETTINGS_LABELS.cloudImportNotReady),
		);

		const res = await callPost();
		expect(res.status, '500 は受け取る側が障害と誤認する').toBe(409);

		const body = (await res.json()) as {
			error: { code: string; message: string; userMessage: string; action: string };
		};
		expect(body.error.code).toBe('EXPORT_NOT_READY');
		expect(body.error.message).toBe(SETTINGS_LABELS.cloudImportNotReady);
		expect(body.error.userMessage).toBe(SETTINGS_LABELS.cloudImportNotReady);
		// 待てば解決することが伝わる (ADR-0062 種別×手段)
		expect(body.error.action).toBe('retry');
		expect(body.error.message).not.toContain('システムに問題');
	});

	it('生成失敗 (build-failed) は 409 + 作り直し案内 を返す', async () => {
		mockFetchCloudExportByPin.mockRejectedValue(
			new CloudExportFetchError('build-failed', SETTINGS_LABELS.cloudImportBuildFailed),
		);

		const res = await callPost();
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string; userMessage: string } };
		expect(body.error.code).toBe('EXPORT_FAILED');
		expect(body.error.userMessage).toBe(SETTINGS_LABELS.cloudImportBuildFailed);
	});

	it.each([
		['invalid-pin', 'PINコードが無効です'],
		['expired', 'このエクスポートは有効期限切れです'],
		['download-limit', 'このエクスポートはダウンロード回数の上限に達しています'],
	] as const)('%s は従来どおり 400 (入力の問題) を返す', async (reason, message) => {
		mockFetchCloudExportByPin.mockRejectedValue(new CloudExportFetchError(reason, message));

		const res = await callPost();
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('VALIDATION_ERROR');
		expect(body.error.message).toBe(message);
	});

	it('S3 にデータが無い (data-missing) は 404', async () => {
		mockFetchCloudExportByPin.mockRejectedValue(
			new CloudExportFetchError('data-missing', 'エクスポートデータが見つかりません'),
		);

		const res = await callPost();
		expect(res.status).toBe(404);
	});

	it('想定外の例外だけが 500 に落ちる (分類できる失敗を 500 にしない)', async () => {
		mockFetchCloudExportByPin.mockRejectedValue(new Error('boom'));

		const res = await callPost();
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('INTERNAL_ERROR');
	});
});
