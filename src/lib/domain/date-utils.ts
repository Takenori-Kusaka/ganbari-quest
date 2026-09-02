// src/lib/domain/date-utils.ts
// 日付ユーティリティ（JST固定）
//
// ## 日時管理方針（#966）
//
// 本プロジェクトでは recorded_date カラムが YYYY-MM-DD テキスト型のため、
// 日付計算は **JST 基準で統一** する。
//
// | レイヤー       | 方針                             |
// |---------------|--------------------------------|
// | DB 保存       | JST 基準の YYYY-MM-DD (recorded_date) |
// | サービス層     | todayDateJST() を使用（UTC 混在禁止） |
// | 表示層         | toJSTDateString / formatJSTDateTime を使用 |
//
// `new Date().toISOString().slice(0, 10)` は UTC 日付を返すため、
// 0:00〜9:00 JST の間に当日判定がずれる。サービス層では必ず
// todayDateJST() を使用すること。
//
// 将来 UTC 保存に移行する場合は recorded_at (timestamp) カラムの
// 新設が必要（#966 コメント 案A 参照）。
//
// ## SSOT 宣言 — 日付を決める計算は本 module 経由で行う (#4015 / #4127)
//
// **「実時刻の瞬間 (`new Date()` / DB timestamp) から暦要素 (年 / 月 / 日 / 時 / 曜日) を
// 取り出す」計算は、必ず本 module の関数を使う。**禁止されるのはローカル getter だけではない。
// 同じ欠陥クラスに属する書き方はすべて対象:
//
// | 書き方 | なぜ駄目か |
// |---|---|
// | `d.getFullYear()` / `getMonth()` / `getDate()` / `getDay()` / `getHours()` 等 | プロセス TZ で結果が変わる |
// | `new Date().toISOString().slice(0, 10)` / `.split('T')[0]` | TZ 不変だが **UTC の暦日**。JST 00:00〜09:00 が前日になる |
// | `toLocaleDateString('ja-JP')` (timeZone 未指定) | SSR は Lambda (UTC) で描画されるため暦日がずれる |
//
// 理由: 本番 runtime は 2 種類あり、プロセス TZ が一致しない。
//
// | runtime | プロセス TZ | ローカル getter の結果 |
// |---|---|---|
// | AWS Lambda / CI runner | UTC | JST 00:00〜09:00 の 9 時間、暦日が 1 日前になる |
// | NUC セルフホスト (日本の家庭) | JST | JST と一致する |
//
// つまりローカル getter を使うと **同じコードが環境ごとに違う日付を返す**。#4003 では
// これで子供ホームの週次チャレンジが毎週 9 時間まるごと消えた。#966 / ADR-0061
// (same-class-N → guard) に基づき、本 module を単一の入口とする。
//
// 機械強制 (2 層):
//
//   - 静的: `scripts/check-local-tz-date-getters.mjs` が src / infra/lambda / scripts を走査し、
//     上表のクラスを検出する。検出対象は `Date.prototype` の実体から導出しているため
//     「まだ知らない書き方」も既定で TZ 依存側に落ちる。allowlist は kind ごとに機械検査される
//   - 振る舞い: `tests/unit/architecture/tz-invariance.test.ts` が `TZ=UTC` (Lambda) と
//     `TZ=Asia/Tokyo` (NUC) の 2 環境で顧客に見える日付導出を評価し、JST 暦の期待値と
//     一致することを assert する (記法に依存しない表明)
//
// 実装方針: JST の暦日を `toJSTDateString()` で文字列化し、それを **UTC 深夜として
// 再解釈**してから UTC 算術 (`getUTCDate` / `setUTCDate`) で計算する。以降の計算が
// UTC 系で閉じるため、プロセス TZ の影響を受けない。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * JST の暦日を「UTC 深夜の Date」として取り出す内部ヘルパ。
 * 以降の暦計算はすべて UTC 系 (`getUTC*` / `setUTC*`) で閉じるため TZ 非依存。
 */
function jstCalendarDay(date: Date): Date {
	return new Date(`${toJSTDateString(date)}T00:00:00Z`);
}

/** JSTの「今日」をYYYY-MM-DD形式で返す */
export function todayDateJST(): string {
	return toJSTDateString(new Date());
}

