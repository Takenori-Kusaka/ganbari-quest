// src/lib/server/auth/parent-gate.ts
// 親 PIN gate の単一強制点 (#4866 系 QM 監査 / PO 決裁 2026-09-10 決定 4)
//
// ## 何が問題だったか
//
// PIN gate の判定は `(parent)/admin/+layout.server.ts` の **インライン 1 箇所だけ**にあり、
// `hooks.server.ts` を通っていなかった。page の `load` しか通らないので:
//
//   - `/api/v1/admin/**` の **25 本**が素通り
//   - form action (`?/action` POST) が **22 file** で素通り
//
// 設計書 `docs/design/14-セキュリティ設計書.md` は「アプリ層（全経路）」と書いており、
// **実装より広く書いてある**状態だった (PO 差し戻し:「守っているつもり」を残さないこと)。
//
// ## PO 決裁 2026-09-10 決定 4
//
// | 論点 | 決定 |
// |---|---|
// | 不成立時の `/api/v1/admin/**` | **403 JSON** (`PARENT_GATE_REQUIRED`、ADR-0062 shape) |
// | 不成立時の form action | **303 にしない**。`fail()` で入力を保持したまま画面上で PIN を求める |
// | 要求範囲 | **書き込み全部** (POST / PUT / PATCH / DELETE) + **一括 PII を返す読み取り 2 本** |
//
// 読み取りを原則 PIN 不要にしたのは、`/api/v1/admin/tenant/status` のような描画のための
// 読み取りまで 403 にすると admin 画面が描けなくなるため (PO も同じ理由を挙げている)。
//
// ## 読み取り例外 2 本の根拠
//
// QM 監査 (`security.md`) が名指しした実害は「**アドレスバーに URL を打つだけで
// 家族全員分のバックアップが落ちる**」こと。脅威モデル (同端末を親子で共有する家庭、
// 14-セキュリティ設計書 §4.3) で効くのは **書き換え**と**持ち出し**の 2 つで、
// 描画のための読み取りではない。

import { fail } from '@sveltejs/kit';
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import { getEnv } from '$lib/runtime/env';
import { apiError } from '$lib/server/errors';
import {
	PARENT_SESSION_COOKIE_NAME,
	verifyParentSession,
} from '$lib/server/services/parent-gate-session';
// `./factory` ではなく `./auth-mode` から取る (#4723 と同じ理由)。factory は provider 実体を
// 芋づるで引くため、gate の判定だけが要る本 module から見ると過剰で、循環 import も招く。
import { getAuthMode, isCognitoDevMode } from './auth-mode';

/**
 * PIN gate を要求する path prefix。
 *
 * `FRONT_DOOR_PROTECTED_PREFIXES` (`origin-verify.ts`) の `/admin` + `/api/v1/admin` と
 * 同じ集合。`/ops` は運営者専用で ops group 所属が別に効くため対象外。
 */
const PIN_GATE_PREFIXES = ['/admin', '/api/v1/admin'] as const;

/**
 * PIN gate を**掛けてはいけない** path。
 *
 * cookie を発行する経路自身に gate を掛けると PIN を入力する手段が無くなる
 * (鍵を開けるための鍵が要る状態になる)。
 */
const PIN_GATE_EXEMPT_PREFIXES = ['/api/v1/parent-gate'] as const;

/**
 * 一括 PII を返すため、**読み取りでも** PIN を要求する path (PO 決定 4(b))。
 *
 * **完全一致で持つ** — prefix にすると `/api/v1/export/cloud` (保存済みバックアップの
 * *一覧*。描画のための読み取り) まで巻き込み、`/admin/settings/data` が 15 分後に
 * 描けなくなる ([G2] と衝突する)。
 */
const PII_EXPORT_READ_PATHS: readonly string[] = [
	'/api/v1/admin/account/export',
	// PO は `?format=zip` と名指ししたが、**path で持つ**。`?format=json` は同じ
	// `exportFamilyData` を返すため、query 1 文字を変えれば同じ PII が落ちてしまい、
	// 名指しされた zip 側の gate が無意味になる。
	'/api/v1/export',
];

/**
 * 保存済みバックアップの実ファイル DL (`/api/v1/export/cloud/<id>/download`)。
 *
 * 一覧 (`GET /api/v1/export/cloud`) は id を返すだけなので、DL だけを塞いでも
 * 「一覧で id を見て URL を打つ」経路は残らない (DL 自体が止まる)。
 */
const CLOUD_EXPORT_DOWNLOAD_RE = /^\/api\/v1\/export\/cloud\/[^/]+\/download$/;

function isPiiExportRead(pathname: string): boolean {
	return PII_EXPORT_READ_PATHS.includes(pathname) || CLOUD_EXPORT_DOWNLOAD_RE.test(pathname);
}

/** 書き込みメソッド。form action の POST もここに入る。 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hasPrefix(pathname: string, prefixes: readonly string[]): boolean {
	return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * PIN gate が動作する環境か。
 *
 * 判定条件は `(parent)/admin/+layout.server.ts` の既存実装と同一 (SSOT をここへ移した)。
 * demo / local / cognito-dev では無効 — 詳細は 14-セキュリティ設計書 §4.3「有効化条件」。
 */
export function isParentGateActive(): boolean {
	if (getEnv().PARENT_GATE_FORCE_ACTIVE === true) return true;
	return getAuthMode() === 'cognito' && !isCognitoDevMode();
}

/**
 * この request が PIN gate の対象かを判定する。
 *
 * PO 決定 4(b): **書き込み全部** + **一括 PII を返す読み取り**。
 * 描画のための読み取り (GET) は対象外 — 403 にすると admin 画面が描けなくなる。
 */
