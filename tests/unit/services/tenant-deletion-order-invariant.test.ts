// tests/unit/services/tenant-deletion-order-invariant.test.ts
// #4327 product-1: 物理削除の途中失敗が「宙吊り行」を作らないことの不変条件テスト。
//
// ## 何を守るか
//
// soft-delete 判定の SSOT は `settings` の `soft_deleted_at` / `physical_deletion_date`
// (`families` の列ではない)。一方で物理削除の対象列挙 `findExpiredSoftDeletedTenants` は
// `families` (= `auth.listAllTenants`) を歩いて 1 件ずつ `settings` を読む。
//
// したがって **判定材料 (`settings`) が `families` より先に消えると**、途中失敗した瞬間に
//
//   - `families` / `users` / `memberships` は残る
//   - 判定材料が無いので `findExpiredSoftDeletedTenants` は二度と拾わない (= 再削除されない)
//   - `soft_deleted_at` も無いので復元 UI からも戻せない (= 復元されない)
//
// という「誰にも観測されないまま残り続ける行」ができる。これは cron 自身が作る不可逆な
// データ破損であり、削除の実行順だけで構造的に封じられる (#4321 の sentinel-last と同じ発想:
// トランザクション境界を触らず、順序で不変条件を守る)。
//
// ## テストの立て方 (failing-test-first / ADR-0061)
//
// 「途中で失敗させる」を実際に起こす。`auth.deleteTenant` (families 行の削除) を投げさせ、
// **その後に判定材料が残っているか** を `findExpiredSoftDeletedTenants` の実挙動で確かめる。
// 修正前 (settings を step 2 で消していた実装) では expired が空になり本 test は落ちる。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- 共有 fake DB ---------------------------------------------------------

/** tenantId -> (settings key -> value) */
const settingsStore = new Map<string, Map<string, string>>();
/** 現存する families 行 */
let tenants: Array<{ tenantId: string; name: string }> = [];
/** repo への呼び出し順 (実行順の検証に使う) */
let opLog: string[] = [];
/** `auth.deleteTenant` を失敗させるか (途中失敗の再現) */
let deleteTenantFails = false;

function settingsOf(tenantId: string): Map<string, string> {
	let m = settingsStore.get(tenantId);
	if (!m) {
		m = new Map();
		settingsStore.set(tenantId, m);
	}
	return m;
}

const settingsRepo = {
	getSettings: async (keys: string[], tenantId: string) => {
		const m = settingsOf(tenantId);
		const out: Record<string, string | undefined> = {};
		for (const k of keys) out[k] = m.get(k);
		return out;
	},
	setSetting: async (key: string, value: string, tenantId: string) => {
		const m = settingsOf(tenantId);
		if (value === '') m.delete(key);
		else m.set(key, value);
	},
	deleteByTenantId: async (tenantId: string) => {
		opLog.push('settings.deleteByTenantId');
		settingsStore.delete(tenantId);
	},
	// #4338: 判定 3 キー以外を先に消す (機微キーを孤児に残さない)
	deleteByTenantIdExcept: async (tenantId: string, keepKeys: readonly string[]) => {
		opLog.push('settings.deleteByTenantIdExcept');
		const keep = new Set(keepKeys);
		const m = settingsOf(tenantId);
		for (const key of [...m.keys()]) if (!keep.has(key)) m.delete(key);
	},
};

const authRepo = {
	listAllTenants: async () => tenants,
	findTenantMembers: async () => [{ userId: 'owner-1', role: 'owner' }],
	findTenantInvites: async () => [],
	findUserById: async () => ({ userId: 'owner-1', email: 'owner@example.test' }),
	deleteMembership: async () => {
		opLog.push('auth.deleteMembership');
	},
	deleteUser: async () => {
		opLog.push('auth.deleteUser');
	},
	deleteTenant: async (tenantId: string) => {
		opLog.push('auth.deleteTenant');
		if (deleteTenantFails) throw new Error('DSQL 40001 serialization failure (simulated)');
		tenants = tenants.filter((t) => t.tenantId !== tenantId);
	},
};

/**
 * tenant-cleanup-service が触る repo は 20 本以上あり、いずれも「失敗しても warn で継続」。
 * 本 test の関心は settings / auth の**順序**だけなので、その他は no-op で埋める。
 * `find*` は配列を、それ以外は 0 を返す (呼び出し側が `deleted += await ...` するため)。
 */
const noopRepo = new Proxy(
	{},
	{
		get: (_t, prop: string) => async () => (prop.startsWith('find') ? [] : 0),
	},
);

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () =>
		new Proxy(
			{ settings: settingsRepo, auth: authRepo },
			{
				get: (target: Record<string, unknown>, prop: string) =>
					prop in target ? target[prop] : noopRepo,
			},
		),
}));

