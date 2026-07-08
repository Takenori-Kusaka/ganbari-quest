// src/lib/server/db/dsql/battle-repo.ts
// EPIC #3424 / PR-R9 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §5 / §11.2 / §P9
//
// IBattleRepo (daily_battles + enemy_collection) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) は
//     呼び出し側 (client factory / テスト) が渡す。本 repo は txn を張らない (全操作が単文の
//     ため runner 不要) が、fitness#8 の一貫性のため signature は他 repo と揃える。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **playerStatsJson は text 据置 (M3 §10 / M4-C)**: BattleStats を列展開すると キー変動時に
//     silent drop を招くため、daily_battles.player_stats_json に JSON 文字列で丸ごと保持する
//     (SQLite SSOT と parity。battle-service が JSON.parse(row.playerStatsJson) する文字列契約)。
//   - **合成 id (自然複合 PK の帰結)**: daily_battles PK = (family,child,date)、enemy_collection
//     PK = (family,child,enemy_id) で surrogate id 列が無い。interface の `id: string` /
//     insertDailyBattle 戻り / completeBattle(battleId) は opaque token 契約 (battle-service は
//     等値比較せず client へ往復させるだけ = 実測) のため、自然キーを `${childId}:${date}` /
//     `${childId}:${enemyId}` で埋め込む。completeBattle は token を自然キーへ復号して UPDATE する。
//     childId(uuid) と date(YYYY-MM-DD)・enemyId(int) は ':' を含まないため復号は一意。
//   - **連敗集計は app-side fetch + JS 集計** (§5 line 87: battle 連敗は真の GROUP BY を持たない)。
//     completed 直近 5 件を date 降順で取り、先頭からの 'lose' 連鎖を JS で数える (sqlite parity)。
//   - **enemy_collection は単文 upsert** (sqlite の select-then-branch を ON CONFLICT DO UPDATE に
//     置換、§3.5.5 の N+1 を repo が作らない)。

import { sql } from 'drizzle-orm';
import type { BattleOutcome } from '$lib/domain/battle-types';
import { asChildId } from '$lib/domain/ids';
import type {
	DailyBattleRow,
	EnemyCollectionRow,
	IBattleRepo,
} from '../interfaces/battle-repo.interface';
import type { SqlExecutor } from './sql-executor';

interface BattleRow {
	child_id: string;
	date: string;
	enemy_id: number;
	status: string;
	outcome: string | null;
	reward_points: number;
	turns_used: number;
	player_stats_json: string;
	created_at: string;
	updated_at: string;
}

interface CollectionRow {
	child_id: string;
	enemy_id: number;
	first_defeated_at: string;
	defeat_count: number;
}

const BATTLE_COLUMNS = sql.raw(
	`child_id, date, enemy_id, status, outcome, reward_points, turns_used,
	 player_stats_json, created_at, updated_at`,
);

const COLLECTION_COLUMNS = sql.raw('child_id, enemy_id, first_defeated_at, defeat_count');

/** 自然複合キー (child_id, date) を opaque token に埋め込む (surrogate id 列が無いため)。 */
function battleToken(childId: string, date: string): string {
	return `${childId}:${date}`;
}

/** battleId token を自然キー (childId, date) に復号する。childId(uuid)/date は ':' を含まない。 */
function decodeBattleToken(battleId: string): { childId: string; date: string } {
	const idx = battleId.indexOf(':');
	if (idx < 0) {
		throw new Error(`completeBattle: 不正な battleId token (${battleId})`);
	}
	return { childId: battleId.slice(0, idx), date: battleId.slice(idx + 1) };
}

/** row → DailyBattleRow (player_stats_json は text 据置のため verbatim、sqlite parity shape)。 */
function toBattleRow(row: BattleRow): DailyBattleRow {
	return {
		id: battleToken(row.child_id, row.date),
		childId: asChildId(row.child_id),
		enemyId: Number(row.enemy_id),
		date: row.date,
		status: row.status as DailyBattleRow['status'],
		outcome: row.outcome as DailyBattleRow['outcome'],
		rewardPoints: Number(row.reward_points),
		turnsUsed: Number(row.turns_used),
		playerStatsJson: row.player_stats_json,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** row → EnemyCollectionRow (合成 id = `${childId}:${enemyId}`)。 */
function toCollectionRow(row: CollectionRow): EnemyCollectionRow {
	return {
		id: `${row.child_id}:${row.enemy_id}`,
		childId: asChildId(row.child_id),
		enemyId: Number(row.enemy_id),
		firstDefeatedAt: row.first_defeated_at,
		defeatCount: Number(row.defeat_count),
	};
}

/** DSQL 用 IBattleRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlBattleRepo(db: SqlExecutor): IBattleRepo {
	return {
		async findTodayBattle(childId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT ${BATTLE_COLUMNS} FROM daily_battles
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND date = ${date}
			`);
			const row = result.rows[0] as unknown as BattleRow | undefined;
			return row ? toBattleRow(row) : undefined;
		},

		async findRecentBattles(childId, limit, tenantId) {
			const result = await db.execute(sql`
				SELECT ${BATTLE_COLUMNS} FROM daily_battles
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY date DESC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as BattleRow[]).map(toBattleRow);
		},

		async countConsecutiveLosses(childId, tenantId) {
			// app-side JS 集計 (§5 line 87): completed 直近 5 件を date 降順で取り、先頭 'lose' 連鎖を数える。
			const result = await db.execute(sql`
				SELECT outcome FROM daily_battles
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND status = 'completed'
				ORDER BY date DESC
				LIMIT 5
			`);
			let losses = 0;
			for (const row of result.rows as { outcome: string | null }[]) {
				if (row.outcome === 'lose') {
					losses++;
				} else {
					break;
				}
			}
			return losses;
		},

		async insertDailyBattle(childId, enemyId, date, playerStats, tenantId) {
			// 自然複合 PK (family,child,date) = 1日1バトル (ADR-0012 policy invariant §11.2)。
			// service は事前に findTodayBattle で存在確認するため plain INSERT (衝突は 1日2回目 = 契約違反)。
			await db.execute(sql`
				INSERT INTO daily_battles
					(family_id, child_id, date, enemy_id, status, player_stats_json)
				VALUES (${tenantId}, ${childId}, ${date}, ${enemyId}, 'pending',
					${JSON.stringify(playerStats)})
			`);
			return battleToken(String(childId), date);
		},

		async completeBattle(battleId, outcome, rewardPoints, turnsUsed, tenantId) {
			const { childId, date } = decodeBattleToken(battleId);
			await db.execute(sql`
				UPDATE daily_battles
				SET status = 'completed', outcome = ${outcome as BattleOutcome},
					reward_points = ${rewardPoints}, turns_used = ${turnsUsed}, updated_at = now()
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND date = ${date}
			`);
		},

		async findCollection(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${COLLECTION_COLUMNS} FROM enemy_collection
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY enemy_id
			`);
			return (result.rows as unknown as CollectionRow[]).map(toCollectionRow);
		},

		async upsertCollectionEntry(childId, enemyId, tenantId) {
			// 単文 upsert: 初回は defeat_count=1 (default)、既存は +1 (sqlite の select-then-branch 置換)。
			await db.execute(sql`
				INSERT INTO enemy_collection (family_id, child_id, enemy_id)
				VALUES (${tenantId}, ${childId}, ${enemyId})
				ON CONFLICT (family_id, child_id, enemy_id)
				DO UPDATE SET defeat_count = enemy_collection.defeat_count + 1
			`);
		},
	};
}
