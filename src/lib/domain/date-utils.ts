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

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JSTの「今日」をYYYY-MM-DD形式で返す */
export function todayDateJST(): string {
	return toJSTDateString(new Date());
}

/** 任意のDateをJSTのYYYY-MM-DD形式に変換 */
export function toJSTDateString(date: Date): string {
	const jst = new Date(date.getTime() + JST_OFFSET_MS);
	return jst.toISOString().slice(0, 10);
}

/** JSTの「前日」をYYYY-MM-DD形式で返す */
export function prevDateJST(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
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
