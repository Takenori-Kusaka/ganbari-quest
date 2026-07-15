// src/lib/server/db/sqlite/child-challenge-repo.ts
// per-child challenge instance repository — SQLite 実装 (#2362 PR-7, ADR-0055, User §6)
//
// 旧 `sibling-challenge-repo.ts` (family-wide + per-child progress 別 table) の後継。
// `childId` 必須 + tenant isolation を強制し、cross-child access を構造的に防ぐ。
//
// 旧 sibling_challenges / sibling_challenge_progress は #2458 (Path B sibling drop, 2026-05-26) で
// 物理 drop 済。本 repo が単一の challenge 経路。
//
// tenant isolation について (#3203 item3): `childChallenges` table に tenant_id 列は無く、SQLite は
// 1 process = 1 DB = 1 tenant のため `_tenantId` 引数は意図的 no-op。DynamoDB repo は PK に tenant を
// 含み tenant-scoped だが、SQLite で対称化するには列追加 + 全 backend migration が必要で、childId は
// DB 内 autoincrement unique のため cross-tenant exploit は構造的に不能 (= 防御価値ゼロ)。よって列追加は
// ADR-0010 Pre-PMF 過剰防衛として採らず、本コメントで非対称の根拠を明示する (#3203 QM follow-up 裁定)。

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import { childChallenges, pointLedger } from '../schema';
import type {
	ChildChallenge,
	InsertChildChallengeInput,
	UpdateChildChallengeInput,
} from '../types';
import { AUTO_WEEKLY_SOURCE_TEMPLATE_ID } from '../types';

type ChallengeRow = typeof childChallenges.$inferSelect;

const toChallenge = (r: ChallengeRow): ChildChallenge => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

export async function findByChildId(
	childId: ChildId,
	_tenantId: string,
): Promise<ChildChallenge[]> {
	return db
		.select()
		.from(childChallenges)
		.where(eq(childChallenges.childId, Number(childId)))
		.orderBy(childChallenges.startDate)
		.all()
		.map(toChallenge);
}

export async function findActiveByChildId(
	childId: ChildId,
	today: string,
	_tenantId: string,
): Promise<ChildChallenge[]> {
	return db
		.select()
		.from(childChallenges)
		.where(
			and(
				eq(childChallenges.childId, Number(childId)),
				eq(childChallenges.isActive, 1),
				eq(childChallenges.status, 'active'),
				lte(childChallenges.startDate, today),
				gte(childChallenges.endDate, today),
			),
		)
		.all()
		.map(toChallenge);
}

/**
 * #2488 (must-1 fix): 子供画面 home/history で active + 「完成済だが未請求」の instance を返す。
 *
 * 旧 `findActiveByChildId` (status='active' のみ) では `markCompleted` が status を 'completed'
 * に flip した瞬間、当該 instance が active 一覧から消えてしまい、完了時の `SiblingCelebration`
 * の claim ボタン (#3333 で旧 ChallengeBanner から受取導線を一本化) が render されず、ユーザが
 * 報酬を受け取れないまま消える regression が発生した (PR #2488 QM Re-Review must-1)。
 *
 * 旧 sibling-challenge-service の挙動: status flip は全 siblings 完了時のみで、それまで
 * 子供画面に表示され続けていた。本関数で「期間内 = 当該 child の今閉じるべき instance」を
 * 包括的に返すことで挙動を復元する。
 *
 * 条件: 当該 child の instance、isActive=1、startDate <= today <= endDate、
 *      (status='active' OR (status='completed' AND rewardClaimed=0))
 */
export async function findActiveOrUnclaimedByChildId(
	childId: ChildId,
	today: string,
	_tenantId: string,
): Promise<ChildChallenge[]> {
	const rows = db
		.select()
		.from(childChallenges)
		.where(
			and(
				eq(childChallenges.childId, Number(childId)),
				eq(childChallenges.isActive, 1),
				inArray(childChallenges.status, ['active', 'completed']),
				lte(childChallenges.startDate, today),
				gte(childChallenges.endDate, today),
			),
		)
		.all()
		.map(toChallenge);
	// status='completed' で rewardClaimed=1 (受取済) は除外
	return rows.filter((r) => r.status === 'active' || r.rewardClaimed === 0);
}

