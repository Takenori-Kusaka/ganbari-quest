// src/lib/server/db/interfaces/auth-repo.interface.ts
// マルチテナント認証リポジトリインターフェース (#0123)
//
// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract。LicenseRecord / LicenseKeyStatus /
// saveLicenseKey 系メソッド + LicenseKeyPage / LicenseKeyCountFilter を撤去。entitlement は
// Stripe Subscription (tenant.status) が唯一 SSOT。

import type {
	AuthUser,
	ConsentRecord,
	CreateInviteInput,
	CreateMembershipInput,
	CreateTenantInput,
	CreateUserInput,
	Invite,
	Membership,
	RecordConsentInput,
	Tenant,
} from '$lib/server/auth/entities';
import type { Role } from '$lib/server/auth/types';

/**
 * invite 受諾 txn の業務失敗 (#4039 / dsql-data-model.md §6.6)。
 *
 * いずれも **retry してはいけない**確定失敗であり、例外ではなく戻り値で運ぶ。
 * 競合 (40001) は backend 側の runner が txn 全体を再実行するためここには現れない。
 */
export type AcceptInviteFailure =
	| 'INVALID_OR_EXPIRED'
	| 'ALREADY_IN_TENANT'
	| 'EMAIL_MISMATCH'
	| 'EMAIL_UNVERIFIED';

export interface AcceptInviteTxnInput {
	/** invite の管理鍵 (#3585)。raw code ではない。 */
	inviteId: string;
	/** 受諾する user (users.user_id)。 */
	userId: string;
	/** 受諾 user の email (invite.email 束縛の再検証に使う)。 */
	userEmail: string;
	/**
	 * 受諾 user の email が IdP で検証済みか (Cognito `email_verified` claim、#3555 ③ / #3742)。
	 * `false` は fail-closed で拒否、`undefined` は claim を持たない provider との後方互換で許容。
	 */
	userEmailVerified?: boolean;
	/** 判定基準時刻 (ISO 8601)。呼び出し側が注入する (テスト決定性 + txn 内で一貫)。 */
	now: string;
}

export type AcceptInviteTxnResult =
	| { ok: true; familyId: string; role: Role; invitedBy?: string; joinedAt: string }
	| { ok: false; reason: AcceptInviteFailure };

export interface IAuthRepo {
	// --- User ---
	findUserByEmail(email: string): Promise<AuthUser | undefined>;
	findUserById(userId: string): Promise<AuthUser | undefined>;
	createUser(input: CreateUserInput): Promise<AuthUser>;
	deleteUser(userId: string): Promise<void>;

	// --- Tenant ---
	findTenantById(tenantId: string): Promise<Tenant | undefined>;
	findTenantByStripeCustomerId(stripeCustomerId: string): Promise<Tenant | undefined>;
	listAllTenants(): Promise<Tenant[]>;
	createTenant(input: CreateTenantInput): Promise<Tenant>;
	updateTenantStatus(tenantId: string, status: Tenant['status']): Promise<void>;
	/**
	 * テナントの Stripe 関連属性を **部分更新**する。
	 *
	 * フィールドごとの意味論 (#3982):
	 * - `undefined` (キー省略含む) = **その列を更新しない**。既存値を保持する。
	 *   `handleInvoicePaid` / `handleSubscriptionUpdated` が plan を解決できなかったとき、
	 *   既存 plan を壊さないためにこの意味論に依存している (#3960)。
	 * - `null` = **その列を NULL でクリアする**。`customer.subscription.deleted` で
	 *   subscription 参照 / plan / 期限を解消する用途 (null を渡せるのは nullable 列のみ)。
	 *   終端状態は `stripeSubscriptionId` / `plan` / `planExpiresAt` を**同時に** null で
	 *   クリアする (片方だけ残すと contract-state-matrix の X1 / X3 を作る、#4026)。
	 *
	 * 実装は「渡されたキーだけ SET 句を積む」方式であり、全フィールド `undefined`
	 * (= SET 句 0 件) の場合は UPDATE 自体を発行しない。
	 */
	updateTenantStripe(
		tenantId: string,
		data: {
			stripeCustomerId?: string;
			stripeSubscriptionId?: string | null;
			plan?: Tenant['plan'] | null;
			planExpiresAt?: string | null;
			trialUsedAt?: string;
			status?: Tenant['status'];
		},
	): Promise<void>;
	updateTenantOwner(tenantId: string, newOwnerId: string): Promise<void>;
	/**
	 * #1601 (ADR-0023 §5 I11): テナントの最終活動時刻 (lastActiveAt) を更新する。
	 *
	 * `hooks.server.ts` が認証成功ごとに呼ぶ可能性があるため、呼び出し側で
	 * 1 日 1 回のガード（前回値が当日と同じならスキップ）を行うこと。
	 * 本メソッド自体は冪等で副作用は ISO 文字列の上書きのみ。
	 */
	updateTenantLastActiveAt(tenantId: string, lastActiveAt: string): Promise<void>;
	deleteTenant(tenantId: string): Promise<void>;

