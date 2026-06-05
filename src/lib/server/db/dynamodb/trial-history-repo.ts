// src/lib/server/db/dynamodb/trial-history-repo.ts
// トライアル履歴 リポジトリ — DynamoDB 本実装 (#314 / #769 / #1016 / #2932 / ADR-0055)
//
// ITrialHistoryRepo (interfaces/trial-history-repo.interface.ts) を SQLite 実装
// (sqlite/trial-history-repo.ts、挙動 SSOT) と機能等価に DynamoDB single-table で実装する。
//
// 経緯 (#2932 CRITICAL): 本 repo は #1021 の check-dynamodb-stub.mjs 導入時点で既に no-op stub の
//   まま稼働しており GRANDFATHERED_STUBS (follow-up #1016) に登録されていた。EPIC #2897 Phase 2
//   (#2824「write stub 12 repo 全廃」) でも grandfathered のため対象外で残存した結果、本番
//   cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で startTrial → insert() が no-op と
//   なり、action は 200 success (偽 success) を返すが getTrialStatus → findLatestByTenant() が
//   undefined を返すため UI が trial 表示に変化しない (新課金体系の hero CTA 動線が死ぬ)。本実装で根治する。
//
// key 設計 (keys.ts §trialHistoryKey):
//   PK = T#<tenantId>#TRIAL   (tenant 単位 partition)
//   SK = HIST#<paddedId>      (8 桁 0 埋め、counter 採番 = SQLite auto-increment 互換、辞書順 = id 昇順)
//   → findLatestByTenant(tenantId) は tenant partition を ScanIndexForward=false で Query Limit 1 →
//     最大 id (=最新) を 1 read で取得 (GSI 不要)。
//   → findActiveTrials() は tenantId を受けない全 tenant 横断 + 日次 cron の低頻度経路のため、
//     Scan + FilterExpression(begins_with(SK,'HIST#') AND endDate >= today) で対応
//     (cancellation-reason-repo と同じ Pre-PMF 方針、ADR-0010 — GSI 追加は過剰防衛)。
//   → updateConversion(id) は tenantId が不明なため tenant 横断 Scan + id filter で PK/SK を解決して
//     Update する (message-repo.markShown / stamp-card-repo の id 解決と同パターン、Stripe webhook
//     経由の稀な経路、#2842 教訓で Scan は Limit なしページング)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/trial-history-repo.ts (SSOT)

import { PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type {
	InsertTrialHistoryInput,
	TrialHistoryRow,
	UpdateTrialConversionInput,
} from '../interfaces/trial-history-repo.interface';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, trialHistoryKey, trialHistoryPrefix, trialHistoryTenantPK } from './keys';
import { stripKeys } from './repo-helpers';

const PREFIX = trialHistoryPrefix();

/** DynamoDB item を TrialHistoryRow に正規化する (PK/SK 除去 + null 既定の補完)。 */
function toRow(item: Record<string, unknown>): TrialHistoryRow {
	const s = stripKeys(item) as Record<string, unknown>;
	return {
		id: s.id as number,
		tenantId: s.tenantId as string,
		startDate: s.startDate as string,
		endDate: s.endDate as string,
		tier: s.tier as string,
		source: s.source as string,
		campaignId: (s.campaignId ?? null) as string | null,
		stripeSubscriptionId: (s.stripeSubscriptionId ?? null) as string | null,
		upgradeReason: (s.upgradeReason ?? null) as string | null,
		trialStartSource: (s.trialStartSource ?? null) as string | null,
		createdAt: s.createdAt as string,
	};
}

// ============================================================
// findLatestByTenant — tenant 内の最新トライアル履歴 1 件
// ============================================================

export async function findLatestByTenant(tenantId: string): Promise<TrialHistoryRow | undefined> {
	// SQLite: WHERE tenant_id = ? ORDER BY id DESC LIMIT 1
	// SK = HIST#<paddedId> が id 昇順の辞書順のため、ScanIndexForward=false で先頭 = 最大 id = 最新。
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': trialHistoryTenantPK(tenantId),
				':prefix': PREFIX,
			},
			ScanIndexForward: false,
			Limit: 1,
		}),
	);
	const item = result.Items?.[0];
	return item ? toRow(item) : undefined;
}

