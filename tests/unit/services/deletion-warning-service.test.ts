// tests/unit/services/deletion-warning-service.test.ts
// #2399: アカウント削除予告メールの送信判定。
//
// 守る不変条件:
//   [W1] free (猶予 0 日) には 1 通も送らない — 予告を送る時間が原理的に存在しない
//   [W2] しきい値は猶予日数より必ず小さい (family=14 / standard=1)。「14 日前固定」は standard で成立しない
//   [W3] 境界 — 15 日では送らず、14 日で 1 通。同一テナントを 15/14/13 日で回しても合計 1 通
//   [W4] idempotency — 同日 2 回連続実行でも 1 通 (`deletion_warning_sent_at`)
//   [W5] 復元 → 再予約で再び予告が届く (クリア漏れは「2 回目は無音」の silent regression)
//   [W6] cron 欠測の救済 — 一度も送っていないテナントはしきい値を過ぎていても届く
//   [W7] マーケティング配信停止 (opt-out) 済でも届く — 法務通知を年 6 回枠 / 購読解除で握り潰さない
//   [W8] 宛先は owner 単独固定ではなく保護者 (owner/parent) 全員 — owner 不在 / アドレス失効の
//        単一障害点を解消する (#4325 follow-up、オーナー決裁 2026-08-06)
//
// 背景: 猶予期間の物理削除 cron が AWS 本番の EventBridge Rule に配線された (#4119 / PR #4311) ため、
// 予告が無いまま実データが消える経路が生きている。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Mocks
// ============================================================

vi.mock('$lib/server/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

// #4721: 物理削除の kill-switch を切り替えるための env mock
const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
}));
vi.mock('$lib/runtime/env', () => ({ env: mockEnv }));

/** settings KV (tenantId 込みの複合キーで保持する) */
const settingsStore = new Map<string, string>();

const mockGetSetting = vi.fn(async (key: string, tenantId: string) =>
	settingsStore.get(`${tenantId}:${key}`),
);
const mockSetSetting = vi.fn(async (key: string, value: string, tenantId: string) => {
	settingsStore.set(`${tenantId}:${key}`, value);
});
const mockGetSettings = vi.fn(async (keys: string[], tenantId: string) => {
	const result: Record<string, string | undefined> = {};
	for (const key of keys) result[key] = settingsStore.get(`${tenantId}:${key}`);
	return result;
});

const mockListAllTenants = vi.fn();
const mockFindTenantMembers = vi.fn();
const mockFindUserById = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			listAllTenants: mockListAllTenants,
			findTenantMembers: mockFindTenantMembers,
			findUserById: mockFindUserById,
		},
		settings: {
			getSetting: mockGetSetting,
			setSetting: mockSetSetting,
			getSettings: mockGetSettings,
		},
	}),
}));

const mockSendWarning = vi.fn(async (_params: unknown) => true);
vi.mock('$lib/server/services/email-service', () => ({
	sendDeletionWarningEmail: (params: unknown) => mockSendWarning(params),
}));

// restore の副作用 (sent_at クリア) を実物で検証するため grace-period-service は mock しない。
// purge 経路 (dynamic import) には触れないが、import 解決のため spy を置く。
vi.mock('$lib/server/services/account-deletion-service', () => ({
	deleteOwnerOnlyAccount: vi.fn(),
	deleteOwnerFullDelete: vi.fn(),
}));

import {
	DELETION_WARNING_DAYS_BEFORE,
	DELETION_WARNING_SENT_KEY,
	runDeletionWarningEmails,
} from '$lib/server/services/deletion-warning-service';
import {
	DELETION_GRACE_PERIOD_DAYS,
	restoreSoftDeletedTenant,
} from '$lib/server/services/grace-period-service';

// ============================================================
// Helpers
// ============================================================

const MS_PER_DAY = 86_400_000;
/** 2026-04-01 10:00 JST (= 01:00 UTC)。cron の起動時刻に合わせる */
const NOW = new Date('2026-04-01T01:00:00Z');

/** now から JST 暦日で `days` 日後の物理削除予定時刻 (時刻は 22:00 JST = 端数ありの現実的な値) */
function deletionDateInDays(days: number): string {
	return new Date(NOW.getTime() + days * MS_PER_DAY - 4 * 3_600_000).toISOString();
}

/**
 * soft delete 済テナントを settings KV に仕込む。
 * softDeleteTenant() が書く 3 キーと同じ形にする。
 */
