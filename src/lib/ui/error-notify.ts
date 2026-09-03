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
//     ステータス別の汎用文言にフォールバック。echo hardening (#3225) で無害化する。
//   - error は role="alert"(assertive) の Toast (Toast.svelte 側で error は自動消滅させず
//     手動閉じ)。重大・要決定は呼出側で Alert/Dialog を併用する。
//   - 文言は labels.ts (ERROR_NOTIFY_LABELS) に SSOT 化。

import type { ActionResult } from '@sveltejs/kit';
import { ERROR_NOTIFY_LABELS, type ErrorNotifyLabelSet } from '$lib/domain/labels';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

/**
 * notify 系 helper の共通オプション。
 * - `toastTitle`: Toast タイトルの上書き。
 * - `labels` (#3225 ②b): エラー文言セットの上書き。子供画面は `getErrorNotifyLabels(uiMode)` で
 *   ひらがな版 (`ERROR_NOTIFY_LABELS_CHILD`) を渡す。未指定時は標準 (`ERROR_NOTIFY_LABELS`)。
 */
export interface NotifyOpts {
	toastTitle?: string;
	labels?: ErrorNotifyLabelSet;
}

export interface ApiErrorResult {
	/** ユーザに通知済みか (常に true。呼出側が inline 表示する際の message 取得用) */
	shown: boolean;
	/** ユーザ向け文言 (inline 表示にも再利用可能) */
	message: string;
	/** HTTP status (ネットワーク例外時は undefined) */
	status?: number;
}

/** 4xx serverMessage の最大表示長 (#3225: layout-break / info-disclosure 余地を抑える)。 */
export const MAX_SERVER_MESSAGE_LENGTH = 200;

// ユーザ向け文言は labels.ts SSOT のとおり日本語。ひらがな / カタカナ / 漢字 / 半角カナの
// いずれも含まない 4xx body は内部識別子 (例: 'INVALID_PLAN' / 'ValidationException') や
// コード dump の疑いがあるため verbatim 表示せず generic fallback する (#3225 echo hardening)。
const JAPANESE_CHAR_RE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

// #3243: 日本語を含むが internal 識別子 (例外クラス名 / userId= / table#id / stack-trace / 長い
// opaque ID) が混在する 4xx message は info-disclosure になりうる (例: 'プラン不正:
// ValidationException at tenants#42' / '権限がありません(userId=12345)')。allowlist (日本語含有) を
// 通過しても本 blocklist に該当したら generic fallback に落とす (defense-in-depth、主制御は
// server 側 ADR-0062 §2 内部例外非露出)。legit な日本語 UI 文言 ('owner のみ実行できます' 等) は
// 非該当で素通しする。
const INTERNAL_IDENTIFIER_PATTERNS: RegExp[] = [
	/\b[A-Z][A-Za-z0-9]*(?:Exception|Error)\b/, // 例外クラス名 (ValidationException / TypeError)
	// #3354: 大文字始まり要求で lowercase 例外文 (validationexception / typeerror) を取りこぼしていた補完。
	/\b[a-z][a-z0-9]*(?:exception|error)\b/, // lowercase 例外クラス名 (validationexception)
	/\b[a-z][A-Za-z0-9]*(?:Id|ID)\s*[=:]/, // camelCase 内部 id 代入 (userId=12345 / tenantId: x)
	// #3354: camelCase(Id) 偏重で snake_case 内部 id (user_id=12345 / tenant_id: x) を取りこぼしていた補完。
	/\b[a-z][a-z0-9_]*_id\b\s*[=:]/i, // snake_case 内部 id 代入 (user_id=12345)
	/\b[a-z_][a-z0-9_]*#\d+/i, // table#id 参照 (tenants#42)
	// #3354: `#\d+` のみで slash パス参照 (tenants/42 / users/123) を取りこぼしていた補完。
	/\b[a-z_][a-z0-9_]{2,}\/\d+/i, // slash パス内部参照 (tenants/42)
	/\bat\s+\S+:\d+/, // stack-trace フレーム (at file.ts:123)
	/\b[0-9a-f]{16,}\b/i, // 長い hex / UUID 様式
	/\b[A-Za-z0-9_-]{32,}\b/, // 長い opaque token / 連続英数字 ID
	// #3354: JP 混在メッセージに verbatim 露出しうる infra 識別子 (IP / email / SQLSTATE) を補完。
	/\b\d{1,3}(?:\.\d{1,3}){3}\b/, // IPv4 アドレス (169.254.169.254 / 192.168.x.x)
	/\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/i, // email アドレス (info-disclosure)
	/\bSQLSTATE\b/i, // DB エラーコード (SQLSTATE[23000])
];

