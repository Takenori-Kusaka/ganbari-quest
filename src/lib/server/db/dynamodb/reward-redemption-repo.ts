// src/lib/server/db/dynamodb/reward-redemption-repo.ts
// ごほうびショップ交換申請リポジトリ — DynamoDB 本実装 (#1337 / #2824 Phase 2A / ADR-0055)
//
// IRewardRedemptionRepo を SQLite 実装 (sqlite/reward-redemption-repo.ts、挙動 SSOT) と
// 機能等価に DynamoDB single-table で実装する。
//
// 経緯: 本 repo は #2263 hotfix で「read=空 / write=no-op + logger.warn」化された。
//   ごほうび交換は子供のコアループ (記録 → ポイント → 交換) の終端であり、本番 cognito
//   Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で交換申請が永続しないのは致命的。
//   本実装で根治する。
//
// key 設計 (keys.ts §rewardRedemptionKey):
//   PK = T#<tenantId>#CHILD#<childId>   (child partition、special_rewards 等と同居)
//   SK = REDEMPT#<paddedId>             (8 桁 0 埋め、辞書順)
//   → findRedemptionRequestsByChild は単一 partition Query で完結し GSI 不要 (ADR-0055 §3.1)。
//
// 結合フィールドの非正規化:
//   SQLite の findRedemptionRequestsByTenant / findUnshownResultByChild は children +
//   special_rewards を JOIN して childName / rewardTitle / rewardIcon / rewardPoints を返す。
//   DynamoDB では tenant 横断クエリ時の N+1 を避けるため、insert 時に上記を解決して item に
//   非正規化保存する (RedemptionRequestRow 返り値には含めず、With* 型でのみ露出)。
//
// 残高整合: ポイント減算は service 層 (reward-redemption-service.approveRedemption) が
//   insertPointEntry で別途行う (SQLite と同じ責務分割)。本 repo は status 更新のみ担い、
//   残高に触れないため TransactWriteItems は不要。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/reward-redemption-repo.ts (SSOT)

import { PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type {
	IRewardRedemptionRepo,
	RedemptionRequestRow,
	RedemptionRequestWithDetails,
	RedemptionRequestWithReward,
} from '../interfaces/reward-redemption-repo.interface';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	childPK,
	ENTITY_NAMES,
	rewardRedemptionKey,
	rewardRedemptionPrefix,
	specialRewardPrefix,
	tenantPK,
} from './keys';
import { findChildByIdRaw, stripKeys } from './repo-helpers';

const PREFIX = rewardRedemptionPrefix();
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

// item に保存する非正規化フィールド (JOIN 代替)。RedemptionRequestRow には含めない。
interface DenormFields {
	childName: string;
	rewardTitle: string;
	rewardIcon: string | null;
	rewardPoints: number;
}

// DynamoDB item から PK/SK + 非正規化フィールドを除いた RedemptionRequestRow を作る。
function toRow(item: Record<string, unknown>): RedemptionRequestRow {
	const stripped = stripKeys(item) as Record<string, unknown>;
	return {
		id: stripped.id as number,
		childId: stripped.childId as number,
		rewardId: stripped.rewardId as number,
		requestedAt: stripped.requestedAt as number,
		status: stripped.status as string,
		parentNote: (stripped.parentNote ?? null) as string | null,
		resolvedAt: (stripped.resolvedAt ?? null) as number | null,
		resolvedByParentId: (stripped.resolvedByParentId ?? null) as string | null,
		shownToChildAt: (stripped.shownToChildAt ?? null) as number | null,
	};
}

// 非正規化フィールドを取り出す (旧データ防御で欠落時は既定値)。
function extractDenorm(item: Record<string, unknown>): DenormFields {
	return {
		childName: (item.childName ?? '') as string,
		rewardTitle: (item.rewardTitle ?? '') as string,
		rewardIcon: (item.rewardIcon ?? null) as string | null,
		rewardPoints: (item.rewardPoints ?? 0) as number,
	};
}

/**
 * child partition から指定 special reward (id) を解決する。
 * SQLite の JOIN special_rewards 相当。SK は REWARD#<ts>#<id> のため child の REWARD# を
 * Query し id 一致を探す (service の findSpecialRewards と同じパターン)。
 */
