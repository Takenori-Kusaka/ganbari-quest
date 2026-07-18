// src/lib/server/db/dsql/auth-repo.ts
// EPIC #3424 / PR-R2 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §6.6 / §P9
//
// IAuthRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) と
//     TransactionRunner を呼び出し側 (将来の client factory / テスト) が渡す。
//   - **§P9 tenant 述語**: family 系メソッドは family_id を WHERE に含む。users は
//     グローバル表 (§6.6 正準、§11.2 例外) のため tenant 述語を持たない。
//   - **createTenant / updateTenantOwner / deleteTenant は単一 txn** (§6.6)。work 内の
//     await は tx.execute(...) 直呼びのみ (fitness#7、helper 閉包経由 await 禁止 — PR-R1 教訓)。
//   - **invite は token_hash のみ保存** (CWE-522、raw 非保存)。hash SSOT は
//     $lib/server/auth/invite-code-hash.ts。raw code を知るのは作成時の呼び出し側だけ。
//   - **invite 受諾は invite-accept.ts が正** (§6.6 厳密分岐の単一 txn)。本 repo の
//     updateInviteStatus / deleteInvite は invite_id 鍵の管理系操作 (#3585)。
//     updateInviteStatus は pending からの遷移のみ許可する状態機械 (#3588 ③)。
//   - 23505 (email_lower / owner_guard UNIQUE 違反) は throw のまま呼び出し側契約
//     (dynamo backend の ConditionExpression 失敗 throw / invite-accept の catch と同型)。

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { MS_PER_DAY } from '$lib/domain/constants/time';
import { asChildId } from '$lib/domain/ids';
import { INVITE_EXPIRY_DAYS } from '$lib/domain/validation/auth';
import type {
	AuthUser,
	ConsentRecord,
	Invite,
	Membership,
	Tenant,
} from '$lib/server/auth/entities';
import { hashInviteCode } from '$lib/server/auth/invite-code-hash';
import type { Role } from '$lib/server/auth/types';
import type { IAuthRepo } from '../interfaces/auth-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { SqlExecutor } from './sql-executor';

// ---------------------------------------------------------------- row 型 + mapper

interface UserRow {
	user_id: string;
	email: string;
	provider: string;
	display_name: string | null;
	created_at: string;
	updated_at: string;
}

const USER_COLUMNS = sql.raw('user_id, email, provider, display_name, created_at, updated_at');

