// src/lib/server/db/dynamodb/auth-repo.ts
// DynamoDB implementation of IAuthRepo (#0123: DeviceToken 廃止)

import { randomUUID } from 'node:crypto';
import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { LICENSE_KEY_STATUS } from '$lib/domain/constants/license-key-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { MS_PER_DAY } from '$lib/domain/constants/time';
import { INVITE_EXPIRY_DAYS } from '$lib/domain/validation/auth';
import type {
	AuthUser,
	ConsentRecord,
	Invite,
	Membership,
	Tenant,
} from '$lib/server/auth/entities';
import type { Role } from '$lib/server/auth/types';
import type { IAuthRepo } from '../interfaces/auth-repo.interface';
import {
	CONSENT_SK_PREFIX,
	INVITE_SK_PREFIX,
	inviteKey,
	licenseKey as licenseKeyFn,
	MEMBER_SK_PREFIX,
	tenantConsentKey,
	tenantInviteKey,
	tenantKey,
	tenantMemberKey,
	tenantPartition,
	USER_TENANT_SK_PREFIX,
	userEmailKey,
	userKey,
	userPartition,
	userTenantKey,
} from './auth-keys';
import { GSI, getDocClient, TABLE_NAME } from './client';

const doc = () => getDocClient();

// ============================================================
// User
// ============================================================

export const findUserByEmail: IAuthRepo['findUserByEmail'] = async (email) => {
	// GSI1 逆引き: SK=EMAIL#<email> → PK=USER#<userId>
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			IndexName: GSI.GSI1,
			KeyConditionExpression: 'SK = :sk',
			ExpressionAttributeValues: { ':sk': `EMAIL#${email}` },
			Limit: 1,
		}),
	);
	const item = result.Items?.[0];
	if (!item) return undefined;
	return itemToUser(item);
};

export const findUserById: IAuthRepo['findUserById'] = async (userId) => {
	const result = await doc().send(new GetCommand({ TableName: TABLE_NAME, Key: userKey(userId) }));
	if (!result.Item) return undefined;
	return itemToUser(result.Item);
};

export const createUser: IAuthRepo['createUser'] = async (input) => {
	const userId = `u-${randomUUID()}`;
	const now = new Date().toISOString();
	const user: AuthUser = {
		userId,
		email: input.email,
		provider: input.provider,
		displayName: input.displayName,
		createdAt: now,
		updatedAt: now,
	};

	// Profile item
	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...userKey(userId), ...user },
			ConditionExpression: 'attribute_not_exists(PK)',
		}),
	);

	// Email lookup item (for GSI1 reverse lookup)
	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...userEmailKey(userId, input.email), userId, email: input.email },
		}),
	);

	return user;
};

export const deleteUser: IAuthRepo['deleteUser'] = async (userId) => {
	// Look up user to get email for email-key deletion
	const user = await findUserById(userId);
	if (!user) return;

	// Delete email lookup item
	await doc().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: userEmailKey(userId, user.email),
		}),
	);

	// Delete user profile item
	await doc().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: userKey(userId),
		}),
	);
};

// ============================================================
// Tenant
// ============================================================

export const findTenantById: IAuthRepo['findTenantById'] = async (tenantId) => {
	const result = await doc().send(
		new GetCommand({ TableName: TABLE_NAME, Key: tenantKey(tenantId) }),
	);
	if (!result.Item) return undefined;
	return itemToTenant(result.Item);
};

export const createTenant: IAuthRepo['createTenant'] = async (input) => {
	const tenantId = `t-${randomUUID()}`;
	const now = new Date().toISOString();
	const tenant: Tenant = {
		tenantId,
		name: input.name,
		ownerId: input.ownerId,
		status: SUBSCRIPTION_STATUS.ACTIVE,
		licenseKey: input.licenseKey,
		createdAt: now,
		updatedAt: now,
	};

	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...tenantKey(tenantId), ...tenant },
			ConditionExpression: 'attribute_not_exists(PK)',
		}),
	);

	return tenant;
};

export const updateTenantStatus: IAuthRepo['updateTenantStatus'] = async (tenantId, status) => {
	const now = new Date().toISOString();
	const result = await doc().send(
		new GetCommand({ TableName: TABLE_NAME, Key: tenantKey(tenantId) }),
	);
	if (!result.Item) return;

	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...result.Item, status, updatedAt: now },
		}),
	);
};

