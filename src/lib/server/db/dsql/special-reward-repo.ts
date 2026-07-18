// src/lib/server/db/dsql/special-reward-repo.ts
// EPIC #3424 / PR-R8 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ISpecialRewardRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) と
//     TransactionRunner を呼び出し側 (client factory / テスト) が渡す。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **total_point 共更新は無し (§5 P7 対象外)**: sqlite backend の special-reward repo は
//     children.total_point を一切触らない。特別報酬の付与自体はポイント残高を動かさない
//     (ポイントの授受は point-repo 経由の service 層が担う)。したがって本 repo は片方向の
//     CRUD のみで、point_ledger / total_point の共更新経路を持たない。
//   - **#2845 課題① composite-key addressing**: mutation は (childId, rewardId) の複合キーで
//     child 所有権を repo 入口で構造的に検証する (id-only mutation 禁止、不一致は undefined)。
//   - **deleteSpecialReward = reward + 解決済 redemption 履歴を単一 txn 削除** (FK 整合、§P4 は
//     CASCADE 非対応のため repo が明示 DELETE。work は inline + tx-bound await のみ = fitness#7)。
//   - entity 境界: reward_id (uuid) を id 文字列に、family_id 由来の値は entity 非公開。

import { sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import type {
	ISpecialRewardRepo,
	UpdateSpecialRewardInput,
} from '../interfaces/special-reward-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { InsertSpecialRewardInput, SpecialReward } from '../types';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface RewardRow {
	reward_id: string;
	child_id: string;
	granted_by: string | null;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	granted_at: string;
	shown_at: string | null;
	source_preset_id: string | null;
	shop_category: string | null;
}

const REWARD_COLUMNS = sql.raw(
	`reward_id, child_id, granted_by, title, description, points, icon, category,
	 granted_at, shown_at, source_preset_id, shop_category`,
);

/** row → SpecialReward entity (既存 sqlite backend と同一 shape)。 */
function toReward(row: RewardRow): SpecialReward {
	return {
		id: String(row.reward_id),
		childId: asChildId(row.child_id),
		grantedBy: row.granted_by,
		title: row.title,
		description: row.description,
		points: row.points,
		icon: row.icon,
		category: row.category,
		grantedAt: row.granted_at,
		shownAt: row.shown_at,
		sourcePresetId: row.source_preset_id,
		shopCategory: row.shop_category,
	};
}

