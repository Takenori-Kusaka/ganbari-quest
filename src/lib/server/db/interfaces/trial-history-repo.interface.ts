export interface TrialHistoryRow {
	id: number;
	tenantId: string;
	startDate: string;
	endDate: string;
	tier: string;
	source: string;
	campaignId: string | null;
	stripeSubscriptionId: string | null;
	upgradeReason: string | null;
	trialStartSource: string | null;
	createdAt: string;
}

export interface InsertTrialHistoryInput {
	tenantId: string;
	startDate: string;
	endDate: string;
	tier: string;
	source: string;
	campaignId?: string | null;
	trialStartSource?: string | null;
}

export interface UpdateTrialConversionInput {
	id: number;
	/**
	 * #2941 項目 1: trial counter は tenant 別採番のため id は tenant 間で衝突する。
	 * id 単独解決 (旧 DynamoDB scanKeyById) は cross-tenant の課金情報上書き (IDOR 形状、
	 * #2845 同クラス) の余地があるため、呼び出し元 (将来の Stripe webhook ハンドラ) は
	 * 必ず tenant 解決済みの tenantId を渡し、両実装とも tenant scope で record を特定する。
	 */
	tenantId: string;
	stripeSubscriptionId: string;
	upgradeReason: 'auto' | 'manual' | 'email_cta';
}

export interface ITrialHistoryRepo {
	findLatestByTenant(tenantId: string): Promise<TrialHistoryRow | undefined>;
	findActiveTrials(): Promise<TrialHistoryRow[]>;
	insert(input: InsertTrialHistoryInput): Promise<void>;
	updateConversion(input: UpdateTrialConversionInput): Promise<void>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