/**
 * JST 暦日 (YYYY-MM-DD) を「その日を指す瞬間」として Date に戻す (#4120)。
 *
 * 暦日文字列を起点に暦計算したい呼び出し側が、各所で
 * ``new Date(`${dateStr}T00:00:00Z`)`` と書いて自前の暦算術を始めるのを止めるための入口。
 * 返す瞬間は JST 09:00 (= UTC 00:00) なので `toJSTDateString()` に通すと元の暦日に戻る。
 */
export function jstDateToInstant(dateStr: string): Date {
	return new Date(`${dateStr}T00:00:00Z`);
}

/** 任意のDateをJSTのYYYY-MM-DD形式に変換 */
export function toJSTDateString(date: Date): string {
	const jst = new Date(date.getTime() + JST_OFFSET_MS);
	return jst.toISOString().slice(0, 10);
}

/**
 * JST 日付文字列 (YYYY-MM-DD) の `days` 日後を返す (負値で過去)。
 *
 * 暦日文字列を UTC 深夜として解釈し UTC 算術で加減算するため、プロセス TZ に依存しない。
 * `d.setDate(d.getDate() + n)` (ローカル TZ 版) の置換先。
 */
export function addDaysJST(dateStr: string, days: number): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** JSTの「前日」をYYYY-MM-DD形式で返す */
export function prevDateJST(dateStr: string): string {
	return addDaysJST(dateStr, -1);
}

/**
 * JST 基準の曜日 (0=日曜 … 6=土曜) を返す。
 * `new Date().getDay()` (ローカル TZ) の置換先。
 */
export function jstDayOfWeek(date: Date = new Date()): number {
	return jstCalendarDay(date).getUTCDay();
}

/**
 * JST 基準の「時」(0-23) を返す。
 * `date.getHours()` (ローカル TZ) の置換先 (#4127)。
 *
 * はやおきボーナスのような「朝 N 時までに記録したか」の判定は、プロセス TZ が UTC の
 * Lambda 上だと 9 時間ずれ、JST 07:00 の記録には付かず JST 15:00 の記録に付いてしまう。
 */
export function jstHour(date: Date = new Date()): number {
	return new Date(date.getTime() + JST_OFFSET_MS).getUTCHours();
}

/**
 * JST 基準の「その日の 0:00 からの経過分」(0-1439) を返す (#4120)。
 * `(date.getUTCHours() + 9) % 24 * 60 + date.getUTCMinutes()` を手書きする経路の置換先。
 */
export function jstMinuteOfDay(date: Date = new Date()): number {
	const jst = new Date(date.getTime() + JST_OFFSET_MS);
	return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

/**
 * ISO timestamp 文字列 (DB の createdAt / recordedAt 等、UTC) の **JST 暦日**を返す (#4120)。
 *
 * `log.recordedAt.slice(0, 10)` / `.split('T')[0]` は **UTC の暦日**であり、
 * JST 00:00〜09:00 に記録された行を前日に落とす。文字列を切るのではなく本関数を通す。
 */
export function jstDateOfIso(isoTimestamp: string): string {
	return toJSTDateString(new Date(isoTimestamp));
}

/**
 * JST 暦日 (YYYY-MM-DD) の 00:00 に対応する **UTC の瞬間**を ISO 文字列で返す (#4127)。
 *
 * DB に UTC ISO で保存した timestamp を「JST の 1 日」で絞るときの境界値。
 * `startedAt >= '2026-08-01'` のような UTC 暦日前方一致は、JST 00:00〜09:00 の利用を
 * 前日側に落としてしまう (保護者画面の「今日の利用時間」が 0 分のままになる)。
 */
export function jstDayStartUtcIso(dateStr: string): string {
	return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - JST_OFFSET_MS).toISOString();
}

/**
 * **epoch 秒** (DB 格納値) を JST 暦日 (YYYY-MM-DD) にする (#4632)。
 *
 * `new Date(x)` は x を **ミリ秒**として解釈するため、秒値をそのまま渡すと 1970 年になる
 * (実害: 子供の交換履歴が全件「1月22日（木）」と表示された)。DB は `requested_at` /
 * `resolved_at` を epoch 秒で持ち、UI は ISO 文字列 / Date / epoch 秒が混在するため、
 * **秒を受ける入口を専用関数に分けて呼び分けを型と名前で強制する**。
 * ミリ秒を持っているなら `toJSTDateString(new Date(ms))` を使う。
 */