function seedSoftDeleted(
	tenantId: string,
	planTier: 'free' | 'standard' | 'family',
	daysRemaining: number,
) {
	settingsStore.set(`${tenantId}:soft_deleted_at`, NOW.toISOString());
	settingsStore.set(`${tenantId}:deletion_grace_plan_tier`, planTier);
	settingsStore.set(`${tenantId}:physical_deletion_date`, deletionDateInDays(daysRemaining));
}

function setTenants(tenantIds: string[]) {
	mockListAllTenants.mockResolvedValue(
		tenantIds.map((tenantId) => ({
			tenantId,
			name: 'テスト家族',
			ownerId: `owner-${tenantId}`,
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		})),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	// grace-period-service の getGracePeriodStatus / restoreSoftDeletedTenant は内部で
	// new Date() を見る (注入不可) ため、system time を NOW に固定して「猶予内」を成立させる。
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settingsStore.clear();
	mockSendWarning.mockResolvedValue(true);
	mockFindTenantMembers.mockImplementation(async (tenantId: string) => [
		{ userId: `owner-${tenantId}`, role: 'owner' },
	]);
	mockFindUserById.mockImplementation(async (userId: string) => ({
		userId,
		email: `${userId}@example.com`,
		displayName: '保護者',
	}));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

// ============================================================
// [W1] free には送らない
// ============================================================

describe('#2399 [W1] free プラン (猶予 0 日) には予告を送らない', () => {
	it('free のしきい値は null (送信タイミングが存在しない)', () => {
		expect(DELETION_GRACE_PERIOD_DAYS.free).toBe(0);
		expect(DELETION_WARNING_DAYS_BEFORE.free).toBeNull();
	});

	it('soft delete 済の free テナントがいても 1 通も送らない', async () => {
		setTenants(['t-free']);
		// free は即時削除なので猶予は 0。念のため残日数がある状態でも送らないことを固定する
		seedSoftDeleted('t-free', 'free', 14);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(mockSendWarning).not.toHaveBeenCalled();
		expect(result.sent).toBe(0);
		expect(result.skippedNoThreshold).toBe(1);
	});
});

// ============================================================
// [W2] プラン別しきい値
// ============================================================

describe('#2399 [W2] プラン別しきい値', () => {
	it('しきい値は猶予日数より必ず小さい (「14 日前」は standard では成立しない)', () => {
		for (const [tier, graceDays] of Object.entries(DELETION_GRACE_PERIOD_DAYS)) {
			const threshold = DELETION_WARNING_DAYS_BEFORE[tier as 'free' | 'standard' | 'family'];
			if (graceDays === 0) {
				expect(threshold).toBeNull();
				continue;
			}
			expect(threshold).not.toBeNull();
			expect(threshold as number).toBeGreaterThanOrEqual(1);
			expect(threshold as number).toBeLessThan(graceDays);
		}
	});

	it('family は残り 14 日で送る', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
		expect(mockSendWarning).toHaveBeenCalledTimes(1);
		expect(mockSendWarning.mock.calls[0]?.[0]).toMatchObject({
			email: 'owner-t-family@example.com',
			daysRemaining: 14,
		});
	});

	it('standard は残り 1 日で送る (14 日前は猶予 7 日に収まらない)', async () => {
		setTenants(['t-std']);
		seedSoftDeleted('t-std', 'standard', 1);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
		expect(mockSendWarning.mock.calls[0]?.[0]).toMatchObject({
			email: 'owner-t-std@example.com',
			daysRemaining: 1,
		});
	});

	it('standard は残り 3 日ではまだ送らない (しきい値未到達)', async () => {
		setTenants(['t-std']);
		seedSoftDeleted('t-std', 'standard', 3);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(0);
		expect(result.skippedNotDue).toBe(1);
	});
});

// ============================================================
// [W3] 境界
// ============================================================

describe('#2399 [W3] 境界 (family 15 / 14 / 13 日)', () => {
	it('残り 15 日では送らない', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 15);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(0);
		expect(result.skippedNotDue).toBe(1);
	});

	it('同一テナントを 15 / 14 / 13 日で日次実行しても送信は 14 日の 1 通だけ', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 15);
		const deletionAt = settingsStore.get('t-family:physical_deletion_date') as string;

		// physical_deletion_date は固定のまま「今日」を 1 日ずつ進める (実運用の日次 cron と同じ)
		const day15 = await runDeletionWarningEmails({ now: NOW });
		const day14 = await runDeletionWarningEmails({ now: new Date(NOW.getTime() + MS_PER_DAY) });
		const day13 = await runDeletionWarningEmails({
			now: new Date(NOW.getTime() + 2 * MS_PER_DAY),
		});

		expect(settingsStore.get('t-family:physical_deletion_date')).toBe(deletionAt);
		expect(day15.sent).toBe(0);
		expect(day14.sent).toBe(1);
		expect(day13.sent).toBe(0);
		expect(day13.skippedAlreadySent).toBe(1);
		expect(mockSendWarning).toHaveBeenCalledTimes(1);
	});
});

