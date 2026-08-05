// src/lib/server/db/sqlite/auth-repo.ts
// SQLite stub for IAuthRepo — local mode does not use auth entities.
// All methods throw to catch accidental usage in local mode.

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import type { IAuthRepo } from '../interfaces/auth-repo.interface';
import { getSetting, setSetting } from './settings-repo';

const NOT_SUPPORTED = 'Auth repo is not supported in local (SQLite) mode. Set AUTH_MODE=cognito.';

const LOCAL_TENANT_ID = 'local';

/**
 * ローカルモードのダミーテナントの契約 4 列を保持する settings key (#4156)。
 *
 * 以前は `findTenantById` が `status: active` / stripe 列なしの固定値を返し、
 * `updateTenantStripe` は黙って no-op だった。そのためローカル (E2E 含む) では
 * **契約状態が 1 つしか存在せず**、解約済み・支払い停止といった状態の画面を
 * 一度も動かせなかった (`/admin/subscription` の分岐の大半が未検証のまま残っていた)。
 *
 * cognito モードの `families` 4 列 (contract-state-matrix.md §3) と同じ形を settings に置き、
 * 書き込みも読み出しも実際に効くようにする。cognito / DSQL 側の実装には影響しない。
 */
const LOCAL_TENANT_CONTRACT_KEY = 'local_tenant_contract';

type LocalTenantContract = Pick<
	Tenant,
	'status' | 'plan' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'planExpiresAt' | 'trialUsedAt'
>;

async function readLocalContract(): Promise<LocalTenantContract> {
	const raw = await getSetting(LOCAL_TENANT_CONTRACT_KEY, LOCAL_TENANT_ID);
	if (!raw) return { status: SUBSCRIPTION_STATUS.ACTIVE };
	try {
		const parsed = JSON.parse(raw) as Partial<LocalTenantContract>;
		return { status: SUBSCRIPTION_STATUS.ACTIVE, ...parsed };
	} catch {
		// 壊れた値で全 admin 画面を 500 にしない。既定 (未課金) に落とす。
		return { status: SUBSCRIPTION_STATUS.ACTIVE };
	}
}

async function buildLocalTenant(): Promise<Tenant> {
	const contract = await readLocalContract();
	const now = new Date().toISOString();
	return {
		tenantId: LOCAL_TENANT_ID,
		name: 'ローカル家族',
		ownerId: LOCAL_TENANT_ID,
		createdAt: now,
		updatedAt: now,
		...contract,
	};
}

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
	// local モード用ダミーテナント (契約 4 列は settings 永続、#4156)
	return await buildLocalTenant();
};
export const listAllTenants: IAuthRepo['listAllTenants'] = async () => {
	// local モードではダミーテナント1件を返す
	return [await buildLocalTenant()];
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
export const updateTenantStripe: IAuthRepo['updateTenantStripe'] = async (_tenantId, patch) => {
	// #4156: 以前は no-op で、書いたはずの契約状態が次の read で消えていた
	// (「書けたのに反映されない」= silent failure)。settings に永続する。
	const current = await readLocalContract();
	const next: LocalTenantContract = { ...current };
	for (const [key, value] of Object.entries(patch) as [keyof LocalTenantContract, unknown][]) {
		if (value === undefined) continue; // undefined = 変更しない (null = 明示クリア)
		// biome-ignore lint/suspicious/noExplicitAny: 4 列の union を 1 ループで書き戻すため
		(next as any)[key] = value === null ? undefined : value;
	}
	await setSetting(LOCAL_TENANT_CONTRACT_KEY, JSON.stringify(next), LOCAL_TENANT_ID);
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
// #4039: 受諾は単一 txn の acceptInviteTransactional に一本化した。local (SQLite) モードは
// invite 自体が未対応 (createInvite / findMembership も NOT_SUPPORTED) のため同じ扱いにする。
// findInviteByCode が undefined を返すので service 層はここへ到達しない (defense-in-depth)。
export const acceptInviteTransactional: IAuthRepo['acceptInviteTransactional'] = async () => {
	throw new Error(NOT_SUPPORTED);
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
// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract。local (SQLite) モードは元々
// licenseKey 列を持たず method 群は no-op stub だったため、IAuthRepo から license key API を撤去した
// のに合わせて本 stub 群も削除。SQLite の DROP COLUMN migration は不要 (列が初めから存在しない)。