function containsInternalIdentifier(s: string): boolean {
	return INTERNAL_IDENTIFIER_PATTERNS.some((re) => re.test(s));
}

/** 制御文字 (C0: 0x00-0x1f / C1: 0x7f-0x9f) を空白化する。正規表現に制御文字を直書きしない。 */
function stripControlChars(raw: string): string {
	let out = '';
	for (const ch of raw) {
		const code = ch.codePointAt(0) ?? 0;
		out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
	}
	return out;
}

/**
 * 4xx の serverMessage を UI 表示用に無害化する (#3225)。
 *   - 制御文字 (C0/C1) を空白化し連続空白を 1 個に畳む
 *   - 日本語文字を 1 つも含まない = 内部識別子 / 例外クラス名 / dump の疑い → 空文字 (= 不採用)
 *   - 日本語を含んでも internal 識別子混在 (#3243) → 空文字 (= 不採用、info-disclosure 防止)
 *   - 過大長は info-disclosure / layout-break 余地のため MAX_SERVER_MESSAGE_LENGTH で切る
 * 空文字を返した場合、呼出側はステータス別の汎用文言にフォールバックする。
 *
 * **XSS 不変条件 (#3243)**: 本関数 / resolveApiErrorMessage の返り値は HTML エスケープを **行わない**
 * (制御文字除去 + allowlist/blocklist のみ)。XSS 防止は呼出側が **textContent 補間** (Svelte の
 * `{message}` テキストバインド / Alert / Toast の text prop) で描画することに依存する。
 * **error message を `{@html}` で描画してはならない** (将来 callsite が `{@html}` を使うと sanitize を
 * すり抜けて stored/reflected XSS 経路化する)。HTML 描画が必要な箇所は DOMPurify 等の別経路を使う。
 */
export function sanitizeServerMessage(raw: string): string {
	const cleaned = stripControlChars(raw).replace(/\s+/g, ' ').trim();
	if (!cleaned) return '';
	if (!JAPANESE_CHAR_RE.test(cleaned)) return '';
	// #3243: 日本語含有でも internal 識別子混在は generic fallback に落とす (defense-in-depth)
	if (containsInternalIdentifier(cleaned)) return '';
	return cleaned.length > MAX_SERVER_MESSAGE_LENGTH
		? `${cleaned.slice(0, MAX_SERVER_MESSAGE_LENGTH)}…`
		: cleaned;
}

/**
 * HTTP status + サーバ body からユーザ向け文言を決定する。
 * 500 系は内部例外露出防止のため body の message を使わず汎用文言にする。
 * 400/403/409 はサーバの UI 向け文言を尊重するが、echo hardening (#3225) で
 * 無害化し、内部識別子 / 過大 body はステータス別の汎用文言にフォールバックする。
 */
export function resolveApiErrorMessage(
	status: number,
	serverMessage = '',
	labels: ErrorNotifyLabelSet = ERROR_NOTIFY_LABELS,
): string {
	if (status >= 500) return labels.server;
	// 400/403/409 はサーバの UI 向け文言を尊重 (error(400,'プランが正しくありません') 等)。
	// ただし verbatim ではなく sanitize 経由 (#3225 echo hardening)。
	const safe = sanitizeServerMessage(serverMessage);
	if (safe) return safe;
	if (status === 403) return labels.forbidden;
	if (status === 409) return labels.conflict;
	if (status === 400) return labels.badRequest;
	return labels.generic;
}

/**
 * ADR-0062 の「種別 × 通知手段」を client 側で決めるための 2 値。server の error body
 * (`apiError` が載せる `severity` / `action`) と同じ語彙で、`ErrorAlert` の props に直結する。
 */
export type ApiErrorSeverity = 'info' | 'warning' | 'error';
export type ApiErrorAction = 'retry' | 'fix_input' | 'contact_admin' | 'none';

export interface ApiErrorDisplay {
	/** 画面に出す文言 (`resolveApiErrorMessage` と同じ規律で無害化済) */
	message: string;
	severity: ApiErrorSeverity;
	/** 顧客が次に取るべき行動。`ErrorAlert` がこの値で案内文 / 再試行ボタンを出し分ける */
	action: ApiErrorAction;
}

/** 呼び出し側が server の指定を得られなかったときに使う既定値 (従来の hardcode 値を渡す)。 */
export interface ApiErrorDisplayFallback {
	severity: ApiErrorSeverity;
	action: ApiErrorAction;
}

const DEFAULT_DISPLAY_FALLBACK: ApiErrorDisplayFallback = { severity: 'error', action: 'retry' };

