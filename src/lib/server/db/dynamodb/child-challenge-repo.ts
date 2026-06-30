// src/lib/server/db/dynamodb/child-challenge-repo.ts
// per-child challenge instance repository — DynamoDB 本実装 (ADR-0055、Phase 2B #2824)
//
// IChildChallengeRepo (child-challenge-repo.interface.ts) を SQLite 実装
// (sqlite/child-challenge-repo.ts、挙動 SSOT) と機能等価に DynamoDB single-table で実装する。
//
// 経緯: #2362 PR-7 で導入された stub が #2263/#2280 hotfix で「read=空 / write=no-op +
//   logger.warn」化されたまま有料本番 (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で運用されていた。
//   marketplace challenge-set 取込 (顧客レビュー対象経路) が本番で永続せず、UI が「N 件追加しました」
//   と偽る CRITICAL バグの一部。本実装で根治する (Phase 1 child-activity #2820 と同型)。
//
// key 設計 (keys.ts §childChallengeKey):
//   PK = T#<tenantId>#CHILD#<childId>   (child partition、child_activities / activity_logs と同居)
//   SK = CHILDCHAL#<paddedId>           (regular instance、8 桁 0 埋め、辞書順)
//   SK = CHILDCHAL#AUTO#<weekStart>     (auto:weekly instance、#3245 の atomic get-or-create 用)
//   → findByChildId は単一 partition Query (begins_with(SK,'CHILDCHAL#')) で両種を取得し GSI 不要。
//
// child-activity との差分: interface の mutation method (update / markCompleted / claimReward /
//   deleteChallenge / findById) が childId を受け取らず id 単独のため、id → PK/SK 解決を
//   tenant 配下 Scan で行う。#3258: auto:weekly 行は SK が id-addressable でない (CHILDCHAL#AUTO#)
//   ため SK exact-match では never match し全 mutation が silent no-op になっていた。解決は SK 形式
//   非依存の id 属性 match (`#id = :id`) で行い regular / auto 双方に作用させる。challenge instance は
//   1 child 当たり数件 (週次/月次) と低頻度なため Scan で十分 (ADR-0010 Pre-PMF、GSI 追加は過剰防衛)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/child-challenge-repo.ts (SSOT)

import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '$lib/server/logger';
import type {
	ChildChallenge,
	InsertChildChallengeInput,
	UpdateChildChallengeInput,
} from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	childChallengeAutoWeeklyKey,
	childChallengeKey,
	childChallengePrefix,
	childPK,
	ENTITY_NAMES,
	tenantPK,
} from './keys';
import { queryAllItems, stripKeys } from './repo-helpers';

const PREFIX = childChallengePrefix();

/** DynamoDB item を ChildChallenge に正規化する (PK/SK を除去)。 */
function toChildChallenge(item: Record<string, unknown>): ChildChallenge {
	return stripKeys(item) as unknown as ChildChallenge;
}

// ============================================================
// findByChildId — child 単位の全 challenge instance (child partition Query)
// ============================================================

export async function findByChildId(childId: number, tenantId: string): Promise<ChildChallenge[]> {
	const items = await queryAllItems(childPK(childId, tenantId), PREFIX);
	const challenges = items.map(toChildChallenge);
	// SQLite は ORDER BY start_date。in-memory で同順に揃える。
	challenges.sort((a, b) => a.startDate.localeCompare(b.startDate));
	return challenges;
}

// ============================================================
// findActiveByChildId — status=active かつ today が start〜end 範囲内
// ============================================================

export async function findActiveByChildId(
	childId: number,
	today: string,
	tenantId: string,
): Promise<ChildChallenge[]> {
	const all = await findByChildId(childId, tenantId);
	return all.filter(
		(c) => c.isActive === 1 && c.status === 'active' && c.startDate <= today && c.endDate >= today,
	);
}

// ============================================================
// findActiveOrUnclaimedByChildId (#2488 must-1) — active + 完成済未請求
// ============================================================

/**
 * status='active' に加え、status='completed' AND rewardClaimed=0 の instance も含める
 * (markCompleted 直後に claim ボタンが消える regression 防止、SQLite SSOT と同条件)。
 */
export async function findActiveOrUnclaimedByChildId(
	childId: number,
	today: string,
	tenantId: string,
): Promise<ChildChallenge[]> {
	const all = await findByChildId(childId, tenantId);
	return all.filter(
		(c) =>
			c.isActive === 1 &&
			(c.status === 'active' || c.status === 'completed') &&
			c.startDate <= today &&
			c.endDate >= today &&
			// status='completed' で rewardClaimed=1 (受取済) は除外
			(c.status === 'active' || c.rewardClaimed === 0),
	);
}

// ============================================================
// findAllByTenant — tenant 全体 (admin 画面、child partition 横断 Scan)
// ============================================================

