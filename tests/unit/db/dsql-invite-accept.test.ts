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
//   [B5b] email 束縛 + userEmailVerified=false → EMAIL_UNVERIFIED + 全 rollback (#3742 service parity)
//   [B5c] email 束縛 + userEmailVerified=true / 未提供 → 受諾可 (#3742 後方互換 parity)
//   [B5d] email 前後空白は trim 一致扱い (#3742 service `trim().toLowerCase()` parity)
//   [B5e] email 未束縛 + userEmailVerified=false → 受諾可 (束縛 opt-in と同原則、#3742)
//   [B7] consents: append-only 表に insert できる (GRANT/repo 束縛 = fitness#2 は repo 実装 PR)

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const NOW = '2026-07-02T10:00:00+00:00';
const FUTURE = '2026-12-31T00:00:00+00:00';
const PAST = '2026-01-01T00:00:00+00:00';

describe('#3528(b): invite 受諾単一 txn (§6.6 厳密分岐)', () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle>;

	const FAMILY = '00000000-0000-4000-8000-000000000001';
	// #4704 上限 test 用 (他 test の id と衝突させない)
	const LIMIT_INVITE = '00000000-0000-4000-8000-000000004704';
	const LIMIT_USER = '00000000-0000-4000-8000-000000047040';
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
		// #4704: 受諾 txn がメンバー上限のためにプラン (契約 4 列) を読む。
		await db.execute(
			sql.raw(`CREATE TABLE families (
				family_id uuid PRIMARY KEY,
				name text NOT NULL DEFAULT 'test',
				status text NOT NULL DEFAULT 'active',
				plan text,
				stripe_customer_id text,
				stripe_subscription_id text,
				plan_expires_at timestamptz,
				trial_used_at timestamptz,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			)`),
		);
		// #4704: 受諾 txn は「トライアル中か」も読む (発行側 resolveFullPlanTier と同じ tier を使うため)。
		await db.execute(
			sql.raw(`CREATE TABLE trial_history (
				family_id uuid NOT NULL,
				trial_id uuid NOT NULL DEFAULT gen_random_uuid(),
				start_date text NOT NULL,
				end_date text NOT NULL,
				tier text NOT NULL DEFAULT 'standard',
				source text NOT NULL DEFAULT 'test',
				stripe_subscription_id text,
				created_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (family_id, trial_id)
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

	/**
	 * #4704: 受諾 txn はメンバー上限のためにプラン (families 契約 4 列) を読む。
	 * 既定は「プレミアム契約」= 上限なし。本 file の関心は受諾 txn の分岐 (email 束縛 / 原子性) で、
	 * 同じ family に複数 user を受諾させる test が多いため、上限は既定で効かせない。
	 * 上限そのものの検証は [B7] が free 契約を明示的に seed して行う。
	 */
	const seedFamily = async (over: { plan?: string | null; subscription?: string | null } = {}) => {
		await db.execute(sql`DELETE FROM families WHERE family_id = ${FAMILY}`);
		await db.execute(sql`
			INSERT INTO families (family_id, status, plan, stripe_subscription_id)
			VALUES (${FAMILY}, 'active', ${over.plan === undefined ? 'family-monthly' : over.plan},
				${over.subscription === undefined ? 'sub_test' : over.subscription})
		`);
	};

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

	/** #4704: 進行中トライアル (既定 standard) を 1 行入れる。end_date は JST 暦日の文字列。 */
	const seedTrial = async (over: { endDate: string; tier?: string; subscription?: string }) => {
		await db.execute(sql`
			INSERT INTO trial_history (family_id, start_date, end_date, tier, source, stripe_subscription_id)
			VALUES (${FAMILY}, '2020-01-01', ${over.endDate}, ${over.tier ?? 'standard'}, 'test',
				${over.subscription ?? null})
		`);
	};

	beforeEach(async () => {
		await seedFamily();
		await db.execute(sql`DELETE FROM trial_history WHERE family_id = ${FAMILY}`);
	});

	const makeRunner = async () => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		return createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
	};

	// #4704: 受諾側でも席数を数える (発行時検査だけでは、発行後の降格 / 同時受諾で超過できた)
	it('[B7] 上限に達している家族への受諾は MEMBER_LIMIT_REACHED で拒否し、invite も rollback', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		// free 契約 (契約なし) = 上限 1 人。owner が既に 1 席使っている状態を作る。
		await seedFamily({ plan: null, subscription: null });
		await db.execute(
			sql`INSERT INTO memberships (family_id, user_id, role) VALUES (${FAMILY}, ${INVITER}, 'owner')`,
		);
		await seedInvite({ id: LIMIT_INVITE });

		const result = await acceptInvite(await makeRunner(), {
			inviteId: LIMIT_INVITE,
			userId: LIMIT_USER,
			userEmail: 'someone@example.com',
			userEmailVerified: true,
			now: new Date().toISOString(),
		});

		expect(result).toEqual({ ok: false, reason: 'MEMBER_LIMIT_REACHED' });
		// invite は pending のまま (rollback されている = 上限解消後に使える)
		expect((await inviteStatus(LIMIT_INVITE)).status).toBe('pending');
		expect(await membershipCount(LIMIT_USER)).toBe(0);
	}, 30_000);

	// #4704: 発行側 (resolveFullPlanTier) はトライアル中の tier で上限を見る。受諾側が
	// families だけを見て free に丸めると「発行は通るのに受諾だけ落ちる」ずれになる。
	it('[B7b] トライアル中 (standard) の家族は free 上限 (1 人) を超えて受諾できる', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		await seedFamily({ plan: null, subscription: null }); // 契約なし = 契約列だけ見れば free
		await seedTrial({ endDate: '2999-12-31' });
		// owner 席は [B7] が作っている場合がある (memberships は test 間で残る)
		await db.execute(
			sql`INSERT INTO memberships (family_id, user_id, role) VALUES (${FAMILY}, ${INVITER}, 'owner')
				ON CONFLICT (family_id, user_id) DO NOTHING`,
		);
		const id = '10000000-0000-4000-8000-000000004705';
		const user = '20000000-0000-4000-8000-000000004705';
		await seedInvite({ id });

		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'someone@example.com',
			userEmailVerified: true,
			now: new Date().toISOString(),
		});

		expect(result.ok).toBe(true);
		expect(await membershipCount(user)).toBe(1);
	}, 30_000);

	// 終了済みトライアルで上限が緩んだままにならないこと (end_date 経過 = free に戻る)
	it('[B7c] 終了したトライアルは席数を緩めない (free 上限で MEMBER_LIMIT_REACHED)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		await seedFamily({ plan: null, subscription: null });
		await seedTrial({ endDate: '2020-01-08' });
		await db.execute(
			sql`INSERT INTO memberships (family_id, user_id, role) VALUES (${FAMILY}, ${INVITER}, 'owner')
				ON CONFLICT (family_id, user_id) DO NOTHING`,
		);
		const id = '10000000-0000-4000-8000-000000004706';
		const user = '20000000-0000-4000-8000-000000004706';
		await seedInvite({ id });

		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'someone@example.com',
			userEmailVerified: true,
			now: new Date().toISOString(),
		});

		expect(result).toEqual({ ok: false, reason: 'MEMBER_LIMIT_REACHED' });
		expect(await membershipCount(user)).toBe(0);
	}, 30_000);

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

	it('[B5b] email 束縛 + userEmailVerified=false → EMAIL_UNVERIFIED + 全 rollback (#3742 fail-closed parity)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		const id = '10000000-0000-4000-8000-000000000015';
		const user = '20000000-0000-4000-8000-000000000015';
		await seedInvite({ id, email: 'intended@example.com' });
		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'intended@example.com',
			userEmailVerified: false,
			now: NOW,
		});
		expect(result).toEqual({ ok: false, reason: 'EMAIL_UNVERIFIED' });
		expect((await inviteStatus(id)).status).toBe('pending');
		expect(await membershipCount(user)).toBe(0);
	});

	it('[B5c] email 束縛 + userEmailVerified=true / 未提供 → 受諾できる (#3742 後方互換 parity)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		// true: 検証済み claim を持つ provider
		const idTrue = '10000000-0000-4000-8000-000000000016';
		const userTrue = '20000000-0000-4000-8000-000000000016';
		await seedInvite({ id: idTrue, email: 'intended@example.com' });
		const resultTrue = await acceptInvite(await makeRunner(), {
			inviteId: idTrue,
			userId: userTrue,
			userEmail: 'intended@example.com',
			userEmailVerified: true,
			now: NOW,
		});
		expect(resultTrue.ok).toBe(true);
		// undefined: claim を持たない provider (local / dev) の後方互換 (service 層と同一契約)
		const idUndef = '10000000-0000-4000-8000-000000000017';
		const userUndef = '20000000-0000-4000-8000-000000000017';
		await seedInvite({ id: idUndef, email: 'intended@example.com' });
		const resultUndef = await acceptInvite(await makeRunner(), {
			inviteId: idUndef,
			userId: userUndef,
			userEmail: 'intended@example.com',
			now: NOW,
		});
		expect(resultUndef.ok).toBe(true);
	});

	it('[B5d] 受諾 email の前後空白は trim 一致扱い (#3742 service trim().toLowerCase() parity)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		const id = '10000000-0000-4000-8000-000000000018';
		const user = '20000000-0000-4000-8000-000000000018';
		await seedInvite({ id, email: 'intended@example.com' });
		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: '  Intended@Example.com  ',
			now: NOW,
		});
		expect(result.ok).toBe(true);
	});

	it('[B5e] email 未束縛の招待は userEmailVerified=false でも受諾できる (束縛 opt-in と同原則、#3742)', async () => {
		const { acceptInvite } = await import('../../../src/lib/server/db/dsql/invite-accept');
		const id = '10000000-0000-4000-8000-000000000019';
		const user = '20000000-0000-4000-8000-000000000019';
		await seedInvite({ id, email: null });
		const result = await acceptInvite(await makeRunner(), {
			inviteId: id,
			userId: user,
			userEmail: 'anyone@example.com',
			userEmailVerified: false,
			now: NOW,
		});
		expect(result.ok).toBe(true);
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
