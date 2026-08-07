// tests/unit/services/tenant-deletion-settings-orphan-4338.test.ts
//
// #4338: 退会の最終ステップ (families 行を消した**後**の settings 削除) が失敗したとき、
// 孤児として残る `settings` に **認証情報 (`pin_hash` / `session_token`) とアンケート回答が
// 含まれない**ことを固定する。
//
// #4340 は「判定材料を最後に消す」順序で観測も修復もできない宙吊り行を潰したが、代わりに
// 最終ステップ失敗時の孤児が残った。#4327 と同型の silent gap を作らずにこれを潰すため、
// 「消すキーを列挙する」のではなく **「残すキー (判定 3 キー) 以外を全部消す」** を採る。
// 向きが反転しているので、**新しい設定キーが増えても自動で消える**。
//
// ── Canon TDD test list ──
//   [O1] 最終ステップ失敗時の孤児に機微キーが残らない (= #4338 の再現 + 修正)
//   [O2] **本 test が知らない未知キー**も残らない (列挙方式との差。新キー追加で落ちない形)
//   [O3] 判定 3 キーは最終ステップ直前まで残る (#4321 sentinel-last / 自己回復の前提を壊さない)
//   [O4] 正常系では settings が 1 行も残らない (回帰)
//   [O5] 残すキーの SSOT が grace-period-service の判定キーと同一 (drift 不能)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- in-memory settings repo (fake) ---
// 本 test の主眼は「削除後に何が残るか」なので、settings だけは stub ではなく実体を持たせる。
const settingsStore = new Map<string, string>();
/** true のとき最終ステップ (deleteByTenantId) が失敗する = #4338 の孤児シナリオ */
let failFinalSettingsDelete = false;

const fakeSettingsRepo = {
	getSetting: vi.fn(async (key: string) => settingsStore.get(key)),
	setSetting: vi.fn(async (key: string, value: string) => {
		settingsStore.set(key, value);
	}),
	getSettings: vi.fn(async (keys: string[]) => {
		const map: Record<string, string> = {};
		for (const key of keys) {
			const value = settingsStore.get(key);
			if (value !== undefined) map[key] = value;
		}
		return map;
	}),
	deleteByTenantId: vi.fn(async () => {
		if (failFinalSettingsDelete) throw new Error('simulated DSQL failure at final step');
		settingsStore.clear();
	}),
	deleteByTenantIdExcept: vi.fn(async (_tenantId: string, keepKeys: readonly string[]) => {
		const keep = new Set(keepKeys);
		for (const key of [...settingsStore.keys()]) {
			if (!keep.has(key)) settingsStore.delete(key);
		}
	}),
};

const mockAuthRepo = {
	findTenantById: vi.fn().mockResolvedValue({ tenantId: 't-4338', name: 'テスト家族' }),
	findTenantMembers: vi.fn().mockResolvedValue([{ userId: 'u-owner', role: 'owner' }]),
	findUserById: vi.fn().mockResolvedValue({ userId: 'u-owner', email: 'owner@example.com' }),
	findTenantInvites: vi.fn().mockResolvedValue([]),
	deleteMembership: vi.fn(),
	deleteUser: vi.fn(),
	deleteTenant: vi.fn(),
	deleteInvite: vi.fn(),
};

const mockChildRepo = {
	findAllChildren: vi.fn().mockResolvedValue([]),
	findArchivedChildren: vi.fn().mockResolvedValue([]),
	deleteChild: vi.fn(),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: mockAuthRepo,
		child: mockChildRepo,
		settings: fakeSettingsRepo,
		// 他 repo は未定義のまま。deleteTenantScopedData は各ブロックを try/catch で
		// 独立させているため、未定義アクセスは warn ログになって処理が続く。
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/server/storage', () => ({
	deleteByPrefix: vi.fn().mockResolvedValue(0),
}));

