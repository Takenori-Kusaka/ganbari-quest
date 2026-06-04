// src/lib/server/db/dynamodb/battle-repo.ts
// バトルアドベンチャーリポジトリ — DynamoDB 本実装 (#2824 Wave 5A / ADR-0055)
//
// IBattleRepo (interfaces/battle-repo.interface.ts) を SQLite 実装
// (sqlite/battle-repo.ts、挙動 SSOT) と機能等価に DynamoDB single-table で実装する。
//
// 経緯: 本 repo は #2263 hotfix (PR #2280) で「read=空 / write=no-op + logger.warn」化された。
//   バトルは LP machine-tour ④「冒険のクライマックス」(feature-rpg-battle) で訴求する RPG 機能で、
//   子供 home から日次バトルを起動 → 勝敗 → ポイント報酬 → 敵図鑑収集という体験ループを持つ
//   (battle-service.ts)。本番 cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で
//   書込みが永続しないと、毎アクセスで「今日のバトル未挑戦」に戻り報酬も図鑑も消える
//   (ADR-0013 LP truth 違反級)。本実装で根治する。
//
// key 設計 (keys.ts §dailyBattleKey / §enemyCollectionKey):
//   daily_battles  : PK = T#<tid>#CHILD#<childId>  SK = BATTLE#<date>
//     → child partition 同居 (stamp_cards / activity_logs と同じ)。
//       findTodayBattle は childId + date 既知の GetItem 1 回。date は child 内で一意
//       = SQLite uniqueIndex(child_id, date) と等価。findRecentBattles /
//       countConsecutiveLosses は begins_with(SK, 'BATTLE#') の child partition Query で
//       取得し、date が YYYY-MM-DD なので SK 辞書順 = 日付順 → ScanIndexForward=false で
//       desc(date) と等価。battleId だけで引く completeBattle は 1 日 1 戦の低頻度のため
//       tenant Scan + id filter で PK/SK を解決する (stamp-card updateCardStatus と同型)。
//   enemy_collection: PK = T#<tid>#CHILD#<childId> SK = ENEMYCOL#<paddedEnemyId>
//     → child partition 同居。findCollection は begins_with(SK, 'ENEMYCOL#') Query で全件、
//       upsertCollectionEntry は childId + enemyId 既知の GetItem → 不在なら Put /
//       既存なら defeatCount を ADD する (childId が常に渡るため Scan 不要)。
//   → 全アクセスパターンが child 軸 / id 軸で完結し追加 GSI 不要 (ADR-0055 §3.1 / ADR-0010)。
//
// 関連: ADR-0055 / ADR-0013 / docs/design/08-データベース設計書.md / sqlite/battle-repo.ts (SSOT)

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import type { DailyBattleRow, EnemyCollectionRow } from '../interfaces/battle-repo.interface';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	dailyBattleKey,
	dailyBattlePrefix,
	ENTITY_NAMES,
	enemyCollectionKey,
	enemyCollectionPrefix,
	tenantPK,
} from './keys';
import { stripKeys } from './repo-helpers';

const BATTLE_PREFIX = dailyBattlePrefix();
const ENEMYCOL_PREFIX = enemyCollectionPrefix();

/** DynamoDB item を DailyBattleRow に正規化する (PK/SK 除去 + SQLite default の補完)。 */
function toBattleRow(item: Record<string, unknown>): DailyBattleRow {
	const s = stripKeys(item) as Record<string, unknown>;
	return {
		id: s.id as number,
		childId: s.childId as number,
		enemyId: s.enemyId as number,
		date: s.date as string,
		status: s.status as 'pending' | 'completed',
		// SQLite: outcome は nullable (pending では null)。
		outcome: (s.outcome ?? null) as BattleOutcome | null,
		// SQLite: reward_points / turns_used は NOT NULL default 0。
		rewardPoints: (s.rewardPoints ?? 0) as number,
		turnsUsed: (s.turnsUsed ?? 0) as number,
		playerStatsJson: (s.playerStatsJson ?? '{}') as string,
		createdAt: s.createdAt as string,
		updatedAt: s.updatedAt as string,
	};
}

