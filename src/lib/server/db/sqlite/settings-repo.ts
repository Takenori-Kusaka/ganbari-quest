import { eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import { settings } from '../schema';

/** 設定値を取得 */
export async function getSetting(key: string, _tenantId: string): Promise<string | undefined> {
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	return row?.value;
}

/** 設定値を更新（upsert） */
export async function setSetting(key: string, value: string, _tenantId: string): Promise<void> {
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
export async function getSettings(
	keys: string[],
	_tenantId: string,
): Promise<Record<string, string>> {
	const rows = db.select().from(settings).where(inArray(settings.key, keys)).all();
	const map: Record<string, string> = {};
	for (const row of rows) {
		map[row.key] = row.value;
	}
	return map;
}

/** テナントの全設定を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(settings).run();
}
