// tests/unit/services/notification-delivery-service.test.ts
// #4706: 設定 UI が約束する 3 配信の送信ジョブ。
//
// 本 Issue の欠陥は「設定は保存できるのに、その値を読んで送るコードがどこにも無い」だった。
// したがって固定すべきは **保存された設定値が送信判定に実際に使われること** と、
// **retry / 手動再実行で 2 通目を送らないこと** の 2 点である。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRepos } = vi.hoisted(() => ({
	mockRepos: {
		auth: {
			listAllTenants: vi.fn(),
			findTenantMembers: vi.fn(),
			findUserById: vi.fn(),
		},
		settings: {
			getSettingForAllTenants: vi.fn(),
			setSetting: vi.fn(),
		},
		child: { findAllChildren: vi.fn() },
		activity: { findDistinctRecordedDates: vi.fn() },
	},
}));

const { mockSendPush, mockSendWeeklyEmail, mockGetLicenseInfo, mockResolvePlanTier, mockGenerate } =
	vi.hoisted(() => ({
		mockSendPush: vi.fn(),
		mockSendWeeklyEmail: vi.fn(),
		mockGetLicenseInfo: vi.fn(),
		mockResolvePlanTier: vi.fn(),
		mockGenerate: vi.fn(),
	}));

vi.mock('$lib/server/db/factory', () => ({ getRepos: () => mockRepos }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/server/services/notification-service', () => ({
	sendPushNotification: mockSendPush,
}));
vi.mock('$lib/server/services/email-service', () => ({
	sendWeeklyReportEmail: mockSendWeeklyEmail,
}));
vi.mock('$lib/server/services/license-service', () => ({ getLicenseInfo: mockGetLicenseInfo }));
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: mockResolvePlanTier,
}));
vi.mock('$lib/server/services/weekly-report-service', () => ({
	generateWeeklyReport: mockGenerate,
}));

import {
	reminderMinuteOfDay,
	resolveDueFlags,
	runNotificationDelivery,
	streakDaysFromDates,
} from '../../../src/lib/server/services/notification-delivery-service';

const TENANT = 't-1';

/** JST 基準の時刻を UTC の Date に直す (JST = UTC+9)。日跨ぎも正しく扱う。 */
function jst(dateStr: string, hhmm: string): Date {
	const [h, m] = hhmm.split(':').map(Number);
	return new Date(
		new Date(`${dateStr}T00:00:00Z`).getTime() + ((h ?? 0) - 9) * 3_600_000 + (m ?? 0) * 60_000,
	);
}

function baseInput(overrides: Partial<Parameters<typeof resolveDueFlags>[0]> = {}) {
	return {
		tenantId: TENANT,
		// 2026-08-20 は木曜日 (JST)
		now: jst('2026-08-20', '10:00'),
		weeklyEnabled: undefined,
		weeklyDay: undefined,
		weeklySentWeek: undefined,
		remindersEnabled: undefined,
		reminderTime: undefined,
		reminderSentDate: undefined,
		streakEnabled: undefined,
		streakSentDate: undefined,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockRepos.auth.listAllTenants.mockResolvedValue([{ tenantId: TENANT }]);
	mockRepos.settings.getSettingForAllTenants.mockResolvedValue(new Map());
	mockRepos.settings.setSetting.mockResolvedValue(undefined);
	mockRepos.child.findAllChildren.mockResolvedValue([{ id: 'c-1', nickname: 'たろう' }]);
	mockRepos.activity.findDistinctRecordedDates.mockResolvedValue([]);
	mockRepos.auth.findTenantMembers.mockResolvedValue([{ userId: 'u-1', role: 'owner' }]);
	mockRepos.auth.findUserById.mockResolvedValue({ email: 'owner@example.com' });
	mockSendPush.mockResolvedValue({ sent: 1, failed: 0 });
	mockSendWeeklyEmail.mockResolvedValue(true);
	mockGetLicenseInfo.mockResolvedValue({ status: 'active', plan: 'standard' });
	mockResolvePlanTier.mockResolvedValue('standard');
	mockGenerate.mockResolvedValue({
		weekStart: '2026-08-17',
		weekEnd: '2026-08-23',
		totalPoints: 42,
		categories: [{ categoryName: 'うんどう', activityCount: 3, totalXp: 30 }],
		newAchievements: [],
	});
});