export const listAllTenants: IAuthRepo['listAllTenants'] = async () => {
	const tenants: Tenant[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await doc().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
				ExpressionAttributeValues: { ':prefix': 'TENANT#', ':sk': 'META' },
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			tenants.push(itemToTenant(item as Record<string, unknown>));
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return tenants;
};

export const findTenantByStripeCustomerId: IAuthRepo['findTenantByStripeCustomerId'] = async (
	stripeCustomerId,
) => {
	// GSI1 逆引き: SK=STRIPE_CUS#<customerId>
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			IndexName: GSI.GSI1,
			KeyConditionExpression: 'SK = :sk',
			ExpressionAttributeValues: { ':sk': `STRIPE_CUS#${stripeCustomerId}` },
			Limit: 1,
		}),
	);
	const item = result.Items?.[0];
	if (!item) return undefined;
	// The item is a lookup record; fetch the actual tenant
	const tenantId = item.tenantId as string;
	return findTenantById(tenantId);
};

export const updateTenantStripe: IAuthRepo['updateTenantStripe'] = async (tenantId, data) => {
	const now = new Date().toISOString();
	const result = await doc().send(
		new GetCommand({ TableName: TABLE_NAME, Key: tenantKey(tenantId) }),
	);
	if (!result.Item) return;

	const oldCustomerId = result.Item.stripeCustomerId as string | undefined;
	const updated: Record<string, unknown> = { ...result.Item, ...data, updatedAt: now };
	// Remove undefined values
	for (const [k, v] of Object.entries(updated)) {
		if (v === undefined) delete updated[k];
	}

	await doc().send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));

	// Maintain GSI1 lookup for stripeCustomerId
	if (data.stripeCustomerId && data.stripeCustomerId !== oldCustomerId) {
		// Remove old lookup if exists
		if (oldCustomerId) {
			await doc().send(
				new DeleteCommand({
					TableName: TABLE_NAME,
					Key: {
						PK: tenantPartition(tenantId),
						SK: `STRIPE_CUS#${oldCustomerId}`,
					},
				}),
			);
		}
		// Create new lookup
		await doc().send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: {
					PK: tenantPartition(tenantId),
					SK: `STRIPE_CUS#${data.stripeCustomerId}`,
					tenantId,
				},
			}),
		);
	}
};

export const updateTenantOwner: IAuthRepo['updateTenantOwner'] = async (tenantId, newOwnerId) => {
	const now = new Date().toISOString();
	// Atomic update to prevent race condition (Get→Put full overwrite is unsafe)
	await doc().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: tenantKey(tenantId),
			UpdateExpression: 'SET ownerId = :ownerId, updatedAt = :updatedAt',
			ExpressionAttributeValues: {
				':ownerId': newOwnerId,
				':updatedAt': now,
			},
		}),
	);
};

/**
 * #1601 (ADR-0023 §5 I11): lastActiveAt を atomic に更新する。
 * hooks.server.ts が認証ごとに呼びうるホットパスのため、Get→Put ではなく
 * UpdateCommand で 1 件の RW で済ませる。存在しないテナントには書かない。
 */
export const updateTenantLastActiveAt: IAuthRepo['updateTenantLastActiveAt'] = async (
	tenantId,
	lastActiveAt,
) => {
	try {
		await doc().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: tenantKey(tenantId),
				UpdateExpression: 'SET lastActiveAt = :lastActiveAt, updatedAt = :updatedAt',
				ConditionExpression: 'attribute_exists(PK)',
				ExpressionAttributeValues: {
					':lastActiveAt': lastActiveAt,
					':updatedAt': lastActiveAt,
				},
			}),
		);
	} catch (err) {
		// ConditionalCheckFailedException = テナントが存在しない（demo / 削除済み）。
		// hooks の呼び出しはベストエフォートで黙って許容する。
		const name = (err as { name?: string }).name;
		if (name === 'ConditionalCheckFailedException') return;
		throw err;
	}
};