/** DSQL 用 ISpecialRewardRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlSpecialRewardRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): ISpecialRewardRepo {
	/** (childId, rewardId) 複合キーで単一 reward を取得 (composite ownership)。 */
	const findOne = async (
		childId: ChildId,
		rewardId: string,
		tenantId: string,
	): Promise<SpecialReward | undefined> => {
		const result = await db.execute(sql`
			SELECT ${REWARD_COLUMNS} FROM special_rewards
			WHERE family_id = ${tenantId} AND child_id = ${childId} AND reward_id = ${rewardId}
		`);
		const row = result.rows[0] as unknown as RewardRow | undefined;
		return row ? toReward(row) : undefined;
	};

	return {
		async insertSpecialReward(input: InsertSpecialRewardInput, tenantId) {
			const result = await db.execute(sql`
				INSERT INTO special_rewards
					(family_id, child_id, granted_by, title, description, points, icon, category,
					 source_preset_id, shop_category)
				VALUES (${tenantId}, ${input.childId}, ${input.grantedBy ?? null}, ${input.title},
					${input.description ?? null}, ${input.points}, ${input.icon ?? null}, ${input.category},
					${input.sourcePresetId ?? null}, ${input.shopCategory ?? null})
				RETURNING ${REWARD_COLUMNS}
			`);
			return toReward(result.rows[0] as unknown as RewardRow);
		},

		async findSpecialRewards(childId, tenantId) {
			// granted_at 降順 (同時刻の tie-break に reward_id を添える)。
			const result = await db.execute(sql`
				SELECT ${REWARD_COLUMNS} FROM special_rewards
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY granted_at DESC, reward_id DESC
			`);
			return (result.rows as unknown as RewardRow[]).map(toReward);
		},

		async findUnshownReward(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${REWARD_COLUMNS} FROM special_rewards
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND shown_at IS NULL
				ORDER BY granted_at DESC, reward_id DESC
				LIMIT 1
			`);
			const row = result.rows[0] as unknown as RewardRow | undefined;
			return row ? toReward(row) : undefined;
		},

		async markRewardShown(childId, rewardId, tenantId) {
			// #3581 ②: `/api/v1/special-rewards/[rewardId]/shown` POST (+server) が raw cookie id を
			// 直達させる repo 入口。非 uuid は not-found (undefined) に正規化し 22P02 → 500 を断つ
			// (endpoint は既存の 404 経路で graceful 応答。beacon POST のため redirect でなく repo guard)。
			if (!isUuidFormat(String(childId))) {
				warnInvalidUuidId('special-reward-repo.markRewardShown');
				return undefined;
			}
			// #3799: rewardId は URL param (`[rewardId]`) 由来の form-field 同等 opaque id。cookie childId
			// が有効でも非 uuid rewardId が `reward_id = ${rewardId}` へ直達すると 22P02 になるため同型 guard。
			if (!isUuidFormat(String(rewardId))) {
				warnInvalidUuidId('special-reward-repo.markRewardShown');
				return undefined;
			}
			// #2845 課題①: (childId, rewardId) 複合キー。不一致なら 0 行 = undefined。
			const result = await db.execute(sql`
				UPDATE special_rewards SET shown_at = now()
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND reward_id = ${rewardId}
				RETURNING ${REWARD_COLUMNS}
			`);
			const row = result.rows[0] as unknown as RewardRow | undefined;
			return row ? toReward(row) : undefined;
		},

		async updateSpecialReward(childId, rewardId, updates: UpdateSpecialRewardInput, tenantId) {
			const sets: ReturnType<typeof sql>[] = [];
			if (updates.title !== undefined) sets.push(sql`title = ${updates.title}`);
			if (updates.points !== undefined) sets.push(sql`points = ${updates.points}`);
			if (updates.icon !== undefined) sets.push(sql`icon = ${updates.icon}`);
			if (updates.category !== undefined) sets.push(sql`category = ${updates.category}`);
			// #3154: 陳列系統 (physical/money/privilege/null) を編集で変更可能にする。
			if (updates.shopCategory !== undefined)
				sets.push(sql`shop_category = ${updates.shopCategory}`);
			// 空更新は現状を返す (composite ownership を経由するため他 child は undefined)。
			if (sets.length === 0) return findOne(childId, rewardId, tenantId);
			const result = await db.execute(sql`
				UPDATE special_rewards SET ${sql.join(sets, sql`, `)}
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND reward_id = ${rewardId}
				RETURNING ${REWARD_COLUMNS}
			`);
			const row = result.rows[0] as unknown as RewardRow | undefined;
			return row ? toReward(row) : undefined;
		},

		async deleteSpecialReward(childId, rewardId, tenantId) {
			// reward per-child のため cascade も同 child scope に閉じる (§P4 明示 DELETE、fitness#7)。
			return runner.runInTransaction(async (tx) => {
				await tx.execute(sql`
					DELETE FROM reward_redemption_requests
					WHERE family_id = ${tenantId} AND child_id = ${childId} AND reward_id = ${rewardId}
				`);
				const deleted = await tx.execute(sql`
					DELETE FROM special_rewards
					WHERE family_id = ${tenantId} AND child_id = ${childId} AND reward_id = ${rewardId}
					RETURNING reward_id
				`);
				return deleted.rows.length > 0;
			});
		},

		async deleteByTenantId(tenantId) {
			// sqlite (シングルテナント全行削除) と違い §P9 family 述語で tenant 限定。
			await db.execute(sql`DELETE FROM special_rewards WHERE family_id = ${tenantId}`);
		},
	};
}