// ============================================================
// 保存された設定値が判定に使われる (#4706 の中核)
// ============================================================

describe('resolveDueFlags — 設定値が送信判定に使われる', () => {
	it('配信曜日が今日でなければ週次レポートは対象外', () => {
		// 2026-08-20 は木曜。monday を指定していれば送らない
		expect(resolveDueFlags(baseInput({ weeklyDay: 'monday' })).weekly).toBe(false);
		expect(resolveDueFlags(baseInput({ weeklyDay: 'thursday' })).weekly).toBe(true);
	});

	it('週次レポートは 09:00 JST 以降にだけ対象になる', () => {
		const early = baseInput({ weeklyDay: 'thursday', now: jst('2026-08-20', '08:59') });
		expect(resolveDueFlags(early).weekly).toBe(false);
		const late = baseInput({ weeklyDay: 'thursday', now: jst('2026-08-20', '09:00') });
		expect(resolveDueFlags(late).weekly).toBe(true);
	});

	it('weekly_report_enabled=0 なら送らない (UI の保存値と同じ向き)', () => {
		const input = baseInput({ weeklyDay: 'thursday', weeklyEnabled: '0' });
		expect(resolveDueFlags(input).weekly).toBe(false);
	});

	it('リマインダーは設定時刻を過ぎてから対象になる', () => {
		const before = baseInput({ reminderTime: '10:30', now: jst('2026-08-20', '10:15') });
		expect(resolveDueFlags(before).reminder).toBe(false);
		const after = baseInput({ reminderTime: '10:30', now: jst('2026-08-20', '10:30') });
		expect(resolveDueFlags(after).reminder).toBe(true);
	});

	it('notification_reminders_enabled=false なら送らない', () => {
		expect(resolveDueFlags(baseInput({ remindersEnabled: 'false' })).reminder).toBe(false);
	});

	it('ストリーク警告は 19:00 JST 以降にだけ対象になる', () => {
		expect(resolveDueFlags(baseInput({ now: jst('2026-08-20', '18:59') })).streak).toBe(false);
		expect(resolveDueFlags(baseInput({ now: jst('2026-08-20', '19:00') })).streak).toBe(true);
	});

	it('notification_streak_enabled=false なら送らない', () => {
		const input = baseInput({ streakEnabled: 'false', now: jst('2026-08-20', '20:00') });
		expect(resolveDueFlags(input).streak).toBe(false);
	});
});

// ============================================================
// 冪等 (送信済マーカー)
// ============================================================