export const deleteTenant: IAuthRepo['deleteTenant'] = async (tenantId) => {
	// Read tenant first to get Stripe customer ID
	const tenant = await findTenantById(tenantId);

	// Delete Stripe customer lookup if it exists
	if (tenant?.stripeCustomerId) {
		await doc().send(
			new DeleteCommand({
				TableName: TABLE_NAME,
				Key: {
					PK: tenantPartition(tenantId),
					SK: `STRIPE_CUS#${tenant.stripeCustomerId}`,
				},
			}),
		);
	}

	// Delete tenant META item
	await doc().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: tenantKey(tenantId),
		}),
	);
};

// ============================================================
// Membership
// ============================================================

export const findMembership: IAuthRepo['findMembership'] = async (userId, tenantId) => {
	const result = await doc().send(
		new GetCommand({ TableName: TABLE_NAME, Key: tenantMemberKey(tenantId, userId) }),
	);
	if (!result.Item) return undefined;
	return itemToMembership(result.Item);
};

export const findUserTenants: IAuthRepo['findUserTenants'] = async (userId) => {
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': userPartition(userId),
				':prefix': USER_TENANT_SK_PREFIX,
			},
		}),
	);
	return (result.Items ?? []).map(itemToMembership);
};

export const findTenantMembers: IAuthRepo['findTenantMembers'] = async (tenantId) => {
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPartition(tenantId),
				':prefix': MEMBER_SK_PREFIX,
			},
		}),
	);
	return (result.Items ?? []).map(itemToMembership);
};

export const createMembership: IAuthRepo['createMembership'] = async (input) => {
	const now = new Date().toISOString();
	const membership: Membership = {
		userId: input.userId,
		tenantId: input.tenantId,
		role: input.role,
		joinedAt: now,
		invitedBy: input.invitedBy,
	};

	// Tenant 側の membership record
	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...tenantMemberKey(input.tenantId, input.userId), ...membership },
		}),
	);

	// User 側の tenant record（ユーザーのテナント一覧用）
	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...userTenantKey(input.userId, input.tenantId), ...membership },
		}),
	);

	return membership;
};

export const deleteMembership: IAuthRepo['deleteMembership'] = async (userId, tenantId) => {
	await doc().send(
		new DeleteCommand({ TableName: TABLE_NAME, Key: tenantMemberKey(tenantId, userId) }),
	);
	await doc().send(
		new DeleteCommand({ TableName: TABLE_NAME, Key: userTenantKey(userId, tenantId) }),
	);
};

// ============================================================
// Invite
// ============================================================

export const createInvite: IAuthRepo['createInvite'] = async (input) => {
	const inviteCode = `inv-${randomUUID()}`;
	const now = new Date();
	const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * MS_PER_DAY);
	const invite: Invite = {
		inviteCode,
		tenantId: input.tenantId,
		invitedBy: input.invitedBy,
		role: input.role,
		childId: input.childId,
		status: 'pending',
		createdAt: now.toISOString(),
		expiresAt: expiresAt.toISOString(),
	};

	// Primary invite item
	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...inviteKey(inviteCode), ...invite },
		}),
	);

	// Tenant adjacency item (for listing invites by tenant)
	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...tenantInviteKey(input.tenantId, inviteCode), ...invite },
		}),
	);

	return invite;
};

export const findInviteByCode: IAuthRepo['findInviteByCode'] = async (inviteCode) => {
	const result = await doc().send(
		new GetCommand({ TableName: TABLE_NAME, Key: inviteKey(inviteCode) }),
	);
	if (!result.Item) return undefined;
	return itemToInvite(result.Item);
};

export const updateInviteStatus: IAuthRepo['updateInviteStatus'] = async (
	inviteCode,
	status,
	acceptedBy,
) => {
	const now = new Date().toISOString();

	// Get current invite to find tenantId for adjacency update
	const current = await findInviteByCode(inviteCode);
	if (!current) return;

	const updates: string[] = ['#status = :status', '#updatedAt = :now'];
	const names: Record<string, string> = { '#status': 'status', '#updatedAt': 'updatedAt' };
	const values: Record<string, unknown> = { ':status': status, ':now': now };

	if (acceptedBy) {
		updates.push('acceptedBy = :acceptedBy', 'acceptedAt = :now');
		values[':acceptedBy'] = acceptedBy;
	}

	const allValues = { ...values, ':pending': 'pending' };

	// Update primary invite item (conditional on pending to prevent race)
	await doc().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: inviteKey(inviteCode),
			UpdateExpression: `SET ${updates.join(', ')}`,
			ConditionExpression: '#status = :pending',
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: allValues,
		}),
	);

	// Update tenant adjacency item
	await doc().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: tenantInviteKey(current.tenantId, inviteCode),
			UpdateExpression: `SET ${updates.join(', ')}`,
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: allValues,
		}),
	);
};

