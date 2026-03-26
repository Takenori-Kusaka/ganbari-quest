// src/lib/server/db/sqlite/auth-repo.ts
// SQLite stub for IAuthRepo — local mode does not use auth entities.
// All methods throw to catch accidental usage in local mode.

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
export const findTenantById: IAuthRepo['findTenantById'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const createTenant: IAuthRepo['createTenant'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const updateTenantStatus: IAuthRepo['updateTenantStatus'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findMembership: IAuthRepo['findMembership'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findUserTenants: IAuthRepo['findUserTenants'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findTenantMembers: IAuthRepo['findTenantMembers'] = async () => {
	throw new Error(NOT_SUPPORTED);
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
	throw new Error(NOT_SUPPORTED);
};
export const updateInviteStatus: IAuthRepo['updateInviteStatus'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
export const findTenantInvites: IAuthRepo['findTenantInvites'] = async () => {
	throw new Error(NOT_SUPPORTED);
};