export function jstDateOfEpochSeconds(epochSeconds: number): string {
	return toJSTDateString(new Date(epochSeconds * 1000));
}

/**
 * JST 基準の年 / 月 (月は 1-12) を返す。
 * `now.getFullYear()` / `now.getMonth() + 1` の置換先。
 */
export function jstYearMonth(date: Date = new Date()): { year: number; month: number } {
	const [y, m] = toJSTDateString(date).split('-').map(Number);
	return { year: y ?? 0, month: m ?? 0 };
}

/**
 * JST 基準の月キー (YYYY-MM) を返す。
 * `` `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` `` の置換先。
 */
export function monthKeyJST(date: Date = new Date()): string {
	return toJSTDateString(date).slice(0, 7);
}

/**
 * 月キー (YYYY-MM) を `delta` ヶ月ずらす (負値で過去)。年またぎを正しく扱う。
 * `new Date(now.getFullYear(), now.getMonth() - i, 1)` で月を列挙する形の置換先。
 */
export function shiftMonthKey(monthKey: string, delta: number): string {
	const [y, m] = monthKey.split('-').map(Number);
	const d = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1 + delta, 1));
	return d.toISOString().slice(0, 7);
}

/**
 * ISO timestamp (DB の createdAt 等、UTC 文字列) が JST 基準で月キー (YYYY-MM) に属するか。
 *
 * `createdAt.startsWith('2026-07')` のような UTC 前方一致は、JST 月初の 9 時間分を
 * 前月として落とす。集計の月境界を JST に揃えるための判定入口 (#4015)。
 */
export function isInJstMonth(isoTimestamp: string | null | undefined, monthKey: string): boolean {
	if (!isoTimestamp) return false;
	const d = new Date(isoTimestamp);
	if (Number.isNaN(d.getTime())) return false;
	return monthKeyJST(d) === monthKey;
}

/**
 * 暦日 (YYYY-MM-DD) の月キー (YYYY-MM) を返す (#4120)。
 * `date.slice(0, 7)` を各所で書く経路の置換先 (入力が既に JST 暦日なので基準は JST)。
 */
export function monthKeyOfDate(dateStr: string): string {
	return dateStr.slice(0, 7);
}

/** 月キー (YYYY-MM) の日数を返す (28-31)。うるう年も UTC 算術で正しく扱う。 */
export function daysInMonthOfKey(monthKey: string): number {
	return Number(monthEndOfKey(monthKey).slice(8));
}

/**
 * **UTC 基準**の月キー (YYYY-MM) を返す (#4120)。
 *
 * 顧客に見える暦は JST (`monthKeyJST`) が既定。本関数は **鍵が ISO UTC 文字列そのもの**である
 * ops 集計 (cohort / acquisition) が、鍵と月バケットの基準を一致させるために使う (#3449)。
 * どちらの基準を採るかを呼び出し側の手書き実装で分岐させず、SSOT 内の明示 API として持つ。
 */
export function utcMonthKey(date: Date): string {
	return date.toISOString().slice(0, 7);
}

/** JST 基準で「その月の 1 日」を YYYY-MM-DD で返す */
export function monthStartJST(date: Date = new Date()): string {
	return `${monthKeyJST(date)}-01`;
}

/** JST 基準で「その月の末日」を YYYY-MM-DD で返す */
export function monthEndJST(date: Date = new Date()): string {
	return monthEndOfKey(monthKeyJST(date));
}