export const findTenantInvites: IAuthRepo['findTenantInvites'] = async (tenantId) => {
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPartition(tenantId),
				':prefix': INVITE_SK_PREFIX,
			},
		}),
	);
	return (result.Items ?? []).map(itemToInvite);
};

export const deleteInvite: IAuthRepo['deleteInvite'] = async (inviteCode, tenantId) => {
	// Delete primary invite item (INVITE#<code>)
	await doc().send(new DeleteCommand({ TableName: TABLE_NAME, Key: inviteKey(inviteCode) }));
	// Delete tenant adjacency item (TENANT#<tenantId>, INVITE#<code>)
	await doc().send(
		new DeleteCommand({ TableName: TABLE_NAME, Key: tenantInviteKey(tenantId, inviteCode) }),
	);
};

// ============================================================
// Item → Entity mappers
// ============================================================

function itemToUser(item: Record<string, unknown>): AuthUser {
	return {
		userId: item.userId as string,
		email: item.email as string,
		provider: item.provider as AuthUser['provider'],
		displayName: item.displayName as string | undefined,
		createdAt: item.createdAt as string,
		updatedAt: item.updatedAt as string,
	};
}

function itemToTenant(item: Record<string, unknown>): Tenant {
	return {
		tenantId: item.tenantId as string,
		name: item.name as string,
		ownerId: item.ownerId as string,
		status: item.status as Tenant['status'],
		licenseKey: item.licenseKey as string | undefined,
		plan: item.plan as Tenant['plan'],
		stripeCustomerId: item.stripeCustomerId as string | undefined,
		stripeSubscriptionId: item.stripeSubscriptionId as string | undefined,
		planExpiresAt: item.planExpiresAt as string | undefined,
		trialUsedAt: item.trialUsedAt as string | undefined,
		// #1601: 既存テナント (lastActiveAt 未保存) は undefined を返し、
		// 呼び出し側で createdAt にフォールバックする。
		lastActiveAt: item.lastActiveAt as string | undefined,
		createdAt: item.createdAt as string,
		updatedAt: item.updatedAt as string,
	};
}

function itemToMembership(item: Record<string, unknown>): Membership {
	return {
		userId: item.userId as string,
		tenantId: item.tenantId as string,
		role: item.role as Role,
		joinedAt: item.joinedAt as string,
		invitedBy: item.invitedBy as string | undefined,
	};
}

function itemToInvite(item: Record<string, unknown>): Invite {
	return {
		inviteCode: item.inviteCode as string,
		tenantId: item.tenantId as string,
		invitedBy: item.invitedBy as string,
		role: item.role as Role,
		childId: item.childId as number | undefined,
		status: item.status as Invite['status'],
		createdAt: item.createdAt as string,
		expiresAt: item.expiresAt as string,
		acceptedBy: item.acceptedBy as string | undefined,
		acceptedAt: item.acceptedAt as string | undefined,
	};
}

function itemToConsent(item: Record<string, unknown>): ConsentRecord {
	return {
		tenantId: item.tenantId as string,
		userId: item.userId as string,
		type: item.type as ConsentRecord['type'],
		version: item.version as string,
		consentedAt: item.consentedAt as string,
		ipAddress: item.ipAddress as string,
		userAgent: item.userAgent as string,
	};
}

// ============================================================
// Consent (#0192)
// ============================================================

export const recordConsent: IAuthRepo['recordConsent'] = async (input) => {
	const now = new Date().toISOString();
	const record: ConsentRecord = {
		tenantId: input.tenantId,
		userId: input.userId,
		type: input.type,
		version: input.version,
		consentedAt: now,
		ipAddress: input.ipAddress,
		userAgent: input.userAgent,
	};

	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...tenantConsentKey(input.tenantId, input.type, input.version),
				...record,
			},
		}),
	);

	return record;
};

