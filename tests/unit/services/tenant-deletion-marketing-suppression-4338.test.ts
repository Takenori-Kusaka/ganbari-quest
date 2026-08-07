// tests/unit/services/tenant-deletion-marketing-suppression-4338.test.ts
//
// #4338: 退会処理の途中 (`deferSettings` で「残すキー以外を全部消す」step) が、
// **マーケティングメールの配信抑止記録まで消してしまわない**ことを固定する。
//
// なぜ致命的か:
//   `runLifecycleEmails` は `listAllTenants()` を素通しで全 families を走査し、削除進行中か
//   どうかを一切見ない。opt-out 判定は `marketing_unsubscribed_at` の**有無だけ**である。
//   したがって「settings は消えたが後続ステップが失敗して families 行が残った」テナント
//   (= この削除順序が存在する理由そのものの窓) から抑止記録を消すと、**退会を申し出て、かつ
//   配信停止していた家族に、退会処理の最中に販促メールを送る**経路ができる。
//
// ── Canon TDD test list ──
//   [M1] 途中失敗で残った孤児 settings に配信抑止 3 種 (opt-out / 送信済 / 当年カウンタ) が残る
//   [M2] その状態で lifecycle-emails cron を回しても opt-out として弾かれ 1 通も送られない
//   [M3] 抑止機構が書き込むキーは全て「残すキー」に含まれる (SSOT drift 不能)
//   [M4] 正常系では抑止記録も最終的に消える (孤児を作らない回帰)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- in-memory settings repo (fake) ---
const settingsStore = new Map<string, string>();

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
		settingsStore.clear();
	}),
	deleteByTenantIdExcept: vi.fn(async (_tenantId: string, keepKeys: readonly string[]) => {
		const keep = new Set(keepKeys);
		for (const key of [...settingsStore.keys()]) {
			if (!keep.has(key)) settingsStore.delete(key);
		}
	}),
};

const TENANT = 't-4338-marketing';
const NOW = new Date('2026-08-07T00:00:00.000Z');
/** 90 日しきい値を超える最終ログイン (休眠復帰メールの対象になる) */
const LONG_AGO = new Date(NOW.getTime() - 200 * 86_400_000).toISOString();

const tenantRow = {
	tenantId: TENANT,
	name: 'テスト家族',
	plan: undefined as string | undefined,
	planExpiresAt: undefined as string | undefined,
	lastActiveAt: LONG_AGO,
	createdAt: LONG_AGO,
};