describe('送信済マーカー — retry / 手動再実行で 2 通目を送らない', () => {
	it('同じ週のマーカーがあれば週次レポートは対象外', () => {
		const input = baseInput({ weeklyDay: 'thursday', weeklySentWeek: '2026-08-17' });
		expect(resolveDueFlags(input).weekly).toBe(false);
		// 先週のマーカーなら今週分は送る (マーカーが恒久的に止めない)
		const older = baseInput({ weeklyDay: 'thursday', weeklySentWeek: '2026-08-10' });
		expect(resolveDueFlags(older).weekly).toBe(true);
	});

	it('同じ日のマーカーがあればリマインダー / ストリーク警告は対象外', () => {
		const now = jst('2026-08-20', '20:00');
		const sentToday = baseInput({
			now,
			reminderSentDate: '2026-08-20',
			streakSentDate: '2026-08-20',
		});
		expect(resolveDueFlags(sentToday).reminder).toBe(false);
		expect(resolveDueFlags(sentToday).streak).toBe(false);

		const sentYesterday = baseInput({
			now,
			reminderSentDate: '2026-08-19',
			streakSentDate: '2026-08-19',
		});
		expect(resolveDueFlags(sentYesterday).reminder).toBe(true);
		expect(resolveDueFlags(sentYesterday).streak).toBe(true);
	});

	it('送信に成功したときだけマーカーを書く (失敗した回は次回再試行される)', async () => {
		mockSendPush.mockResolvedValue({ sent: 0, failed: 1 });
		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.reminderSent).toBe(0);
		expect(mockRepos.settings.setSetting).not.toHaveBeenCalledWith(
			'notification_reminder_sent_date',
			expect.anything(),
			TENANT,
		);
	});

	it('送信できたらマーカーを JST 暦日で書く', async () => {
		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.reminderSent).toBe(1);
		expect(mockRepos.settings.setSetting).toHaveBeenCalledWith(
			'notification_reminder_sent_date',
			'2026-08-20',
			TENANT,
		);
	});

	it('dryRun ではマーカーを書かず送信もしない', async () => {
		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00'), dryRun: true });

		expect(result.dryRun).toBe(true);
		expect(result.reminderSent).toBe(1);
		expect(mockSendPush).not.toHaveBeenCalled();
		expect(mockRepos.settings.setSetting).not.toHaveBeenCalled();
	});
});

// ============================================================
// プランゲート
// ============================================================

// 週次メールは「🔥 連続記録: N日」「±0」をそのまま描くため、0 固定にすると
// 顧客には「連続 0 日」「全カテゴリ増減なし」という嘘が届く。
describe('週次メールの中身が実データを載せる', () => {
	beforeEach(() => {
		mockRepos.settings.getSettingForAllTenants.mockImplementation(async (key: string) =>
			key === 'weekly_report_day' ? new Map([[TENANT, 'thursday']]) : new Map(),
		);
		mockRepos.activity.findDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-08-20' },
			{ recordedDate: '2026-08-19' },
			{ recordedDate: '2026-08-18' },
		]);
		// 今週 3 回 / 前週 1 回 → diff は +2
		mockGenerate
			.mockResolvedValueOnce({
				weekStart: '2026-08-17',
				weekEnd: '2026-08-23',
				totalPoints: 42,
				categories: [{ categoryName: 'うんどう', activityCount: 3, totalXp: 30 }],
				newAchievements: [],
			})
			.mockResolvedValueOnce({
				weekStart: '2026-08-10',
				weekEnd: '2026-08-16',
				totalPoints: 10,
				categories: [{ categoryName: 'うんどう', activityCount: 1, totalXp: 10 }],
				newAchievements: [],
			});
	});

	it('streak は実際の連続記録日数、diff は前週比を載せる', async () => {
		await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		const data = mockSendWeeklyEmail.mock.calls[0]?.[1] as {
			streak: number;
			categories: Array<{ name: string; count: number; diff: number }>;
		};
		expect(data.streak).toBe(3);
		expect(data.categories[0]).toEqual({ name: 'うんどう', count: 3, diff: 2 });
	});
});

describe('プランゲート (#735)', () => {
	it('無料プランには週次メールを送らない (upsell で有料特典と案内しているため)', async () => {
		mockResolvePlanTier.mockResolvedValue('free');
		mockRepos.settings.getSettingForAllTenants.mockImplementation(async (key: string) =>
			key === 'weekly_report_day' ? new Map([[TENANT, 'thursday']]) : new Map(),
		);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.weeklyReportSent).toBe(0);
		expect(mockSendWeeklyEmail).not.toHaveBeenCalled();
	});

	it('standard 以上には送る', async () => {
		mockRepos.settings.getSettingForAllTenants.mockImplementation(async (key: string) =>
			key === 'weekly_report_day' ? new Map([[TENANT, 'thursday']]) : new Map(),
		);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.weeklyReportSent).toBe(1);
		expect(mockSendWeeklyEmail).toHaveBeenCalledWith('owner@example.com', expect.anything());
	});
});