export async function findAllByTenant(_tenantId: string): Promise<ChildChallenge[]> {
	// SQLite はシングルテナント (#1923 等の整合)。tenant_id 列なし、全件返す。
	return db
		.select()
		.from(childChallenges)
		.orderBy(childChallenges.createdAt)
		.all()
		.map(toChallenge);
}

export async function findById(id: string, _tenantId: string): Promise<ChildChallenge | undefined> {
	const row = db
		.select()
		.from(childChallenges)
		.where(eq(childChallenges.id, Number(id)))
		.get();
	return row ? toChallenge(row) : undefined;
}

export async function insert(
	input: InsertChildChallengeInput,
	_tenantId: string,
): Promise<ChildChallenge> {
	const now = new Date().toISOString();
	const row = db
		.insert(childChallenges)
		.values({
			childId: Number(input.childId),
			title: input.title,
			description: input.description ?? null,
			challengeType: input.challengeType ?? 'cooperative',
			periodType: input.periodType ?? 'weekly',
			startDate: input.startDate,
			endDate: input.endDate,
			targetConfig: input.targetConfig,
			rewardConfig: input.rewardConfig,
			sourceTemplateId: input.sourceTemplateId ?? null,
			currentValue: 0,
			targetValue: input.targetValue,
			completed: 0,
			rewardClaimed: 0,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get();
	if (!row) throw new Error('insert: insert returned no row');
	return toChallenge(row);
}

/**
 * #3329 backup restore 用: 進捗 / 完了 / 請求 / status / 日時を含む全フィールドを保全して復元する。
 * insert と異なり currentValue / completed / rewardClaimed / createdAt 等を引数の値のまま書き戻す。
 * id は新規採番 (元 id は保全しない、childId は呼び出し側が解決済)。
 *
 * #3387/#3394 統一冪等契約: auto:weekly 行の (childId, startDate) 重複 (部分 unique index
 * idx_child_challenges_auto_weekly_unique 衝突) は onConflictDoNothing で skip し null を返す
 * (DynamoDB AUTO# SK + attribute_not_exists と機能等価。regular 行は一意制約がなく常に insert)。
 */
export async function insertForRestore(
	input: Omit<ChildChallenge, 'id'>,
	_tenantId: string,
): Promise<ChildChallenge | null> {
	const row = db
		.insert(childChallenges)
		.values({
			childId: Number(input.childId),
			title: input.title,
			description: input.description,
			challengeType: input.challengeType,
			periodType: input.periodType,
			startDate: input.startDate,
			endDate: input.endDate,
			targetConfig: input.targetConfig,
			rewardConfig: input.rewardConfig,
			status: input.status,
			isActive: input.isActive,
			sourceTemplateId: input.sourceTemplateId,
			currentValue: input.currentValue,
			targetValue: input.targetValue,
			completed: input.completed,
			completedAt: input.completedAt,
			rewardClaimed: input.rewardClaimed,
			rewardClaimedAt: input.rewardClaimedAt,
			createdAt: input.createdAt,
			updatedAt: input.updatedAt,
		})
		.onConflictDoNothing()
		.returning()
		.get();
	return row ? toChallenge(row) : null;
}

/**
 * #3245: auto:weekly の atomic get-or-create。
 * 部分 unique index idx_child_challenges_auto_weekly_unique により (child_id, start_date) は
 * auto:weekly 行で一意。`onConflictDoNothing` で concurrent 二重 INSERT を DB レベルで no-op 化し、
 * 直後の SELECT で勝者 1 行に収束させる (= ポイント二重付与を不可能化)。
 */
export async function getOrCreateWeeklyAuto(
	input: InsertChildChallengeInput,
	_tenantId: string,
): Promise<ChildChallenge> {
	const now = new Date().toISOString();
	db.insert(childChallenges)
		.values({
			childId: Number(input.childId),
			title: input.title,
			description: input.description ?? null,
			challengeType: input.challengeType ?? 'cooperative',
			periodType: input.periodType ?? 'weekly',
			startDate: input.startDate,
			endDate: input.endDate,
			targetConfig: input.targetConfig,
			rewardConfig: input.rewardConfig,
			sourceTemplateId: input.sourceTemplateId ?? AUTO_WEEKLY_SOURCE_TEMPLATE_ID,
			currentValue: 0,
			targetValue: input.targetValue,
			completed: 0,
			rewardClaimed: 0,
			createdAt: now,
			updatedAt: now,
		})
		// 部分 unique index への衝突 (= 同一 child×week の auto 行が既存) は no-op
		.onConflictDoNothing()
		.run();

	const row = db
		.select()
		.from(childChallenges)
		.where(
			and(
				eq(childChallenges.childId, Number(input.childId)),
				eq(childChallenges.startDate, input.startDate),
				eq(
					childChallenges.sourceTemplateId,
					input.sourceTemplateId ?? AUTO_WEEKLY_SOURCE_TEMPLATE_ID,
				),
			),
		)
		.get();
	if (!row) throw new Error('getOrCreateWeeklyAuto: row not found after upsert');
	return toChallenge(row);
}

export async function insertBulk(
	inputs: readonly InsertChildChallengeInput[],
	tenantId: string,
): Promise<ChildChallenge[]> {
	if (inputs.length === 0) return [];
	const results: ChildChallenge[] = [];
	for (const input of inputs) {
		results.push(await insert(input, tenantId));
	}
	return results;
}

export async function updateProgress(
	id: string,
	currentValue: number,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.update(childChallenges)
		.set({ currentValue, updatedAt: now })
		.where(eq(childChallenges.id, Number(id)))
		.run();
}

export async function markCompleted(id: string, _tenantId: string): Promise<void> {
	const now = new Date().toISOString();
	db.update(childChallenges)
		.set({ completed: 1, completedAt: now, status: 'completed', updatedAt: now })
		.where(eq(childChallenges.id, Number(id)))
		.run();
}

/**
 * ごほうび受取マーク + ポイント付与の単一原子プリミティブ (#3284 / #3342、#3333 claim-first の後継)。
 *
 * better-sqlite3 の**同期トランザクション**で「条件付き flip (`rewardClaimed=0 AND completed=1`) →
 * flip 行数 gate → point_ledger insert (type='child_challenge' / referenceId=id)」を 1 単位に閉じ込める。
 * 旧 2 段構成 (claimReward flip → service が別呼び出しで insertPointLedger) は flip 成功後の
 * ledger throw で「rewardClaimed=1 のまま付与 0 = 恒久受取不能 (lost-award)」が残っていた (#3342 (1))。
 * 本 txn では ledger insert が throw すると flip ごと自動 ROLLBACK され、両成功 or 両 rollback を保証する。
 * ledger 側は idx_point_ledger_idempotency (#3284) が同一 (child, type, reference) の二重 insert を
 * DB レベルで拒否する (defense in depth)。
 *
 * 注: childChallenges に tenantId 列は無く SQLite は単一テナント DB のため `_tenantId` は他 mutation
 * (markCompleted / updateProgress) と同様に未使用。tenant 越え IDOR は DB 分離 + service の childId
 * 所有権 check で担保する。
 */
export async function claimRewardAndGrantPoints(
	id: string,
	ledger: { childId: ChildId; amount: number; description: string },
	_tenantId: string,
): Promise<number> {
	const now = new Date().toISOString();
	return db.transaction((tx) => {
		const result = tx
			.update(childChallenges)
			.set({ rewardClaimed: 1, rewardClaimedAt: now, updatedAt: now })
			.where(
				and(
					eq(childChallenges.id, Number(id)),
					eq(childChallenges.rewardClaimed, 0),
					eq(childChallenges.completed, 1),
				),
			)
			.run();
		if (result.changes !== 1) return 0;
		tx.insert(pointLedger)
			.values({
				childId: Number(ledger.childId),
				amount: ledger.amount,
				type: 'child_challenge',
				description: ledger.description,
				referenceId: Number(id),
			})
			.run();
		return 1;
	});
}

export async function update(
	id: string,
	input: UpdateChildChallengeInput,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.update(childChallenges)
		.set({ ...input, updatedAt: now })
		.where(eq(childChallenges.id, Number(id)))
		.run();
}

export async function deleteChallenge(id: string, _tenantId: string): Promise<void> {
	db.delete(childChallenges)
		.where(eq(childChallenges.id, Number(id)))
		.run();
}

/**
 * source child の challenge 全件を target child に複製 (兄弟共通化 UX、User §6)。
 * sourceTemplateId を維持 + 進捗は currentValue=0 にリセット。
 */
export async function copyAcrossChildren(
	sourceChildId: ChildId,
	targetChildId: ChildId,
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

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// シングルテナント SQLite では全件削除
	db.delete(childChallenges).run();
}
