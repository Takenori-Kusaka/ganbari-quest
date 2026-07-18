// src/lib/domain/validation/datetime.ts
//
// #3859: export/import round-trip の日時形式 SSOT (ADR-0066 と同型の domain 層集約)。
//
// 背景 (#3851 / PR #3856): legacy SQLite の TEXT datetime 列は `CURRENT_TIMESTAMP` 既定値で
// `'YYYY-MM-DD HH:MM:SS'` (半角スペース区切り) を書く一方、JS 側書込は
// `new Date().toISOString()` (`'T'` 区切り) を書く。round-trip validator が片方の表現しか
// 想定しないと、正当な legacy 行を「不正」と誤判定して silent drop → 件数突合 abort
// (false-positive data-loss) を起こす (#3851 で親メッセージが実害)。
//
// 本 module は「先頭 `YYYY-MM-DD` + `T` または半角スペース区切り + `HH:MM` + `Date.parse` 可」
// を round-trip 日時の受理ポリシーとして単一定義し、import-service (parentMessage /
// siblingCheer の sentAt/shownAt) と export-format (settings tutorial_*_at) の両 validator が
// 同一述語を import する。片側だけ `T` 必須が残ると #3851 の class が再発するため、
// 形式定数を二重定義しない (ADR-0066「wire schema とドメイン validator は同一値域定数を
// import する」の形式版)。`Date.parse` gate が残るため、破損 / 改竄値 (未知形式・範囲外) は
// 依然 reject される。

/**
 * round-trip 日時の受理形式: `YYYY-MM-DD` + (`T` | 半角スペース) + `HH:MM` prefix。
 * `T` = ISO 8601 (JS toISOString) / スペース = SQL datetime (SQLite CURRENT_TIMESTAMP 既定値)。
 */
export const LEGACY_COMPAT_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * 日時 (ISO 8601 または SQL datetime 表現、`Date.parse` 可) か。
 * restore / cutover / settings import の verbatim 値検証用 (#3414 / #3420 / #3382 / #3851 / #3859)。
 */
export function isLegacyCompatibleDateTime(value: string): boolean {
	return LEGACY_COMPAT_DATETIME_RE.test(value) && !Number.isNaN(Date.parse(value));
}
