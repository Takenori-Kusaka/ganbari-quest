// tests/unit/db/dsql-auth-repo.test.ts
// EPIC #3424 / PR-R2 / 設計 SSOT: dsql-data-model.md §6.6 / §P9
//
// DSQL IAuthRepo 実装のテスト。実 schema (pushSchema 適用、dsql-test-db helper) に対して:
//   [U1] createUser → findById/findByEmail round-trip (uuid 採番、displayName NULL→undefined)
//   [U2] email_lower: 大文字小文字非区別 lookup + case 違い重複 INSERT は 23505 で拒否
//   [U3] deleteUser
//   [T1] createTenant = families INSERT + owner membership INSERT の単一 txn
//   [T2] owner_guard UNIQUE が 2 人目 owner の createMembership を物理拒否 (throw 契約)
//   [T3] updateTenantOwner の txn 整合 (旧 owner demote → 新 owner promote → cache 更新)
//   [T4] updateTenantStatus / updateTenantStripe / findTenantByStripeCustomerId
//   [T5] updateTenantLastActiveAt (存在しない tenant は silent no-op)
//   [T6] listAllTenants (created_at 順)
//   [T7] deleteTenant = auth 4 表削除の単一 txn (users は cross-tenant で survive)
//   [M1] membership CRUD (findUserTenants / findTenantMembers / deleteMembership + 非存在 no-op)
//   [M2] deleteMembership が唯一の owner をブロック (I-OWN ≥1 app 層、M3 §3.3、FOR UPDATE)
//   [M3] owner 移譲後は旧 owner (parent 降格) を削除可能
//   [I1] createInvite → findInviteByCode round-trip (raw code 維持 + inviteId 採番、DB は token_hash のみ保存)
//   [I2] findTenantInvites は inviteId を管理鍵に返し inviteCode は '' (raw 非露出、#3585)
//   [I3] invite email の小文字正規化 (§6.6)
//   [I4] updateInviteStatus (inviteId 鍵、acceptedBy/acceptedAt 設定、#3585)
//   [I5] deleteInvite の inviteId 鍵 + tenant 束縛 (他 tenant からは消せない、#3585)
//   [I8] updateInviteStatus の tenant 束縛 (他 tenant の inviteId は no-op、cross-tenant mutation 排除、#3588 / ADR-0063)
//   [I6] updateInviteStatus 状態機械: pending 以外からの再遷移は no-op (#3588 ③)
//   [I7] 一覧の inviteId → revoke/delete が正しく反応する (raw 非保存の債務解消、#3585 / #3588 ④)
//   [N1] consent append-only + findLatestConsent (consented_at 降順) + §P9 tenant 分離

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SUBSCRIPTION_PLAN } from '../../../src/lib/domain/constants/subscription-plan';
import { asChildId } from '../../../src/lib/domain/ids';
import { hashInviteCode } from '../../../src/lib/server/auth/invite-code-hash';
import { createDsqlAuthRepo } from '../../../src/lib/server/db/dsql/auth-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IAuthRepo } from '../../../src/lib/server/db/interfaces/auth-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const USER_A = '00000000-0000-4000-8000-0000000000b1';
const USER_B = '00000000-0000-4000-8000-0000000000b2';
const USER_C = '00000000-0000-4000-8000-0000000000b3';
const NO_SUCH = '00000000-0000-4000-8000-00000000dead';
const CHILD_1 = '00000000-0000-4000-8000-0000000000c1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('DSQL auth-repo (PR-R2、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let repo: IAuthRepo;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		repo = createDsqlAuthRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ---------------------------------------------------------- User

	it('[U1] createUser → findUserById/findUserByEmail round-trip', async () => {
		const created = await repo.createUser({ email: 'Kenta@Example.com', provider: 'cognito' });
		expect(created.userId).toMatch(UUID_RE);
		expect(created.email).toBe('Kenta@Example.com'); // 表示用 email は原文保持
		expect(created.provider).toBe('cognito');
		expect(created.displayName).toBeUndefined(); // NULL → undefined 変換

		const byId = await repo.findUserById(created.userId);
		expect(byId?.email).toBe('Kenta@Example.com');

		const withName = await repo.createUser({
			email: 'named@example.com',
			provider: 'cognito',
			displayName: 'なまえ',
		});
		expect((await repo.findUserById(withName.userId))?.displayName).toBe('なまえ');
	});

	it('[U2] email_lower: 大文字小文字非区別 lookup + case 違い重複は 23505 拒否', async () => {
		const found = await repo.findUserByEmail('KENTA@EXAMPLE.COM');
		expect(found?.email).toBe('Kenta@Example.com');
		expect(await repo.findUserByEmail('kenta@example.com')).toBeDefined();
		expect(await repo.findUserByEmail('unknown@example.com')).toBeUndefined();

		// case 違いの同一 email は email_lower UNIQUE が拒否 (throw のまま = 既存 backend 契約)
		await expect(
			repo.createUser({ email: 'KENTA@example.com', provider: 'cognito' }),
		).rejects.toThrow();
	});

	it('[U3] deleteUser で消える', async () => {
		const u = await repo.createUser({ email: 'delete-me@example.com', provider: 'cognito' });
		await repo.deleteUser(u.userId);
		expect(await repo.findUserById(u.userId)).toBeUndefined();
		expect(await repo.findUserByEmail('delete-me@example.com')).toBeUndefined();
	});

	// ---------------------------------------------------------- Tenant

	it('[T1] createTenant = families + owner membership の単一 txn', async () => {
		const tenant = await repo.createTenant({ name: 'テスト家', ownerId: USER_A });
		expect(tenant.tenantId).toMatch(UUID_RE);
		expect(tenant.name).toBe('テスト家');
		expect(tenant.ownerId).toBe(USER_A);
		expect(tenant.status).toBe('active');
		expect(tenant.plan).toBeUndefined(); // NULL → undefined
		expect(tenant.stripeCustomerId).toBeUndefined();

		const found = await repo.findTenantById(tenant.tenantId);
		expect(found?.ownerId).toBe(USER_A);

		// owner membership が同時作成されている (§6.6: SSOT = memberships)
		const member = await repo.findMembership(USER_A, tenant.tenantId);
		expect(member?.role).toBe('owner');
	});

	it('[T2] owner_guard UNIQUE が 2 人目 owner を物理拒否 (23505 throw 契約)', async () => {
		const tenant = await repo.createTenant({ name: 'ガード家', ownerId: USER_A });
		await expect(
			repo.createMembership({ userId: USER_B, tenantId: tenant.tenantId, role: 'owner' }),
		).rejects.toThrow();
		// parent は許容される
		const parent = await repo.createMembership({
			userId: USER_B,
			tenantId: tenant.tenantId,
			role: 'parent',
		});
		expect(parent.role).toBe('parent');
	});

	it('[T3] updateTenantOwner: 旧 owner demote + 新 owner promote + cache 更新の txn 整合', async () => {
		const tenant = await repo.createTenant({ name: '移譲家', ownerId: USER_A });
		await repo.createMembership({ userId: USER_B, tenantId: tenant.tenantId, role: 'parent' });

		await repo.updateTenantOwner(tenant.tenantId, USER_B);

		expect((await repo.findMembership(USER_A, tenant.tenantId))?.role).toBe('parent'); // demote
		expect((await repo.findMembership(USER_B, tenant.tenantId))?.role).toBe('owner'); // promote
		expect((await repo.findTenantById(tenant.tenantId))?.ownerId).toBe(USER_B); // cache 更新
	});

	it('[T4] updateTenantStatus / updateTenantStripe / stripe lookup', async () => {
		const tenant = await repo.createTenant({ name: '課金家', ownerId: USER_A });

		await repo.updateTenantStatus(tenant.tenantId, 'grace_period');
		expect((await repo.findTenantById(tenant.tenantId))?.status).toBe('grace_period');

		const expires = '2026-08-01T00:00:00.000Z';
		await repo.updateTenantStripe(tenant.tenantId, {
			stripeCustomerId: 'cus_r2test',
			stripeSubscriptionId: 'sub_r2test',
			plan: SUBSCRIPTION_PLAN.MONTHLY,
			planExpiresAt: expires,
			trialUsedAt: '2026-07-01T00:00:00.000Z',
			status: 'active',
		});
		const updated = await repo.findTenantById(tenant.tenantId);
		expect(updated?.stripeCustomerId).toBe('cus_r2test');
		expect(updated?.stripeSubscriptionId).toBe('sub_r2test');
		expect(updated?.plan).toBe(SUBSCRIPTION_PLAN.MONTHLY);
		expect(Date.parse(updated?.planExpiresAt ?? '')).toBe(Date.parse(expires));
		expect(updated?.status).toBe('active');

		const byStripe = await repo.findTenantByStripeCustomerId('cus_r2test');
		expect(byStripe?.tenantId).toBe(tenant.tenantId);
		expect(await repo.findTenantByStripeCustomerId('cus_unknown')).toBeUndefined();

		// 部分更新: 未指定 field は不変
		await repo.updateTenantStripe(tenant.tenantId, { status: 'suspended' });
		const partial = await repo.findTenantById(tenant.tenantId);
		expect(partial?.status).toBe('suspended');
		expect(partial?.stripeCustomerId).toBe('cus_r2test');
	});

	it('[T5] updateTenantLastActiveAt (存在しない tenant は silent no-op)', async () => {
		const tenant = await repo.createTenant({ name: '活動家', ownerId: USER_A });
		const ts = '2026-07-04T01:02:03.000Z';
		await repo.updateTenantLastActiveAt(tenant.tenantId, ts);
		expect(Date.parse((await repo.findTenantById(tenant.tenantId))?.lastActiveAt ?? '')).toBe(
			Date.parse(ts),
		);
		// dynamo backend の best-effort 契約と同じく throw しない
		await expect(repo.updateTenantLastActiveAt(NO_SUCH, ts)).resolves.toBeUndefined();
	});

	it('[T6] listAllTenants は created_at 順で全件返す', async () => {
		const all = await repo.listAllTenants();
		expect(all.length).toBeGreaterThanOrEqual(4);
		const times = all.map((x) => Date.parse(x.createdAt));
		expect([...times].sort((a, b) => a - b)).toEqual(times);
	});

	it('[T7] deleteTenant = auth 4 表削除の単一 txn (users は survive)', async () => {
		const owner = await repo.createUser({ email: 'survivor@example.com', provider: 'cognito' });
		const tenant = await repo.createTenant({ name: '削除家', ownerId: owner.userId });
		await repo.createInvite({ tenantId: tenant.tenantId, invitedBy: owner.userId, role: 'parent' });
		await repo.recordConsent({
			tenantId: tenant.tenantId,
			userId: owner.userId,
			type: 'terms',
			version: 'v1',
			ipAddress: '127.0.0.1',
			userAgent: 'vitest',
		});

		await repo.deleteTenant(tenant.tenantId);

		expect(await repo.findTenantById(tenant.tenantId)).toBeUndefined();
		expect(await repo.findMembership(owner.userId, tenant.tenantId)).toBeUndefined();
		expect(await repo.findTenantInvites(tenant.tenantId)).toEqual([]);
		expect(await repo.findAllConsents(tenant.tenantId)).toEqual([]);
		// users は cross-tenant なので消えない
		expect(await repo.findUserById(owner.userId)).toBeDefined();
	});

	// ---------------------------------------------------------- Membership

	it('[M1] membership CRUD (findUserTenants / findTenantMembers / delete)', async () => {
		const t1 = await repo.createTenant({ name: 'メンバ家1', ownerId: USER_C });
		await repo.createMembership({
			userId: USER_B,
			tenantId: t1.tenantId,
			role: 'child',
			invitedBy: USER_C,
		});

		const members = await repo.findTenantMembers(t1.tenantId);
		expect(members.map((m) => m.userId).sort()).toEqual([USER_B, USER_C].sort());
		const childMember = members.find((m) => m.userId === USER_B);
		expect(childMember?.role).toBe('child');
		expect(childMember?.invitedBy).toBe(USER_C);

		const tenantsOfB = await repo.findUserTenants(USER_B);
		expect(tenantsOfB.some((m) => m.tenantId === t1.tenantId)).toBe(true);

		await repo.deleteMembership(USER_B, t1.tenantId);
		expect(await repo.findMembership(USER_B, t1.tenantId)).toBeUndefined();

		// 非存在 membership の削除は silent no-op (dynamo backend の DeleteCommand と同契約)
		await expect(repo.deleteMembership(NO_SUCH, t1.tenantId)).resolves.toBeUndefined();
	});

	it('[M2] deleteMembership は唯一の owner をブロックする (I-OWN ≥1 app 層、M3 §3.3)', async () => {
		// owner_guard は owner ≤1 を DB 強制するが「最後の 1 名を残す」(≥1) は app 層。
		const owner = await repo.createUser({ email: 'm2-owner@example.com', provider: 'cognito' });
		const tenant = await repo.createTenant({ name: 'M2家', ownerId: owner.userId });

		// owner は唯一の owner ゆえ削除はブロックされる (owner 空白防止)
		await expect(repo.deleteMembership(owner.userId, tenant.tenantId)).rejects.toThrow(
			/sole owner/,
		);
		// ブロック後も owner は残る (I-OWN ≥1 維持)
		expect((await repo.findMembership(owner.userId, tenant.tenantId))?.role).toBe('owner');
	});

	it('[M3] owner 移譲後は旧 owner (parent 降格) を削除できる', async () => {
		const owner = await repo.createUser({ email: 'm3-owner@example.com', provider: 'cognito' });
		const heir = await repo.createUser({ email: 'm3-heir@example.com', provider: 'cognito' });
		const tenant = await repo.createTenant({ name: 'M3家', ownerId: owner.userId });
		await repo.createMembership({ userId: heir.userId, tenantId: tenant.tenantId, role: 'parent' });

		// 先に移譲 (updateTenantOwner) → 旧 owner は parent へ降格
		await repo.updateTenantOwner(tenant.tenantId, heir.userId);
		expect((await repo.findMembership(owner.userId, tenant.tenantId))?.role).toBe('parent');

		// parent へ降格した旧 owner は削除可能 (新 owner が I-OWN ≥1 を満たす)
		await repo.deleteMembership(owner.userId, tenant.tenantId);
		expect(await repo.findMembership(owner.userId, tenant.tenantId)).toBeUndefined();
		// 新 owner は残る
		expect((await repo.findMembership(heir.userId, tenant.tenantId))?.role).toBe('owner');
	});

	// ---------------------------------------------------------- Invite

	it('[I1] createInvite → findInviteByCode round-trip (raw code 維持、DB は hash のみ)', async () => {
		const tenant = await repo.createTenant({ name: '招待家', ownerId: USER_A });
		const before = Date.now();
		const invite = await repo.createInvite({
			tenantId: tenant.tenantId,
			invitedBy: USER_A,
			role: 'parent',
			childId: asChildId(CHILD_1),
		});
		// 作成時のみ raw code を返す (dynamo backend と同形式)
		expect(invite.inviteCode).toMatch(/^inv-/);
		// #3585: inviteId (管理鍵) は DB 採番 uuid で raw code とは独立
		expect(invite.inviteId).toMatch(UUID_RE);
		expect(invite.inviteId).not.toBe(invite.inviteCode);
		expect(invite.status).toBe('pending');
		expect(invite.childId).toBe(CHILD_1);
		// expiresAt ≈ +7 日 (INVITE_EXPIRY_DAYS)
		const expiresMs = Date.parse(invite.expiresAt);
		expect(expiresMs).toBeGreaterThan(before + 6.9 * 24 * 3600 * 1000);
		expect(expiresMs).toBeLessThan(before + 7.1 * 24 * 3600 * 1000);

		// DB には raw code を保存しない (CWE-522): token_hash = sha256(raw) のみ
		const rows = await t.db.execute(
			sql`SELECT token_hash FROM invites WHERE family_id = ${tenant.tenantId}`,
		);
		const stored = (rows.rows[0] as { token_hash: string }).token_hash;
		expect(stored).toBe(hashInviteCode(invite.inviteCode));
		expect(stored).not.toContain(invite.inviteCode);

		const found = await repo.findInviteByCode(invite.inviteCode);
		expect(found?.inviteCode).toBe(invite.inviteCode); // 引数の raw code を維持
		expect(found?.inviteId).toBe(invite.inviteId); // 同一 invite の inviteId を復元
		expect(found?.tenantId).toBe(tenant.tenantId);
		expect(found?.invitedBy).toBe(USER_A);
		expect(found?.role).toBe('parent');
		expect(await repo.findInviteByCode('inv-unknown')).toBeUndefined();
	});

	it('[I2] findTenantInvites は inviteId を管理鍵に返し inviteCode は空 (raw 非露出、#3585)', async () => {
		const tenant = await repo.createTenant({ name: '一覧家', ownerId: USER_A });
		const created = await repo.createInvite({
			tenantId: tenant.tenantId,
			invitedBy: USER_A,
			role: 'child',
		});

		const listed = await repo.findTenantInvites(tenant.tenantId);
		expect(listed).toHaveLength(1);
		// #3585: 管理鍵 inviteId (= 作成時の inviteId) を返す
		expect(listed[0]?.inviteId).toBe(created.inviteId);
		expect(listed[0]?.inviteId).toMatch(UUID_RE);
		// raw code は復元不能 (CWE-522) のため一覧では '' (作成時のみ露出)
		expect(listed[0]?.inviteCode).toBe('');
		expect(listed[0]?.role).toBe('child');
		// §P9: 他 tenant の一覧には出ない
		const other = await repo.createTenant({ name: '別家', ownerId: USER_B });
		expect(await repo.findTenantInvites(other.tenantId)).toEqual([]);
	});

	it('[I3] invite email は小文字正規化して保存される (§6.6)', async () => {
		const tenant = await repo.createTenant({ name: '宛先家', ownerId: USER_A });
		const invite = await repo.createInvite({
			tenantId: tenant.tenantId,
			invitedBy: USER_A,
			role: 'parent',
			email: 'Aunt.Mari@Example.COM',
		});
		expect(invite.email).toBe('aunt.mari@example.com');
		expect((await repo.findInviteByCode(invite.inviteCode))?.email).toBe('aunt.mari@example.com');
	});

	it('[I4] updateInviteStatus: inviteId 鍵 + acceptedBy/acceptedAt 設定 (#3585)', async () => {
		const tenant = await repo.createTenant({ name: '状態家', ownerId: USER_A });
		const inv1 = await repo.createInvite({
			tenantId: tenant.tenantId,
			invitedBy: USER_A,
			role: 'parent',
		});
		// #3585: 管理鍵は inviteId (raw code ではない)。#3588: tenant scope は family_id 述語
		await repo.updateInviteStatus(inv1.inviteId, tenant.tenantId, 'revoked');
		expect((await repo.findInviteByCode(inv1.inviteCode))?.status).toBe('revoked');

		const inv2 = await repo.createInvite({
			tenantId: tenant.tenantId,
			invitedBy: USER_A,
			role: 'parent',
		});
		await repo.updateInviteStatus(inv2.inviteId, tenant.tenantId, 'accepted', USER_B);
		const accepted = await repo.findInviteByCode(inv2.inviteCode);
		expect(accepted?.status).toBe('accepted');
		expect(accepted?.acceptedBy).toBe(USER_B);
		expect(accepted?.acceptedAt).toBeDefined();

		// 存在しない inviteId (有効 uuid) は invite_id 照合で一致せず no-op
		const inv3 = await repo.createInvite({
			tenantId: tenant.tenantId,
			invitedBy: USER_A,
			role: 'parent',
		});
		await repo.updateInviteStatus(NO_SUCH, tenant.tenantId, 'revoked');
		expect((await repo.findInviteByCode(inv3.inviteCode))?.status).toBe('pending');
	});

	it('[I5] deleteInvite は inviteId 鍵 + tenant 束縛 (他 tenant からは消せない、#3585)', async () => {
		const mine = await repo.createTenant({ name: '自家', ownerId: USER_A });
		const other = await repo.createTenant({ name: '他家', ownerId: USER_B });
		const invite = await repo.createInvite({
			tenantId: mine.tenantId,
			invitedBy: USER_A,
			role: 'parent',
		});

		await repo.deleteInvite(invite.inviteId, other.tenantId); // 他 tenant → no-op
		expect(await repo.findInviteByCode(invite.inviteCode)).toBeDefined();

		await repo.deleteInvite(invite.inviteId, mine.tenantId);
		expect(await repo.findInviteByCode(invite.inviteCode)).toBeUndefined();
	});

	it('[I8] updateInviteStatus は tenant 束縛 (他 tenant の inviteId は no-op、cross-tenant mutation 排除、#3588 / ADR-0063)', async () => {
		// deleteInvite ([I5]) と対称の family_id 述語検証。他家族の invite の status / accepted_by を
		// 書き換えられないことを assert する (述語を外すと fail する検出力)。
		const mine = await repo.createTenant({ name: '本家', ownerId: USER_A });
		const other = await repo.createTenant({ name: '別家', ownerId: USER_B });
		const invite = await repo.createInvite({
			tenantId: mine.tenantId,
			invitedBy: USER_A,
			role: 'parent',
		});

		// 他 tenant の family_id 指定 → family_id 述語不一致で 0 行 = no-op (revoke されない)
		await repo.updateInviteStatus(invite.inviteId, other.tenantId, 'revoked');
		expect((await repo.findInviteByCode(invite.inviteCode))?.status).toBe('pending');

		// 他 tenant の family_id 指定 + acceptedBy 経路も no-op (accepted_by を書き込めない)
		await repo.updateInviteStatus(invite.inviteId, other.tenantId, 'accepted', USER_C);
		const afterCrossTenant = await repo.findInviteByCode(invite.inviteCode);
		expect(afterCrossTenant?.status).toBe('pending');
		expect(afterCrossTenant?.acceptedBy).toBeUndefined();

		// 正しい family_id なら遷移する (regression の対照)
		await repo.updateInviteStatus(invite.inviteId, mine.tenantId, 'revoked');
		expect((await repo.findInviteByCode(invite.inviteCode))?.status).toBe('revoked');
	});

	it('[I6] updateInviteStatus 状態機械: pending 以外からの再遷移は no-op (#3588 ③)', async () => {
		const tenant = await repo.createTenant({ name: '機械家', ownerId: USER_A });
		const invite = await repo.createInvite({
			tenantId: tenant.tenantId,
			invitedBy: USER_A,
			role: 'parent',
		});
		// pending → revoked は許可 (#3588: tenant scope は family_id 述語)
		await repo.updateInviteStatus(invite.inviteId, tenant.tenantId, 'revoked');
		expect((await repo.findInviteByCode(invite.inviteCode))?.status).toBe('revoked');

		// revoked → accepted / pending / expired への再遷移は状態機械が弾く (no-op)
		await repo.updateInviteStatus(invite.inviteId, tenant.tenantId, 'accepted', USER_B);
		await repo.updateInviteStatus(invite.inviteId, tenant.tenantId, 'pending');
		await repo.updateInviteStatus(invite.inviteId, tenant.tenantId, 'expired');
		const stillRevoked = await repo.findInviteByCode(invite.inviteCode);
		expect(stillRevoked?.status).toBe('revoked');
		expect(stillRevoked?.acceptedBy).toBeUndefined();
	});

	it('[I7] 一覧の inviteId で revoke / delete が正しく反応する (raw 非保存の債務解消、#3585 / #3588 ④)', async () => {
		const tenant = await repo.createTenant({ name: '債務家', ownerId: USER_A });
		await repo.createInvite({ tenantId: tenant.tenantId, invitedBy: USER_A, role: 'parent' });

		// 一覧から得た inviteId で管理操作 → 一致して状態遷移する (旧: inviteCode 位置の
		// invite_id を hash 照合し不一致 no-op となる債務)。
		const listed = (await repo.findTenantInvites(tenant.tenantId))[0];
		expect(listed).toBeDefined();
		if (!listed) throw new Error('invite not listed');
		expect(listed.inviteCode).toBe(''); // raw は非露出
		await repo.updateInviteStatus(listed.inviteId, tenant.tenantId, 'revoked');
		const afterRevoke = await repo.findTenantInvites(tenant.tenantId);
		expect(afterRevoke[0]?.status).toBe('revoked');

		// 一覧の inviteId で物理削除も反応する
		await repo.deleteInvite(listed.inviteId, tenant.tenantId);
		expect(await repo.findTenantInvites(tenant.tenantId)).toEqual([]);
	});

	// ---------------------------------------------------------- Consent

	it('[N1] consent append-only + latest 判定 (consented_at 降順) + §P9 分離', async () => {
		const tenant = await repo.createTenant({ name: '同意家', ownerId: USER_A });
		const other = await repo.createTenant({ name: '無同意家', ownerId: USER_B });
		const base = {
			tenantId: tenant.tenantId,
			userId: USER_A,
			ipAddress: '127.0.0.1',
			userAgent: 'vitest',
		};

		const first = await repo.recordConsent({ ...base, type: 'terms', version: 'v1' });
		expect(first.version).toBe('v1');
		expect(first.consentedAt).toBeTruthy();
		// consented_at 降順判定 (version 文字列順に依存しない、§6.6) — timestamp を確実に分離
		await new Promise((r) => setTimeout(r, 10));
		await repo.recordConsent({ ...base, type: 'terms', version: 'v0-later' });
		await repo.recordConsent({ ...base, type: 'privacy', version: 'p1' });

		const latest = await repo.findLatestConsent(tenant.tenantId, 'terms');
		expect(latest?.version).toBe('v0-later'); // 後から記録した方が latest
		expect((await repo.findLatestConsent(tenant.tenantId, 'privacy'))?.version).toBe('p1');
		expect(await repo.findLatestConsent(other.tenantId, 'terms')).toBeUndefined(); // §P9

		const all = await repo.findAllConsents(tenant.tenantId);
		expect(all).toHaveLength(3);
		expect(await repo.findAllConsents(other.tenantId)).toEqual([]);
	});

	it('[T8] updateTenantOwner: 非 member への移譲は throw + rollback (owner 空白防止)', async () => {
		const owner = await repo.createUser({ email: 't8-owner@example.com', provider: 'cognito' });
		const tenant = await repo.createTenant({ name: 'T8家', ownerId: owner.userId });
		await expect(
			repo.updateTenantOwner(tenant.tenantId, '00000000-0000-4000-8000-00000000dead'),
		).rejects.toThrow(/not a member/);
		// rollback 検証: demote も巻き戻り旧 owner が owner のまま (owner 空白が生じない)
		const members = await repo.findTenantMembers(tenant.tenantId);
		expect(members.find((m) => m.userId === owner.userId)?.role).toBe('owner');
	});
});
