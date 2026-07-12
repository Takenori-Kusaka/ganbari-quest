// src/lib/server/db/dsql/settings-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ISettingsRepo (settings) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) は
//     呼び出し側 (client factory / テスト) が渡す。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//     sqlite 現行は key 単独 PK のグローバル KVS (tenantId 無視) だが、DSQL は
//     自然複合 PK (family_id, key) の family KVS に昇格する (schema §11.2 #3557 の前提差分。
//     単一家族 NUC では定数 family_id で同挙動、§P10)。
//   - **setSetting は upsert**: 自然複合 PK への ON CONFLICT DO UPDATE で value / updated_at を
//     上書き (sqlite backend の onConflictDoUpdate と同 shape)。
//   - **getSettings は IN 一括**: keys 空配列は SQL を発行せず {} を返す (IN () は構文エラー)。

import { sql } from 'drizzle-orm';
import type { ISettingsRepo } from '../interfaces/settings-repo.interface';
import type { SqlExecutor } from './sql-executor';

interface SettingRow {
	key: string;
	value: string;
}

/** DSQL 用 ISettingsRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlSettingsRepo(db: SqlExecutor): ISettingsRepo {
	return {
		async getSetting(key, tenantId) {
			const result = await db.execute(sql`
				SELECT value FROM settings WHERE family_id = ${tenantId} AND key = ${key}
			`);
			const row = result.rows[0] as { value: string } | undefined;
			return row?.value;
		},

		async setSetting(key, value, tenantId) {
			await db.execute(sql`
				INSERT INTO settings (family_id, key, value)
				VALUES (${tenantId}, ${key}, ${value})
				ON CONFLICT (family_id, key) DO UPDATE SET value = ${value}, updated_at = now()
			`);
		},

		async getSettings(keys, tenantId) {
			if (keys.length === 0) return {};
			const result = await db.execute(sql`
				SELECT key, value FROM settings
				WHERE family_id = ${tenantId} AND key IN (${sql.join(
					keys.map((k) => sql`${k}`),
					sql`, `,
				)})
			`);
			const map: Record<string, string> = {};
			for (const row of result.rows as unknown as SettingRow[]) {
				map[row.key] = row.value;
			}
			return map;
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM settings WHERE family_id = ${tenantId}`);
		},
	};
}