function toUser(row: UserRow): AuthUser {
	return {
		userId: row.user_id,
		email: row.email,
		provider: row.provider as AuthUser['provider'],
		displayName: row.display_name ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

interface FamilyRow {
	family_id: string;
	name: string;
	owner_user_id: string | null;
	status: string;
	plan: string | null;
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
	plan_expires_at: string | null;
	trial_used_at: string | null;
	last_active_at: string | null;
	created_at: string;
	updated_at: string;
}

const FAMILY_COLUMNS = sql.raw(
	`family_id, name, owner_user_id, status, plan, stripe_customer_id, stripe_subscription_id,
	 plan_expires_at, trial_used_at, last_active_at, created_at, updated_at`,
);

function toTenant(row: FamilyRow): Tenant {
	return {
		tenantId: row.family_id,
		name: row.name,
		// owner_user_id は denormalized cache (SSOT = memberships.owner_guard、§6.6)。
		// createTenant / updateTenantOwner が常に設定する運用のため NULL は理論上無いが、
		// entity は必須 string ゆえ防御的に '' を返す (memberships への追加 lookup はしない)。
		ownerId: row.owner_user_id ?? '',
		status: row.status as Tenant['status'],
		plan: (row.plan ?? undefined) as Tenant['plan'],
		stripeCustomerId: row.stripe_customer_id ?? undefined,
		stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
		planExpiresAt: row.plan_expires_at ?? undefined,
		trialUsedAt: row.trial_used_at ?? undefined,
		lastActiveAt: row.last_active_at ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

interface MembershipRow {
	family_id: string;
	user_id: string;
	role: string;
	invited_by: string | null;
	joined_at: string;
}

const MEMBERSHIP_COLUMNS = sql.raw('family_id, user_id, role, invited_by, joined_at');

function toMembership(row: MembershipRow): Membership {
	return {
		userId: row.user_id,
		tenantId: row.family_id,
		role: row.role as Role,
		joinedAt: row.joined_at,
		invitedBy: row.invited_by ?? undefined,
	};
}

interface InviteRow {
	invite_id: string;
	family_id: string;
	invited_by: string;
	role: string;
	child_id: string | null;
	email: string | null;
	status: string;
	expires_at: string;
	accepted_by: string | null;
	accepted_at: string | null;
	created_at: string;
}

const INVITE_COLUMNS = sql.raw(
	`invite_id, family_id, invited_by, role, child_id, email, status, expires_at,
	 accepted_by, accepted_at, created_at`,
);

/**
 * row → Invite。inviteId = invite_id (管理鍵、#3585)。raw code は DB に無い (CWE-522) ため
 * 呼び出し側が inviteCode を供給する (受諾照合は raw、一覧は '' で raw 非露出)。
 */
function toInvite(row: InviteRow, inviteCode: string): Invite {
	return {
		inviteId: row.invite_id,
		inviteCode,
		tenantId: row.family_id,
		invitedBy: row.invited_by,
		role: row.role as Role,
		childId: row.child_id != null ? asChildId(row.child_id) : undefined,
		email: row.email ?? undefined,
		status: row.status as Invite['status'],
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		acceptedBy: row.accepted_by ?? undefined,
		acceptedAt: row.accepted_at ?? undefined,
	};
}

interface ConsentRow {
	family_id: string;
	user_id: string;
	type: string;
	version: string;
	consented_at: string;
	ip_address: string;
	user_agent: string;
}

const CONSENT_COLUMNS = sql.raw(
	'family_id, user_id, type, version, consented_at, ip_address, user_agent',
);

function toConsent(row: ConsentRow): ConsentRecord {
	return {
		tenantId: row.family_id,
		userId: row.user_id,
		type: row.type as ConsentRecord['type'],
		version: row.version,
		consentedAt: row.consented_at,
		ipAddress: row.ip_address,
		userAgent: row.user_agent,
	};
}

// ---------------------------------------------------------------- factory

/** DSQL 用 IAuthRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlAuthRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IAuthRepo {
	return {
		// ---------------------------------------------------------- User (global 表、§6.6)

		async findUserByEmail(email) {
			// email_lower 生成列 + UNIQUE (spike#6 F7)。case-insensitive lookup の SSOT。
			const result = await db.execute(
				sql`SELECT ${USER_COLUMNS} FROM users WHERE email_lower = lower(${email})`,
			);
			const row = result.rows[0] as UserRow | undefined;
			return row ? toUser(row) : undefined;
		},

		async findUserById(userId) {
			const result = await db.execute(
				sql`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ${userId}`,
			);
			const row = result.rows[0] as UserRow | undefined;
			return row ? toUser(row) : undefined;
		},

		async createUser(input) {
			// email 重複 (case-insensitive) は email_lower UNIQUE の 23505 で throw のまま
			// (dynamo backend の ConditionExpression 失敗 throw と同型契約)。
			const result = await db.execute(sql`
				INSERT INTO users (email, provider, display_name)
				VALUES (${input.email}, ${input.provider}, ${input.displayName ?? null})
				RETURNING ${USER_COLUMNS}
			`);
			return toUser(result.rows[0] as UserRow);
		},

		async deleteUser(userId) {
			await db.execute(sql`DELETE FROM users WHERE user_id = ${userId}`);
		},

		// ---------------------------------------------------------- Tenant (families)

		async findTenantById(tenantId) {
			const result = await db.execute(
				sql`SELECT ${FAMILY_COLUMNS} FROM families WHERE family_id = ${tenantId}`,
			);
			const row = result.rows[0] as FamilyRow | undefined;
			return row ? toTenant(row) : undefined;
		},

		async findTenantByStripeCustomerId(stripeCustomerId) {
			// UNIQUE(stripe_customer_id) で 2hop→1hop (§6.6、spike#6 F8)。
			const result = await db.execute(
				sql`SELECT ${FAMILY_COLUMNS} FROM families WHERE stripe_customer_id = ${stripeCustomerId}`,
			);
			const row = result.rows[0] as FamilyRow | undefined;
			return row ? toTenant(row) : undefined;
		},

		async listAllTenants() {
			// §6.6 は created_at cursor ページング (OFFSET 不使用) を規定するが、現 interface は
			// 無引数で全件契約 → 全件 SELECT (安定順序: created_at, family_id)。cursor 化は
			// interface 進化 (cursor/limit 引数追加) が必要で、cutover 配線 PR 以降の課題。
			const result = await db.execute(
				sql`SELECT ${FAMILY_COLUMNS} FROM families ORDER BY created_at, family_id`,
			);
			return (result.rows as unknown as FamilyRow[]).map(toTenant);
		},

		async createTenant(input) {
			// families INSERT + owner membership INSERT の単一 txn (§6.6: role の SSOT は
			// memberships、owner_user_id は cache)。owner_guard 生成列 UNIQUE が owner ≤ 1 を
			// DB 強制する。work 内 await は tx.execute のみ (fitness#7)。
			return runner.runInTransaction(async (tx) => {
				const inserted = await tx.execute(sql`
					INSERT INTO families (name, owner_user_id, status)
					VALUES (${input.name}, ${input.ownerId}, ${SUBSCRIPTION_STATUS.ACTIVE})
					RETURNING ${FAMILY_COLUMNS}
				`);
				const family = inserted.rows[0] as FamilyRow;
				await tx.execute(sql`
					INSERT INTO memberships (family_id, user_id, role)
					VALUES (${family.family_id}, ${input.ownerId}, 'owner')
				`);
				return toTenant(family);
			});
		},

		async updateTenantStatus(tenantId, status) {
			await db.execute(sql`
				UPDATE families SET status = ${status}, updated_at = now()
				WHERE family_id = ${tenantId}
			`);
		},

		async updateTenantStripe(tenantId, data) {
			const sets: ReturnType<typeof sql>[] = [];
			if (data.stripeCustomerId !== undefined)
				sets.push(sql`stripe_customer_id = ${data.stripeCustomerId}`);
			if (data.stripeSubscriptionId !== undefined)
				sets.push(sql`stripe_subscription_id = ${data.stripeSubscriptionId}`);
			if (data.plan !== undefined) sets.push(sql`plan = ${data.plan}`);
			if (data.planExpiresAt !== undefined) sets.push(sql`plan_expires_at = ${data.planExpiresAt}`);
			if (data.trialUsedAt !== undefined) sets.push(sql`trial_used_at = ${data.trialUsedAt}`);
			if (data.status !== undefined) sets.push(sql`status = ${data.status}`);
			if (sets.length === 0) return;
			await db.execute(sql`
				UPDATE families SET ${sql.join(sets, sql`, `)}, updated_at = now()
				WHERE family_id = ${tenantId}
			`);
		},

		async updateTenantOwner(tenantId, newOwnerId) {
			// 全て単一 txn (§6.6)。owner_guard UNIQUE と両立する更新順序:
			// 旧 owner を先に demote してから新 owner を promote (逆順だと一瞬 owner 2 行で 23505)。
			// 新 owner が member でない場合は promote 0 行 = owner 空白になるため、
			// RETURNING 行数を検証し 0 行なら throw → txn ごと rollback (demote も巻き戻る)。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`
					UPDATE memberships SET role = 'parent'
					WHERE family_id = ${tenantId} AND role = 'owner' AND user_id <> ${newOwnerId}
				`);
				const promoted = await tx.execute(sql`
					UPDATE memberships SET role = 'owner'
					WHERE family_id = ${tenantId} AND user_id = ${newOwnerId}
					RETURNING 1
				`);
				if (promoted.rows.length === 0) {
					throw new Error(
						`updateTenantOwner: new owner ${newOwnerId} is not a member of tenant ${tenantId}`,
					);
				}
				await tx.execute(sql`
					UPDATE families SET owner_user_id = ${newOwnerId}, updated_at = now()
					WHERE family_id = ${tenantId}
				`);
			});
		},

		async updateTenantLastActiveAt(tenantId, lastActiveAt) {
			// hooks の best-effort 呼び出し (#1601)。存在しない tenant は 0 行 = silent no-op
			// (dynamo backend の ConditionalCheckFailed 黙認と同型契約)。
			await db.execute(sql`
				UPDATE families SET last_active_at = ${lastActiveAt}, updated_at = ${lastActiveAt}
				WHERE family_id = ${tenantId}
			`);
		},

		async deleteTenant(tenantId) {
			// 本 PR の scope は auth 4 表 (families/memberships/invites/consents) の単一 txn 削除のみ。
			// users は cross-tenant (global 表) なので消さない。§6.6 の family 全削除 orchestrator
			// (children 集約含む全 40 テナント表 cascade、§P4 FK 非対応ゆえ明示 DELETE) は
			// cutover 級の別 PR が担う — 本メソッドはその orchestrator の auth 部分として呼ばれる想定。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`DELETE FROM consents WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM invites WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM memberships WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM families WHERE family_id = ${tenantId}`);
			});
		},

		// ---------------------------------------------------------- Membership

		async findMembership(userId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
				WHERE family_id = ${tenantId} AND user_id = ${userId}
			`);
			const row = result.rows[0] as MembershipRow | undefined;
			return row ? toMembership(row) : undefined;
		},

		async findUserTenants(userId) {
			// user 起点 lookup (session 3 連 lookup の起点、memberships_user_id_idx、§6.6)。
			const result = await db.execute(sql`
				SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
				WHERE user_id = ${userId} ORDER BY joined_at, family_id
			`);
			return (result.rows as unknown as MembershipRow[]).map(toMembership);
		},

		async findTenantMembers(tenantId) {
			const result = await db.execute(sql`
				SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
				WHERE family_id = ${tenantId} ORDER BY joined_at, user_id
			`);
			return (result.rows as unknown as MembershipRow[]).map(toMembership);
		},

		async createMembership(input) {
			// 2 人目 owner は owner_guard UNIQUE の 23505 で throw のまま
			// (invite-accept 側が ALREADY_IN_TENANT へ写像する契約、§6.6)。
			const result = await db.execute(sql`
				INSERT INTO memberships (family_id, user_id, role, invited_by)
				VALUES (${input.tenantId}, ${input.userId}, ${input.role}, ${input.invitedBy ?? null})
				RETURNING ${MEMBERSHIP_COLUMNS}
			`);
			return toMembership(result.rows[0] as MembershipRow);
		},

		async deleteMembership(userId, tenantId) {
			// I-OWN ≥1 (M3 §3.1B / §3.3): owner_guard 生成列 UNIQUE は「owner ≤ 1」のみを DB 物理
			// 強制する。「最後の 1 名を残す」(≥1) は生成列では守れないため app 層で保証する。owner は
			// owner_guard で常に ≤ 1 = 現 owner が家族の唯一の owner ゆえ、owner membership の削除は
			// family を owner 空白にする (I-OWN 違反)。→ 削除をブロックし、先に updateTenantOwner で
			// 移譲させる。read-then-conditional-write の RMW 不変条件ゆえ、対象行を `FOR UPDATE` で
			// write-intent 化して write-skew (並行 promote / role 変更との TOCTOU) を阻止する
			// (M3 §6.6 F7、Phase 1 PoC 検証6)。runInTransaction が withOccRetry を内包し 40001 を
			// bounded retry する (M3 §6.3 F6、Drizzle txn 経路は connector 内蔵 retry を通らない)。
			// fitness#7: work 内 await は tx.execute 直呼びのみ。
			await runner.runInTransaction(async (tx) => {
				const found = await tx.execute(sql`
					SELECT role FROM memberships
					WHERE family_id = ${tenantId} AND user_id = ${userId}
					FOR UPDATE
				`);
				const row = found.rows[0] as { role: string } | undefined;
				// 非存在は silent no-op (既存 unconditional delete / dynamo backend の DeleteCommand と同契約)。
				if (!row) return;
				if (row.role === 'owner') {
					throw new Error(
						`deleteMembership: cannot remove the sole owner of tenant ${tenantId}; ` +
							'transfer ownership via updateTenantOwner first (I-OWN ≥1, M3 §3.3)',
					);
				}
				await tx.execute(
					sql`DELETE FROM memberships WHERE family_id = ${tenantId} AND user_id = ${userId}`,
				);
			});
		},

		// ---------------------------------------------------------- Invite (token_hash、CWE-522)

		async createInvite(input) {
			// raw code は repo が採番し (dynamo backend と同形式 inv-<uuid v4>、122bit エントロピー)、
			// DB には hash のみ INSERT。raw を知るのは作成時の戻り値だけ (以後復元不能)。
			const inviteCode = `inv-${randomUUID()}`;
			const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * MS_PER_DAY).toISOString();
			const result = await db.execute(sql`
				INSERT INTO invites (family_id, invited_by, role, child_id, email, token_hash, expires_at)
				VALUES (${input.tenantId}, ${input.invitedBy}, ${input.role}, ${input.childId ?? null},
					${input.email ? input.email.toLowerCase() : null}, ${hashInviteCode(inviteCode)}, ${expiresAt})
				RETURNING ${INVITE_COLUMNS}
			`);
			return toInvite(result.rows[0] as InviteRow, inviteCode);
		},

		async findInviteByCode(inviteCode) {
			const result = await db.execute(sql`
				SELECT ${INVITE_COLUMNS} FROM invites WHERE token_hash = ${hashInviteCode(inviteCode)}
			`);
			const row = result.rows[0] as InviteRow | undefined;
			// 呼び出し側が raw code を提示できた = capability 保持者。entity には引数の raw を返す。
			return row ? toInvite(row, inviteCode) : undefined;
		},

		async updateInviteStatus(inviteId, tenantId, status, acceptedBy) {
			// 管理系遷移 (revoke / expire / 旧経路 accept)。鍵は invite_id (#3585)。
			// tenant scope: AND family_id = ${tenantId} で cross-tenant mutation を query 層が物理排除する
			// (deleteInvite と対称、ADR-0063 §3.4 単一強制点。RLS 非対応の代替防御線。#3588)。
			// #3588 ③ 状態機械: pending からの遷移のみ許可 (AND status = 'pending')。
			// 失効済 / 受諾済 invite への再遷移は 0 行 = no-op で乱用余地を塞ぐ。
			// 全呼び出し側は既に pending を確認してから呼ぶため defense-in-depth。
			// pending→accepted の厳密分岐 (rowCount=0 / 23505 / 40001) は invite-accept.ts が正 (§6.6)。
			if (acceptedBy) {
				await db.execute(sql`
					UPDATE invites SET status = ${status}, accepted_by = ${acceptedBy}, accepted_at = now()
					WHERE invite_id = ${inviteId} AND family_id = ${tenantId} AND status = 'pending'
				`);
				return;
			}
			await db.execute(sql`
				UPDATE invites SET status = ${status}
				WHERE invite_id = ${inviteId} AND family_id = ${tenantId} AND status = 'pending'
			`);
		},

		async findTenantInvites(tenantId) {
			// #3585: inviteId (= invite_id) を管理鍵として返し、inviteCode は '' (raw 非露出)。
			// raw code は token_hash のみ保存で復元不能 (CWE-522)。一覧から得た inviteId を
			// updateInviteStatus / deleteInvite に渡すと invite_id 照合で正しく反応する
			// (旧: inviteCode 位置に invite_id を入れ hash 照合で不一致 no-op となる債務を解消)。
			const result = await db.execute(sql`
				SELECT ${INVITE_COLUMNS} FROM invites
				WHERE family_id = ${tenantId} ORDER BY created_at, invite_id
			`);
			return (result.rows as unknown as InviteRow[]).map((row) => toInvite(row, ''));
		},

		async deleteInvite(inviteId, tenantId) {
			// 鍵は invite_id (#3585)。family_id 束縛必須 (§P9): 他 tenant の invite は消せない。
			await db.execute(sql`
				DELETE FROM invites
				WHERE invite_id = ${inviteId} AND family_id = ${tenantId}
			`);
		},

		// ---------------------------------------------------------- Consent (append-only、§6.6)

		async recordConsent(input) {
			// append-only: UPDATE/DELETE は repo 非定義 + GRANT 除外 + fitness 多層禁止 (§6.6)。
			const result = await db.execute(sql`
				INSERT INTO consents (family_id, user_id, type, version, ip_address, user_agent)
				VALUES (${input.tenantId}, ${input.userId}, ${input.type}, ${input.version},
					${input.ipAddress}, ${input.userAgent})
				RETURNING ${CONSENT_COLUMNS}
			`);
			return toConsent(result.rows[0] as ConsentRow);
		},

		async findLatestConsent(tenantId, type) {
			// 最新判定は consented_at 降順 (version 文字列順に依存しない、§6.6)。
			const result = await db.execute(sql`
				SELECT ${CONSENT_COLUMNS} FROM consents
				WHERE family_id = ${tenantId} AND type = ${type}
				ORDER BY consented_at DESC LIMIT 1
			`);
			const row = result.rows[0] as ConsentRow | undefined;
			return row ? toConsent(row) : undefined;
		},

		async findAllConsents(tenantId) {
			const result = await db.execute(sql`
				SELECT ${CONSENT_COLUMNS} FROM consents
				WHERE family_id = ${tenantId} ORDER BY consented_at, consent_id
			`);
			return (result.rows as unknown as ConsentRow[]).map(toConsent);
		},
	};
}