const mockAuthRepo = {
	listAllTenants: vi.fn(async () => [tenantRow]),
	findTenantById: vi.fn().mockResolvedValue({ tenantId: TENANT, name: 'テスト家族' }),
	findTenantMembers: vi.fn().mockResolvedValue([{ userId: 'u-owner', role: 'owner' }]),
	findUserById: vi.fn().mockResolvedValue({
		userId: 'u-owner',
		email: 'owner@example.com',
		displayName: 'オーナー',
	}),
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
		// 他 repo は未定義のまま (deleteTenantScopedData は各ブロック独立 try/catch)
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
	cancelSubscription: vi.fn().mockResolvedValue({ status: 'not_subscribed' }),
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendMemberRemovedEmail: vi.fn().mockResolvedValue(true),
	sendDormantReactivationEmail: vi.fn().mockResolvedValue(true),
	sendLicenseRenewalReminderEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock('$lib/server/request-context', () => ({
	invalidateRequestCaches: vi.fn(),
}));

import { deleteOwnerOnlyAccount } from '$lib/server/services/account-deletion-service';
import {
	sendDormantReactivationEmail,
	sendLicenseRenewalReminderEmail,
} from '$lib/server/services/email-service';
import {
	markTenantUnsubscribed,
	runLifecycleEmails,
} from '$lib/server/services/lifecycle-email-service';
import { getSettingsKeysToKeepDuringDeletion } from '$lib/server/services/soft-delete-keys';

const mockSendDormant = vi.mocked(sendDormantReactivationEmail);
const mockSendRenewal = vi.mocked(sendLicenseRenewalReminderEmail);

/** 当年カウンタのキー (実装と同じ組み立て方をテスト側でも 1 回だけ書く)。 */
const COUNT_KEY = `marketing_email_count_${NOW.getUTCFullYear()}`;

/**
 * 「配信停止済みで、休眠復帰メールも 1 回受け取り済みで、年枠を使い切っている」家族が
 * 退会を申し出た状態を再現する。
 */
function seedSettings(): void {
	settingsStore.clear();
	// soft-delete 判定材料
	settingsStore.set('soft_deleted_at', '2026-08-01T00:00:00.000Z');
	settingsStore.set('deletion_grace_plan_tier', 'standard');
	settingsStore.set('physical_deletion_date', '2026-08-08T00:00:00.000Z');
	// 配信抑止記録 (#4338 で消してはならないもの)
	settingsStore.set('marketing_unsubscribed_at', '2026-07-01T00:00:00.000Z');
	settingsStore.set('dormant_reactivation_sent', '2026-06-01T00:00:00.000Z');
	settingsStore.set(COUNT_KEY, '6');
	// 孤児に残ると困るもの (既存 #4338 の対象。ここでは消えることを確認するだけ)
	settingsStore.set('pin_hash', '$2b$10$dummy-hash-value');
}

/**
 * 「settings は消したが後続ステップが失敗して `families` 行が残った」窓を作る。
 * step 6 (families 行削除) を失敗させることで、step 2 の settings 先行削除だけが済んだ
 * 中間状態を再現する。
 */
async function runDeletionFailingAfterSettings(): Promise<void> {
	mockAuthRepo.deleteTenant.mockRejectedValueOnce(new Error('simulated DSQL failure'));
	await expect(
		deleteOwnerOnlyAccount(TENANT, 'u-owner', { route: 'grace-expiry', planTier: 'standard' }),
	).rejects.toThrow();
}

describe('#4338 退会途中の孤児: 配信抑止記録を消さない', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSendDormant.mockResolvedValue(true);
		mockSendRenewal.mockResolvedValue(true);
		mockAuthRepo.deleteTenant.mockReset();
		mockAuthRepo.listAllTenants.mockResolvedValue([tenantRow]);
		mockAuthRepo.findTenantMembers.mockResolvedValue([{ userId: 'u-owner', role: 'owner' }]);
		mockChildRepo.findAllChildren.mockResolvedValue([]);
		mockChildRepo.findArchivedChildren.mockResolvedValue([]);
		seedSettings();
	});

	it('[M1] 途中失敗で残る孤児に opt-out / 送信済フラグ / 当年カウンタが残る', async () => {
		await runDeletionFailingAfterSettings();

		expect(settingsStore.get('marketing_unsubscribed_at')).toBe('2026-07-01T00:00:00.000Z');
		expect(settingsStore.get('dormant_reactivation_sent')).toBe('2026-06-01T00:00:00.000Z');
		expect(settingsStore.get(COUNT_KEY)).toBe('6');
		// 機微キーは従来どおり消えている (#4338 本来の目的を壊していない)
		expect(settingsStore.has('pin_hash')).toBe(false);
	});

	it('[M2] その孤児は翌日の lifecycle-emails でも opt-out として弾かれ 1 通も送られない', async () => {
		await runDeletionFailingAfterSettings();

		const result = await runLifecycleEmails({ now: NOW });

		// 実害そのもの: 配信停止した家族に販促メールが飛ばないこと
		expect(mockSendDormant).not.toHaveBeenCalled();
		expect(mockSendRenewal).not.toHaveBeenCalled();
		expect(result.dormantSent).toBe(0);
		expect(result.renewalSent).toBe(0);
		// 弾かれた理由が opt-out であること (別の偶然で送られなかっただけ、を許さない)
		expect(result.scanned).toBe(1);
		expect(result.skippedUnsubscribed).toBe(1);
	});

	it('[M3] 抑止機構が書き込むキーは全て「残すキー」に含まれる (drift 不能)', async () => {
		// 抑止記録がまったく無い家族に、実際の抑止機構を動かして書かせる。
		settingsStore.clear();
		await markTenantUnsubscribed(TENANT, NOW);
		settingsStore.delete('marketing_unsubscribed_at'); // opt-out を外して送信経路を通す
		await runLifecycleEmails({ now: NOW });
		await markTenantUnsubscribed(TENANT, NOW);

		// 実際に書かれたキー = 抑止判定の材料そのもの
		const writtenKeys = [...settingsStore.keys()].sort();
		expect(writtenKeys.length).toBeGreaterThan(0);

		const kept = new Set(getSettingsKeysToKeepDuringDeletion(NOW));
		for (const key of writtenKeys) {
			expect(
				kept.has(key),
				`抑止機構が書く "${key}" が削除の keep-list に無い (退会中に販促メールが再開する)`,
			).toBe(true);
		}
	});

	it('[M4] 正常系では抑止記録も最終的に消える (孤児を作らない回帰)', async () => {
		await deleteOwnerOnlyAccount(TENANT, 'u-owner', {
			route: 'grace-expiry',
			planTier: 'standard',
		});

		expect(settingsStore.size).toBe(0);
		expect(fakeSettingsRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
	});
});
