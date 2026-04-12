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
	stripeSubscriptionId: string;
	upgradeReason: 'auto' | 'manual' | 'email_cta';
}

export interface ITrialHistoryRepo {
	findLatestByTenant(tenantId: string): Promise<TrialHistoryRow | undefined>;
	insert(input: InsertTrialHistoryInput): Promise<void>;
	updateConversion(input: UpdateTrialConversionInput): Promise<void>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
