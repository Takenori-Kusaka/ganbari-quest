import { eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../client';
import { assertCrossTenantReadableKey } from '../interfaces/settings-repo.interface';
import { settings } from '../schema';

/**
 * SQLite backend の単一テナント id。`sqlite/auth-repo.ts` の `LOCAL_TENANT_ID` と同値。
 * (auth-repo から import すると settings ↔ auth の循環になるため定数を置く。
 *  一致は `tests/unit/db/settings-all-tenants.test.ts` が機械検証する)
 */
const SQLITE_TENANT_ID = 'local';

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

/**
 * key 一致行を「value が valuePrefix で始まる / 始まらない」で数える（#4269 ①）。
 *
 * SQLite backend は key 単独 PK のグローバル KVS（単一家族 NUC）なので該当は最大 1 行。
 * DSQL backend と同じ「前方一致」判定で数え、`/ops` の在庫表示を同一契約に保つ。
 */
export async function countValuesByPrefix(
	key: string,
	valuePrefix: string,
): Promise<{ total: number; withPrefix: number }> {
	const rows = db.select().from(settings).where(eq(settings.key, key)).all();
	return {
		total: rows.length,
		withPrefix: rows.filter((row) => row.value.startsWith(valuePrefix)).length,
	};
}

/**
 * 全テナント横断で 1 キー分をまとめて読む (#4706)。
 *
 * SQLite backend は key 単独 PK のグローバル KVS（単一家族 NUC）なので該当は最大 1 行。
 * 「全テナント」= その 1 家族であり、tenantId は `sqlite/auth-repo.ts` の `listAllTenants()` が
 * 返すダミーテナントの id (`'local'`) に一致させる。ここを別の値にすると配信 cron 側の
 * 突き合わせが常に空振りし、**NUC でだけ通知が 1 通も出ない**という backend 差になる。
 */
export async function getSettingForAllTenants(key: string): Promise<Map<string, string>> {
	assertCrossTenantReadableKey(key);
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	return row ? new Map([[SQLITE_TENANT_ID, row.value]]) : new Map();
}

/** テナントの全設定を削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(settings).run();
}

/**
 * #4338: `keepKeys` に挙げたキー**以外**を削除する（SQLite: シングルテナントのため
 * 対象は全行。`deleteByTenantId` と同じく tenantId は使わない）。
 *
 * 「消すキーを列挙する」のではなく「残すキーを列挙して他を全部消す」向きにすることで、
 * 新しい設定キーが増えても削除対象から漏れない（詳細は interface の docstring）。
 * NUC (SQLite / PGlite) と cloud (DSQL) で振る舞いが割れないよう、両 backend に実装する。
 */
export async function deleteByTenantIdExcept(
	_tenantId: string,
	keepKeys: readonly string[],
): Promise<void> {
	if (keepKeys.length === 0) {
		db.delete(settings).run();
		return;
	}
	db.delete(settings)
		.where(notInArray(settings.key, [...keepKeys]))
		.run();
}
