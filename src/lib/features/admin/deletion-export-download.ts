// src/lib/features/admin/deletion-export-download.ts
// #4472: 退会前データ持ち出しのクライアント側ダウンロード処理
//
// 退会確認画面から `GET /api/v1/admin/account/export` を呼び、応答をファイルとして保存する。
// 無料プランは通常のエクスポート (`/api/v1/export`) を使えない (plan-limit-service の
// `free.canExport: false`) ため、本経路が唯一のデータ持ち出し手段になる。
//
// 失敗は throw せずユーザ向け文言として返す (ADR-0062: 無言で失敗させない / 内部例外を露出しない)。

import { todayDateJST } from '$lib/domain/date-utils';
import { ERROR_NOTIFY_LABELS } from '$lib/domain/labels';
import { resolveApiErrorMessage } from '$lib/ui/error-notify';

export const DELETION_EXPORT_ENDPOINT = '/api/v1/admin/account/export';

export type DeletionExportDownloadResult =
	| { ok: true; filename: string }
	| { ok: false; message: string };

export interface DeletionExportDownloadDeps {
	fetchFn?: typeof fetch;
	/** Blob をファイルとして保存する (既定はアンカー経由。test では差し替える) */
	saveBlob?: (blob: Blob, filename: string) => void;
}

/** Content-Disposition から filename を取り出す (無ければ null)。 */
function parseFilename(disposition: string | null): string | null {
	if (!disposition) return null;
	const match = disposition.match(/filename="?([^";]+)"?/);
	return match?.[1] ?? null;
}

function defaultFilename(): string {
	return `ganbari-quest-deletion-export-${todayDateJST()}.json`;
}

function saveBlobViaAnchor(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

/** 非 2xx 応答から UI 向け文言を取り出す (内部例外は 500 系汎用文言に落ちる)。 */
async function resolveErrorMessage(res: Response): Promise<string> {
	let serverMessage = '';
	try {
		const body = (await res.clone().json()) as { message?: unknown; error?: unknown };
		if (typeof body?.message === 'string') serverMessage = body.message;
		else if (typeof body?.error === 'string') serverMessage = body.error;
	} catch {
		// 非 JSON / 空 body — ステータス別の汎用文言にフォールバックする
	}
	return resolveApiErrorMessage(res.status, serverMessage);
}

/**
 * 退会前エクスポートをダウンロードする。
 * 成功時は保存したファイル名、失敗時は表示可能なエラー文言を返す。
 */
export async function downloadDeletionExport(
	deps: DeletionExportDownloadDeps = {},
): Promise<DeletionExportDownloadResult> {
	const fetchFn = deps.fetchFn ?? fetch;
	const saveBlob = deps.saveBlob ?? saveBlobViaAnchor;

	let res: Response;
	try {
		res = await fetchFn(DELETION_EXPORT_ENDPOINT);
	} catch {
		return { ok: false, message: ERROR_NOTIFY_LABELS.network };
	}

	if (!res.ok) {
		return { ok: false, message: await resolveErrorMessage(res) };
	}

	try {
		const blob = await res.blob();
		const filename = parseFilename(res.headers.get('Content-Disposition')) ?? defaultFilename();
		saveBlob(blob, filename);
		return { ok: true, filename };
	} catch {
		return { ok: false, message: ERROR_NOTIFY_LABELS.generic };
	}
}
