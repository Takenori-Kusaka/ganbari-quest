// src/lib/domain/date-utils.ts
// 日付ユーティリティ（JST固定）

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
