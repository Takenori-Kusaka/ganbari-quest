// tests/unit/db/dsql-invite-accept.test.ts
// EPIC #3424 / 実装 #3528 (#N2-1 Phase B cycle (b)) / 設計 SSOT: dsql-data-model.md §6.6
//
// invite 受諾 = 単一 txn (§6.6):
//   UPDATE invites SET status='accepted' WHERE invite_id AND status='pending' AND expires_at>now()
//   RETURNING → membership INSERT。分岐を厳密に:
//   - rowCount=0 = 業務失敗 (INVALID_OR_EXPIRED、**retry 禁止** — retry すると受諾済 invite の
//     二重処理を誘発) → ok:false を正常 return
//   - 23505 (memberships PK/owner_guard 重複) = ALREADY_IN_TENANT → invite UPDATE ごと rollback
//   - 40001 = OCC 競合 → runner 内蔵 withOccRetry が txn 全体を再実行
//   - email 束縛 (§6.6 ⚠️): invite.email 設定時は accepting user の email と一致必須 (不一致 =
//     EMAIL_MISMATCH で全 rollback)。招待リンク横流しによる別人受諾を防ぐ
//
// token_hash (CWE-522): raw 招待コードは保存しない前提の DDL (UNIQUE)。hash 生成・照合は
// service 層 (後続 PR)。本テストは fixture hash を直接 insert する。
//
// ── Canon TDD test list ──
//   [B1] 成功: pending+未失効 → accepted + membership 作成 (単一 txn)
//   [B2] 失効 → INVALID_OR_EXPIRED (status は pending のまま、membership 無し)
//   [B3] 非 pending (accepted 済/revoked) → INVALID_OR_EXPIRED
//   [B4] 既 member (23505) → ALREADY_IN_TENANT + **invite UPDATE も rollback (原子性)**
//   [B5] email 束縛不一致 → EMAIL_MISMATCH + 全 rollback
//   [B7] consents: append-only 表に insert できる (GRANT/repo 束縛 = fitness#2 は repo 実装 PR)

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NOW = '2026-07-02T10:00:00+00:00';
const FUTURE = '2026-12-31T00:00:00+00:00';
const PAST = '2026-01-01T00:00:00+00:00';