export async function findAllByTenant(tenantId: string): Promise<ChildChallenge[]> {
	const items = await scanTenantChallenges(tenantId);
	const challenges = items.map(toChildChallenge);
	// SQLite は ORDER BY created_at。in-memory で同順に揃える。
	challenges.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return challenges;
}

// ============================================================
// findById — id 単独取得 (childId 不明のため tenant 配下 Scan)
// ============================================================

export async function findById(id: number, tenantId: string): Promise<ChildChallenge | undefined> {
	// #3258: SK 形式 (regular=CHILDCHAL#<padId> / auto=CHILDCHAL#AUTO#<weekStart>) に依存せず
	// id 属性で解決する (auto:weekly 行が exact-SK match を外して silent に取得不能になるのを根治)。
	const items = await scanTenantChallenges(tenantId, { id });
	const item = items[0];
	return item ? toChildChallenge(item) : undefined;
}

// ============================================================
// insert / insertBulk — per-child instance 新規作成
// ============================================================

/**
 * 1 件の ChildChallenge を組み立てる。SQLite schema default
 * (challengeType='cooperative' / periodType='weekly' / status='active' / isActive=1 /
 * currentValue=0 / completed=0 / completedAt=null / rewardClaimed=0 / rewardClaimedAt=null)
 * を明示的に埋め、insert の返り値が SQLite の `.returning()` と等価になるようにする。
 */
function buildChildChallenge(
	id: number,
	input: InsertChildChallengeInput,
	now: string,
): ChildChallenge {
	return {
		id,
		childId: input.childId,
		title: input.title,
		description: input.description ?? null,
		challengeType: input.challengeType ?? 'cooperative',
		periodType: input.periodType ?? 'weekly',
		startDate: input.startDate,
		endDate: input.endDate,
		targetConfig: input.targetConfig,
		rewardConfig: input.rewardConfig,
		status: 'active',
		isActive: 1,
		sourceTemplateId: input.sourceTemplateId ?? null,
		currentValue: 0,
		targetValue: input.targetValue,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function insert(
	input: InsertChildChallengeInput,
	tenantId: string,
): Promise<ChildChallenge> {
	const id = await nextId(ENTITY_NAMES.childChallenge, tenantId);
	const challenge = buildChildChallenge(id, input, new Date().toISOString());

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...childChallengeKey(input.childId, id, tenantId),
				...challenge,
			},
		}),
	);

	return challenge;
}

/**
 * #3329 backup restore 用: 進捗 / 完了 / 請求 / status / 日時を含む全フィールドを保全して復元する。
 * insert と異なり buildChildChallenge の初期化を経ず、引数の値をそのまま書き戻す (id は新規採番)。
 *
 * #3329 QM-fix: auto:weekly 行は dedup SK (childChallengeAutoWeeklyKey = CHILDCHAL#AUTO#<weekStart>)
 * で書き戻す。regular 行と同じ CHILDCHAL#<paddedId> に入れると、後続の getOrCreateWeeklyAuto
 * (当該 (child, weekStart) の AUTO# key を GetItem で dedup) が復元行を miss し 2 個目の auto:weekly
 * を生成してしまう (週次チャレンジ重複 / 進捗分裂)。SQLite SSOT は部分 unique index
 * (child_id, start_date) で復元行が get-or-create 勝者になり重複しないため、DynamoDB でも復元行を
 * dedup key に置いて機能等価にする。id 属性は Item に保持されるため findById / resolveKeyById
 * (#3258 id-addressable Scan) は SK 形式に依存せず auto 行も解決でき、findByChildId の
 * begins_with(SK,'CHILDCHAL#') Query でも auto 行を拾える。
 */
export async function insertForRestore(
	input: Omit<ChildChallenge, 'id'>,
	tenantId: string,
): Promise<ChildChallenge> {
	const id = await nextId(ENTITY_NAMES.childChallenge, tenantId);
	const challenge: ChildChallenge = { ...input, id };

	const key =
		input.sourceTemplateId === 'auto:weekly'
			? childChallengeAutoWeeklyKey(input.childId, input.startDate, tenantId)
			: childChallengeKey(input.childId, id, tenantId);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...challenge,
			},
		}),
	);

	return challenge;
}

/**
 * #3245: auto:weekly の atomic get-or-create。
 * SK を weekStart 由来の決定的キー (childChallengeAutoWeeklyKey) にし、
 * 条件付き PutItem (attribute_not_exists(PK)) で concurrent 二重作成を atomic に防ぐ。
 * 衝突時は同キーを GetItem して勝者 1 行に収束させる (= ポイント二重付与を不可能化)。
 */