// ============================================================
// ストリーク判定
// ============================================================

describe('streakDaysFromDates', () => {
	it('連続している日数だけ数える', () => {
		expect(streakDaysFromDates(['2026-08-19', '2026-08-18', '2026-08-17'], '2026-08-19')).toBe(3);
	});

	it('途切れたらそこで止まる', () => {
		expect(streakDaysFromDates(['2026-08-19', '2026-08-17'], '2026-08-19')).toBe(1);
	});

	it('起点の日に記録が無ければ 0', () => {
		expect(streakDaysFromDates(['2026-08-17'], '2026-08-19')).toBe(0);
	});
});

// ADR-0012 anti-engagement: 「記録しよう」の催促は、既に記録した家庭に届いた時点で
// 無意味な急かしになる。毎朝きちんと記録している家庭ほど毎日鳴らされる逆転を作らない。
describe('リマインダーの対象選別', () => {
	it('全員が今日すでに記録していれば送らない', async () => {
		mockRepos.activity.findDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-08-20' },
		]);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.reminderSent).toBe(0);
		expect(mockSendPush).not.toHaveBeenCalled();
		// 対象がいない日はマーカーも立てない (その日の後半に対象が生じたら送る)
		expect(mockRepos.settings.setSetting).not.toHaveBeenCalled();
	});

	it('未記録の子供だけを本文に載せる', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 'c-1', nickname: 'たろう' },
			{ id: 'c-2', nickname: 'はなこ' },
		]);
		mockRepos.activity.findDistinctRecordedDates.mockImplementation(async (childId: string) =>
			childId === 'c-1' ? [{ recordedDate: '2026-08-20' }] : [],
		);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.reminderSent).toBe(1);
		const body = mockSendPush.mock.calls.find((c) => c[1] === 'reminder')?.[3] as string;
		expect(body).toContain('はなこ');
		expect(body).not.toContain('たろう');
	});
});

describe('ストリーク警告の対象選別', () => {
	it('今日すでに記録していれば送らない (途切れないため)', async () => {
		mockRepos.activity.findDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-08-20' },
			{ recordedDate: '2026-08-19' },
		]);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '20:00') });

		expect(result.streakWarningSent).toBe(0);
	});

	it('ストリークが 0 なら送らない (失うものが無い)', async () => {
		mockRepos.activity.findDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-08-10' },
		]);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '20:00') });

		expect(result.streakWarningSent).toBe(0);
	});

	// ADR-0012 anti-engagement: push の宛先はテナント (親の端末) であって子供ごとではない。
	// 子供の数だけ送ると同じ端末が連続で鳴り、1 日 3 通上限を兄弟で使い切ってその日の
	// 他の通知が全部落ちる。
	it('子供が複数いても push は 1 通にまとめる (通知連打しない)', async () => {
		mockRepos.child.findAllChildren.mockResolvedValue([
			{ id: 'c-1', nickname: 'たろう' },
			{ id: 'c-2', nickname: 'はなこ' },
		]);
		mockRepos.activity.findDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-08-19' },
			{ recordedDate: '2026-08-18' },
		]);

		await runNotificationDelivery({ now: jst('2026-08-20', '20:00') });

		const streakCalls = mockSendPush.mock.calls.filter((c) => c[1] === 'streak_warning');
		expect(streakCalls).toHaveLength(1);
		// 1 通に両方の子供が入る
		const body = streakCalls[0]?.[3] as string;
		expect(body).toContain('たろう');
		expect(body).toContain('はなこ');
	});

	it('今日未記録かつストリーク継続中なら日数を本文に入れて送る', async () => {
		mockRepos.activity.findDistinctRecordedDates.mockResolvedValue([
			{ recordedDate: '2026-08-19' },
			{ recordedDate: '2026-08-18' },
			{ recordedDate: '2026-08-17' },
		]);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '20:00') });

		expect(result.streakWarningSent).toBe(1);
		const body = mockSendPush.mock.calls.find((c) => c[1] === 'streak_warning')?.[3] as string;
		expect(body).toContain('3日れんぞく');
	});
});

