// src/lib/server/db/dynamodb/auth-repo.ts
// DynamoDB implementation of IAuthRepo (#0123: DeviceToken 廃止)

import { randomUUID } from 'node:crypto';
import type { AuthUser, Membership, Tenant } from '$lib/server/auth/entities';
import type { Role } from '$lib/server/auth/types';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { IAuthRepo } from '../interfaces/auth-repo.interface';
import {
	MEMBER_SK_PREFIX,
	USER_TENANT_SK_PREFIX,
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
