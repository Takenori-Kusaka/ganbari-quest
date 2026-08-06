// tests/unit/services/grace-period-service.test.ts
// #742: グレースピリオドサービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks ---

const settingsStore = new Map<string, string>();
const mockGetSettings = vi.fn(async (keys: string[], _tenantId: string) => {
	const result: Record<string, string | undefined> = {};
	for (const key of keys) {
		result[key] = settingsStore.get(key);
	}
	return result;
});
const mockSetSetting = vi.fn(async (key: string, value: string, _tenantId: string) => {
	settingsStore.set(key, value);
});
const mockListAllTenants = vi.fn().mockResolvedValue([]);
const mockUpdateTenantStripe = vi.fn();
const mockFindTenantMembers = vi.fn().mockResolvedValue([{ userId: 'owner-1', role: 'owner' }]);

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		settings: {
			getSettings: mockGetSettings,
			setSetting: mockSetSetting,
		},
		auth: {
			listAllTenants: mockListAllTenants,
			updateTenantStripe: mockUpdateTenantStripe,
			findTenantMembers: mockFindTenantMembers,
		},
	}),
}));

// #3695: purge の実削除経路 (dynamic import) を spy 化して self-limiting を検証する
const mockDeleteOwnerOnlyAccount = vi.fn().mockResolvedValue(undefined);
const mockDeleteOwnerFullDelete = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/services/account-deletion-service', () => ({
	deleteOwnerOnlyAccount: mockDeleteOwnerOnlyAccount,
	deleteOwnerFullDelete: mockDeleteOwnerFullDelete,
}));

// #4327: kill-switch env を test から切り替えるための可変 stub
const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn().mockResolvedValue({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
	}),
}));

vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => null,
	buildPlanTierCacheKey: (...args: unknown[]) => args.join(':'),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { logger } from '$lib/server/logger';
import {
	DELETION_GRACE_PERIOD_DAYS,
	DELETION_WARNING_SENT_KEY,
	findExpiredSoftDeletedTenants,
	getGracePeriodDays,
	getGracePeriodStatus,
	purgeExpiredSoftDeletedTenants,
	restoreSoftDeletedTenant,
	softDeleteTenant,
} from '$lib/server/services/grace-period-service';

