export interface TrialHistoryRow {
	id: number;
	tenantId: string;
	startDate: string;
	endDate: string;
	tier: string;
	source: string;
	campaignId: string | null;
	createdAt: string;
}

export interface InsertTrialHistoryInput {
	tenantId: string;
	startDate: string;
	endDate: string;
	tier: string;
	source: string;
	campaignId?: string | null;
}

export interface ITrialHistoryRepo {
	findLatestByTenant(tenantId: string): Promise<TrialHistoryRow | undefined>;
	insert(input: InsertTrialHistoryInput): Promise<void>;
}