/** DynamoDB item を EnemyCollectionRow に正規化する。 */
function toCollectionRow(item: Record<string, unknown>): EnemyCollectionRow {
	const s = stripKeys(item) as Record<string, unknown>;
	return {
		id: s.id as number,
		childId: s.childId as number,
		enemyId: s.enemyId as number,
		firstDefeatedAt: s.firstDefeatedAt as string,
		// SQLite: defeat_count は NOT NULL default 1。
		defeatCount: (s.defeatCount ?? 1) as number,
	};
}

// ============================================================
// findTodayBattle — child + date で 1 件取得 (GetItem)
// ============================================================

export async function findTodayBattle(
	childId: number,
	date: string,
	tenantId: string,
): Promise<DailyBattleRow | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: dailyBattleKey(childId, date, tenantId),
		}),
	);
	if (!result.Item) return undefined;
	return toBattleRow(result.Item);
}

// ============================================================
// findRecentBattles — 直近のバトル履歴 (date desc, limit)
// ============================================================

export async function findRecentBattles(
	childId: number,
	limit: number,
	tenantId: string,
): Promise<DailyBattleRow[]> {
	// child partition の BATTLE# item を SK 降順 (date desc) で取得。
	// SK = BATTLE#<YYYY-MM-DD> なので辞書順降順 = 日付降順 (SQLite orderBy desc(date) と等価)。
	const items = await queryChildBattles(childId, tenantId, { descending: true, limit });
	return items.map(toBattleRow);
}

// ============================================================
// countConsecutiveLosses — 直近の連敗数
// ============================================================

export async function countConsecutiveLosses(childId: number, tenantId: string): Promise<number> {
	// SQLite: status='completed' を date desc 5 件取り、先頭から outcome='lose' が続く数を数える。
	// DynamoDB は SK 降順 Query (date desc) で completed のみ拾い、先頭 5 件で同じロジックを適用。
	const items = await queryChildBattles(childId, tenantId, { descending: true });
	const completed = items
		.map(toBattleRow)
		.filter((b) => b.status === 'completed')
		.slice(0, 5);

	let losses = 0;
	for (const b of completed) {
		if (b.outcome === 'lose') {
			losses++;
		} else {
			break;
		}
	}
	return losses;
}

// ============================================================
// insertDailyBattle — 日次バトルを登録
// ============================================================

export async function insertDailyBattle(
	childId: number,
	enemyId: number,
	date: string,
	playerStats: BattleStats,
	tenantId: string,
): Promise<number> {
	const id = await nextId(ENTITY_NAMES.dailyBattle, tenantId);
	const now = new Date().toISOString();
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...dailyBattleKey(childId, date, tenantId),
				id,
				childId,
				enemyId,
				date,
				// SQLite schema default。
				status: 'pending',
				outcome: null,
				rewardPoints: 0,
				turnsUsed: 0,
				playerStatsJson: JSON.stringify(playerStats),
				createdAt: now,
				updatedAt: now,
			},
		}),
	);
	return id;
}

// ============================================================
// completeBattle — バトル結果を記録 (battleId → Scan で PK/SK 解決)
// ============================================================

export async function completeBattle(
	battleId: number,
	outcome: BattleOutcome,
	rewardPoints: number,
	turnsUsed: number,
	tenantId: string,
): Promise<void> {
	const found = await findBattleItemById(battleId, tenantId);
	// SQLite UPDATE は対象不在で no-op。DynamoDB も解決できなければ no-op。
	if (!found) return;
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: found.PK, SK: found.SK },
			UpdateExpression:
				'SET #status = :status, outcome = :outcome, rewardPoints = :rp, turnsUsed = :tu, updatedAt = :ua',
			ExpressionAttributeNames: { '#status': 'status' },
			ExpressionAttributeValues: {
				':status': 'completed',
				':outcome': outcome,
				':rp': rewardPoints,
				':tu': turnsUsed,
				':ua': new Date().toISOString(),
			},
		}),
	);
}

// ============================================================
// findCollection — 敵図鑑を取得
// ============================================================

export async function findCollection(
	childId: number,
	tenantId: string,
): Promise<EnemyCollectionRow[]> {
	const items = await queryChildEnemyCollection(childId, tenantId);
	return items.map(toCollectionRow);
}

// ============================================================
// upsertCollectionEntry — 敵図鑑エントリを追加/更新
// ============================================================

