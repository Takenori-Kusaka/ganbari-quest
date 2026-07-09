// src/lib/server/db/dsql/account-lockout-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §1.10 / §11.2 (M2
// R-EMAIL_LOGIN_LOCKOUT / I-EMAIL-LOCK)
//
// IAccountLockoutRepo (email_login_lockouts) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **グローバル表 (tenant 非依存)**: PK = email 自然キー。未登録メールもロック対象になり
//     うるため family 述語は持たない (§P9 対象外、GLOBAL_MASTER_PK_MANIFEST 凍結)。
//   - **email は小文字正規化**: sqlite backend (settings `lockout:` プレフィクス JSON) が
//     email.toLowerCase() を key/value 双方に用いる挙動を踏襲し、読み書き両方で正規化する。
//   - **専用表への昇格**: sqlite は settings 表の JSON 値に間借りしていたが、DSQL は
//     専用表 email_login_lockouts に列展開する (schema §1.10 で確定済の前提差分)。
//   - **upsert**: PK (email) への ON CONFLICT DO UPDATE で failed_attempts / locked_until /
//     last_failed_at を丸ごと上書き (sqlite の onConflictDoUpdate と同 shape)。

import { sql } from 'drizzle-orm';
import type {
	IAccountLockoutRepo,
	LockoutRecord,
} from '../interfaces/account-lockout-repo.interface';
import type { SqlExecutor } from './sql-executor';

interface LockoutRow {
	email: string;
	failed_attempts: number;
	locked_until: string | null;
	last_failed_at: string | null;
}

const LOCKOUT_COLUMNS = sql.raw(`email, failed_attempts, locked_until, last_failed_at`);

/** row → LockoutRecord entity。 */
function toLockout(row: LockoutRow): LockoutRecord {
	return {
		email: row.email,
		failedCount: row.failed_attempts,
		lockedUntil: row.locked_until,
		lastFailedAt: row.last_failed_at,
	};
}

/** DSQL 用 IAccountLockoutRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlAccountLockoutRepo(db: SqlExecutor): IAccountLockoutRepo {
	return {
		async getLockout(email) {
			const result = await db.execute(sql`
				SELECT ${LOCKOUT_COLUMNS} FROM email_login_lockouts
				WHERE email = ${email.toLowerCase()}
			`);
			const row = result.rows[0] as unknown as LockoutRow | undefined;
			return row ? toLockout(row) : null;
		},

		async upsertLockout(record) {
			await db.execute(sql`
				INSERT INTO email_login_lockouts (email, failed_attempts, locked_until, last_failed_at)
				VALUES (${record.email.toLowerCase()}, ${record.failedCount},
					${record.lockedUntil}::timestamptz, ${record.lastFailedAt}::timestamptz)
				ON CONFLICT (email) DO UPDATE SET
					failed_attempts = ${record.failedCount},
					locked_until = ${record.lockedUntil}::timestamptz,
					last_failed_at = ${record.lastFailedAt}::timestamptz
			`);
		},
	};
}
