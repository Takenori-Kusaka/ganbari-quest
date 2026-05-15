// Demo IAccountLockoutRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// Account lockout は demo Lambda では発生しない (AnonymousAuthProvider が常時 allow)。

import type { LockoutRecord } from '../interfaces/account-lockout-repo.interface';

export async function getLockout(_email: string): Promise<LockoutRecord | null> {
	// Demo Lambda は認証なし (anonymous)、lockout 状態は存在しない
	return null;
}

export async function upsertLockout(_record: LockoutRecord): Promise<void> {
	// Stub: no-op (ADR-0048 P-1.7)
}