describe('grace-period-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		settingsStore.clear();
		// #4327: kill-switch env は test 間で持ち越さない (既定 = 有効)
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ============================================================
	// Constants
	// ============================================================

	describe('DELETION_GRACE_PERIOD_DAYS', () => {
		it('free は 0 日', () => {
			expect(DELETION_GRACE_PERIOD_DAYS.free).toBe(0);
		});

		it('standard は 7 日', () => {
			expect(DELETION_GRACE_PERIOD_DAYS.standard).toBe(7);
		});

		it('family は 30 日', () => {
			expect(DELETION_GRACE_PERIOD_DAYS.family).toBe(30);
		});
	});

	describe('getGracePeriodDays', () => {
		it('プランティアに対応した日数を返す', () => {
			expect(getGracePeriodDays('free')).toBe(0);
			expect(getGracePeriodDays('standard')).toBe(7);
			expect(getGracePeriodDays('family')).toBe(30);
		});
	});

	// ============================================================
	// softDeleteTenant
	// ============================================================

	describe('softDeleteTenant', () => {
		it('free プランは即時削除フラグを返す', async () => {
			// licenseStatus=none で resolveFullPlanTier が 'free' を返す
			const result = await softDeleteTenant('tenant-1', 'none');

			expect(result.success).toBe(true);
			expect(result.gracePeriodDays).toBe(0);
			expect(result.requiresImmediateDeletion).toBe(true);
		});

		it('standard プラン (active) は 7 日のグレースピリオドを設定する', async () => {
			// active + planId なし → standard 扱い
			const result = await softDeleteTenant('tenant-1', 'active', 'monthly');

			expect(result.success).toBe(true);
			expect(result.gracePeriodDays).toBe(7);
			expect(result.requiresImmediateDeletion).toBe(false);

			// settings にグレースピリオド情報が保存される
			expect(mockSetSetting).toHaveBeenCalledWith(
				'soft_deleted_at',
				expect.any(String),
				'tenant-1',
			);
			expect(mockSetSetting).toHaveBeenCalledWith(
				'deletion_grace_plan_tier',
				'standard',
				'tenant-1',
			);
		});

		it('family プランは 30 日のグレースピリオドを設定する', async () => {
			const result = await softDeleteTenant('tenant-1', 'active', 'family-monthly');

			expect(result.success).toBe(true);
			expect(result.gracePeriodDays).toBe(30);
			expect(result.requiresImmediateDeletion).toBe(false);
		});

		// #4316: sentinel-last 書き込み順序
		// setSetting は非原子 (settings repo に txn は無く、setSetting は 1 キー 1 文の
		// upsert)。`soft_deleted_at` は soft-delete 状態を起動する sentinel なので **最後に**
		// 書く。途中で失敗しても「soft-delete が始まっていない」状態にしかならず、
		// 「ロックはかかるが物理削除の母集団に入らない」宙吊りが成立しない。
		//
		// #2399: 予告メール送信済フラグのリセットも sentinel より前に置く。ここで失敗しても
		// sentinel が立たない = 「送信済フラグが残ったまま猶予期間に入り予告なしで消える」が
		// 成立しない。
		it('#4316: sentinel である soft_deleted_at を最後に書く (途中失敗で宙吊りを作らない)', async () => {
			await softDeleteTenant('tenant-1', 'active', 'family-monthly');

			const writtenKeys = mockSetSetting.mock.calls.map((call) => call[0]);
			expect(writtenKeys).toEqual([
				'physical_deletion_date',
				'deletion_grace_plan_tier',
				'deletion_warning_sent_at',
				'soft_deleted_at',
			]);
			// sentinel は常に最後 (キーが増えても本不変条件は保たれる)
			expect(writtenKeys.at(-1)).toBe('soft_deleted_at');
		});
	});

	// ============================================================
	// getGracePeriodStatus
	// ============================================================

	describe('getGracePeriodStatus', () => {
		it('ソフトデリートされていない場合は未削除状態を返す', async () => {
			const result = await getGracePeriodStatus('tenant-1');

			expect(result.isSoftDeleted).toBe(false);
			expect(result.daysRemaining).toBe(0);
		});

		it('ソフトデリート中でグレースピリオド内の場合', async () => {
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 10);

			settingsStore.set('soft_deleted_at', new Date().toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', futureDate.toISOString());

			const result = await getGracePeriodStatus('tenant-1');

			expect(result.isSoftDeleted).toBe(true);
			expect(result.isExpired).toBe(false);
			expect(result.daysRemaining).toBeGreaterThan(0);
			expect(result.planTier).toBe('family');
		});

		it('グレースピリオドが期限切れの場合', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);

			settingsStore.set('soft_deleted_at', new Date(Date.now() - 35 * 86400000).toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', pastDate.toISOString());

			const result = await getGracePeriodStatus('tenant-1');

			expect(result.isSoftDeleted).toBe(true);
			expect(result.isExpired).toBe(true);
			expect(result.daysRemaining).toBe(0);
		});
	});

	// ============================================================
	// restoreSoftDeletedTenant
	// ============================================================

	describe('restoreSoftDeletedTenant', () => {
		it('グレースピリオド内なら復元できる', async () => {
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 10);

			settingsStore.set('soft_deleted_at', new Date().toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', futureDate.toISOString());

			const result = await restoreSoftDeletedTenant('tenant-1');

			expect(result.success).toBe(true);
			// settings がクリアされている
			expect(mockSetSetting).toHaveBeenCalledWith('soft_deleted_at', '', 'tenant-1');
		});

		// #2399: クリア漏れは「2 回目の予約が予告なしで消える」silent regression になる
		it('復元時に削除予告メールの送信済フラグもクリアする', async () => {
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 10);

			settingsStore.set('soft_deleted_at', new Date().toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', futureDate.toISOString());
			settingsStore.set(DELETION_WARNING_SENT_KEY, new Date().toISOString());

			await restoreSoftDeletedTenant('tenant-1');

			expect(settingsStore.get(DELETION_WARNING_SENT_KEY)).toBe('');
		});

		it('ソフトデリートされていない場合は失敗する', async () => {
			const result = await restoreSoftDeletedTenant('tenant-1');

			expect(result.success).toBe(false);
		});

		it('グレースピリオド期限切れの場合は失敗する', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);

			settingsStore.set('soft_deleted_at', new Date(Date.now() - 35 * 86400000).toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', pastDate.toISOString());

			const result = await restoreSoftDeletedTenant('tenant-1');

			expect(result.success).toBe(false);
		});
	});

	// ============================================================
	// #4316: physical_deletion_date 欠落時の宙吊り
	//
	// 欠落を「期限切れ」に倒すと、復元は恒久拒否される一方 (isExpired 恒真) で
	// 物理削除の母集団にも入らない (`&& status.physicalDeletionDate`) ため、
	// 「復元できないが物理削除もされない」状態から抜ける経路が 1 本も無くなる。
	// 安全側 = データを消さない側 = 復元を許す側に倒す。
	// ============================================================

	describe('#4316: physical_deletion_date 欠落 (soft_deleted_at のみ立った部分書き込み)', () => {
		/** soft_deleted_at と plan tier だけが書かれた宙吊り行を作る */
		function seedLimboTenant(physicalDeletionDate?: string) {
			settingsStore.set('soft_deleted_at', new Date(Date.now() - 86400000).toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			if (physicalDeletionDate !== undefined) {
				settingsStore.set('physical_deletion_date', physicalDeletionDate);
			}
		}

		it('欠落している行を期限切れ扱いにしない', async () => {
			seedLimboTenant();

			const result = await getGracePeriodStatus('tenant-limbo');

			expect(result.isSoftDeleted).toBe(true);
			expect(result.isExpired).toBe(false);
			expect(result.metadataIncomplete).toBe(true);
			expect(result.physicalDeletionDate).toBeNull();
		});

		it('空文字 / パース不能な値も欠落として扱う', async () => {
			seedLimboTenant('not-a-date');

			const result = await getGracePeriodStatus('tenant-limbo');

			expect(result.isExpired).toBe(false);
			expect(result.metadataIncomplete).toBe(true);
			expect(result.physicalDeletionDate).toBeNull();
		});

		it('deletion_grace_plan_tier が欠落している場合も期限切れ扱いにしない', async () => {
			const pastDate = new Date(Date.now() - 5 * 86400000).toISOString();
			settingsStore.set('soft_deleted_at', new Date(Date.now() - 35 * 86400000).toISOString());
			settingsStore.set('physical_deletion_date', pastDate);

			const result = await getGracePeriodStatus('tenant-limbo');

			expect(result.isExpired).toBe(false);
			expect(result.metadataIncomplete).toBe(true);
		});

		it('欠落している行は復元できる (宙吊りからの脱出経路が存在する)', async () => {
			seedLimboTenant();

			const result = await restoreSoftDeletedTenant('tenant-limbo');

			expect(result.success).toBe(true);
			expect(mockSetSetting).toHaveBeenCalledWith('soft_deleted_at', '', 'tenant-limbo');
			expect(mockSetSetting).toHaveBeenCalledWith('physical_deletion_date', '', 'tenant-limbo');
		});

		it('欠落している行は物理削除の母集団に入らない (安全側を維持)', async () => {
			seedLimboTenant();
			mockListAllTenants.mockResolvedValue([{ tenantId: 'tenant-limbo' }]);

			const result = await findExpiredSoftDeletedTenants();

			expect(result).toHaveLength(0);
		});

		it('欠落を検出できるよう warn ログを出す (新規通知機構は作らない)', async () => {
			seedLimboTenant();

			await getGracePeriodStatus('tenant-limbo');

			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('physical_deletion_date'),
				expect.objectContaining({
					context: expect.objectContaining({ tenantId: 'tenant-limbo' }),
				}),
			);
		});
	});

	// ============================================================
	// findExpiredSoftDeletedTenants
	// ============================================================

	describe('findExpiredSoftDeletedTenants', () => {
		it('期限切れのソフトデリートテナントを返す', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);

			mockListAllTenants.mockResolvedValue([
				{ tenantId: 'tenant-expired' },
				{ tenantId: 'tenant-active' },
			]);

			// tenant-expired は期限切れ
			mockGetSettings
				.mockResolvedValueOnce({
					soft_deleted_at: new Date(Date.now() - 35 * 86400000).toISOString(),
					deletion_grace_plan_tier: 'family',
					physical_deletion_date: pastDate.toISOString(),
				})
				// tenant-active はソフトデリートされていない
				.mockResolvedValueOnce({});

			const result = await findExpiredSoftDeletedTenants();

			expect(result).toHaveLength(1);
			expect(result[0]?.tenantId).toBe('tenant-expired');
			expect(result[0]?.planTier).toBe('family');
		});

		it('期限切れテナントがない場合は空配列を返す', async () => {
			mockListAllTenants.mockResolvedValue([]);

			const result = await findExpiredSoftDeletedTenants();

			expect(result).toHaveLength(0);
		});
	});

	// ============================================================
	// purgeExpiredSoftDeletedTenants (#1648 R43)
	// ============================================================

	describe('purgeExpiredSoftDeletedTenants', () => {
		it('dryRun=true は対象一覧のみ返し物理削除しない', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);
			mockListAllTenants.mockResolvedValue([{ tenantId: 'tenant-expired' }]);
			mockGetSettings.mockResolvedValueOnce({
				soft_deleted_at: new Date(Date.now() - 35 * 86400000).toISOString(),
				deletion_grace_plan_tier: 'family',
				physical_deletion_date: pastDate.toISOString(),
			});

			const result = await purgeExpiredSoftDeletedTenants({ dryRun: true });

			expect(result.dryRun).toBe(true);
			expect(result.tenantsProcessed).toBe(1);
			expect(result.tenantsDeleted).toBe(0);
			expect(result.tenantsFailed).toBe(0);
			expect(result.expired).toHaveLength(1);
			expect(result.expired[0]?.tenantId).toBe('tenant-expired');
			expect(result.expired[0]?.planTier).toBe('family');
		});

		it('期限切れテナントが 0 件なら 0 件処理を返す', async () => {
			mockListAllTenants.mockResolvedValue([]);

			const result = await purgeExpiredSoftDeletedTenants({ dryRun: false });

			expect(result.tenantsProcessed).toBe(0);
			expect(result.tenantsDeleted).toBe(0);
			expect(result.tenantsRemaining).toBe(0);
			expect(result.expired).toHaveLength(0);
			expect(result.errors).toHaveLength(0);
		});

		// #3695: 30 秒 self-limiting + 持ち越し (13-AWS設計書 §3.3)
		function seedExpiredTenants(ids: string[]) {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);
			// settingsStore 経由の既定実装で全テナントが期限切れ扱いになる
			settingsStore.set('soft_deleted_at', new Date(Date.now() - 35 * 86400000).toISOString());
			settingsStore.set('deletion_grace_plan_tier', 'family');
			settingsStore.set('physical_deletion_date', pastDate.toISOString());
			mockListAllTenants.mockResolvedValue(ids.map((tenantId) => ({ tenantId })));
			mockFindTenantMembers.mockResolvedValue([{ userId: 'owner-1', role: 'owner' }]);
			mockDeleteOwnerOnlyAccount.mockResolvedValue(undefined);
			mockDeleteOwnerFullDelete.mockResolvedValue(undefined);
		}

		it('#3695: limit 超過分は削除せず tenantsRemaining として翌日実行へ持ち越す', async () => {
			seedExpiredTenants(['t1', 't2', 't3']);

			const result = await purgeExpiredSoftDeletedTenants({ dryRun: false, limit: 2 });

			expect(result.tenantsProcessed).toBe(2);
			expect(result.tenantsDeleted).toBe(2);
			expect(result.tenantsRemaining).toBe(1);
			expect(mockDeleteOwnerOnlyAccount).toHaveBeenCalledTimes(2);
			expect(mockDeleteOwnerOnlyAccount).toHaveBeenCalledWith('t1', 'owner-1');
			expect(mockDeleteOwnerOnlyAccount).toHaveBeenCalledWith('t2', 'owner-1');
		});

		it('#3695: 時間予算超過なら以降のテナントを削除せず持ち越す', async () => {
			seedExpiredTenants(['t1', 't2']);
			// 1 件目の処理後に予算超過する fake budget (2 回目の exceeded() から true)
			let calls = 0;
			const budget = { exceeded: () => ++calls > 1, elapsedMs: () => 20_001 };

			const result = await purgeExpiredSoftDeletedTenants({ dryRun: false, budget });

			expect(result.tenantsProcessed).toBe(1);
			expect(result.tenantsDeleted).toBe(1);
			expect(result.tenantsRemaining).toBe(1);
			expect(mockDeleteOwnerOnlyAccount).toHaveBeenCalledTimes(1);
		});

		it('#3695: limit 内 + 予算内なら全件削除し持ち越し 0', async () => {
			seedExpiredTenants(['t1', 't2']);

			const result = await purgeExpiredSoftDeletedTenants({ dryRun: false });

			expect(result.tenantsProcessed).toBe(2);
			expect(result.tenantsDeleted).toBe(2);
			expect(result.tenantsRemaining).toBe(0);
		});

		// #4327: kill-switch — 不可逆な削除を「止められる」ことを実挙動で固定する。
		// 宣言 (env が読めている) ではなく **削除が呼ばれないこと** を検証する。
		describe('#4327 kill-switch (GRACE_PERIOD_DELETION_DISABLED)', () => {
			it("'true' なら対象の走査すらせず、1 件も削除しない", async () => {
				seedExpiredTenants(['t1', 't2']);
				mockEnv.GRACE_PERIOD_DELETION_DISABLED = 'true';

				const result = await purgeExpiredSoftDeletedTenants({ dryRun: false });

				expect(result.disabled).toBe(true);
				expect(result.tenantsDeleted).toBe(0);
				expect(result.tenantsProcessed).toBe(0);
				// 実削除経路が 1 度も呼ばれていない
				expect(mockDeleteOwnerOnlyAccount).not.toHaveBeenCalled();
				expect(mockDeleteOwnerFullDelete).not.toHaveBeenCalled();
				// 対象列挙 (listAllTenants) にも到達していない = 誤って消す経路が残っていない
				expect(mockListAllTenants).not.toHaveBeenCalled();
			});

			it("'1' でも停止する", async () => {
				seedExpiredTenants(['t1']);
				mockEnv.GRACE_PERIOD_DELETION_DISABLED = '1';

				const result = await purgeExpiredSoftDeletedTenants({ dryRun: false });

				expect(result.disabled).toBe(true);
				expect(mockDeleteOwnerOnlyAccount).not.toHaveBeenCalled();
			});

			it('未設定 / 空 / その他の値では従来どおり削除する (既定は有効)', async () => {
				for (const value of [undefined, '', 'false', 'TRUE']) {
					vi.clearAllMocks();
					seedExpiredTenants(['t1']);
					if (value === undefined) {
						mockEnv.GRACE_PERIOD_DELETION_DISABLED = undefined;
					} else {
						mockEnv.GRACE_PERIOD_DELETION_DISABLED = value;
					}

					const result = await purgeExpiredSoftDeletedTenants({ dryRun: false });

					expect(result.disabled).toBe(false);
					expect(result.tenantsDeleted).toBe(1);
				}
			});
		});
	});
});
