export interface LockoutRecord {
	email: string;
	failedCount: number;
	lockedUntil: string | null;
	lastFailedAt: string | null;
}

export interface IAccountLockoutRepo {
	getLockout(email: string): Promise<LockoutRecord | null>;
	upsertLockout(record: LockoutRecord): Promise<void>;
}
