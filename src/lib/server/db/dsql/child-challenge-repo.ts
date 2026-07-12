// src/lib/server/db/dsql/child-challenge-repo.ts
// EPIC #3424 / M4-E PR8b (repo 層 §3.8 item 8) / 設計 SSOT: m2-logical-model.md §1.6 /
// m3-physical-model.md §4.2 / dsql-data-model.md §P9
//
// IChildChallengeRepo (child_challenges) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) は
//     呼び出し側 (client factory / テスト) が渡す。全操作が単文のため txn runner 不要
//     (copyAcrossChildren も INSERT...SELECT 単文で原子化)。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **targetConfig / rewardConfig は text 据置 (M3 §4.2 [must]A)**: 列展開すると実 write の
//     genMode / genMissStreak (#3203) / activityId / ageAdjustments を silent drop するため
//     JSON 文字列で丸ごと保持 (SQLite SSOT と parity)。repo は parse しない (opaque)。
//   - **0/1 契約**: ChildChallenge.isActive / completed / rewardClaimed は number (0/1)。
//     DSQL 列は boolean のため読み出しで boolean→0/1、書き込みで 0/1→boolean 変換する
//     (voice-repo の is_active と同 convention、sqlite backend と同 shape)。
//   - **id = challenge_id (uuid)**: PK は (family, child, challenge_id) だが challenge_id 自体が
//     uuid で全域一意のため、findById / update 系は family_id + challenge_id 述語で解決する
//     (certificate-repo の findCertificateById と同判断)。
//   - **getOrCreateWeeklyAuto (#3245)**: DSQL は部分 unique index 非対応のため、schema の
//     weekly_auto_guard STORED 生成列 (auto:weekly 行のみ `${child}:${startDate}`、他は NULL) +
//     UNIQUE に対する ON CONFLICT DO NOTHING で concurrent 二重 INSERT を物理拒否し、直後の
//     SELECT で勝者 1 行に収束させる (owner_guard パターン、ポイント二重付与の不可能化)。
//   - **claimReward (#3333)**: `reward_claimed=false AND completed=true` の行のみ flip し
//     RETURNING で実 flip 行数を返す (SqlExecutor は rowCount 非公開のため RETURNING で数える、
//     daily-mission-complete と同 convention)。service は戻り 1 のときだけ加点する。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import type { IChildChallengeRepo } from '../interfaces/child-challenge-repo.interface';
import type {
	ChildChallenge,
	InsertChildChallengeInput,
	UpdateChildChallengeInput,
} from '../types';
import { AUTO_WEEKLY_SOURCE_TEMPLATE_ID } from '../types';
import type { SqlExecutor } from './sql-executor';

interface ChallengeRow {
	challenge_id: string;
	child_id: string;
	title: string;
	description: string | null;
	challenge_type: string;
	period_type: string;
	start_date: string;
	end_date: string;
	target_config: string;
	reward_config: string;
	status: string;
	is_active: boolean;
	source_template_id: string | null;
	current_value: number;
	target_value: number;
	completed: boolean;
	completed_at: string | null;
	reward_claimed: boolean;
	reward_claimed_at: string | null;
	created_at: string;
	updated_at: string;
}

const CHALLENGE_COLUMNS = sql.raw(
	`challenge_id, child_id, title, description, challenge_type, period_type,
	 start_date, end_date, target_config, reward_config, status, is_active,
	 source_template_id, current_value, target_value, completed, completed_at,
	 reward_claimed, reward_claimed_at, created_at, updated_at`,
);

