import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { eq, inArray } from 'drizzle-orm';

/** 設定値を取得 */
export function getSetting(key: string): string | undefined {
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	return row?.value;
}

/** 設定値を更新（upsert） */
export function setSetting(key: string, value: string): void {
	const now = new Date().toISOString();
	db.insert(settings)
		.values({ key, value, updatedAt: now })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value, updatedAt: now },
		})
		.run();
}

/** 複数の設定値を一括取得 */
export function getSettings(keys: string[]): Record<string, string> {
	const rows = db.select().from(settings).where(inArray(settings.key, keys)).all();
	const map: Record<string, string> = {};
	for (const row of rows) {
		map[row.key] = row.value;
	}
	return map;
}