vi.mock('$lib/server/services/child-service', () => ({
	deleteChildFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/stripe-service', () => ({
	cancelSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendMemberRemovedEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock('$lib/server/request-context', () => ({
	invalidateRequestCaches: vi.fn(),
}));

import { deleteOwnerOnlyAccount } from '$lib/server/services/account-deletion-service';
import {
	GRACE_PERIOD_JUDGMENT_KEYS,
	getGracePeriodStatus,
} from '$lib/server/services/grace-period-service';
import { deleteTenantScopedData } from '$lib/server/services/tenant-cleanup-service';

const TENANT = 't-4338';

/** 退会予約済みテナントの settings を再現する (判定材料 + 機微キー + 通常キー)。 */
function seedSettings(extra: Record<string, string> = {}): void {
	settingsStore.clear();
	settingsStore.set('soft_deleted_at', '2026-08-01T00:00:00.000Z');
	settingsStore.set('deletion_grace_plan_tier', 'standard');
	settingsStore.set('physical_deletion_date', '2026-08-08T00:00:00.000Z');
	// 孤児に残ると困るもの (#4338 の顧客影響そのもの)
	settingsStore.set('pin_hash', '$2b$10$dummyhash');
	settingsStore.set('session_token', 'sess-dummy-token');
	settingsStore.set('questionnaire_activity_level', 'high');
	settingsStore.set('questionnaire_challenges', 'なかなか続かない');
	settingsStore.set('deletion_warning_sent_at', '2026-08-07T00:00:00.000Z');
	for (const [key, value] of Object.entries(extra)) settingsStore.set(key, value);
}

describe('#4338 settings 孤児: 判定 3 キー以外を全部消す', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		failFinalSettingsDelete = false;
		mockAuthRepo.findTenantMembers.mockResolvedValue([{ userId: 'u-owner', role: 'owner' }]);
		mockChildRepo.findAllChildren.mockResolvedValue([]);
		mockChildRepo.findArchivedChildren.mockResolvedValue([]);
	});

	it('[O1] 最終ステップが失敗しても孤児に認証情報 / アンケート回答が残らない', async () => {
		seedSettings();
		failFinalSettingsDelete = true;

		await expect(
			deleteOwnerOnlyAccount(TENANT, 'u-owner', { route: 'grace-expiry', planTier: 'standard' }),
		).rejects.toThrow();

		// 孤児は残るが、そこに機微キーは無い
		expect(settingsStore.has('pin_hash')).toBe(false);
		expect(settingsStore.has('session_token')).toBe(false);
		expect(settingsStore.has('questionnaire_activity_level')).toBe(false);
		expect(settingsStore.has('questionnaire_challenges')).toBe(false);
		expect(settingsStore.has('deletion_warning_sent_at')).toBe(false);
	});

	it('[O2] 本 test が知らない未知キーも残らない (列挙方式との差)', async () => {
		// 「将来こういうキーが増える」を模したもの。実装が列挙方式なら、この key は
		// 列挙に載っていないので残ってしまう。反転方式なら自動で消える。
		seedSettings({
			some_future_feature_flag: 'on',
			another_unknown_key_2099: JSON.stringify({ secret: 'x' }),
			'child:903:habit_certificate_notice': '2026-08-01',
		});
		failFinalSettingsDelete = true;

		await expect(
			deleteOwnerOnlyAccount(TENANT, 'u-owner', { route: 'grace-expiry', planTier: 'standard' }),
		).rejects.toThrow();

		const remaining = [...settingsStore.keys()].sort();
		expect(remaining).toEqual([...GRACE_PERIOD_JUDGMENT_KEYS].sort());
	});

	it('[O3] 判定 3 キーは最終ステップ直前まで残る (自己回復 / sentinel-last の前提)', async () => {
		seedSettings();

		// full deletion 経路 (deferSettings) の途中状態を直接確かめる
		await deleteTenantScopedData(TENANT, { deferSettings: true });

		// 判定材料は残っている = 途中で失敗しても翌日の cron が同じテナントを再び拾える
		const status = await getGracePeriodStatus(TENANT);
		expect(status.isSoftDeleted).toBe(true);
		expect(status.metadataIncomplete).toBe(false);
		expect(status.physicalDeletionDate).toBe('2026-08-08T00:00:00.000Z');
		// 機微キーは既に無い
		expect(settingsStore.has('pin_hash')).toBe(false);
		expect(settingsStore.has('session_token')).toBe(false);
	});

	it('[O4] 正常系では settings が 1 行も残らない (回帰)', async () => {
		seedSettings({ some_future_feature_flag: 'on' });

		await deleteOwnerOnlyAccount(TENANT, 'u-owner', {
			route: 'grace-expiry',
			planTier: 'standard',
		});

		expect(settingsStore.size).toBe(0);
		expect(fakeSettingsRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
	});

	it('[O5] 残すキーの SSOT は grace-period-service の判定キーと同一 (drift 不能)', async () => {
		seedSettings();
		await deleteTenantScopedData(TENANT, { deferSettings: true });

		// 反転削除に渡された keep-list
		const keepArg = fakeSettingsRepo.deleteByTenantIdExcept.mock.calls[0]?.[1];
		expect(keepArg).toBeDefined();

		// getGracePeriodStatus が実際に読むキー (= 判定材料の定義そのもの)
		fakeSettingsRepo.getSettings.mockClear();
		await getGracePeriodStatus(TENANT);
		const readKeys = fakeSettingsRepo.getSettings.mock.calls[0]?.[0];

		// 「残すキー」と「判定に使うキー」が同じ集合であること。
		// 片方だけ増える (= 判定キーを足したのに削除で消してしまう) 状態を作れない。
		expect([...(keepArg ?? [])].sort()).toEqual([...(readKeys ?? [])].sort());
		expect([...(keepArg ?? [])].sort()).toEqual([...GRACE_PERIOD_JUDGMENT_KEYS].sort());
	});
});