export async function upsertCollectionEntry(
	childId: number,
	enemyId: number,
	tenantId: string,
): Promise<void> {
	const doc = getDocClient();
	const key = enemyCollectionKey(childId, enemyId, tenantId);
	const existing = await doc.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));

	if (existing.Item) {
		// SQLite: defeat_count = defeat_count + 1。
		await doc.send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: key,
				UpdateExpression: 'ADD defeatCount :one',
				ExpressionAttributeValues: { ':one': 1 },
			}),
		);
		return;
	}

	// 新規: SQLite default (first_defeated_at=CURRENT_TIMESTAMP, defeat_count=1)。
	const id = await nextId(ENTITY_NAMES.enemyCollection, tenantId);
	try {
		await doc.send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: {
					...key,
					id,
					childId,
					enemyId,
					firstDefeatedAt: new Date().toISOString(),
					defeatCount: 1,
				},
				// 同時押下による二重 Put を防ぐ (既存なら ConditionalCheckFailed)。
				ConditionExpression: 'attribute_not_exists(PK)',
			}),
		);
	} catch (e) {
		// 競合で既に作られていたら no-op で握りつぶす (SQLite の存在チェック分岐と等価)。
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return;
		throw e;
	}
}

// ============================================================
// deleteByTenantId — テナントの全バトル・図鑑を削除
// ============================================================
//
// IBattleRepo interface には未定義だが、テナントデータ削除 (退会等) の整合のため
// 他 repo (stamp-card 等) と同様に提供する。両 entity とも child partition 配下。

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const { deleteItemsByPkPrefix } = await import('./bulk-delete');
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), BATTLE_PREFIX);
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), ENEMYCOL_PREFIX);
}

// ============================================================
// 内部ヘルパ
// ============================================================

/**
 * child partition (PK=CHILD#<cId>) の BATTLE# item を Query する (ページング対応)。
 * descending=true で SK 降順 (date desc)。limit 指定時はサーバ側 Limit で打ち切る
 * (begins_with の KeyCondition で他 entity は混ざらないため Limit が filter 前評価でも安全)。
 */
async function queryChildBattles(
	childId: number,
	tenantId: string,
	opts?: { descending?: boolean; limit?: number },
): Promise<Record<string, unknown>[]> {
	const doc = getDocClient();
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': dailyBattleKey(childId, '', tenantId).PK,
					':prefix': BATTLE_PREFIX,
				},
				ScanIndexForward: !opts?.descending,
				Limit: opts?.limit,
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) items.push(item);
		// limit 充足で打ち切り (subsequent page 不要)。
		if (opts?.limit != null && items.length >= opts.limit) {
			return items.slice(0, opts.limit);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}

/** child partition の ENEMYCOL# item を全件 Query する (ページング対応)。 */
async function queryChildEnemyCollection(
	childId: number,
	tenantId: string,
): Promise<Record<string, unknown>[]> {
	const doc = getDocClient();
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': enemyCollectionKey(childId, 0, tenantId).PK,
					':prefix': ENEMYCOL_PREFIX,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) items.push(item);
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}

/**
 * battleId だけ受け取る completeBattle 用に、tenant 配下を Scan して battle item (PK/SK) を
 * 解決する。battle は child partition (PK=CHILD#<cId>, SK=BATTLE#<date>) に分散し childId が
 * 不明なため、tenant Scan + id filter で 1 件特定する。1 日 1 戦・低頻度のため Pre-PMF では
 * GSI 不要 (ADR-0010)。
 *
 * 重要 (#2842 教訓): DynamoDB Scan の `Limit` は FilterExpression 適用「前」の評価上限であり
 * filter 通過後の返却件数ではない。`Limit: 1` + Filter だと対象が scan 順先頭でない限り空振り
 * するため Limit は付けず、ExclusiveStartKey で全ページ走査し一致 item を見つけ次第 early
 * return する (stamp-card findCardItemById と同じ正パターン)。1 件も無ければ undefined。
 */
async function findBattleItemById(
	battleId: number,
	tenantId: string,
): Promise<{ PK: string; SK: string } | undefined> {
	const doc = getDocClient();
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND id = :id',
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': BATTLE_PREFIX,
					':id': battleId,
				},
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0];
		if (item) return { PK: item.PK as string, SK: item.SK as string };
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}