export const findLatestConsent: IAuthRepo['findLatestConsent'] = async (tenantId, type) => {
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPartition(tenantId),
				':prefix': `${CONSENT_SK_PREFIX}${type}#`,
			},
			ScanIndexForward: false,
			Limit: 1,
		}),
	);
	if (!result.Items || result.Items.length === 0) return undefined;
	return itemToConsent(result.Items[0] as Record<string, unknown>);
};

export const findAllConsents: IAuthRepo['findAllConsents'] = async (tenantId) => {
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPartition(tenantId),
				':prefix': CONSENT_SK_PREFIX,
			},
		}),
	);
	return (result.Items ?? []).map((item) => itemToConsent(item as Record<string, unknown>));
};

// ============================================================
// License Key (#0247)
// ============================================================

import type { LicenseRecord } from '$lib/server/services/license-key-service';

export const saveLicenseKey: IAuthRepo['saveLicenseKey'] = async (record) => {
	const keys = licenseKeyFn(record.licenseKey);
	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...keys,
				// #816: GSI2 でテナント別一覧を引けるようにする
				GSI2PK: `TENANT#${record.tenantId}`,
				GSI2SK: `LICENSE#${record.createdAt}`,
				tenantId: record.tenantId,
				plan: record.plan,
				stripeSessionId: record.stripeSessionId,
				status: record.status,
				createdAt: record.createdAt,
				// #801: kind / issuedBy を永続化。undefined のフィールドは DynamoDB に保存しない
				...(record.kind ? { kind: record.kind } : {}),
				...(record.issuedBy ? { issuedBy: record.issuedBy } : {}),
				// #797: expiresAt / revokedAt / revokedReason / revokedBy を永続化
				...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
				...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
				...(record.revokedReason ? { revokedReason: record.revokedReason } : {}),
				...(record.revokedBy ? { revokedBy: record.revokedBy } : {}),
			},
		}),
	);
};

export const findLicenseKey: IAuthRepo['findLicenseKey'] = async (key) => {
	const keys = licenseKeyFn(key);
	const result = await doc().send(new GetCommand({ TableName: TABLE_NAME, Key: keys }));
	if (!result.Item) return undefined;
	const item = result.Item as Record<string, unknown>;
	return {
		licenseKey: key,
		tenantId: item.tenantId as string,
		plan: item.plan as LicenseRecord['plan'],
		stripeSessionId: item.stripeSessionId as string | undefined,
		status: item.status as LicenseRecord['status'],
		consumedBy: item.consumedBy as string | undefined,
		consumedAt: item.consumedAt as string | undefined,
		createdAt: item.createdAt as string,
		// #801: 旧レコードには kind/issuedBy が存在しない。undefined で返し、
		// サービス層の getRecordKind() で 'purchase' デフォルトに解決する。
		kind: item.kind as LicenseRecord['kind'],
		issuedBy: item.issuedBy as string | undefined,
		// #797: 旧レコードには expiresAt/revokedAt 等が存在しない。undefined で返す。
		expiresAt: item.expiresAt as string | undefined,
		revokedAt: item.revokedAt as string | undefined,
		revokedReason: item.revokedReason as LicenseRecord['revokedReason'],
		revokedBy: item.revokedBy as string | undefined,
	};
};

export const updateLicenseKeyStatus: IAuthRepo['updateLicenseKeyStatus'] = async (
	key,
	status,
	consumedBy,
) => {
	const keys = licenseKeyFn(key);
	const now = new Date().toISOString();
	await doc().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: keys,
			UpdateExpression: consumedBy
				? 'SET #status = :status, consumedBy = :consumedBy, consumedAt = :consumedAt'
				: 'SET #status = :status',
			ExpressionAttributeNames: { '#status': 'status' },
			ExpressionAttributeValues: {
				':status': status,
				...(consumedBy ? { ':consumedBy': consumedBy, ':consumedAt': now } : {}),
			},
		}),
	);
};