export function requiresParentGate(pathname: string, method: string): boolean {
	if (hasPrefix(pathname, PIN_GATE_EXEMPT_PREFIXES)) return false;
	// 一括 PII の持ち出しは `/api/v1/admin` の外にもある (`/api/v1/export`)。
	// prefix 判定より先に見ないと取りこぼす。
	if (isPiiExportRead(pathname)) return true;
	if (!hasPrefix(pathname, PIN_GATE_PREFIXES)) return false;
	return WRITE_METHODS.has(method.toUpperCase());
}

/**
 * `hooks.server.ts` から呼ぶ強制点。gate 不成立なら Response を返す (通すなら null)。
 *
 * **API (`/api/`) だけをここで倒す。** form action は page への POST なので、
 * ここで 303 に倒すと**保護者が書いた内容が黙って捨てられる** (PO 決定 4(a) が禁じている)。
 * form action 側は `parentGateBlocked()` を見て `fail()` を返し、入力を保持する。
 */
export function enforceParentGate(
	pathname: string,
	method: string,
	sessionCookie: string | undefined,
	tenantId: string | undefined,
): Response | null {
	if (!isParentGateActive()) return null;
	if (!pathname.startsWith('/api/')) return null;
	if (!requiresParentGate(pathname, method)) return null;
	if (verifyParentSession(sessionCookie, tenantId)) return null;
	return apiError('PARENT_GATE_REQUIRED', OYAKAGI_LABELS.gateRequired, { pathname, method });
}

/**
 * form action / page load から使う判定。gate 不成立なら true。
 *
 * `fail()` に渡す文言は `OYAKAGI_LABELS.gateRequired` を使うこと (文言 SSOT)。
 */
export function parentGateBlocked(
	sessionCookie: string | undefined,
	tenantId: string | undefined,
): boolean {
	if (!isParentGateActive()) return false;
	return !verifyParentSession(sessionCookie, tenantId);
}

/**
 * page の `load` から使う従来の redirect 先。
 *
 * 読み取りの GET を PO 決定 4(b) で PIN 不要にしても、**`/admin` の page 表示自体**は
 * 従来どおり PIN を要求する (これが §4.3 の脅威モデル = 子供が `/switch` のリンクから
 * 親画面に入るのを止める本体)。
 */
export function parentGateRedirectUrl(pathname: string, search: string): string {
	const next = pathname + (search ?? '');
	return `/switch?pinRequired=1&next=${encodeURIComponent(next)}`;
}

/**
 * form action の実行前に挟む gate。**不成立なら `fail()` を返す (通すなら null)。**
 *
 * `redirect(303)` にしない理由 (PO 決定 4(a)): 303 は画面遷移なので、保護者がフォームに
 * 書いた内容がそのまま消える。`fail()` は同じ画面に留まるため、`use:enhance` 下では
 * 入力欄の値が保持されたまま「おやカギの確認が必要です」だけが出る。
 *
 * 返す payload の `parentGateRequired` は `(parent)/admin/+layout.svelte` が読み、
 * **どの画面のどの action で起きても**再入力ダイアログを出すための旗にしている
 * (各 page が `form?.error` を描いているとは限らないため、旗を layout 側で拾う)。
 */
export interface ParentGateActionEvent {
	cookies: { get(name: string): string | undefined };
	locals: { context?: { tenantId?: string } | null };
}

export function parentGateActionFailure(
	event: ParentGateActionEvent,
): ReturnType<typeof fail> | null {
	// **gate が無効な環境では event を一切触らない。** demo / local / cognito-dev では
	// この判定自体が起きないので、cookie を持たない呼び出し (action の単体 test 等) を
	// 巻き込まない。gate が有効なのは cognito production だけ (§4.3「有効化条件」)。
	if (!isParentGateActive()) return null;
	if (
		!parentGateBlocked(
			event.cookies.get(PARENT_SESSION_COOKIE_NAME),
			event.locals.context?.tenantId,
		)
	) {
		return null;
	}
	return fail(403, {
		error: OYAKAGI_LABELS.gateRequiredKeepInput,
		parentGateRequired: true,
	});
}

/**
 * `export const actions` を丸ごと包み、**全 action の手前に gate を 1 本通す**。
 *
 * action ごとに 1 行足す方式にしなかったのは、22 file / 約 60 action あり、
 * **次に action を足した人が忘れた瞬間に穴が開く**から (#3528 と同じ「単一の seam」の話)。
 * 包み忘れ自体は `tests/unit/architecture/parent-gate-action-seam.test.ts` が検出する。
 *
 * **呼び出しは必ず `withParentGate({ … } satisfies Actions)` の形で書くこと。**
 * 型引数の制約をここまで緩くしてあるのは、route ごとの `Actions` (`./$types`) が
 * RouteId を狭く持ち、総称の `Actions` を満たさないため。緩い代わりに、**contextual type を
 * 内側の `satisfies Actions` から供給しないと action の引数が型を失う**
 * (実測: `satisfies` 無しだと `request` / `locals` / `formData` が軒並み any になり、
 * type-coverage が 97.12% → 96.64% に落ちた)。この書き方は同 test [S2] が強制する。
 */
export function withParentGate<T extends Record<string, (event: never) => unknown>>(actions: T): T {
	const wrapped: Record<string, (event: ParentGateActionEvent) => unknown> = {};
	for (const [name, handler] of Object.entries(actions)) {
		const run = handler as unknown as (event: ParentGateActionEvent) => unknown;
		wrapped[name] = (event) => parentGateActionFailure(event) ?? run(event);
	}
	return wrapped as unknown as T;
}