async function findRewardFields(
	childId: number,
	rewardId: number,
	tenantId: string,
): Promise<{ title: string; icon: string | null; points: number } | undefined> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: 'id = :rid',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': specialRewardPrefix(),
				':rid': rewardId,
			},
		}),
	);
	const item = (result.Items ?? [])[0];
	if (!item) return undefined;
	return {
		title: (item.title ?? '') as string,
		icon: (item.icon ?? null) as string | null,
		points: (item.points ?? 0) as number,
	};
}

// ============================================================
// insertRedemptionRequest — 交換申請を作成
// ============================================================

export const insertRedemptionRequest: IRewardRedemptionRepo['insertRedemptionRequest'] = async (
	input,
	tenantId,
): Promise<RedemptionRequestRow> => {
	const id = await nextId(ENTITY_NAMES.rewardRedemption, tenantId);

	// JOIN 代替: childName / reward fields を解決し item に非正規化保存。
	const child = await findChildByIdRaw(input.childId, tenantId);
	const reward = await findRewardFields(input.childId, input.rewardId, tenantId);

	const row: RedemptionRequestRow = {
		id,
		childId: input.childId,
		rewardId: input.rewardId,
		requestedAt: input.requestedAt,
		// SQLite schema default と一致 (#1337)。
		status: 'pending_parent_approval',
		parentNote: null,
		resolvedAt: null,
		resolvedByParentId: null,
		shownToChildAt: null,
	};

	const denorm: DenormFields = {
		childName: child?.nickname ?? '',
		rewardTitle: reward?.title ?? '',
		rewardIcon: reward?.icon ?? null,
		rewardPoints: reward?.points ?? 0,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...rewardRedemptionKey(input.childId, id, tenantId),
				...row,
				...denorm,
			},
		}),
	);

	return row;
};

// ============================================================
// insertRedemptionForRestore — backup restore 用 (全フィールド保全、#3329)
// ============================================================

export const insertRedemptionForRestore: IRewardRedemptionRepo['insertRedemptionForRestore'] =
	async (input, tenantId): Promise<RedemptionRequestRow> => {
		const id = await nextId(ENTITY_NAMES.rewardRedemption, tenantId);

		const row: RedemptionRequestRow = {
			id,
			childId: input.childId,
			rewardId: input.rewardId,
			requestedAt: input.requestedAt,
			status: input.status,
			parentNote: input.parentNote,
			resolvedAt: input.resolvedAt,
			resolvedByParentId: input.resolvedByParentId,
			shownToChildAt: input.shownToChildAt,
		};

		// JOIN 代替の非正規化フィールド: snapshot を優先し、欠落時のみ live 解決へ fallback。
		const child = await findChildByIdRaw(input.childId, tenantId);
		let rewardTitle = input.rewardTitle;
		let rewardIcon = input.rewardIcon;
		let rewardPoints = input.rewardPoints;
		if (rewardTitle === null || rewardPoints === null) {
			const reward = await findRewardFields(input.childId, input.rewardId, tenantId);
			rewardTitle = rewardTitle ?? reward?.title ?? '';
			rewardIcon = rewardIcon ?? reward?.icon ?? null;
			rewardPoints = rewardPoints ?? reward?.points ?? 0;
		}

		const denorm: DenormFields = {
			childName: child?.nickname ?? '',
			rewardTitle: rewardTitle ?? '',
			rewardIcon,
			rewardPoints: rewardPoints ?? 0,
		};

		await getDocClient().send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: {
					...rewardRedemptionKey(input.childId, id, tenantId),
					...row,
					// denorm.rewardTitle/Icon/Points は snapshot 優先で解決済 (SQLite の
					// COALESCE(snapshot, live) 読み出しと等価の表示値を item に非正規化保存)。
					...denorm,
				},
			}),
		);

		return row;
	};

// ============================================================
// findRedemptionRequestsByChild — 子供の申請一覧 (最新順)
// ============================================================

export const findRedemptionRequestsByChild: IRewardRedemptionRepo['findRedemptionRequestsByChild'] =
	async (childId, tenantId): Promise<RedemptionRequestRow[]> => {
		const items = await queryChildRedemptions(childId, tenantId);
		// SQLite: ORDER BY requested_at DESC。in-memory で同順に揃える。
		const rows = items.map(toRow);
		rows.sort((a, b) => b.requestedAt - a.requestedAt);
		return rows;
	};

// ============================================================
// findRedemptionRequestsByTenant — 親向け一覧 (childName / reward 結合付き)
// ============================================================

