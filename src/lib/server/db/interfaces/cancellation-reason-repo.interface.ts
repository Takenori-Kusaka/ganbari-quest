// src/lib/server/db/interfaces/cancellation-reason-repo.interface.ts
// 解約理由ヒアリング repo 抽象 (#1596 / ADR-0023 §3.8 / I3)

import type { CancellationCategory } from '$lib/domain/labels';

export interface CancellationReasonRecord {
	id: number;
	tenantId: string;
	category: CancellationCategory;
	freeText: string | null;
	planAtCancellation: string | null;
	stripeSubscriptionId: string | null;
	createdAt: string;
}

export interface CreateCancellationReasonInput {
	tenantId: string;
	category: CancellationCategory;
	freeText?: string | null;
	planAtCancellation?: string | null;
	stripeSubscriptionId?: string | null;
}

export interface CancellationReasonAggregation {
	category: CancellationCategory;
	count: number;
	percentage: number;
}

export interface ICancellationReasonRepo {
	create(input: CreateCancellationReasonInput): Promise<CancellationReasonRecord>;
	listByTenant(tenantId: string): Promise<CancellationReasonRecord[]>;
	/** 直近 N 日の集計（デフォルト 90 日）。category 別比率を返す。 */
	aggregateRecent(days?: number): Promise<{
		total: number;
		breakdown: CancellationReasonAggregation[];
	}>;
	/** 自由記述を最新順に検索（最大 limit 件、最低限の検索機能） */
	searchFreeText(query: string, limit?: number): Promise<CancellationReasonRecord[]>;
	/** テナント完全削除時のクリーンアップ */
	deleteByTenantId(tenantId: string): Promise<void>;
}
