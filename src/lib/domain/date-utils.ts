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