export async function getOrCreateWeeklyAuto(
	input: InsertChildChallengeInput,
	tenantId: string,
): Promise<ChildChallenge> {
	const doc = getDocClient();
	const key = childChallengeAutoWeeklyKey(input.childId, input.startDate, tenantId);

	// fast path: 既存があれば即返す (proposal 再計算も省ける)
	const existing = await doc.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
	if (existing.Item) return toChildChallenge(existing.Item);

	const id = await nextId(ENTITY_NAMES.childChallenge, tenantId);
	const challenge = buildChildChallenge(id, input, new Date().toISOString());
	try {
		await doc.send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: { ...key, ...challenge },
				// 同一 (child, week) の auto 行が既存なら書込まない (atomic)
				ConditionExpression: 'attribute_not_exists(PK)',
			}),
		);
		return challenge;
	} catch (e) {
		// concurrent な先行作成と衝突 → 勝者を読み直す
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
			const won = await doc.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
			if (won.Item) return toChildChallenge(won.Item);
		}
		throw e;
	}
}

export async function insertBulk(
	inputs: readonly InsertChildChallengeInput[],
	tenantId: string,
): Promise<ChildChallenge[]> {
	if (inputs.length === 0) return [];
	// SQLite 実装と同じく直列 insert (id 採番が atomic counter のため順次 Put)。
	const results: ChildChallenge[] = [];
	for (const input of inputs) {
		results.push(await insert(input, tenantId));
	}
	return results;
}

// ============================================================
// updateProgress / markCompleted / claimReward / update / deleteChallenge
// いずれも id 単独受領のため、tenant 配下 Scan で PK/SK を解決してから操作する。
// ============================================================

export async function updateProgress(
	id: number,
	currentValue: number,
	tenantId: string,
): Promise<void> {
	const key = await resolveKeyById(id, tenantId);
	if (!key) return;
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: key,
			UpdateExpression: 'SET currentValue = :cv, updatedAt = :now',
			ExpressionAttributeValues: { ':cv': currentValue, ':now': new Date().toISOString() },
		}),
	);
}

export async function markCompleted(id: number, tenantId: string): Promise<void> {
	const key = await resolveKeyById(id, tenantId);
	if (!key) return;
	const now = new Date().toISOString();
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: key,
			UpdateExpression:
				'SET completed = :one, completedAt = :now, #status = :completed, updatedAt = :now',
			ExpressionAttributeNames: { '#status': 'status' },
			ExpressionAttributeValues: { ':one': 1, ':now': now, ':completed': 'completed' },
		}),
	);
}

/**
 * ごほうび受取マーク (条件付き原子化、#3333)。
 * `completed=1 AND (rewardClaimed が未設定 OR 0)` の行のみ flip し、flip できたら 1 / できなければ 0 を返す。
 * DynamoDB ConditionExpression で atomic に判定するため、並行 submit (同 child 二重 POST) でも
 * 2 件目は ConditionalCheckFailedException となり 0 を返す。service 層は戻り値 === 1 のときだけ
 * ポイント付与する (claim-first) ことで TOCTOU 二重付与を防ぐ。tenant scope は resolveKeyById の
 * PK (`T#<tenantId>#...`) 解決で担保 (IDOR 防御)。
 */
export async function claimReward(id: number, tenantId: string): Promise<number> {
	const key = await resolveKeyById(id, tenantId);
	if (!key) return 0;
	const now = new Date().toISOString();
	try {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: key,
				UpdateExpression: 'SET rewardClaimed = :one, rewardClaimedAt = :now, updatedAt = :now',
				ConditionExpression:
					'completed = :one AND (attribute_not_exists(rewardClaimed) OR rewardClaimed = :zero)',
				ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': now },
			}),
		);
		return 1;
	} catch (e) {
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
			return 0;
		}
		throw e;
	}
}

/** UpdateChildChallengeInput で渡された field のみ更新する (SQLite .set({...}) 等価)。 */
export async function update(
	id: number,
	input: UpdateChildChallengeInput,
	tenantId: string,
): Promise<void> {
	const key = await resolveKeyById(id, tenantId);
	if (!key) return;

	const fields = [
		'title',
		'description',
		'periodType',
		'startDate',
		'endDate',
		'targetConfig',
		'rewardConfig',
		'status',
		'isActive',
	] as const;

	// status は予約語のため全 field を ExpressionAttributeNames 経由にする。
	const sets: string[] = ['#updatedAt = :now'];
	const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
	const values: Record<string, unknown> = { ':now': new Date().toISOString() };
	for (const field of fields) {
		if (input[field] !== undefined) {
			const nameRef = `#${field}`;
			sets.push(`${nameRef} = :${field}`);
			names[nameRef] = field;
			values[`:${field}`] = input[field];
		}
	}

	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: key,
			UpdateExpression: `SET ${sets.join(', ')}`,
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: values,
		}),
	);
}