// #797: revoke 専用のアトミック更新。status + revokedAt + revokedReason + revokedBy を
// 1 UpdateItem で書き込むことで、status だけ更新されて理由が欠落する事故を防ぐ。
export const revokeLicenseKey: IAuthRepo['revokeLicenseKey'] = async (params) => {
	const keys = licenseKeyFn(params.licenseKey);
	await doc().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: keys,
			UpdateExpression:
				'SET #status = :status, revokedAt = :revokedAt, revokedReason = :revokedReason, revokedBy = :revokedBy',
			ExpressionAttributeNames: { '#status': 'status' },
			ExpressionAttributeValues: {
				':status': 'revoked',
				':revokedAt': params.revokedAt,
				':revokedReason': params.reason,
				':revokedBy': params.revokedBy,
			},
		}),
	);
};

// ============================================================
// License Key Search (#816)
// ============================================================

const DEFAULT_PAGE_SIZE = 50;

/** カーソルを Base64 エンコードされた DynamoDB ExclusiveStartKey として扱う */
function decodeCursor(cursor: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new TypeError('Cursor must decode to a non-null object');
		}
		return parsed as Record<string, unknown>;
	} catch {
		throw new Error('Invalid pagination cursor');
	}
}

function encodeCursor(lastKey: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(lastKey), 'utf-8').toString('base64url');
}

function itemToLicenseRecord(item: Record<string, unknown>): LicenseRecord {
	return {
		licenseKey: (item.PK as string).replace('LICENSE#', ''),
		tenantId: item.tenantId as string,
		plan: item.plan as LicenseRecord['plan'],
		stripeSessionId: item.stripeSessionId as string | undefined,
		status: item.status as LicenseRecord['status'],
		consumedBy: item.consumedBy as string | undefined,
		consumedAt: item.consumedAt as string | undefined,
		createdAt: item.createdAt as string,
		kind: item.kind as LicenseRecord['kind'],
		issuedBy: item.issuedBy as string | undefined,
		expiresAt: item.expiresAt as string | undefined,
		revokedAt: item.revokedAt as string | undefined,
		revokedReason: item.revokedReason as LicenseRecord['revokedReason'],
		revokedBy: item.revokedBy as string | undefined,
	};
}

export const listLicenseKeysByTenant: IAuthRepo['listLicenseKeysByTenant'] = async (
	tenantId,
	limit = DEFAULT_PAGE_SIZE,
	cursor,
) => {
	const result = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			IndexName: GSI.GSI2,
			KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': `TENANT#${tenantId}`,
				':prefix': 'LICENSE#',
			},
			ScanIndexForward: false, // 直近発行順
			Limit: limit,
			...(cursor ? { ExclusiveStartKey: decodeCursor(cursor) } : {}),
		}),
	);

	const items = (result.Items ?? []).map((item) =>
		itemToLicenseRecord(item as Record<string, unknown>),
	);

	return {
		items,
		cursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null,
	};
};

export const listLicenseKeysByStatus: IAuthRepo['listLicenseKeysByStatus'] = async (
	status,
	limit = DEFAULT_PAGE_SIZE,
	cursor,
) => {
	// DynamoDB の LICENSE# パーティションは status でインデックスされていないため、
	// Scan + FilterExpression を使用。Pre-PMF 段階ではキー数が限定的。
	// 本番スケール時は GSI 追加を検討（ADR-0034 準拠で過剰設計を避ける）。
	const items: LicenseRecord[] = [];
	let lastKey = cursor ? decodeCursor(cursor) : undefined;
	let scannedCount = 0;

	// Scan は FilterExpression 適用前の Limit なので、十分な件数が集まるまでループする
	while (items.length < limit) {
		const result = await doc().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(PK, :prefix) AND #status = :status',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: {
					':prefix': 'LICENSE#',
					':status': status,
				},
				ExclusiveStartKey: lastKey,
				// 多めにスキャンしてフィルタで絞る
				Limit: Math.max(limit * 3, 100),
			}),
		);

		for (const item of result.Items ?? []) {
			if (items.length >= limit) break;
			items.push(itemToLicenseRecord(item as Record<string, unknown>));
		}

		lastKey = result.LastEvaluatedKey;
		scannedCount++;

		// テーブル末尾到達 or 安全弁（最大 10 ラウンド）
		if (!lastKey || scannedCount >= 10) break;
	}

	return {
		items,
		cursor: lastKey ? encodeCursor(lastKey) : null,
	};
};