/** row → ChildChallenge entity (boolean→0/1、sqlite backend と同 shape)。 */
function toChallenge(row: ChallengeRow): ChildChallenge {
	return {
		id: row.challenge_id,
		childId: asChildId(row.child_id),
		title: row.title,
		description: row.description,
		challengeType: row.challenge_type,
		periodType: row.period_type,
		startDate: row.start_date,
		endDate: row.end_date,
		targetConfig: row.target_config,
		rewardConfig: row.reward_config,
		status: row.status,
		isActive: row.is_active ? 1 : 0,
		sourceTemplateId: row.source_template_id,
		currentValue: Number(row.current_value),
		targetValue: Number(row.target_value),
		completed: row.completed ? 1 : 0,
		completedAt: row.completed_at,
		rewardClaimed: row.reward_claimed ? 1 : 0,
		rewardClaimedAt: row.reward_claimed_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function firstRowOrThrow(rows: unknown[], context: string): ChallengeRow {
	const row = rows[0] as ChallengeRow | undefined;
	if (!row) throw new Error(`${context}: insert returned no row`);
	return row;
}

/** DSQL 用 IChildChallengeRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlChildChallengeRepo(db: SqlExecutor): IChildChallengeRepo {
	async function insertOne(
		input: InsertChildChallengeInput,
		tenantId: string,
		options?: { onConflictWeeklyAutoDoNothing?: boolean },
	): Promise<ChildChallenge | undefined> {
		const conflictClause = options?.onConflictWeeklyAutoDoNothing
			? sql` ON CONFLICT (weekly_auto_guard) DO NOTHING`
			: sql``;
		const result = await db.execute(sql`
			INSERT INTO child_challenges
				(family_id, child_id, title, description, challenge_type, period_type,
				 start_date, end_date, target_config, reward_config, source_template_id, target_value)
			VALUES (${tenantId}, ${input.childId}, ${input.title}, ${input.description ?? null},
				${input.challengeType ?? 'cooperative'}, ${input.periodType ?? 'weekly'},
				${input.startDate}, ${input.endDate}, ${input.targetConfig}, ${input.rewardConfig},
				${input.sourceTemplateId ?? null}, ${input.targetValue})${conflictClause}
			RETURNING ${CHALLENGE_COLUMNS}
		`);
		const row = result.rows[0] as unknown as ChallengeRow | undefined;
		return row ? toChallenge(row) : undefined;
	}

	return {
		async findByChildId(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHALLENGE_COLUMNS} FROM child_challenges
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY start_date
			`);
			return (result.rows as unknown as ChallengeRow[]).map(toChallenge);
		},

		async findActiveByChildId(childId, today, tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHALLENGE_COLUMNS} FROM child_challenges
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND is_active = true AND status = 'active'
					AND start_date <= ${today} AND end_date >= ${today}
				ORDER BY start_date
			`);
			return (result.rows as unknown as ChallengeRow[]).map(toChallenge);
		},

		async findActiveOrUnclaimedByChildId(childId, today, tenantId) {
			// #2488: active + 「完成済だが未請求」を包括 (markCompleted 直後に claim 導線が
			// 消える regression 防止)。sqlite backend と同一条件。
			const result = await db.execute(sql`
				SELECT ${CHALLENGE_COLUMNS} FROM child_challenges
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND is_active = true
					AND start_date <= ${today} AND end_date >= ${today}
					AND (status = 'active' OR (status = 'completed' AND reward_claimed = false))
				ORDER BY start_date
			`);
			return (result.rows as unknown as ChallengeRow[]).map(toChallenge);
		},

		async findAllByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHALLENGE_COLUMNS} FROM child_challenges
				WHERE family_id = ${tenantId}
				ORDER BY created_at
			`);
			return (result.rows as unknown as ChallengeRow[]).map(toChallenge);
		},

		async findById(id, tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHALLENGE_COLUMNS} FROM child_challenges
				WHERE family_id = ${tenantId} AND challenge_id = ${id}
			`);
			const row = result.rows[0] as unknown as ChallengeRow | undefined;
			return row ? toChallenge(row) : undefined;
		},

		async insert(input, tenantId) {
			const created = await insertOne(input, tenantId);
			if (!created) throw new Error('insert: insert returned no row');
			return created;
		},

		async insertForRestore(input, tenantId) {
			// #3329: 進捗 / 完了 / 請求 / status / 日時を export 値のまま書き戻す (id のみ新規採番)。
			const result = await db.execute(sql`
				INSERT INTO child_challenges
					(family_id, child_id, title, description, challenge_type, period_type,
					 start_date, end_date, target_config, reward_config, status, is_active,
					 source_template_id, current_value, target_value, completed, completed_at,
					 reward_claimed, reward_claimed_at, created_at, updated_at)
				VALUES (${tenantId}, ${input.childId}, ${input.title}, ${input.description},
					${input.challengeType}, ${input.periodType}, ${input.startDate}, ${input.endDate},
					${input.targetConfig}, ${input.rewardConfig}, ${input.status},
					${input.isActive === 1}, ${input.sourceTemplateId}, ${input.currentValue},
					${input.targetValue}, ${input.completed === 1}, ${input.completedAt},
					${input.rewardClaimed === 1}, ${input.rewardClaimedAt},
					${input.createdAt}, ${input.updatedAt})
				RETURNING ${CHALLENGE_COLUMNS}
			`);
			return toChallenge(firstRowOrThrow(result.rows, 'insertForRestore'));
		},

		async getOrCreateWeeklyAuto(input, tenantId) {
			// #3245: weekly_auto_guard UNIQUE への ON CONFLICT DO NOTHING で二重 INSERT を物理拒否。
			const sourceTemplateId = input.sourceTemplateId ?? AUTO_WEEKLY_SOURCE_TEMPLATE_ID;
			const created = await insertOne({ ...input, sourceTemplateId }, tenantId, {
				onConflictWeeklyAutoDoNothing: true,
			});
			if (created) return created;
			// conflict = 既存勝者が居る。自然キー (child, start_date, auto:weekly) で収束取得。
			const result = await db.execute(sql`
				SELECT ${CHALLENGE_COLUMNS} FROM child_challenges
				WHERE family_id = ${tenantId} AND child_id = ${input.childId}
					AND start_date = ${input.startDate} AND source_template_id = ${sourceTemplateId}
			`);
			const row = result.rows[0] as unknown as ChallengeRow | undefined;
			if (!row) throw new Error('getOrCreateWeeklyAuto: row not found after upsert');
			return toChallenge(row);
		},

		async insertBulk(inputs, tenantId) {
			const results: ChildChallenge[] = [];
			for (const input of inputs) {
				const created = await insertOne(input, tenantId);
				if (!created) throw new Error('insertBulk: insert returned no row');
				results.push(created);
			}
			return results;
		},

		async updateProgress(id, currentValue, tenantId) {
			await db.execute(sql`
				UPDATE child_challenges
				SET current_value = ${currentValue}, updated_at = now()
				WHERE family_id = ${tenantId} AND challenge_id = ${id}
			`);
		},

		async markCompleted(id, tenantId) {
			await db.execute(sql`
				UPDATE child_challenges
				SET completed = true, status = 'completed', completed_at = now(), updated_at = now()
				WHERE family_id = ${tenantId} AND challenge_id = ${id}
			`);
		},

		async claimReward(id, tenantId) {
			// #3333: 条件付き flip。実際に flip した行数を返す (TOCTOU 防止)。
			// #3625: 件数は CTE で DB 側 count 集約し idiom を統一する (affected は高々 1 行だが
			// dsql 全体の「mutation 件数は CTE count」規律に揃え、guard の false-positive を避ける)。
			const result = await db.execute(sql`
				WITH updated AS (
					UPDATE child_challenges
					SET reward_claimed = true, reward_claimed_at = now(), updated_at = now()
					WHERE family_id = ${tenantId} AND challenge_id = ${id}
						AND reward_claimed = false AND completed = true
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM updated
			`);
			return Number((result.rows[0] as { c: number }).c);
		},

		async update(id, input: UpdateChildChallengeInput, tenantId) {
			const sets: ReturnType<typeof sql>[] = [];
			if (input.title !== undefined) sets.push(sql`title = ${input.title}`);
			if (input.description !== undefined) sets.push(sql`description = ${input.description}`);
			if (input.periodType !== undefined) sets.push(sql`period_type = ${input.periodType}`);
			if (input.startDate !== undefined) sets.push(sql`start_date = ${input.startDate}`);
			if (input.endDate !== undefined) sets.push(sql`end_date = ${input.endDate}`);
			if (input.targetConfig !== undefined) sets.push(sql`target_config = ${input.targetConfig}`);
			if (input.rewardConfig !== undefined) sets.push(sql`reward_config = ${input.rewardConfig}`);
			if (input.status !== undefined) sets.push(sql`status = ${input.status}`);
			if (input.isActive !== undefined) sets.push(sql`is_active = ${input.isActive === 1}`);
			if (sets.length === 0) return;
			sets.push(sql`updated_at = now()`);
			await db.execute(sql`
				UPDATE child_challenges SET ${sql.join(sets, sql`, `)}
				WHERE family_id = ${tenantId} AND challenge_id = ${id}
			`);
		},

		async deleteChallenge(id, tenantId) {
			await db.execute(sql`
				DELETE FROM child_challenges
				WHERE family_id = ${tenantId} AND challenge_id = ${id}
			`);
		},

		async copyAcrossChildren(sourceChildId, targetChildId, tenantId) {
			// INSERT...SELECT 単文で原子化 (sqlite の select→loop insert と同結果)。
			// 進捗系 (current_value/completed/reward_claimed/status/is_active) は列 DEFAULT に
			// 委譲して初期化し、メタ (title..target_value, source_template_id) のみ複製する。
			const result = await db.execute(sql`
				INSERT INTO child_challenges
					(family_id, child_id, title, description, challenge_type, period_type,
					 start_date, end_date, target_config, reward_config, source_template_id, target_value)
				SELECT family_id, ${targetChildId}, title, description, challenge_type, period_type,
					start_date, end_date, target_config, reward_config, source_template_id, target_value
				FROM child_challenges
				WHERE family_id = ${tenantId} AND child_id = ${sourceChildId}
				RETURNING ${CHALLENGE_COLUMNS}
			`);
			return (result.rows as unknown as ChallengeRow[]).map(toChallenge);
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`
				DELETE FROM child_challenges WHERE family_id = ${tenantId}
			`);
		},
	};
}