// ============================================================
// findActiveTrials — endDate が今日以降のトライアル履歴 (全 tenant 横断、cron 通知対象)
// ============================================================

/** endDate が今日以降のトライアル履歴を返す（cron 通知対象の取得用、全 tenant 横断） */
export async function findActiveTrials(): Promise<TrialHistoryRow[]> {
	const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (SQLite 実装と同形式)
	const doc = getDocClient();
	const rows: TrialHistoryRow[] = [];
	let lastKey: Record<string, unknown> | undefined;
	// SQLite: WHERE end_date >= today。日次 cron の低頻度経路のため tenant 横断 Scan + 属性フィルタ。
	// #2842 教訓: Scan の Limit は filter 前評価のため付けず ExclusiveStartKey で全ページ走査する。
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND endDate >= :today',
				ExpressionAttributeValues: {
					':prefix': PREFIX,
					':today': today,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) rows.push(toRow(item));
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return rows;
}

// ============================================================
// insert — トライアル開始 (永続の核心経路)
// ============================================================

export async function insert(input: InsertTrialHistoryInput): Promise<void> {
	const id = await nextId(ENTITY_NAMES.trialHistory, input.tenantId);
	const createdAt = new Date().toISOString();
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...trialHistoryKey(id, input.tenantId),
				id,
				tenantId: input.tenantId,
				startDate: input.startDate,
				endDate: input.endDate,
				tier: input.tier,
				source: input.source,
				campaignId: input.campaignId ?? null,
				stripeSubscriptionId: null,
				upgradeReason: null,
				trialStartSource: input.trialStartSource ?? null,
				createdAt,
			},
		}),
	);
}

// ============================================================
// updateConversion — トライアル後のコンバージョン情報を記録 (Stripe 本契約移行時)
// ============================================================

/** トライアル後のコンバージョン情報を記録（Stripe 本契約移行時に呼ぶ、id のみ受ける稀な経路） */
export async function updateConversion(input: UpdateTrialConversionInput): Promise<void> {
	const key = await scanKeyById(input.id);
	if (!key) return; // 該当 id 不在は no-op (SQLite UPDATE ... WHERE id = ? が 0 row と等価)
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: key.PK, SK: key.SK },
			UpdateExpression: 'SET stripeSubscriptionId = :sub, upgradeReason = :reason',
			ExpressionAttributeValues: {
				':sub': input.stripeSubscriptionId,
				':reason': input.upgradeReason,
			},
		}),
	);
}

// ============================================================
// deleteByTenantId — テナントの全トライアル履歴を削除 (退会時、ADR-0049)
// ============================================================

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const { deleteItemsByExactPk } = await import('./bulk-delete');
	// tenant partition (PK=T#<tenant>#TRIAL) は trial history 専用のため exact PK 削除で完結。
	await deleteItemsByExactPk(trialHistoryTenantPK(tenantId));
}

// ============================================================
// 内部ヘルパ
// ============================================================

/**
 * updateConversion 用に、historyId に一致する item の PK/SK を tenant 横断 Scan で解決する。
 * conversion は id のみ受け tenantId が不明なため tenant 配下を走査する (Stripe webhook 経由の
 * 稀な経路)。#2842 教訓: Scan の Limit は filter 前評価のため付けず ExclusiveStartKey で全ページ走査。
 */
async function scanKeyById(historyId: number): Promise<{ PK: string; SK: string } | undefined> {
	const doc = getDocClient();
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND id = :id',
				ExpressionAttributeValues: {
					':prefix': PREFIX,
					':id': historyId,
				},
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = result.Items?.[0];
		if (item) return { PK: item.PK as string, SK: item.SK as string };
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}