/** 月キー (YYYY-MM) の末日を YYYY-MM-DD で返す。うるう年も UTC 算術で正しく扱う。 */
export function monthEndOfKey(monthKey: string): string {
	const [y, m] = monthKey.split('-').map(Number);
	// 翌月 1 日の前日 = 当月末日
	const d = new Date(Date.UTC(y ?? 0, m ?? 1, 1));
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

/**
 * JST 基準で「その週の月曜」を YYYY-MM-DD で返す (#4003)。
 *
 * ## なぜ必要か
 *
 * 週次データの **書き込み側が週頭をローカル TZ で決め、読み出し側が `todayDateJST()` で
 * active 判定する**と、両者の基準がずれる。プロセス TZ が UTC (CI runner / Lambda) のとき、
 * UTC 日曜 15:00〜24:00 = **JST 月曜 00:00〜09:00** の 9 時間だけ:
 *
 *   - 書き込み: `startDate = 前週月曜` / `endDate = その日曜` (UTC ではまだ日曜のため)
 *   - 読み出し: `todayDateJST()` は既に **翌週の月曜** を返す
 *   → `endDate >= today` が false になり、その週のデータが「存在しない」ことになる
 *
 * 実害: 子供ホームの週次チャレンジバッジが毎週 9 時間まるごと消えていた (#4003)。
 *
 * ## 実装方針
 *
 * **ローカル TZ getter (`getDay` / `getFullYear` / `getMonth` / `getDate`) を一切使わない。**
 * `toJSTDateString()` で JST の日付文字列にしてから、その文字列を UTC 深夜として解釈し
 * UTC 算術で月曜まで戻す。同ファイルの `getLastWeekStart()` (child-challenge-service) が
 * 既にこの形なので、それに揃えている。
 *
 * @param date 基準時刻 (省略時は現在時刻)
 * @returns その週の月曜 (JST 基準) の YYYY-MM-DD
 */
export function weekStartJST(date: Date = new Date()): string {
	// JST の暦日を取り出し、それを UTC 深夜として再解釈する。
	// 以降の曜日計算は UTC 系で閉じるため、プロセス TZ の影響を受けない。
	const jstDay = new Date(`${toJSTDateString(date)}T00:00:00Z`);
	const dow = jstDay.getUTCDay(); // 0=Sun, 1=Mon, ...
	const diff = dow === 0 ? -6 : 1 - dow; // 日曜は前週月曜まで 6 日戻す
	jstDay.setUTCDate(jstDay.getUTCDate() + diff);
	return jstDay.toISOString().slice(0, 10);
}

/**
 * JST 基準で「その週の日曜 (週末)」を YYYY-MM-DD で返す (#4015)。
 * 週は月曜始まり・日曜終わりとする (`weekStartJST()` と対で使う)。
 */
export function weekEndJST(date: Date = new Date()): string {
	return addDaysJST(weekStartJST(date), 6);
}

/**
 * 暦日 (YYYY-MM-DD) が属する週の月曜を YYYY-MM-DD で返す (#4120)。
 * 暦日文字列を起点に週頭を出す経路 (スタンプカード等) の置換先。
 */
export function weekStartOfDateJST(dateStr: string): string {
	return weekStartJST(jstDateToInstant(dateStr));
}

/** 暦日 (YYYY-MM-DD) が属する週の日曜を YYYY-MM-DD で返す (`weekStartOfDateJST` と対)。 */
export function weekEndOfDateJST(dateStr: string): string {
	return addDaysJST(weekStartOfDateJST(dateStr), 6);
}

/** 暦日 (YYYY-MM-DD) 2 点間の日数差 (`to` - `from`)。暦日基準なので TZ に依存しない。 */
export function daysBetweenJST(from: string, to: string): number {
	const ms = jstDateToInstant(to).getTime() - jstDateToInstant(from).getTime();
	return Math.round(ms / 86_400_000);
}

/**
 * YYYY-MM-DD 日付文字列を JST の表示用文字列に変換する。
 * 例: '2026-04-13' → '2026年4月13日'
 */
export function formatJSTDate(dateStr: string): string {
	const [y, m, d] = dateStr.split('-').map(Number);
	return `${y}年${m}月${d}日`;
}

/**
 * Date オブジェクトを JST の日時表示用文字列に変換する。
 * 例: new Date('2026-04-13T01:00:00Z') → '2026/04/13 10:00'
 */
export function formatJSTDateTime(date: Date): string {
	return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

/**
 * 誕生日 (YYYY-MM-DD) から JST 基準の現在年齢を計算して返す。
 * 誕生日当日は既に加算済みの年齢を返す。
 */
export function calculateAgeFromBirthDate(birthDateStr: string): number {
	const today = todayDateJST();
	const [ty, tm, td] = today.split('-').map(Number);
	const [by, bm, bd] = birthDateStr.split('-').map(Number);
	let age = (ty ?? 0) - (by ?? 0);
	if ((tm ?? 0) < (bm ?? 0) || ((tm ?? 0) === (bm ?? 0) && (td ?? 0) < (bd ?? 0))) {
		age--;
	}
	return Math.max(0, age);
}