export const findRedemptionRequestsByTenant: IRewardRedemptionRepo['findRedemptionRequestsByTenant'] =
	async (tenantId, opts): Promise<RedemptionRequestWithDetails[]> => {
		// child partition に分散するため tenant 配下を Scan (低頻度: 親が見守り画面で確認時のみ)。
		const items = await scanTenantRedemptions(tenantId);

		let rows: RedemptionRequestWithDetails[] = items.map((item) => ({
			...toRow(item),
			...extractDenorm(item),
		}));

		// SQLite の WHERE 相当 (status / childId filter)。
		if (opts?.status) {
			rows = rows.filter((r) => r.status === opts.status);
		}
		if (opts?.childId) {
			rows = rows.filter((r) => r.childId === opts.childId);
		}

		// ORDER BY requested_at DESC + LIMIT。
		rows.sort((a, b) => b.requestedAt - a.requestedAt);
		return rows.slice(0, opts?.limit ?? 50);
	};

// ============================================================
// countRedemptionRequestsByTenant — テナント内の正確な件数 (limit なし)
// ============================================================

/**
 * #3144: tenant 配下を Scan し status / childId filter 後の件数を返す。
 * findRedemptionRequestsByTenant と同じ filter を適用するが limit slice を掛けないため
 * 50 件以上でも飽和しない (admin ホームの承認待ちバナー件数用)。
 */
export const countRedemptionRequestsByTenant: IRewardRedemptionRepo['countRedemptionRequestsByTenant'] =
	async (tenantId, opts): Promise<number> => {
		const items = await scanTenantRedemptions(tenantId);
		let rows = items.map(toRow);
		if (opts?.status) {
			rows = rows.filter((r) => r.status === opts.status);
		}
		if (opts?.childId) {
			rows = rows.filter((r) => r.childId === opts.childId);
		}
		return rows.length;
	};

// ============================================================
// updateRedemptionRequestStatus — 申請状態を更新
// ============================================================

/**
 * #2845 課題①: childId + id で PK/SK を直接構成し UpdateItem する (full composite-key
 * addressing)。旧実装の tenant Scan + id filter (Limit:1 / #2842 バグクラス B2 残党) は撤去。
 * `attribute_exists(PK)` で (childId, id) 不一致 / 不在を ConditionalCheckFailedException →
 * undefined にする (SQLite `WHERE id=? AND child_id=?` の affected 0 と等価)。
 */
export const updateRedemptionRequestStatus: IRewardRedemptionRepo['updateRedemptionRequestStatus'] =
	async (childId, id, updates, tenantId): Promise<RedemptionRequestRow | undefined> => {
		const sets: string[] = ['#status = :status'];
		const names: Record<string, string> = { '#status': 'status' };
		const values: Record<string, unknown> = { ':status': updates.status };

		// undefined はスキップ、null は明示的に SET (SQLite .set({...}) と一致)。
		if (updates.parentNote !== undefined) {
			sets.push('parentNote = :parentNote');
			values[':parentNote'] = updates.parentNote;
		}
		if (updates.resolvedAt !== undefined) {
			sets.push('resolvedAt = :resolvedAt');
			values[':resolvedAt'] = updates.resolvedAt;
		}
		if (updates.resolvedByParentId !== undefined) {
			sets.push('resolvedByParentId = :resolvedByParentId');
			values[':resolvedByParentId'] = updates.resolvedByParentId;
		}

		try {
			const result = await getDocClient().send(
				new UpdateCommand({
					TableName: TABLE_NAME,
					Key: rewardRedemptionKey(childId, id, tenantId),
					UpdateExpression: `SET ${sets.join(', ')}`,
					ConditionExpression: 'attribute_exists(PK)',
					ExpressionAttributeNames: names,
					ExpressionAttributeValues: values,
					ReturnValues: 'ALL_NEW',
				}),
			);
			if (!result.Attributes) return undefined;
			return toRow(result.Attributes);
		} catch (e) {
			if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return undefined;
			throw e;
		}
	};

// ============================================================
// findPendingByChildAndReward — 二重申請チェック
// ============================================================

export const findPendingByChildAndReward: IRewardRedemptionRepo['findPendingByChildAndReward'] =
	async (childId, rewardId, tenantId): Promise<RedemptionRequestRow | undefined> => {
		const items = await queryChildRedemptions(childId, tenantId);
		const match = items.find(
			(item) => item.rewardId === rewardId && item.status === 'pending_parent_approval',
		);
		return match ? toRow(match) : undefined;
	};

