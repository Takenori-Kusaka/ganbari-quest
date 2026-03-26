// src/lib/server/db/dynamodb/auth-repo.ts
// DynamoDB implementation of IAuthRepo (#0123: DeviceToken 廃止)

import { randomUUID } from 'node:crypto';
import { INVITE_EXPIRY_DAYS } from '$lib/domain/validation/auth';
import type { AuthUser, Invite, Membership, Tenant } from '$lib/server/auth/entities';
import type { Role } from '$lib/server/auth/types';
import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { IAuthRepo } from '../interfaces/auth-repo.interface';
import {
	INVITE_SK_PREFIX,
	MEMBER_SK_PREFIX,
	USER_TENANT_SK_PREFIX,
	inviteKey,
	tenantInviteKey,
	tenantKey,
	tenantMemberKey,
	tenantPartition,
	userEmailKey,
	userKey,
	userPartition,
	userTenantKey,
} from './auth-keys';
import { GSI, TABLE_NAME, getDocClient } from './client';

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
		status: 'active',
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
	const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
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