function isSeverity(v: unknown): v is ApiErrorSeverity {
	return v === 'info' || v === 'warning' || v === 'error';
}
function isAction(v: unknown): v is ApiErrorAction {
	return v === 'retry' || v === 'fix_input' || v === 'contact_admin' || v === 'none';
}

/**
 * server の error body を `ErrorAlert` に渡す 3 props (message / severity / action) に解決する (#4752)。
 *
 * **なぜ severity / action を画面側で固定してはいけないか**: server は ADR-0062 の種別マッピングに従って
 * 「どれくらい重大か」「顧客が次に何をすべきか」を決めている。画面がそれを無視して固定値を描くと、
 * 例えば復元の自動復旧が半端に終わった 409 (`action: contact_admin` = 運営に連絡) を
 * 「入力内容をご確認ください」(`fix_input`) と表示し、**顧客に誤った次の行動を促す** (#4752 実測)。
 *
 * 値は allowlist で検証する (server 由来の文字列をそのまま props に流さない)。body に指定が無い /
 * 未知の値なら `fallback` (呼び出し側の従来値) に落ちるため、既存画面の挙動は変わらない。
 */
export function resolveApiErrorDisplay(
	status: number,
	errorBody: unknown,
	opts?: { fallback?: ApiErrorDisplayFallback; labels?: ErrorNotifyLabelSet },
): ApiErrorDisplay {
	const fallback = opts?.fallback ?? DEFAULT_DISPLAY_FALLBACK;
	const body = errorBody as { message?: unknown; severity?: unknown; action?: unknown } | null;
	const serverMessage = typeof body?.message === 'string' ? body.message : '';
	return {
		message: resolveApiErrorMessage(status, serverMessage, opts?.labels ?? ERROR_NOTIFY_LABELS),
		severity: isSeverity(body?.severity) ? body.severity : fallback.severity,
		action: isAction(body?.action) ? body.action : fallback.action,
	};
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
export async function notifyApiError(res: Response, opts?: NotifyOpts): Promise<ApiErrorResult> {
	const labels = opts?.labels ?? ERROR_NOTIFY_LABELS;
	const serverMessage = await extractServerMessage(res);
	const message = resolveApiErrorMessage(res.status, serverMessage, labels);
	showToast(opts?.toastTitle ?? labels.title, message, 'error');
	return { shown: true, message, status: res.status };
}

/**
 * form action が失敗 (`fail()`) を返したことをユーザに通知する (#4693)。
 *
 * `fail()` の失敗は HTTP status に現れないため `notifyApiError(res)` では拾えない。
 * 内部メッセージを露出せず、年齢帯に合った汎用文言だけを出す (ADR-0062)。
 */
export function notifyActionFailure(opts?: NotifyOpts): ApiErrorResult {
	const labels = opts?.labels ?? ERROR_NOTIFY_LABELS;
	showToast(opts?.toastTitle ?? labels.title, labels.generic, 'error');
	return { shown: true, message: labels.generic, status: 0 };
}

/**
 * ネットワーク例外 (fetch reject / throw / タイムアウト) をユーザに通知する。
 */
export function notifyNetworkError(opts?: NotifyOpts): ApiErrorResult {
	const labels = opts?.labels ?? ERROR_NOTIFY_LABELS;
	showToast(opts?.toastTitle ?? labels.title, labels.network, 'error');
	return { shown: true, message: labels.network };
}

/**
 * SvelteKit form action の `ActionResult` (use:enhance) をユーザに通知する。
 * failure (`fail()`) の `data.error` を UI 向け文言として尊重し、error (500 相当) は汎用文言。
 * success / redirect は何もしない (null を返す)。
 */
export function notifyActionError(result: ActionResult, opts?: NotifyOpts): ApiErrorResult | null {
	const labels = opts?.labels ?? ERROR_NOTIFY_LABELS;
	if (result.type === 'failure') {
		const data = result.data as { error?: unknown; message?: unknown } | undefined;
		const serverMessage =
			typeof data?.error === 'string'
				? data.error
				: typeof data?.message === 'string'
					? data.message
					: '';
		const message = resolveApiErrorMessage(result.status ?? 400, serverMessage, labels);
		showToast(opts?.toastTitle ?? labels.title, message, 'error');
		return { shown: true, message, status: result.status };
	}
	if (result.type === 'error') {
		// 予期せぬ例外 (500 相当)。内部 message は出さず汎用文言。
		showToast(opts?.toastTitle ?? labels.title, labels.server, 'error');
		return { shown: true, message: labels.server };
	}
	return null;
}