// ============================================================
// findUnshownResultByChild — 子供の未表示の承認/却下通知 (reward 結合付き)
// ============================================================

export const findUnshownResultByChild: IRewardRedemptionRepo['findUnshownResultByChild'] = async (
	childId,
	tenantId,
): Promise<RedemptionRequestWithReward | undefined> => {
	const items = await queryChildRedemptions(childId, tenantId);
	// SQLite: status IN (approved, rejected) AND shown_to_child_at IS NULL
	//   ORDER BY resolved_at DESC LIMIT 1
	const candidates = items
		.filter(
			(item) =>
				(item.status === 'approved' || item.status === 'rejected') &&
				(item.shownToChildAt === null || item.shownToChildAt === undefined),
		)
		.sort((a, b) => ((b.resolvedAt as number) ?? 0) - ((a.resolvedAt as number) ?? 0));

	const top = candidates[0];
	if (!top) return undefined;
	const denorm = extractDenorm(top);
	return {
		...toRow(top),
		rewardTitle: denorm.rewardTitle,
		rewardIcon: denorm.rewardIcon,
	};
};

// ============================================================
// markRedemptionResultShown — 未表示通知を表示済みにする
// ============================================================

/** #2845 課題①: childId + id の composite key で直接 UpdateItem (Scan 撤去)。 */
export const markRedemptionResultShown: IRewardRedemptionRepo['markRedemptionResultShown'] = async (
	childId,
	id,
	tenantId,
): Promise<RedemptionRequestRow | undefined> => {
	const now = Math.floor(Date.now() / 1000);
	try {
		const result = await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: rewardRedemptionKey(childId, id, tenantId),
				UpdateExpression: 'SET shownToChildAt = :now',
				ConditionExpression: 'attribute_exists(PK)',
				ExpressionAttributeValues: { ':now': now },
				ReturnValues: 'ALL_NEW',
			}),
		);
		if (!result.Attributes) return undefined;
		return toRow(result.Attributes);
	} catch (e) {
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return undefined;
		throw e;
	}
};

// ============================================================
// expireOldRedemptions — 30 日以上 pending を expired に移行 (cron)
// ============================================================

export const expireOldRedemptions: IRewardRedemptionRepo['expireOldRedemptions'] = async (
	tenantId,
): Promise<number> => {
	const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SECONDS;
	const items = await scanTenantRedemptions(tenantId);
	const targets = items.filter(
		(item) => item.status === 'pending_parent_approval' && (item.requestedAt as number) < cutoff,
	);
	for (const item of targets) {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: { PK: item.PK as string, SK: item.SK as string },
				UpdateExpression: 'SET #status = :expired',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: { ':expired': 'expired' },
			}),
		);
	}
	return targets.length;
};

// ============================================================
// hasPendingByReward — 報酬削除前の pending チェック
// ============================================================

export const hasPendingByReward: IRewardRedemptionRepo['hasPendingByReward'] = async (
	rewardId,
	tenantId,
): Promise<boolean> => {
	const items = await scanTenantRedemptions(tenantId);
	return items.some(
		(item) => item.rewardId === rewardId && item.status === 'pending_parent_approval',
	);
};

// ============================================================
// deleteByTenantId — テナントの全申請を削除
// ============================================================

export const deleteByTenantId: IRewardRedemptionRepo['deleteByTenantId'] = async (
	tenantId,
): Promise<void> => {
	const { deleteItemsByPkPrefix } = await import('./bulk-delete');
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), PREFIX);
};

// ============================================================
// 内部ヘルパ
// ============================================================

/** 指定 child partition の REDEMPT# item を全件 Query する (ページング対応)。 */
async function queryChildRedemptions(
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
					':pk': childPK(childId, tenantId),
					':prefix': PREFIX,
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
 * tenant 配下の REDEMPT# item を Scan する。
 * redemption は child partition (PK=CHILD#<cId>) に分散するため tenant 横断は Scan が必要。
 * 親の確認 / cron / 削除 (低頻度) のみに使われるため Pre-PMF では GSI 不要 (ADR-0010)。
 */
async function scanTenantRedemptions(tenantId: string): Promise<Record<string, unknown>[]> {
	const doc = getDocClient();
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix)',
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': PREFIX,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) items.push(item);
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}
