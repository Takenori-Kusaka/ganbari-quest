// tests/unit/features/deletion-export-download.test.ts
// #4472: 退会前データ持ち出しのクライアント側ダウンロード処理
//
// 固定する挙動:
//   - 押すと `GET /api/v1/admin/account/export` を呼ぶ (導線が API に到達している)
//   - 成功時は Blob として保存する (JSON をブラウザに表示するだけにしない)
//   - filename は Content-Disposition を尊重し、無ければ JST 日付の既定名にフォールバック
//   - 失敗時は例外を投げずユーザ向け文言を返す (ADR-0062 無言失敗の禁止)

import { describe, expect, it, vi } from 'vitest';
import { ERROR_NOTIFY_LABELS } from '../../../src/lib/domain/labels';
import {
	DELETION_EXPORT_ENDPOINT,
	downloadDeletionExport,
} from '../../../src/lib/features/admin/deletion-export-download';

function jsonResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
}

describe('downloadDeletionExport (#4472)', () => {
	it('エンドポイントを GET し、Blob を保存する', async () => {
		let requestedUrl = '';
		const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
			requestedUrl = String(input);
			return jsonResponse(
				200,
				{ scope: 'minimal', data: {}, generatedAt: '2026-08-08T00:00:00.000Z' },
				{ 'Content-Disposition': 'attachment; filename="deletion-export-2026-08-08.json"' },
			);
		});
		const saveBlob = vi.fn((_blob: Blob, _filename: string) => {});

		const result = await downloadDeletionExport({ fetchFn, saveBlob });

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(requestedUrl).toBe(DELETION_EXPORT_ENDPOINT);
		expect(result.ok).toBe(true);
		expect(saveBlob).toHaveBeenCalledTimes(1);
		const [blob, filename] = saveBlob.mock.calls[0] as [Blob, string];
		// jsdom / node の Blob は別 realm のため instanceof ではなく実体で検証する
		expect(blob.type).toBe('application/json');
		expect(await blob.text()).toContain('"scope":"minimal"');
		expect(filename).toBe('deletion-export-2026-08-08.json');
	});

	it('Content-Disposition が無ければ既定のファイル名で保存する', async () => {
		const fetchFn = vi.fn(async () => jsonResponse(200, { scope: 'minimal' }));
		const saveBlob = vi.fn((_blob: Blob, _filename: string) => {});

		const result = await downloadDeletionExport({ fetchFn, saveBlob });

		expect(result.ok).toBe(true);
		const filename = (saveBlob.mock.calls[0] as [Blob, string])[1];
		expect(filename).toMatch(/^ganbari-quest-deletion-export-\d{4}-\d{2}-\d{2}\.json$/);
	});

	it('403 のときは保存せずユーザ向け文言を返す', async () => {
		const fetchFn = vi.fn(async () => jsonResponse(403, { error: '権限がありません' }));
		const saveBlob = vi.fn();

		const result = await downloadDeletionExport({ fetchFn, saveBlob });

		expect(result.ok).toBe(false);
		expect(saveBlob).not.toHaveBeenCalled();
		if (!result.ok) expect(result.message).toBe('権限がありません');
	});

	it('500 のときは内部例外を出さず汎用文言を返す (ADR-0062)', async () => {
		const fetchFn = vi.fn(async () =>
			jsonResponse(500, { error: 'TypeError: repos.child is undefined' }),
		);
		const result = await downloadDeletionExport({ fetchFn, saveBlob: vi.fn() });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toBe(ERROR_NOTIFY_LABELS.server);
	});

	it('通信例外のときは throw せず network 文言を返す', async () => {
		const fetchFn = vi.fn(async () => {
			throw new Error('network down');
		});
		const result = await downloadDeletionExport({ fetchFn, saveBlob: vi.fn() });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toBe(ERROR_NOTIFY_LABELS.network);
	});
});