// ============================================================
// 値域外の設定値 / self-limiting
// ============================================================

describe('値域外の設定値', () => {
	it('25:99 のような値は既定 (09:00) に倒す — 1 テナントの不正値で全体を止めない', () => {
		expect(reminderMinuteOfDay('25:99', TENANT)).toBe(9 * 60);
		expect(reminderMinuteOfDay(undefined, TENANT)).toBe(9 * 60);
		expect(reminderMinuteOfDay('07:30', TENANT)).toBe(7 * 60 + 30);
	});
});

describe('self-limiting (30 秒予算)', () => {
	it('予算を使い切ったら残りを持ち越し、件数をレスポンスに出す (silent 持ち越し禁止)', async () => {
		mockRepos.auth.listAllTenants.mockResolvedValue([
			{ tenantId: 't-1' },
			{ tenantId: 't-2' },
			{ tenantId: 't-3' },
		]);

		const result = await runNotificationDelivery({
			now: jst('2026-08-20', '10:00'),
			budget: { exceeded: () => true, elapsedMs: () => 0 },
		});

		expect(result.scanned).toBe(0);
		expect(result.delivered).toBe(0);
		expect(result.tenantsRemaining).toBe(3);
	});

	// 走査数で上限を数えると、対象でないテナントを 50 件見ただけで打ち切られ、
	// 51 件目以降が毎回同じ位置で切り捨てられて恒久的に 1 通も届かなくなる。
	it('上限は「配信したテナント数」で数える (対象外を走査しても消費しない)', async () => {
		const tenants = Array.from({ length: 5 }, (_, i) => ({ tenantId: `t-${i + 1}` }));
		mockRepos.auth.listAllTenants.mockResolvedValue(tenants);
		// t-5 だけがリマインダー対象 (他はマーカー済で対象外)
		mockRepos.settings.getSettingForAllTenants.mockImplementation(async (key: string) =>
			key === 'notification_reminder_sent_date'
				? new Map(tenants.slice(0, 4).map((t) => [t.tenantId, '2026-08-20']))
				: new Map(),
		);

		const result = await runNotificationDelivery({
			now: jst('2026-08-20', '10:00'),
			deliveryLimit: 1,
		});

		expect(result.scanned).toBe(5);
		expect(result.delivered).toBe(1);
		expect(result.reminderSent).toBe(1);
		expect(result.tenantsRemaining).toBe(0);
	});

	// NUC (sqlite backend) は findTenantMembers が [] を返すため owner が見つからない。
	// 「設定は有効なのに 1 通も来ない」を運用側から観測できないと原因究明ができない。
	it('週次メールの宛先を解決できない場合を件数で報告する (silent にしない)', async () => {
		mockRepos.auth.findTenantMembers.mockResolvedValue([]);
		mockRepos.settings.getSettingForAllTenants.mockImplementation(async (key: string) =>
			key === 'weekly_report_day' ? new Map([[TENANT, 'thursday']]) : new Map(),
		);

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.weeklyReportSent).toBe(0);
		expect(result.skippedNoRecipient).toBe(1);
		expect(mockSendWeeklyEmail).not.toHaveBeenCalled();
	});

	it('1 テナントの失敗が他テナントの配信を止めない', async () => {
		mockRepos.auth.listAllTenants.mockResolvedValue([{ tenantId: 't-1' }, { tenantId: 't-2' }]);
		mockRepos.child.findAllChildren.mockRejectedValueOnce(new Error('db err'));

		const result = await runNotificationDelivery({ now: jst('2026-08-20', '10:00') });

		expect(result.errors).toBe(1);
		expect(result.scanned).toBe(2);
		expect(result.reminderSent).toBe(1);
	});
});