export async function deleteChallenge(id: number, tenantId: string): Promise<void> {
	const key = await resolveKeyById(id, tenantId);
	if (!key) return;
	await getDocClient().send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));
}

// ============================================================
// copyAcrossChildren — 兄弟共通化 (User §6)
// ============================================================

/**
 * source child の challenge 全件を target child に複製。
 * sourceTemplateId を維持し、進捗は insert で currentValue=0 / completed=0 にリセット。
 */
export async function copyAcrossChildren(
	sourceChildId: number,
	targetChildId: number,
	tenantId: string,
): Promise<ChildChallenge[]> {
	const source = await findByChildId(sourceChildId, tenantId);
	if (source.length === 0) return [];

	const inputs: InsertChildChallengeInput[] = source.map((c) => ({
		childId: targetChildId,
		title: c.title,
		description: c.description,
		challengeType: c.challengeType,
		periodType: c.periodType,
		startDate: c.startDate,
		endDate: c.endDate,
		targetConfig: c.targetConfig,
		rewardConfig: c.rewardConfig,
		sourceTemplateId: c.sourceTemplateId,
		targetValue: c.targetValue,
	}));

	return insertBulk(inputs, tenantId);
}

// ============================================================
// deleteByTenantId — テナント削除時の全 child challenge 削除
// ============================================================

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const items = await scanTenantChallenges(tenantId, { projection: 'PK, SK' });
	for (const item of items) {
		await getDocClient().send(
			new DeleteCommand({
				TableName: TABLE_NAME,
				Key: { PK: item.PK as string, SK: item.SK as string },
			}),
		);
	}
}

// ============================================================
// Scan helpers — child partition 横断検索
// ============================================================
//
// child_challenges は child partition (PK=CHILD#<cId>) に分散するため、tenant 横断 read
// (findAllByTenant / findById / deleteByTenantId) は GSI なしでは Scan が必要。challenge は
// 週次/月次 instance で件数が少なく、これらは admin 表示 / id lookup / tenant 削除の低頻度経路
// のため Pre-PMF (ADR-0010) では Scan + 属性フィルタで十分。GSI 追加は過剰防衛。

/**
 * tenant 配下の CHILDCHAL# item を Scan で収集する。
 * @param opts.id         id 属性の完全一致 (findById / resolveKeyById 用)。
 *                        auto:weekly 行は SK=CHILDCHAL#AUTO#<weekStart> で id-addressable でないため、
 *                        SK 形式に依存せず id 属性で解決する (#3258 silent no-op 根治。
 *                        regular 行 SK=CHILDCHAL#<padId> / auto 行 SK=CHILDCHAL#AUTO# 双方に作用)。
 * @param opts.projection ProjectionExpression (PK/SK のみ取得したいとき)
 */
async function scanTenantChallenges(
	tenantId: string,
	opts?: { id?: number; projection?: string },
): Promise<Record<string, unknown>[]> {
	const filters = ['begins_with(SK, :skPrefix)', 'begins_with(PK, :tenantPrefix)'];
	const values: Record<string, unknown> = {
		':skPrefix': PREFIX,
		':tenantPrefix': tenantPK('CHILD#', tenantId),
	};
	// `id` は DynamoDB の予約語ではないが、安全のため ExpressionAttributeNames で別名化する。
	const names: Record<string, string> | undefined =
		opts?.id !== undefined ? { '#id': 'id' } : undefined;
	if (opts?.id !== undefined) {
		filters.push('#id = :id');
		values[':id'] = opts.id;
	}

	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: filters.join(' AND '),
				ExpressionAttributeValues: values,
				ExpressionAttributeNames: names,
				ProjectionExpression: opts?.projection,
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			items.push(item);
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}

/**
 * id から PK/SK を解決する (mutation method 用)。不在なら undefined。
 * #3258: id 属性で解決し、auto:weekly 行 (SK=CHILDCHAL#AUTO#<weekStart>) も id-addressable にする。
 * 旧実装は SK=CHILDCHAL#<padId(id)> の exact match のみで auto 行を never match し、
 * updateProgress/markCompleted/claimReward/update/delete が DynamoDB prod で silent no-op だった。
 */
async function resolveKeyById(
	id: number,
	tenantId: string,
): Promise<{ PK: string; SK: string } | undefined> {
	const items = await scanTenantChallenges(tenantId, {
		id,
		projection: 'PK, SK',
	});
	const item = items[0];
	if (!item) {
		// #3258 AC5: id 解決失敗を observable にする。mutation 呼出時に id が解決できないのは
		// (削除済 race を除き) 想定外であり、旧来の if(!key) return; の silent no-op を warn で可視化する。
		logger.warn('child-challenge resolveKeyById: id 未解決 (mutation no-op)', {
			context: { id, tenantId },
		});
		return undefined;
	}
	return { PK: item.PK as string, SK: item.SK as string };
}