// ============================================================
// [W4] idempotency
// ============================================================

describe('#2399 [W4] idempotency', () => {
	it('同じ日に 2 回連続実行しても 2 通目は送らない', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);

		const first = await runDeletionWarningEmails({ now: NOW });
		const second = await runDeletionWarningEmails({ now: NOW });

		expect(first.sent).toBe(1);
		expect(second.sent).toBe(0);
		expect(second.skippedAlreadySent).toBe(1);
		expect(mockSendWarning).toHaveBeenCalledTimes(1);
		expect(settingsStore.get(`t-family:${DELETION_WARNING_SENT_KEY}`)).toBeTruthy();
	});

	it('dryRun では送信も sent_at 記録もしない (次回の実送信を先食いしない)', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);

		const dry = await runDeletionWarningEmails({ now: NOW, dryRun: true });
		expect(dry.dryRun).toBe(true);
		expect(dry.sent).toBe(1);
		expect(mockSendWarning).not.toHaveBeenCalled();
		expect(settingsStore.get(`t-family:${DELETION_WARNING_SENT_KEY}`)).toBeUndefined();

		const real = await runDeletionWarningEmails({ now: NOW });
		expect(real.sent).toBe(1);
		expect(mockSendWarning).toHaveBeenCalledTimes(1);
	});

	it('送信に失敗したら sent_at を書かない (次回実行で再試行できる)', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		mockSendWarning.mockResolvedValueOnce(false);

		const failed = await runDeletionWarningEmails({ now: NOW });
		expect(failed.sent).toBe(0);
		expect(failed.errors).toBe(1);
		expect(settingsStore.get(`t-family:${DELETION_WARNING_SENT_KEY}`)).toBeUndefined();

		const retried = await runDeletionWarningEmails({ now: NOW });
		expect(retried.sent).toBe(1);
	});
});

// ============================================================
// [W5] 復元 → 再予約で再送
// ============================================================

describe('#2399 [W5] 復元後に再予約したら再び予告が届く', () => {
	it('restoreSoftDeletedTenant が deletion_warning_sent_at をクリアする', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);

		// 1 回目の予約: 予告が届く
		expect((await runDeletionWarningEmails({ now: NOW })).sent).toBe(1);
		expect(settingsStore.get(`t-family:${DELETION_WARNING_SENT_KEY}`)).toBeTruthy();

		// 顧客が復元 (猶予内なので成功する)
		const restored = await restoreSoftDeletedTenant('t-family');
		expect(restored.success).toBe(true);
		expect(settingsStore.get(`t-family:${DELETION_WARNING_SENT_KEY}`)).toBeFalsy();

		// 2 回目の予約: 再び 14 日前になったら届く
		seedSoftDeleted('t-family', 'family', 14);
		const second = await runDeletionWarningEmails({ now: NOW });
		expect(second.sent).toBe(1);
		expect(mockSendWarning).toHaveBeenCalledTimes(2);
	});
});

// ============================================================
// [W6] cron 欠測の救済
// ============================================================

describe('#2399 [W6] cron が 1 日飛んでも無音にしない', () => {
	it('一度も送っていないテナントはしきい値を過ぎていても届く', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 10);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
		expect(mockSendWarning.mock.calls[0]?.[0]).toMatchObject({ daysRemaining: 10 });
	});

	it('残り 0 日以下 (削除当日 / 期限切れ) には送らない', async () => {
		setTenants(['t-a', 't-b']);
		seedSoftDeleted('t-a', 'family', 0);
		seedSoftDeleted('t-b', 'family', -3);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(0);
		expect(mockSendWarning).not.toHaveBeenCalled();
	});
});

// ============================================================
// [W7] opt-out / 上限に握り潰されない
// ============================================================

