// src/lib/server/db/dsql/message-repo.ts
// EPIC #3424 / PR-R8 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// IMessageRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全メソッドが単文のため TransactionRunner は不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **icon 既定は schema DEFAULT 経由**: InsertParentMessageInput.icon 省略時は列を DEFAULT で
//     挿入し、parent_messages.icon の schema 既定 '💌' を SSOT にする (repo 側で '💌' を二重定義
//     しない)。
//   - **message_type CHECK**: schema 側 (parent_messages_message_type_ck、MESSAGE_TYPES) が担保。
//   - **#2845 課題① composite-key addressing**: markMessageShown は (childId, msgId) 複合キー。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import type { IMessageRepo } from '../interfaces/message-repo.interface';
import type { InsertParentMessageInput, ParentMessage } from '../types';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface MessageRow {
	msg_id: string;
	child_id: string;
	message_type: string;
	stamp_code: string | null;
	body: string | null;
	icon: string;
	sent_at: string;
	shown_at: string | null;
	bonus_points: number | null;
	reward_category: string | null;
}

const MESSAGE_COLUMNS = sql.raw(
	`msg_id, child_id, message_type, stamp_code, body, icon, sent_at, shown_at,
	 bonus_points, reward_category`,
);

/** row → ParentMessage entity (既存 sqlite backend と同一 shape)。 */
function toMessage(row: MessageRow): ParentMessage {
	return {
		id: String(row.msg_id),
		childId: asChildId(row.child_id),
		messageType: row.message_type,
		stampCode: row.stamp_code,
		body: row.body,
		icon: row.icon,
		sentAt: row.sent_at,
		shownAt: row.shown_at,
		bonusPoints: row.bonus_points,
		rewardCategory: row.reward_category,
	};
}

/** DSQL 用 IMessageRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlMessageRepo(db: SqlExecutor): IMessageRepo {
	return {
		async insertMessage(input: InsertParentMessageInput, tenantId) {
			// icon 省略時は DEFAULT ('💌' schema 既定) を使い repo 側で既定文字列を持たない。
			const iconVal = input.icon !== undefined ? sql`${input.icon}` : sql`DEFAULT`;
			const result = await db.execute(sql`
				INSERT INTO parent_messages
					(family_id, child_id, message_type, stamp_code, body, icon, bonus_points, reward_category)
				VALUES (${tenantId}, ${input.childId}, ${input.messageType}, ${input.stampCode ?? null},
					${input.body ?? null}, ${iconVal}, ${input.bonusPoints ?? null},
					${input.rewardCategory ?? null})
				RETURNING ${MESSAGE_COLUMNS}
			`);
			return toMessage(result.rows[0] as unknown as MessageRow);
		},

		async insertForRestore(input, tenantId) {
			// #3329: sent_at / shown_at を verbatim 書き戻す (icon は entity で non-null)。
			const result = await db.execute(sql`
				INSERT INTO parent_messages
					(family_id, child_id, message_type, stamp_code, body, icon, sent_at, shown_at,
					 bonus_points, reward_category)
				VALUES (${tenantId}, ${input.childId}, ${input.messageType}, ${input.stampCode},
					${input.body}, ${input.icon}, ${input.sentAt}, ${input.shownAt},
					${input.bonusPoints}, ${input.rewardCategory})
				RETURNING ${MESSAGE_COLUMNS}
			`);
			return toMessage(result.rows[0] as unknown as MessageRow);
		},

		async findMessages(childId, limit, tenantId) {
			const result = await db.execute(sql`
				SELECT ${MESSAGE_COLUMNS} FROM parent_messages
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY sent_at DESC, msg_id DESC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as MessageRow[]).map(toMessage);
		},

		async findUnshownMessage(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${MESSAGE_COLUMNS} FROM parent_messages
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND shown_at IS NULL
				ORDER BY sent_at DESC, msg_id DESC
				LIMIT 1
			`);
			const row = result.rows[0] as unknown as MessageRow | undefined;
			return row ? toMessage(row) : undefined;
		},

		async countUnshownMessages(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT COUNT(*) AS count FROM parent_messages
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND shown_at IS NULL
			`);
			const row = result.rows[0] as { count: number } | undefined;
			return Number(row?.count ?? 0);
		},

		async markMessageShown(childId, messageId, tenantId) {
			// #3581 ②: `/api/v1/messages/[messageId]/shown` POST (+server) が raw cookie id を
			// 直達させる repo 入口。非 uuid は not-found (undefined) に正規化し 22P02 → 500 を断つ
			// (endpoint は既存の notFound 経路で graceful 応答。beacon POST のため redirect でなく repo guard)。
			if (!isUuidFormat(String(childId))) {
				warnInvalidUuidId('message-repo.markMessageShown');
				return undefined;
			}
			// #3799: messageId は URL param (`[messageId]`) 由来の form-field 同等 opaque id。cookie childId
			// が有効でも非 uuid messageId が `msg_id = ${messageId}` へ直達すると 22P02 になるため同型 guard。
			if (!isUuidFormat(String(messageId))) {
				warnInvalidUuidId('message-repo.markMessageShown');
				return undefined;
			}
			// #2845 課題①: (childId, msgId) 複合キー。不一致なら undefined。
			// #4435 (逸脱 2、条件 SSOT: parallel-implementations.md §13 条件 1): `shown_at IS NULL`
			// guard で冪等にし、再送で初回表示時刻を上書きしない。guard で 0 行になった場合は
			// 所有権を満たす行を読み直して返す (「既に既読」と「他人の子の行」を endpoint の 404
			// 判定が区別できるようにするため)。
			const result = await db.execute(sql`
				UPDATE parent_messages SET shown_at = now()
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND msg_id = ${messageId}
					AND shown_at IS NULL
				RETURNING ${MESSAGE_COLUMNS}
			`);
			const row = result.rows[0] as unknown as MessageRow | undefined;
			if (row) return toMessage(row);
			const already = await db.execute(sql`
				SELECT ${MESSAGE_COLUMNS} FROM parent_messages
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND msg_id = ${messageId}
			`);
			const alreadyRow = already.rows[0] as unknown as MessageRow | undefined;
			return alreadyRow ? toMessage(alreadyRow) : undefined;
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM parent_messages WHERE family_id = ${tenantId}`);
		},
	};
}
