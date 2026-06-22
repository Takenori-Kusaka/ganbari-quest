// src/lib/ui/error-notify.ts
// #3218 (EPIC #3217): 統一エラー通知 helper。
//
// silent-failure (押しても無反応) は WCAG 3.3.1 (A) + 4.1.3 (AA) 二重違反
// (JIS X 8341-3:2016 一致規格)。クライアント側の fetch / action 失敗を必ず
// ユーザ可視のフィードバックに繋ぐための SSOT helper。
//
// 設計原則 (deep-research 2026-06-22 / WCAG・JIS・デジタル庁・Material・Apple・NN/g):
//   - 内部例外メッセージをそのまま出さない: 500 系は body を信用せず汎用文言にする
//     (Apple HIG「コード羅列タイトル禁止」/ NN/g「専門用語禁止」/ セキュリティ)。
//   - 400/403/409 はサーバが返す UI 向け文言 (error(400,'…')) を尊重し、無ければ
//     ステータス別の汎用文言にフォールバック。
//   - error は role="alert"(assertive) の Toast (Toast.svelte 側で error は自動消滅させず
//     手動閉じ)。重大・要決定は呼出側で Alert/Dialog を併用する。
//   - 文言は labels.ts (ERROR_NOTIFY_LABELS) に SSOT 化。

import type { ActionResult } from '@sveltejs/kit';
import { ERROR_NOTIFY_LABELS } from '$lib/domain/labels';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

export interface ApiErrorResult {
	/** ユーザに通知済みか (常に true。呼出側が inline 表示する際の message 取得用) */
	shown: boolean;
	/** ユーザ向け文言 (inline 表示にも再利用可能) */
	message: string;
	/** HTTP status (ネットワーク例外時は undefined) */
	status?: number;
}

/**
 * HTTP status + サーバ body からユーザ向け文言を決定する。
 * 500 系は内部例外露出防止のため body の message を使わず汎用文言にする。
 */
export function resolveApiErrorMessage(status: number, serverMessage = ''): string {
	if (status >= 500) return ERROR_NOTIFY_LABELS.server;
	// 400/403/409 はサーバの UI 向け文言を尊重 (error(400,'プランが正しくありません') 等)
	if (serverMessage) return serverMessage;
	if (status === 403) return ERROR_NOTIFY_LABELS.forbidden;
	if (status === 409) return ERROR_NOTIFY_LABELS.conflict;
	if (status === 400) return ERROR_NOTIFY_LABELS.badRequest;
	return ERROR_NOTIFY_LABELS.generic;
}

/** Response body から message / error フィールドを安全に取り出す (非 JSON は空文字)。 */
async function extractServerMessage(res: Response): Promise<string> {
	try {
		const data = (await res.clone().json()) as { message?: unknown; error?: unknown };
		if (typeof data?.message === 'string') return data.message;
		if (typeof data?.error === 'string') return data.error;
	} catch {
		// 非 JSON / 空 body
	}
	return '';
}

/**
 * 非 2xx の fetch Response をユーザに通知する (error Toast)。
 * @returns 通知に使った message (呼出側が in-page Alert にも再利用できる)
 */
export async function notifyApiError(
	res: Response,
	opts?: { toastTitle?: string },
): Promise<ApiErrorResult> {
	const serverMessage = await extractServerMessage(res);
	const message = resolveApiErrorMessage(res.status, serverMessage);
	showToast(opts?.toastTitle ?? ERROR_NOTIFY_LABELS.title, message, 'error');
	return { shown: true, message, status: res.status };
}

/**
 * ネットワーク例外 (fetch reject / throw / タイムアウト) をユーザに通知する。
 */
export function notifyNetworkError(opts?: { toastTitle?: string }): ApiErrorResult {
	showToast(opts?.toastTitle ?? ERROR_NOTIFY_LABELS.title, ERROR_NOTIFY_LABELS.network, 'error');
	return { shown: true, message: ERROR_NOTIFY_LABELS.network };
}

/**
 * SvelteKit form action の `ActionResult` (use:enhance) をユーザに通知する。
 * failure (`fail()`) の `data.error` を UI 向け文言として尊重し、error (500 相当) は汎用文言。
 * success / redirect は何もしない (null を返す)。
 */
export function notifyActionError(
	result: ActionResult,
	opts?: { toastTitle?: string },
): ApiErrorResult | null {
	if (result.type === 'failure') {
		const data = result.data as { error?: unknown; message?: unknown } | undefined;
		const serverMessage =
			typeof data?.error === 'string'
				? data.error
				: typeof data?.message === 'string'
					? data.message
					: '';
		const message = resolveApiErrorMessage(result.status ?? 400, serverMessage);
		showToast(opts?.toastTitle ?? ERROR_NOTIFY_LABELS.title, message, 'error');
		return { shown: true, message, status: result.status };
	}
	if (result.type === 'error') {
		// 予期せぬ例外 (500 相当)。内部 message は出さず汎用文言。
		showToast(opts?.toastTitle ?? ERROR_NOTIFY_LABELS.title, ERROR_NOTIFY_LABELS.server, 'error');
		return { shown: true, message: ERROR_NOTIFY_LABELS.server };
	}
	return null;
}
