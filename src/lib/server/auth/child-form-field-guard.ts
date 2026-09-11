// src/lib/server/auth/child-form-field-guard.ts
// #3799: form-field 由来 opaque id の DSQL uuid 列直達 validation (trust 境界)。
//
// child-facing POST action は form-field で相手 child / cheer / challenge / reward / activity /
// checklist template / item の id を受け取り、DSQL / PGlite backend では uuid 列 WHERE / INSERT /
// JOIN 比較に直達する。旧 SQLite の数値 id ('903' 等) 前提の改竄 form が非 uuid 値を送ると Postgres が
// 22P02 (invalid input syntax for type uuid) を throw し、500 (uncaught) または内部例外 leak
// (try/catch → fail(400) に生 err.message を載せる、ADR-0062 違反) になる (CWE-20 入力検証欠如)。
//
// Cookie (`requireValidChildCookieFormat`) は「cutover で残存した stale cookie の自然回帰」を
// `/switch` redirect で救済するが、form-field 改竄は **有効 cookie + 意図的改竄** でしか起きない
// 自テナント内の自己誘発であるため、redirect (未選択画面へ誘導) でなく validation error 正規化
// (`fail(400)`) が妥当 (#3799、docs/design/14-セキュリティ設計書.md §5.2.7 の form-field 行)。
//
// 本 guard は boolean を返し、caller が action ごとの既存 `fail(400, { error: ... })` で拒否する。
// uuid 形式判定は pg-uuid.ts の `isUuidFormat` に集約する (別実装禁止、ADR-0063 単一強制点 /
// fitness [SSOT-1])。guard trip は cookie guard と同じく `warnInvalidUuidId` で observability を保つ
// (silent guard 禁止、fitness [OBS-2])。

import { isPgBackend } from '$lib/server/db/backend';
import { isUuidFormat, warnInvalidUuidId } from '$lib/server/db/dsql/pg-uuid';

/**
 * form-field 由来の単一 id が DSQL uuid 列に安全に渡せる形式か検証する。
 *
 * dsql backend 時のみ uuid 形式を要求し、非 uuid なら `false` を返す (caller は `fail(400)` で拒否)。
 * 非 dsql backend (sqlite / demo) では数値 id が正当なため常に `true` (有効な数値 id を誤って弾かない)。
 *
 * @param value form-field から取り出した id 文字列 (`formIdString(formData.get(...))` 等)。
 * @param source guard trip 箇所の識別子 (例 `'route.home.sendCheer.toChildId'`)。stale/改竄検知の warn に使う。
 * @returns dsql backend で uuid 形式でなければ `false`、それ以外は `true`。
 */
export function isValidUuidFormField(value: string, source: string): boolean {
	// pg 系 (dsql / pglite) のみ検証 (#4720: NUC PGlite も uuid 列)。
	if (!isPgBackend()) return true;
	if (isUuidFormat(value)) return true;
	// 非空だが非 uuid = 改竄 or 旧数値 id の form 由来直達 (空は各 action の空 guard が既に弾く)。
	if (value) warnInvalidUuidId(source);
	return false;
}

/**
 * form-field 由来の複数 id が全て DSQL uuid 列に安全に渡せる形式か検証する
 * (`markCheersShown` の `cheerIds` 等、CSV で複数 id を受け取る action 用)。
 *
 * dsql backend 時のみ検証し、1 件でも非 uuid なら `false`。非 dsql backend では常に `true`。
 *
 * @param values form-field 由来 id 文字列の配列。
 * @param source guard trip 箇所の識別子。
 * @returns dsql backend で 1 件でも uuid 形式でなければ `false`、それ以外は `true`。
 */
export function areValidUuidFormFields(values: string[], source: string): boolean {
	if (!isPgBackend()) return true;
	return values.every((v) => isValidUuidFormField(v, source));
}
