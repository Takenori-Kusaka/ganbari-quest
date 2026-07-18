// src/lib/server/db/dsql/voice-repo.ts
// EPIC #3424 / PR-R10 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §9.4 / §P9
//
// IVoiceRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) と
//     TransactionRunner を呼び出し側 (client factory / テスト) が渡す。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **§9.4 key+メタのみ**: file_path / public_url / duration_ms 等の key+メタのみを DB に持つ。
//     音声バイトは IStorageRepo (別レイヤー) が保持する。本 repo は録音バイトを touch しない。
//   - **UUID surrogate PK**: voice_id は gen_random_uuid() 採番。id = voice_id 文字列
//     (sqlite の autoincrement 数値 id 文字列化と同 shape 契約)。childId は uuid 文字列。
//   - **0/1 契約**: ChildCustomVoice.isActive は number (0/1)。DSQL 列は boolean のため
//     読み出しで boolean→0/1、書き込みで 0/1→boolean 変換する (既存 sqlite backend と同 shape)。
//   - **setActive の排他は単一 txn**: 「同 child+scene の他 voice を is_active=false + 対象を true」を
//     runner.runInTransaction で all-or-nothing に実行し、アクティブが常に高々 1 本になる状態を
//     不可分に保つ (fitness#7: work 内 await は tx.execute 直呼びのみ、helper 閉包禁止)。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import { assertTenantScopedStorageKey } from '$lib/server/storage-keys';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { IVoiceRepo } from '../interfaces/voice-repo.interface';
import type { ChildCustomVoice } from '../types';
import type { SqlExecutor } from './sql-executor';

interface VoiceRow {
	voice_id: string;
	child_id: string;
	family_id: string;
	scene: string;
	label: string;
	file_path: string;
	public_url: string;
	duration_ms: number | null;
	is_active: boolean;
	created_at: string;
}

const VOICE_COLUMNS = sql.raw(
	`voice_id, child_id, family_id, scene, label, file_path, public_url, duration_ms,
	 is_active, created_at`,
);

/** row → ChildCustomVoice entity (is_active boolean→0/1、§9.4 key+メタのみ)。 */
function toVoice(row: VoiceRow): ChildCustomVoice {
	return {
		id: row.voice_id,
		childId: asChildId(row.child_id),
		scene: row.scene,
		label: row.label,
		filePath: row.file_path,
		publicUrl: row.public_url,
		durationMs: row.duration_ms,
		isActive: row.is_active ? 1 : 0,
		tenantId: row.family_id,
		createdAt: row.created_at,
	};
}

/** DSQL 用 IVoiceRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlVoiceRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IVoiceRepo {
	const findMany = async (tenantWhere: ReturnType<typeof sql>): Promise<ChildCustomVoice[]> => {
		const result = await db.execute(
			sql`SELECT ${VOICE_COLUMNS} FROM child_custom_voices WHERE ${tenantWhere} ORDER BY scene, created_at, voice_id`,
		);
		return (result.rows as unknown as VoiceRow[]).map(toVoice);
	};

	return {
		async findByChild(childId, scene, tenantId) {
			return findMany(sql`family_id = ${tenantId} AND child_id = ${childId} AND scene = ${scene}`);
		},

		async findById(id, tenantId): Promise<ChildCustomVoice | null> {
			const rows = await findMany(sql`family_id = ${tenantId} AND voice_id = ${id}`);
			return rows[0] ?? null;
		},

		async findActiveVoice(childId, scene, tenantId): Promise<ChildCustomVoice | null> {
			const rows = await findMany(
				sql`family_id = ${tenantId} AND child_id = ${childId} AND scene = ${scene} AND is_active = true`,
			);
			return rows[0] ?? null;
		},

		async insert(voice) {
			// #3566 ③ (§9.4): file_path が tenant プレフィックス配下であることを DB 書込前に強制する
			// (孤児バイト / cross-tenant 参照防止、image-repo と同判断)。voice.tenantId が family scope の正。
			assertTenantScopedStorageKey(voice.filePath, voice.tenantId);
			// isActive number(0/1) → boolean。voice.tenantId が family scope の正 (非 restore 経路)。
			const result = await db.execute(sql`
				INSERT INTO child_custom_voices
					(family_id, child_id, scene, label, file_path, public_url, duration_ms, is_active)
				VALUES (${voice.tenantId}, ${voice.childId}, ${voice.scene}, ${voice.label},
					${voice.filePath}, ${voice.publicUrl}, ${voice.durationMs}, ${voice.isActive !== 0})
				RETURNING voice_id
			`);
			return { id: (result.rows[0] as { voice_id: string }).voice_id };
		},

		async findAllByChild(childId, tenantId) {
			return findMany(sql`family_id = ${tenantId} AND child_id = ${childId}`);
		},

		async insertForRestore(voice, tenantId) {
			// #3329 backup restore: created_at / file_path / public_url / is_active を verbatim 保全。
			// voice_id は新規採番 (schema default)。tenantId 引数が復元先 family の正 (voice.tenantId は
			// export 時点の旧値のため使わない、certificate insertForRestore と同判断)。
			// #3566 ③ (§9.4): 呼び出し側 (import-service) は file_path を復元先 tenant へ再キー済だが、
			// untrusted backup 由来のため repo 入口でも tenant プレフィックスを強制する (cross-tenant LFI 防止)。
			assertTenantScopedStorageKey(voice.filePath, tenantId);
			const result = await db.execute(sql`
				INSERT INTO child_custom_voices
					(family_id, child_id, scene, label, file_path, public_url, duration_ms, is_active,
					 created_at)
				VALUES (${tenantId}, ${voice.childId}, ${voice.scene}, ${voice.label},
					${voice.filePath}, ${voice.publicUrl}, ${voice.durationMs}, ${voice.isActive !== 0},
					${voice.createdAt}::timestamptz)
				RETURNING voice_id
			`);
			return { id: (result.rows[0] as { voice_id: string }).voice_id };
		},

		async setActive(id, childId, scene, tenantId) {
			// 排他を単一 txn (all-or-nothing): 同 child+scene の全 voice を false → 対象を true。
			// fitness#7: work 内 await は tx.execute 直呼びのみ (helper 閉包を挟まない)。
			// §P9: 両 UPDATE とも family 述語で tenant 越境を構造排除 (他 tenant 名乗りは no-op)。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`
					UPDATE child_custom_voices SET is_active = false
					WHERE family_id = ${tenantId} AND child_id = ${childId} AND scene = ${scene}
				`);
				await tx.execute(sql`
					UPDATE child_custom_voices SET is_active = true
					WHERE family_id = ${tenantId} AND child_id = ${childId} AND scene = ${scene}
						AND voice_id = ${id}
				`);
			});
		},

		async deleteById(id, tenantId) {
			await db.execute(
				sql`DELETE FROM child_custom_voices WHERE family_id = ${tenantId} AND voice_id = ${id}`,
			);
		},

		async deleteByChild(childId, tenantId) {
			await db.execute(
				sql`DELETE FROM child_custom_voices WHERE family_id = ${tenantId} AND child_id = ${childId}`,
			);
		},
	};
}
