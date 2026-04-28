// src/lib/server/db/sqlite/auth-repo.ts
// SQLite stub for IAuthRepo — local mode does not use auth entities.
// All methods throw to catch accidental usage in local mode.

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { IAuthRepo } from '../interfaces/auth-repo.interface';

const NOT_SUPPORTED = 'Auth repo is not supported in local (SQLite) mode. Set AUTH_MODE=cognito.';

export const findUserByEmail: IAuthRepo['findUserByEmail'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findUserById: IAuthRepo['findUserById'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const createUser: IAuthRepo['createUser'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const deleteUser: IAuthRepo['deleteUser'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findTenantById: IAuthRepo['findTenantById'] = async () => {
	// local モード用ダミーテナント
	return {
		tenantId: 'local',
		name: 'ローカル家族',
		ownerId: 'local',
		status: SUBSCRIPTION_STATUS.ACTIVE,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
};
export const listAllTenants: IAuthRepo['listAllTenants'] = async () => {
	// local モードではダミーテナント1件を返す
	return [
		{
			tenantId: 'local',
			name: 'ローカル家族',
			ownerId: 'local',
			status: SUBSCRIPTION_STATUS.ACTIVE,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
	];
};
export const findTenantByStripeCustomerId: IAuthRepo['findTenantByStripeCustomerId'] = async () => {
	return undefined;
};
export const createTenant: IAuthRepo['createTenant'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const updateTenantStatus: IAuthRepo['updateTenantStatus'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const updateTenantStripe: IAuthRepo['updateTenantStripe'] = async () => {
	// no-op in local mode
};
export const updateTenantOwner: IAuthRepo['updateTenantOwner'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const updateTenantLastActiveAt: IAuthRepo['updateTenantLastActiveAt'] = async () => {
	// no-op in local mode (#1601: lastActiveAt は cognito モードでのみ追跡)
};
export const deleteTenant: IAuthRepo['deleteTenant'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findMembership: IAuthRepo['findMembership'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findUserTenants: IAuthRepo['findUserTenants'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findTenantMembers: IAuthRepo['findTenantMembers'] = async () => {
	return [];
};
export const createMembership: IAuthRepo['createMembership'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const deleteMembership: IAuthRepo['deleteMembership'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const createInvite: IAuthRepo['createInvite'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findInviteByCode: IAuthRepo['findInviteByCode'] = async () => {
	return undefined;
};
export const updateInviteStatus: IAuthRepo['updateInviteStatus'] = async () => {
	// no-op in local mode
};
export const findTenantInvites: IAuthRepo['findTenantInvites'] = async () => {
	return [];
};
export const deleteInvite: IAuthRepo['deleteInvite'] = async () => {
	// no-op in local mode (invites not supported)
};
export const recordConsent: IAuthRepo['recordConsent'] = async (input) => {
	return { ...input, consentedAt: new Date().toISOString() };
};
export const findLatestConsent: IAuthRepo['findLatestConsent'] = async () => {
	return undefined;
};
export const findAllConsents: IAuthRepo['findAllConsents'] = async () => {
	return [];
};
export const saveLicenseKey: IAuthRepo['saveLicenseKey'] = async () => {
	// no-op in local mode
};
export const findLicenseKey: IAuthRepo['findLicenseKey'] = async () => {
	return undefined;
};
export const updateLicenseKeyStatus: IAuthRepo['updateLicenseKeyStatus'] = async () => {
	// no-op in local mode
};
export const revokeLicenseKey: IAuthRepo['revokeLicenseKey'] = async () => {
	// no-op in local mode (#797)
};
export const listLicenseKeysByTenant: IAuthRepo['listLicenseKeysByTenant'] = async () => {
	return { items: [], cursor: null }; // no-op in local mode (#816)
};
export const listLicenseKeysByStatus: IAuthRepo['listLicenseKeysByStatus'] = async () => {
	return { items: [], cursor: null }; // no-op in local mode (#816)
};
export const listExpiringSoon: IAuthRepo['listExpiringSoon'] = async () => {
	return []; // no-op in local mode (#816)
};
export const countLicenseKeys: IAuthRepo['countLicenseKeys'] = async () => {
	return 0; // no-op in local mode (#816)
};
export const listActiveExpiredKeys: IAuthRepo['listActiveExpiredKeys'] = async () => {
	// no-op in local mode (#821)。local モードはライセンスキーを保存しないため常に空配列。
	return [];
};