describe('#2399 [W7] 法務通知は購読解除で止まらない', () => {
	it('マーケティング配信停止済のテナントにも届く', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		settingsStore.set('t-family:marketing_unsubscribed_at', NOW.toISOString());

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
	});

	it('年 6 回上限カウンタ (marketing_email_count_*) を消費しない', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);

		await runDeletionWarningEmails({ now: NOW });

		const counterKeys = [...settingsStore.keys()].filter((k) =>
			k.includes('marketing_email_count'),
		);
		expect(counterKeys).toEqual([]);
	});
});

// ============================================================
// [W8] 宛先: owner 単独固定ではなく保護者全員
// ============================================================

describe('#2399 [W8] 宛先は保護者 (owner/parent) 全員', () => {
	it('owner + parent の 2 名がいれば両方に届く', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		mockFindTenantMembers.mockResolvedValue([
			{ userId: 'u-owner', role: 'owner' },
			{ userId: 'u-parent', role: 'parent' },
		]);
		mockFindUserById.mockImplementation(async (userId: string) => ({
			userId,
			email: `${userId}@example.com`,
			displayName: userId === 'u-owner' ? 'オーナー' : '配偶者',
		}));

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
		expect(mockSendWarning).toHaveBeenCalledTimes(2);
		const sentEmails = mockSendWarning.mock.calls.map((c) => (c[0] as { email: string }).email);
		expect(sentEmails.sort()).toEqual(['u-owner@example.com', 'u-parent@example.com']);
		// 宛先ごとに本人の displayName を使う (他の保護者の名前を差し込まない)
		const byEmail = Object.fromEntries(
			mockSendWarning.mock.calls.map((c) => {
				const p = c[0] as { email: string; ownerName: string };
				return [p.email, p.ownerName];
			}),
		);
		expect(byEmail['u-owner@example.com']).toBe('オーナー');
		expect(byEmail['u-parent@example.com']).toBe('配偶者');
	});

	it('child ロールには送らない', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		mockFindTenantMembers.mockResolvedValue([
			{ userId: 'u-owner', role: 'owner' },
			{ userId: 'u-child', role: 'child' },
		]);
		mockFindUserById.mockImplementation(async (userId: string) => ({
			userId,
			email: `${userId}@example.com`,
			displayName: '名前',
		}));

		await runDeletionWarningEmails({ now: NOW });

		expect(mockSendWarning).toHaveBeenCalledTimes(1);
		expect(mockSendWarning.mock.calls[0]?.[0]).toMatchObject({ email: 'u-owner@example.com' });
	});

	it('同一メールアドレスが複数ロールに登録されていても 1 通にまとめる', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		mockFindTenantMembers.mockResolvedValue([
			{ userId: 'u-owner', role: 'owner' },
			{ userId: 'u-parent-same', role: 'parent' },
		]);
		mockFindUserById.mockImplementation(async (userId: string) => ({
			userId,
			// 同一世帯で owner と parent が同じアドレスを共有しているケース
			email: 'shared@example.com',
			displayName: userId === 'u-owner' ? 'オーナー' : '配偶者',
		}));

		await runDeletionWarningEmails({ now: NOW });

		expect(mockSendWarning).toHaveBeenCalledTimes(1);
	});

	it('owner が失敗し parent が成功したら sent 扱いになり sent_at を書く (次回リトライしない)。失敗件数は観測可能 (#4359 follow-up)', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		mockFindTenantMembers.mockResolvedValue([
			{ userId: 'u-owner', role: 'owner' },
			{ userId: 'u-parent', role: 'parent' },
		]);
		mockFindUserById.mockImplementation(async (userId: string) => ({
			userId,
			email: `${userId}@example.com`,
			displayName: '名前',
		}));
		mockSendWarning.mockImplementation(
			async (params: unknown) => (params as { email: string }).email !== 'u-owner@example.com',
		);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
		expect(result.errors).toBe(0);
		expect(settingsStore.get(`t-family:${DELETION_WARNING_SENT_KEY}`)).toBeTruthy();
		// 片方 (owner) には二度と届かないことが、成功扱いの中に埋もれず件数として残る
		expect(result.failedRecipients).toBe(1);
		expect(result.tenantsWithPartialFailure).toBe(1);
	});

	it('両方成功したら partial failure は 0 のまま (#4359 follow-up)', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		mockFindTenantMembers.mockResolvedValue([
			{ userId: 'u-owner', role: 'owner' },
			{ userId: 'u-parent', role: 'parent' },
		]);
		mockFindUserById.mockImplementation(async (userId: string) => ({
			userId,
			email: `${userId}@example.com`,
			displayName: '名前',
		}));
		mockSendWarning.mockResolvedValue(true);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
		expect(result.failedRecipients).toBe(0);
		expect(result.tenantsWithPartialFailure).toBe(0);
	});

	it('保護者が全員失敗したら error 扱いで sent_at を書かず、次回全員へ再試行できる', async () => {
		setTenants(['t-family']);
		seedSoftDeleted('t-family', 'family', 14);
		mockFindTenantMembers.mockResolvedValue([
			{ userId: 'u-owner', role: 'owner' },
			{ userId: 'u-parent', role: 'parent' },
		]);
		mockFindUserById.mockImplementation(async (userId: string) => ({
			userId,
			email: `${userId}@example.com`,
			displayName: '名前',
		}));
		mockSendWarning.mockResolvedValue(false);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(0);
		expect(result.errors).toBe(1);
		expect(settingsStore.get(`t-family:${DELETION_WARNING_SENT_KEY}`)).toBeUndefined();
		// 全滅は次回再試行される (idempotency key 未設定) が、失敗件数自体は今回分も観測できる
		expect(result.failedRecipients).toBe(2);
		// 'sent' ではなく 'error' 扱いのため partial failure カウンタは増やさない (次回全員へ再試行対象)
		expect(result.tenantsWithPartialFailure).toBe(0);
	});
});