	// --- Membership ---
	findMembership(userId: string, tenantId: string): Promise<Membership | undefined>;
	findUserTenants(userId: string): Promise<Membership[]>;
	findTenantMembers(tenantId: string): Promise<Membership[]>;
	createMembership(input: CreateMembershipInput): Promise<Membership>;
	deleteMembership(userId: string, tenantId: string): Promise<void>;

	// --- Invite (#3585: 管理操作は inviteId 鍵、受諾のみ raw inviteCode 鍵) ---
	createInvite(input: CreateInviteInput): Promise<Invite>;
	/** 受諾フロー専用: raw code (capability) から invite を引く。返る Invite の inviteCode は引数の raw。 */
	findInviteByCode(inviteCode: string): Promise<Invite | undefined>;
	/**
	 * 管理系の状態遷移 (revoke / expire / 旧経路 accept)。鍵は inviteId (#3585)。
	 * pending からの遷移のみ許可する状態機械 (#3588 ③): 失効済 / 受諾済 invite への
	 * 再遷移は no-op (乱用余地を塞ぐ)。
	 *
	 * tenant scope は query 層が `family_id = tenantId` 述語で強制する (deleteInvite と対称、
	 * ADR-0063 §3.4 単一強制点。RLS 非対応の代替防御線)。他 tenant の inviteId を渡しても
	 * 述語不一致で 0 行 = no-op となり cross-tenant mutation (他家族の status / accepted_by 書込)
	 * を物理排除する。呼び出し側の一覧束縛に依存しない (caller-discipline 非依存、#3588)。
	 */
	updateInviteStatus(
		inviteId: string,
		tenantId: string,
		status: Invite['status'],
		acceptedBy?: string,
	): Promise<void>;
	/**
	 * invite 受諾 = **単一 txn** (dsql-data-model.md §6.6、結線 #4039)。
	 *
	 * `UPDATE invites ... WHERE status='pending' AND expires_at > now RETURNING` と
	 * membership INSERT を 1 txn に閉じ、以下を厳密分岐する:
	 *   - rowCount = 0 → `INVALID_OR_EXPIRED` (業務失敗。retry 禁止)
	 *   - membership INSERT の 23505 → `ALREADY_IN_TENANT` (invite の accepted 化も rollback)
	 *   - 40001 (OCC) → backend の runner が txn 全体を再実行 (呼び出し側には現れない)
	 *
	 * `updateInviteStatus` + `createMembership` の 2 回呼びでは、片方だけ commit された
	 * 「membership はあるのに invite は pending のまま」という部分コミットが起きる。
	 * 受諾経路は必ず本メソッドを使うこと (updateInviteStatus は revoke / expire 用)。
	 *
	 * email 束縛 (§6.6 ⚠️) は txn 内でも再検証する (SSOT: `auth/invite-email-binding.ts`)。
	 * 招待の存在 / 自己招待 / 1 user 1 tenant / tenant active 判定は service 層の read 責務。
	 */
	acceptInviteTransactional(input: AcceptInviteTxnInput): Promise<AcceptInviteTxnResult>;
	/** 一覧。各 Invite の inviteId は管理鍵、inviteCode は空 (raw 非露出、#3585)。 */
	findTenantInvites(tenantId: string): Promise<Invite[]>;
	/** 物理削除。鍵は inviteId、tenant 束縛必須 (他 tenant の invite は消せない、#3585 / §P9)。 */
	deleteInvite(inviteId: string, tenantId: string): Promise<void>;

	// --- Consent (#0192) ---
	recordConsent(input: RecordConsentInput): Promise<ConsentRecord>;
	findLatestConsent(
		tenantId: string,
		type: ConsentRecord['type'],
	): Promise<ConsentRecord | undefined>;
	findAllConsents(tenantId: string): Promise<ConsentRecord[]>;
}
