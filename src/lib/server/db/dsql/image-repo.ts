// src/lib/server/db/dsql/image-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §9.4 / §11.2 / §P9
//
// IImageRepo (character_images + children.avatar_url) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む
//     (sqlite 現行はシングルテナント前提で tenantId 無視、DSQL はマルチテナント述語に昇格)。
//   - **§9.4 key+メタのみ**: file_path / prompt_hash 等の key+メタのみを DB に持つ。
//     画像バイトは IStorageRepo (別レイヤー) が保持する。本 repo は画像バイトを touch しない。
//   - **UUID surrogate PK**: image_id は gen_random_uuid() 採番。entity.id = image_id 文字列。
//   - findChildForImage は child-repo の CHILD_COLUMNS / toChild を共有 (mapping 二重実装禁止、
//     login-bonus-repo の findChildById と同判断)。updateChildAvatarUrl は children を
//     updated_at = now() と共更新する (sqlite と同 shape)。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import { assertTenantScopedStorageKey } from '$lib/server/storage-keys';
import type { IImageRepo } from '../interfaces/image-repo.interface';
import type { CharacterImage } from '../types';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import type { SqlExecutor } from './sql-executor';

interface CharacterImageRow {
	image_id: string;
	child_id: string;
	type: string;
	file_path: string;
	prompt_hash: string | null;
	generated_at: string;
}

const IMAGE_COLUMNS = sql.raw(`image_id, child_id, type, file_path, prompt_hash, generated_at`);

/** row → CharacterImage entity (§9.4 key+メタのみ)。 */
function toImage(row: CharacterImageRow): CharacterImage {
	return {
		id: row.image_id,
		childId: asChildId(row.child_id),
		type: row.type,
		filePath: row.file_path,
		promptHash: row.prompt_hash,
		generatedAt: row.generated_at,
	};
}

/** DSQL 用 IImageRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlImageRepo(db: SqlExecutor): IImageRepo {
	return {
		async findCachedImage(childId, type, promptHash, tenantId) {
			const result = await db.execute(sql`
				SELECT ${IMAGE_COLUMNS} FROM character_images
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND type = ${type} AND prompt_hash = ${promptHash}
			`);
			const row = result.rows[0] as unknown as CharacterImageRow | undefined;
			return row ? toImage(row) : undefined;
		},

		async insertCharacterImage(input, tenantId) {
			// #3566 ③ (§9.4): file_path が tenant プレフィックス配下であることを DB 書込前に強制する。
			// prefix 外 / cross-tenant key を永続化すると account 削除の deleteByPrefix で消えない
			// 孤児バイト (COPPA/GDPR) や越境参照 (IDOR/LFI) を生む。mis-scoped は throw で拒否。
			assertTenantScopedStorageKey(input.filePath, tenantId);
			await db.execute(sql`
				INSERT INTO character_images (family_id, child_id, type, file_path, prompt_hash)
				VALUES (${tenantId}, ${input.childId}, ${input.type}, ${input.filePath},
					${input.promptHash})
			`);
		},

		async updateChildAvatarUrl(childId, avatarUrl, tenantId) {
			await db.execute(sql`
				UPDATE children SET avatar_url = ${avatarUrl}, updated_at = now()
				WHERE family_id = ${tenantId} AND child_id = ${childId}
			`);
		},

		async updateChildAvatarUrlIfMatches(childId, expectedAvatarUrl, avatarUrl, tenantId) {
			// #4466: 期待値を WHERE に載せ、一致しなければ 0 行更新で負ける (lost update 防止)。
			// SqlExecutor は rowCount を公開しないため RETURNING の行数で判定する
			// (cloud-export-repo の updateStatus / daily-mission-complete と同 convention)。
			// NULL 同士も「一致」と見なす必要があるので `IS NOT DISTINCT FROM` を使う
			// (`= NULL` は常に UNKNOWN で、avatar_url 未設定の子供が永久に更新できなくなる)。
			const result = await db.execute(sql`
				UPDATE children SET avatar_url = ${avatarUrl}, updated_at = now()
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND avatar_url IS NOT DISTINCT FROM ${expectedAvatarUrl}::text
				RETURNING child_id
			`);
			return result.rows.length > 0;
		},

		async findChildForImage(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children
				WHERE family_id = ${tenantId} AND child_id = ${childId}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM character_images WHERE family_id = ${tenantId}`);
		},
	};
}