describe('#3528(b): invite 受諾単一 txn (§6.6 厳密分岐)', () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle>;

	const FAMILY = '00000000-0000-4000-8000-000000000001';
	const INVITER = '00000000-0000-4000-8000-000000000002';
	const ACCEPTOR = '00000000-0000-4000-8000-000000000003';

	beforeAll(async () => {
		client = new PGlite();
		db = drizzle(client);
		// 実 DDL (dsql/schema.ts) を drizzle-kit 生成なしで再現するため、schema module から
		// CREATE TABLE を組み立てる代わりに必要 2 表を §6.6 と同構造で作成する…のではなく、
		// schema drift を避けるため drizzle-kit 相当の生成はせず、テーブルは raw DDL で
		// dsql/schema.ts と同名・同列に定義する (PK/CHECK/UNIQUE は fitness#9/#13 が
		// schema.ts 側を検証済。本テストの関心は受諾 txn の分岐)。
		// extended protocol は 1 execute 1 文のため表ごとに分割。
		await db.execute(
			sql.raw(`CREATE TABLE invites (
				invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				family_id uuid NOT NULL,
				invited_by uuid NOT NULL,
				role text NOT NULL,
				child_id uuid,
				email text,
				token_hash text NOT NULL UNIQUE,
				status text NOT NULL DEFAULT 'pending',
				expires_at timestamptz NOT NULL,
				accepted_by uuid,
				accepted_at timestamptz,
				created_at timestamptz NOT NULL DEFAULT now()
			)`),
		);
		await db.execute(
			sql.raw(`CREATE TABLE memberships (
				family_id uuid NOT NULL,
				user_id uuid NOT NULL,
				role text NOT NULL,
				owner_guard uuid GENERATED ALWAYS AS (CASE WHEN role = 'owner' THEN family_id END) STORED UNIQUE,
				invited_by uuid,
				joined_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (family_id, user_id)
			)`),
		);
		await db.execute(
			sql.raw(`CREATE TABLE consents (
				consent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				family_id uuid NOT NULL,
				user_id uuid NOT NULL,
				type text NOT NULL,
				version text NOT NULL,
				consented_at timestamptz NOT NULL DEFAULT now(),
				ip_address text NOT NULL,
				user_agent text NOT NULL
			)`),
		);
	});
	afterAll(async () => {
		await client.close();
	});

	const seedInvite = async (over: {
		id: string;
		status?: string;
		expiresAt?: string;
		email?: string | null;
		role?: string;
	}) => {
		await db.execute(sql`
			INSERT INTO invites (invite_id, family_id, invited_by, role, email, token_hash, status, expires_at)
			VALUES (${over.id}, ${FAMILY}, ${INVITER}, ${over.role ?? 'parent'}, ${over.email ?? null},
				${`hash-${over.id}`}, ${over.status ?? 'pending'}, ${over.expiresAt ?? FUTURE})
		`);
	};

	const inviteStatus = async (id: string) =>
		(await db.execute(sql`SELECT status FROM invites WHERE invite_id = ${id}`)).rows[0] as {
			status: string;
		};

	const membershipCount = async (userId: string) =>
		Number(
			(
				(await db.execute(
					sql`SELECT count(*) AS c FROM memberships WHERE family_id = ${FAMILY} AND user_id = ${userId}`,
				)) as { rows: { c: unknown }[] }
			).rows[0]?.c,
		);

	const makeRunner = async () => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		return createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
	};

	it('[B1] pending + 未失効 → accepted + membership 作成 (単一 txn)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		const id = '10000000-0000-4000-8000-000000000001';
		await seedInvite({ id });
		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: ACCEPTOR,
			userEmail: 'parent@example.com',
			now: NOW,
		});
		expect(result.ok).toBe(true);
		expect((await inviteStatus(id)).status).toBe('accepted');
		expect(await membershipCount(ACCEPTOR)).toBe(1);
	});

	it('[B2] 失効 invite → INVALID_OR_EXPIRED (retry 禁止の業務失敗、状態不変)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		const id = '10000000-0000-4000-8000-000000000002';
		const user = '20000000-0000-4000-8000-000000000002';
		await seedInvite({ id, expiresAt: PAST });
		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'x@example.com',
			now: NOW,
		});
		expect(result).toEqual({ ok: false, reason: 'INVALID_OR_EXPIRED' });
		expect((await inviteStatus(id)).status).toBe('pending');
		expect(await membershipCount(user)).toBe(0);
	});

	it('[B3] 非 pending (受諾済 / revoked) → INVALID_OR_EXPIRED', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		for (const [suffix, status] of [
			['3a', 'accepted'],
			['3b', 'revoked'],
		] as const) {
			const id = `10000000-0000-4000-8000-00000000003${suffix.charCodeAt(1) % 10}`;
			const user = `20000000-0000-4000-8000-00000000003${suffix.charCodeAt(1) % 10}`;
			await seedInvite({ id, status });
			const result = await acceptInvite(await makeRunner(), {
				inviteId: id,
				userId: user,
				userEmail: 'x@example.com',
				now: NOW,
			});
			expect(result, `status=${status}`).toEqual({ ok: false, reason: 'INVALID_OR_EXPIRED' });
		}
	});

	it('[B4] 既 member (memberships 23505) → ALREADY_IN_TENANT + invite UPDATE も rollback (原子性)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		const id = '10000000-0000-4000-8000-000000000004';
		const user = '20000000-0000-4000-8000-000000000004';
		await seedInvite({ id });
		await db.execute(
			sql`INSERT INTO memberships (family_id, user_id, role) VALUES (${FAMILY}, ${user}, 'parent')`,
		);
		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'x@example.com',
			now: NOW,
		});
		expect(result).toEqual({ ok: false, reason: 'ALREADY_IN_TENANT' });
		// 単一 txn ゆえ membership INSERT 失敗で invite の accepted 化も巻き戻る (部分コミット禁止)
		expect((await inviteStatus(id)).status).toBe('pending');
	});

	it('[B5] email 束縛不一致 → EMAIL_MISMATCH + 全 rollback (§6.6 ⚠️ 招待リンク横流し防止)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		const id = '10000000-0000-4000-8000-000000000005';
		const user = '20000000-0000-4000-8000-000000000005';
		await seedInvite({ id, email: 'Intended@Example.com' });
		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'attacker@example.com',
			now: NOW,
		});
		expect(result).toEqual({ ok: false, reason: 'EMAIL_MISMATCH' });
		expect((await inviteStatus(id)).status).toBe('pending');
		expect(await membershipCount(user)).toBe(0);

		// 大文字小文字差は一致扱い (email_lower と同じ case-insensitive 原則)
		const result2 = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'intended@example.com',
			now: NOW,
		});
		expect(result2.ok).toBe(true);
	});

	it('[B7] consents 表に insert できる (append-only 表の正常系。fitness#2 repo 束縛は後続 PR)', async () => {
		await db.execute(sql`
			INSERT INTO consents (family_id, user_id, type, version, ip_address, user_agent)
			VALUES (${FAMILY}, ${ACCEPTOR}, 'terms', '2026-01', '127.0.0.1', 'vitest')
		`);
		const rows = (await db.execute(sql`SELECT type, version FROM consents`)).rows;
		expect(rows).toEqual([{ type: 'terms', version: '2026-01' }]);
	});
});