export const listExpiringSoon: IAuthRepo['listExpiringSoon'] = async (days) => {
	const now = new Date();
	const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
	const nowIso = now.toISOString();
	const thresholdIso = threshold.toISOString();

	const items: LicenseRecord[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await doc().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :prefix) AND #status = :active AND expiresAt BETWEEN :now AND :threshold',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: {
					':prefix': 'LICENSE#',
					':active': LICENSE_KEY_STATUS.ACTIVE,
					':now': nowIso,
					':threshold': thresholdIso,
				},
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push(itemToLicenseRecord(item as Record<string, unknown>));
		}

		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return items;
};

export const countLicenseKeys: IAuthRepo['countLicenseKeys'] = async (filter) => {
	let count = 0;
	let lastKey: Record<string, unknown> | undefined;

	// テナント指定がある場合は GSI2 Query を使用
	if (filter?.tenantId) {
		do {
			const result = await doc().send(
				new QueryCommand({
					TableName: TABLE_NAME,
					IndexName: GSI.GSI2,
					KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
					ExpressionAttributeValues: {
						':pk': `TENANT#${filter.tenantId}`,
						':prefix': 'LICENSE#',
						...(filter.status ? { ':status': filter.status } : {}),
					},
					...(filter.status
						? {
								FilterExpression: '#status = :status',
								ExpressionAttributeNames: { '#status': 'status' },
							}
						: {}),
					Select: 'COUNT',
					ExclusiveStartKey: lastKey,
				}),
			);
			count += result.Count ?? 0;
			lastKey = result.LastEvaluatedKey;
		} while (lastKey);

		return count;
	}

	// テナント指定なし: Scan
	do {
		const hasStatusFilter = !!filter?.status;

		const result = await doc().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: hasStatusFilter
					? 'begins_with(PK, :prefix) AND #status = :status'
					: 'begins_with(PK, :prefix)',
				...(hasStatusFilter ? { ExpressionAttributeNames: { '#status': 'status' } } : {}),
				ExpressionAttributeValues: {
					':prefix': 'LICENSE#',
					...(hasStatusFilter ? { ':status': filter.status } : {}),
				},
				Select: 'COUNT',
				ExclusiveStartKey: lastKey,
			}),
		);
		count += result.Count ?? 0;
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return count;
};

// #821: 期限切れキー列挙。日次バッチで対象抽出に使う。
// LICENSE# パーティションを Scan + FilterExpression で絞り込む。件数は通常数十件/日で、
// 全ライセンスキー数も数千オーダー想定なので Scan コストは許容範囲。将来高頻度化するなら
// status + expiresAt を GSI に切る選択肢もあるが、現時点では過剰設計。
export const listActiveExpiredKeys: IAuthRepo['listActiveExpiredKeys'] = async (now) => {
	const results: LicenseRecord[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const resp = await doc().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :licensePrefix) AND SK = :sk AND #status = :active AND attribute_exists(expiresAt) AND expiresAt <= :now',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: {
					':licensePrefix': 'LICENSE#',
					':sk': 'META',
					':active': 'active',
					':now': now,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of resp.Items ?? []) {
			const it = item as Record<string, unknown>;
			const pk = it.PK as string;
			const licenseKeyValue = pk.startsWith('LICENSE#') ? pk.slice('LICENSE#'.length) : pk;
			results.push({
				licenseKey: licenseKeyValue,
				tenantId: it.tenantId as string,
				plan: it.plan as LicenseRecord['plan'],
				stripeSessionId: it.stripeSessionId as string | undefined,
				status: it.status as LicenseRecord['status'],
				consumedBy: it.consumedBy as string | undefined,
				consumedAt: it.consumedAt as string | undefined,
				createdAt: it.createdAt as string,
				kind: it.kind as LicenseRecord['kind'],
				issuedBy: it.issuedBy as string | undefined,
				expiresAt: it.expiresAt as string | undefined,
				revokedAt: it.revokedAt as string | undefined,
				revokedReason: it.revokedReason as LicenseRecord['revokedReason'],
				revokedBy: it.revokedBy as string | undefined,
			});
		}
		lastKey = resp.LastEvaluatedKey;
	} while (lastKey);
	return results;
};