// ============================================================
// 走査対象外 / 異常系
// ============================================================

describe('#2399 走査対象外', () => {
	it('soft delete されていないテナントは対象にならない', async () => {
		setTenants(['t-active']);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.scanned).toBe(1);
		expect(result.sent).toBe(0);
		expect(result.skippedNotSoftDeleted).toBe(1);
	});

	it('保護者ロール全員の email が引けないテナントは skip して他に波及させない', async () => {
		setTenants(['t-owner-missing', 't-family']);
		seedSoftDeleted('t-owner-missing', 'family', 14);
		seedSoftDeleted('t-family', 'family', 14);
		mockFindTenantMembers.mockImplementation(async (tenantId: string) =>
			tenantId === 't-owner-missing' ? [] : [{ userId: `owner-${tenantId}`, role: 'owner' }],
		);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.skippedNoRecipients).toBe(1);
		expect(result.sent).toBe(1);
	});

	it('時間予算を使い切ったら残件を次回に持ち越し、件数を報告する (silent 持ち越し禁止)', async () => {
		setTenants(['t-1', 't-2', 't-3']);
		for (const id of ['t-1', 't-2', 't-3']) seedSoftDeleted(id, 'family', 14);

		const result = await runDeletionWarningEmails({
			now: NOW,
			budget: { exceeded: () => true, elapsedMs: () => 0 },
		});

		expect(result.sent).toBe(0);
		expect(result.tenantsRemaining).toBe(3);
	});
});

// ============================================================
// [W9] #4721: 削除が走らない配備では予告も出さない
// ============================================================

describe('[W9] 物理削除が停止中なら予告メールを送らない (#4721)', () => {
	afterEach(() => {
		for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	});

	// AWS 本番は grace-period-deletion の EventBridge Rule を作っていないのに、予告メールの
	// Rule だけが動いていた。顧客には「削除予定日: X」が届き、その日が来ても削除されない。
	it('kill-switch が有効なら 1 通も送らず、止まったことを結果で報告する', async () => {
		setTenants(['t1']);
		seedSoftDeleted('t1', 'family', 14);
		mockEnv.GRACE_PERIOD_DELETION_DISABLED = 'true';

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(0);
		expect(result.skippedPhysicalDeletionDisabled).toBe(true);
		expect(mockSendWarning).not.toHaveBeenCalled();
		// 走査にも入らない (「送らない」だけでなく「見に行かない」)
		expect(result.scanned).toBe(0);
	});

	// 対照: flag が無ければ従来どおり送る (検査が常に true を返す空振りでない)
	it('kill-switch が無効なら従来どおり送る', async () => {
		setTenants(['t1']);
		seedSoftDeleted('t1', 'family', 14);

		const result = await runDeletionWarningEmails({ now: NOW });

		expect(result.sent).toBe(1);
		expect(result.skippedPhysicalDeletionDisabled).toBe(false);
	});
});