// --- 周辺依存 (本 test の関心外) ------------------------------------------

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), critical: vi.fn() },
}));
vi.mock('$lib/server/storage', () => ({ deleteByPrefix: vi.fn(async () => 0) }));
vi.mock('$lib/server/request-context', () => ({
	invalidateRequestCaches: vi.fn(),
	getRequestContext: () => null,
	buildPlanTierCacheKey: (...args: unknown[]) => args.join(':'),
}));
vi.mock('$lib/server/services/child-service', () => ({ deleteChildFiles: vi.fn(async () => {}) }));
vi.mock('$lib/server/services/stripe-service', () => ({
	cancelSubscription: vi.fn(async () => {}),
}));
vi.mock('$lib/server/services/email-service', () => ({
	sendMemberRemovedEmail: vi.fn(async () => {}),
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
	CognitoIdentityProviderClient: class {
		send = vi.fn(async () => ({}));
	},
	AdminDeleteUserCommand: class {},
}));
vi.mock('$lib/server/auth/factory', () => ({ getAuthMode: () => 'local' }));
vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn(async () => ({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
	})),
}));
vi.mock('$lib/runtime/env', () => ({ env: {} }));

import { deleteOwnerOnlyAccount } from '$lib/server/services/account-deletion-service';
import { findExpiredSoftDeletedTenants } from '$lib/server/services/grace-period-service';

const TENANT = 'tenant-4327';

/** 期限切れ soft-delete 済みテナントを 1 件用意する。 */
function seedExpiredTenant(): void {
	tenants = [{ tenantId: TENANT, name: 'テスト家族' }];
	const m = settingsOf(TENANT);
	const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	m.set('soft_deleted_at', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());
	m.set('deletion_grace_plan_tier', 'standard');
	m.set('physical_deletion_date', past);
}

beforeEach(() => {
	settingsStore.clear();
	opLog = [];
	deleteTenantFails = false;
	seedExpiredTenant();
});

describe('#4327 物理削除の実行順 — 判定材料は families 行より後に消す', () => {
	it('前提: 期限切れテナントは物理削除の対象として列挙される', async () => {
		const expired = await findExpiredSoftDeletedTenants();
		expect(expired.map((e) => e.tenantId)).toEqual([TENANT]);
	});

	it('途中 (families 行の削除) で失敗しても、判定材料が残り次回実行で再び対象になる', async () => {
		deleteTenantFails = true;

		await expect(
			deleteOwnerOnlyAccount(TENANT, 'owner-1', { route: 'grace-expiry', planTier: 'standard' }),
		).rejects.toThrow(/40001/);

		// families 行は残っている (削除に失敗したのだから当然)
		expect(tenants.map((t) => t.tenantId)).toEqual([TENANT]);

		// **ここが本丸**: 判定材料が消えていないので、次回 cron が同じテナントを拾える。
		// 修正前の実装 (settings を step 2 で削除) ではここが [] になり、
		// 「二度と消せず復元もできない行」が残っていた。
		const expired = await findExpiredSoftDeletedTenants();
		expect(expired.map((e) => e.tenantId)).toEqual([TENANT]);

		// 判定材料の実体も確認する (列挙結果だけだと将来 SSOT が変わったとき素通りするため)
		expect(settingsOf(TENANT).get('soft_deleted_at')).toBeTruthy();
		expect(settingsOf(TENANT).get('physical_deletion_date')).toBeTruthy();

		// settings 削除は 1 度も呼ばれていない
		expect(opLog).not.toContain('settings.deleteByTenantId');
	});

	it('正常系: 物理削除は従来どおり完遂し、settings も最終的に消える (回帰)', async () => {
		const result = await deleteOwnerOnlyAccount(TENANT, 'owner-1', {
			route: 'grace-expiry',
			planTier: 'standard',
		});

		expect(result.success).toBe(true);
		// families 行が消えている
		expect(tenants).toEqual([]);
		// 判定材料 (settings) も残さない — 孤児データを残さないこと
		expect(settingsStore.has(TENANT)).toBe(false);
		// 次回実行の母集団にも入らない
		await expect(findExpiredSoftDeletedTenants()).resolves.toEqual([]);
	});

	it('正常系: settings の削除は families 行の削除より後に実行される (順序そのものを固定)', async () => {
		await deleteOwnerOnlyAccount(TENANT, 'owner-1', {
			route: 'grace-expiry',
			planTier: 'standard',
		});

		const tenantIdx = opLog.indexOf('auth.deleteTenant');
		const settingsIdx = opLog.indexOf('settings.deleteByTenantId');
		expect(tenantIdx).toBeGreaterThanOrEqual(0);
		expect(settingsIdx).toBeGreaterThanOrEqual(0);
		expect(settingsIdx).toBeGreaterThan(tenantIdx);
	});
});
