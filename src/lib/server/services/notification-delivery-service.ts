// src/lib/server/services/notification-delivery-service.ts
// #4706: 設定 UI が約束する 3 配信を実際に送る cron 本体。
//
// ## なぜ要るか
//
// `/admin/reports` は「週次レポートを有効にする / 配信曜日 / 保存」を出し、無料プランには
// 「週次メールレポートはスタンダードプラン以上の特典です」と upsell していた。
// `/admin/settings/notifications` も「リマインダー通知 / リマインダー時刻」「ストリーク警告」を
// 保存できた。**しかしどれも送信ジョブが存在せず、保存した設定は 1 度も使われていなかった。**
// 送信 endpoint (`/api/v1/admin/weekly-report` ほか) は「呼ばれる側」として実在したが、
// tenant を列挙して叩く呼び手がどの runtime にも無かった (#4706 F2/F3)。
//
// 有料の特典として案内し、設定させ、保存まで成功したのに届かない — 有料契約者が最初に
// クレームする類の欠陥なので、**1 本の cron が 3 配信をまとめて担う**。
//
// ## 設計
//
// - **判定用の設定は全テナント分をキーごとに 1 クエリで読む** (`getSettingForAllTenants`)。
//   本 job は 15 分ごとに走るため、テナントごとに `getSettings` を引くと
//   15 分 × テナント数 × キー数のクエリになる (ADR-0065 原則 2 の N+1)。
//   判定キーは固定数なので、実行回数をテナント数から切り離す。
// - **送信済マーカーで冪等**にする。dispatcher の非同期 retry や手動再実行で 2 通目を送らない
//   (`deletion-warning-service` / `pmf-survey-service` と同方式)。
// - **30 秒予算で self-limiting**。テナント単位のループ先頭で時間予算を確認し、
//   残りは次回実行へ持ち越す。持ち越し件数はレスポンスと log に必ず出す (silent 持ち越し禁止)。
// - quiet hours / 日次上限は `sendPushNotification` が内部で `canSendNotification` を通すので
//   ここでは重複判定しない。

import { formatChildName, formatChildNames } from '$lib/domain/child-display';
import {
	jstDayOfWeek,
	jstHour,
	jstMinuteOfDay,
	prevDateJST,
	toJSTDateString,
	weekStartJST,
} from '$lib/domain/date-utils';
import { isHhMmTimeSetting } from '$lib/domain/export-format';
import type { ChildId } from '$lib/domain/ids';
import { createTimeBudget, type TimeBudget } from '$lib/server/cron/time-budget';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendWeeklyReportEmail, type WeeklyReportData } from './email-service';
import { getLicenseInfo } from './license-service';
import { sendPushNotification } from './notification-service';
import { resolveFullPlanTier } from './plan-limit-service';
import { generateWeeklyReport } from './weekly-report-service';

// ============================================================
// 定数
// ============================================================

/** 曜日設定 (`weekly_report_day`) の値 → `jstDayOfWeek()` の戻り値 (0=日曜)。 */
const WEEKDAY_TO_JST_INDEX: Record<string, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
};

/** 週次メールを送る JST 時刻 (この時刻以降の最初の実行で 1 回だけ送る)。 */
export const WEEKLY_REPORT_HOUR_JST = 9;

/**
 * ストリーク警告を送る JST 時刻。
 *
 * quiet hours の既定 (21:00-07:00) より前で、かつ「今日まだ記録していない」が確定に近い時間帯。
 * 19:00 なら子供が寝る前に取り返せる (Anti-engagement / ADR-0012: 連打せず 1 日 1 回)。
 */
export const STREAK_WARNING_HOUR_JST = 19;

/** 1 回の実行で処理するテナント数の上限 (時間予算と併用の二重打ち切り)。 */
export const DEFAULT_TENANT_LIMIT = 50;

/** ストリーク日数の走査上限。これ以上遡っても警告文の意味は変わらない。 */
const STREAK_SCAN_LIMIT_DAYS = 365;

const SETTING_KEYS = {
	weeklyEnabled: 'weekly_report_enabled',
	weeklyDay: 'weekly_report_day',
	weeklySentWeek: 'weekly_report_sent_week',
	remindersEnabled: 'notification_reminders_enabled',
	reminderTime: 'notification_reminder_time',
	reminderSentDate: 'notification_reminder_sent_date',
	streakEnabled: 'notification_streak_enabled',
	streakSentDate: 'notification_streak_sent_date',
} as const;

/** `notification_reminder_time` の既定 (`getNotificationSettings` と同値)。 */
const DEFAULT_REMINDER_TIME = '09:00';

// ============================================================
// 型
// ============================================================

export interface NotificationDeliveryOptions {
	now?: Date;
	dryRun?: boolean;
	budget?: TimeBudget;
	tenantLimit?: number;
}

export interface NotificationDeliveryResult {
	scanned: number;
	weeklyReportSent: number;
	reminderSent: number;
	streakWarningSent: number;
	errors: number;
	/** 時間予算 / 件数上限で持ち越したテナント数 (silent 持ち越し禁止)。 */
	tenantsRemaining: number;
	dryRun: boolean;
}

interface DueFlags {
	weekly: boolean;
	reminder: boolean;
	streak: boolean;
}

// ============================================================
// 判定 (純粋関数 — DB を触らない。unit test はここを直接叩ける)
// ============================================================

/** 「有効」判定。未保存は既定で有効 (`getNotificationSettings` と同じ向き)。 */
function isEnabledByDefault(value: string | undefined): boolean {
	return value !== 'false' && value !== '0';
}

/** 週次レポートの有効判定。未保存は既定で有効 (`/admin/reports` の `!== '0'` と同じ)。 */
function isWeeklyEnabled(value: string | undefined): boolean {
	return value !== '0' && value !== 'false';
}

/**
 * `HH:MM` を「その日の 0:00 からの経過分」に直す。
 *
 * **値域外 (`25:99` 等) は既定値に倒す。** 保存側の validation は本 PR で 00:00-23:59 に
 * 狭めたが、それ以前に保存された値が残りうる。ここで throw すると 1 テナントの不正値で
 * 全テナントの配信が止まるため、既定に倒して warn する。
 */
export function reminderMinuteOfDay(raw: string | undefined, tenantId: string): number {
	const value = raw ?? DEFAULT_REMINDER_TIME;
	if (!isHhMmTimeSetting(value)) {
		logger.warn('[notification-delivery] リマインダー時刻が値域外のため既定値を使う', {
			context: { tenantId, expected: 'HH:MM (00:00-23:59)' },
		});
		return reminderMinuteOfDay(DEFAULT_REMINDER_TIME, tenantId);
	}
	const [hour, minute] = value.split(':').map(Number);
	return (hour ?? 0) * 60 + (minute ?? 0);
}

/**
 * 連続記録日数を「記録のあった日付の集合」から求める (#4706)。
 *
 * `report-service` の `calculateStreak` は 1 日 1 クエリで最大 365 往復するため、
 * 全テナント × 全子供を回る cron では 30 秒予算に収まらない。
 * `findDistinctRecordedDates` の 1 クエリ分をメモリ上で辿る。
 *
 * `from` に「昨日」を渡すと「今日が途切れる直前のストリーク」が得られる。
 */
export function streakDaysFromDates(recordedDates: readonly string[], from: string): number {
	const dates = new Set(recordedDates);
	let streak = 0;
	let cursor = from;
	while (streak < STREAK_SCAN_LIMIT_DAYS && dates.has(cursor)) {
		streak++;
		cursor = prevDateJST(cursor);
	}
	return streak;
}

/** そのテナントで今この瞬間に送るべきものがあるかを、設定値だけから判定する。 */
export function resolveDueFlags(input: {
	tenantId: string;
	now: Date;
	weeklyEnabled: string | undefined;
	weeklyDay: string | undefined;
	weeklySentWeek: string | undefined;
	remindersEnabled: string | undefined;
	reminderTime: string | undefined;
	reminderSentDate: string | undefined;
	streakEnabled: string | undefined;
	streakSentDate: string | undefined;
}): DueFlags {
	const today = toJSTDateString(input.now);
	const minuteOfDay = jstMinuteOfDay(input.now);
	const hour = jstHour(input.now);

	const weekly =
		isWeeklyEnabled(input.weeklyEnabled) &&
		WEEKDAY_TO_JST_INDEX[input.weeklyDay ?? 'monday'] === jstDayOfWeek(input.now) &&
		hour >= WEEKLY_REPORT_HOUR_JST &&
		input.weeklySentWeek !== weekStartJST(input.now);

	const reminder =
		isEnabledByDefault(input.remindersEnabled) &&
		minuteOfDay >= reminderMinuteOfDay(input.reminderTime, input.tenantId) &&
		input.reminderSentDate !== today;

	const streak =
		isEnabledByDefault(input.streakEnabled) &&
		hour >= STREAK_WARNING_HOUR_JST &&
		input.streakSentDate !== today;

	return { weekly, reminder, streak };
}

// ============================================================
// 送信
// ============================================================

/** 週次レポート 1 テナント分。送れた子供の数を返す (0 ならマーカーを立てない)。 */
async function sendWeeklyReport(tenantId: string, now: Date, dryRun: boolean): Promise<number> {
	const repos = getRepos();

	// #735: 週次メールレポートは standard 以上の特典。free は送らない
	// (送信 endpoint 側と同じ gate をここでも通す — 呼び手が増えても判定が 1 箇所に寄るように
	//  plan-limit-service の resolveFullPlanTier を共有する)。
	const licenseInfo = await getLicenseInfo(tenantId);
	if (!licenseInfo) return 0;
	const planTier = await resolveFullPlanTier(tenantId, licenseInfo.status, licenseInfo.plan);
	if (planTier === 'free') return 0;

	const members = await repos.auth.findTenantMembers(tenantId);
	const owner = members.find((m) => m.role === 'owner');
	if (!owner) return 0;
	const ownerUser = await repos.auth.findUserById(owner.userId);
	if (!ownerUser?.email) return 0;

	const children = await repos.child.findAllChildren(tenantId);
	if (children.length === 0) return 0;

	let sent = 0;
	for (const child of children) {
		const data = await buildWeeklyReportData(child, tenantId, now);
		if (dryRun) {
			sent++;
			continue;
		}
		if (await sendWeeklyReportEmail(ownerUser.email, data)) sent++;
	}
	return sent;
}

/**
 * 週次メール 1 通分のデータを作る。
 *
 * **`streak` と `diff` (前週比) を実数で埋める。** メールは「🔥 連続記録: N日」「±0」と
 * そのまま描くため、0 固定にすると顧客には「連続 0 日」「全カテゴリ増減なし」と読める嘘が届く。
 * 週次 = 1 テナントにつき週 1 回なので、前週レポートの生成 (1 往復) と
 * 記録日一覧 (1 クエリ) を足すコストは許容範囲にある。
 */
async function buildWeeklyReportData(
	child: { id: string; nickname: string },
	tenantId: string,
	now: Date,
): Promise<WeeklyReportData> {
	const repos = getRepos();
	const childId = child.id as ChildId;
	const lastWeek = new Date(now.getTime() - 7 * 86_400_000);

	const [report, prevReport, recordedRows] = await Promise.all([
		generateWeeklyReport(childId, child.nickname, tenantId, now),
		generateWeeklyReport(childId, child.nickname, tenantId, lastWeek),
		repos.activity.findDistinctRecordedDates(childId, tenantId),
	]);

	const prevCount = new Map(
		prevReport.categories.map((c) => [c.categoryName, c.activityCount] as const),
	);
	const recordedDates = recordedRows.map((r) => r.recordedDate);
	const today = toJSTDateString(now);
	// 今日まだ記録していない日に送っても「昨日までの連続」を正しく出す
	const streakFrom = recordedDates.includes(today) ? today : prevDateJST(today);

	return {
		childName: child.nickname,
		dateRange: `${report.weekStart} 〜 ${report.weekEnd}`,
		categories: report.categories.map((c) => ({
			name: c.categoryName,
			count: c.activityCount,
			diff: c.activityCount - (prevCount.get(c.categoryName) ?? 0),
		})),
		streak: streakDaysFromDates(recordedDates, streakFrom),
		pointsEarned: report.totalPoints,
		totalPoints: report.categories.reduce((sum, c) => sum + c.totalXp, 0),
		newAchievements: report.newAchievements.map((a) => a.name),
	};
}

/** リマインダー push 1 テナント分。送れたら true。 */
async function sendReminder(tenantId: string, dryRun: boolean): Promise<boolean> {
	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);
	const nameLabel = formatChildNames(
		children.map((c) => c.nickname),
		'possessive',
	);
	if (!nameLabel) return false;
	if (dryRun) return true;

	const result = await sendPushNotification(
		tenantId,
		'reminder',
		'きょうも がんばろう！',
		`${nameLabel}がんばりを きろくしよう！`,
		{ type: 'reminder' },
	);
	return result.sent > 0;
}

/**
 * ストリーク警告 push 1 テナント分。送れたら true。
 *
 * **子供が複数いても push は 1 通にまとめる** (ADR-0012 anti-engagement: 通知連打は不採用)。
 * push の宛先はテナント (親の端末) であり子供ごとではないため、子供の数だけ送ると
 * 同じ端末が連続で鳴る。しかも 1 日 3 通の上限 (`MAX_DAILY_NOTIFICATIONS`) を
 * 兄弟 3 人で使い切り、その日の他の通知が全部落ちる。
 */
async function sendStreakWarning(tenantId: string, now: Date, dryRun: boolean): Promise<boolean> {
	const repos = getRepos();
	const today = toJSTDateString(now);
	const yesterday = prevDateJST(today);
	const children = await repos.child.findAllChildren(tenantId);

	const atRisk: Array<{ nickname: string; streakDays: number }> = [];
	for (const child of children) {
		const rows = await repos.activity.findDistinctRecordedDates(child.id as ChildId, tenantId);
		const dates = rows.map((r) => r.recordedDate);
		if (dates.includes(today)) continue; // 今日は記録済 = 途切れない
		const streakDays = streakDaysFromDates(dates, yesterday);
		if (streakDays === 0) continue; // そもそもストリークが無い
		atRisk.push({ nickname: child.nickname, streakDays });
	}
	if (atRisk.length === 0) return false;
	if (dryRun) return true;

	const body = atRisk
		.map(
			(c) =>
				`${formatChildName(c.nickname, 'possessive')}${c.streakDays}日れんぞくが きょうでとぎれちゃうよ！`,
		)
		.join(' ');
	const result = await sendPushNotification(
		tenantId,
		'streak_warning',
		'ストリークが あぶない！',
		`${body} いまからがんばろう！`,
		{ type: 'streak_warning' },
	);
	return result.sent > 0;
}

// ============================================================
// エントリポイント
// ============================================================

/** `SETTING_KEYS` の名前 → 全テナント分の保存値。判定に使うキーだけを 1 キー 1 クエリで読む。 */
type SettingMaps = Record<keyof typeof SETTING_KEYS, Map<string, string>>;

async function loadSettingMaps(): Promise<SettingMaps> {
	const repos = getRepos();
	const names = Object.keys(SETTING_KEYS) as Array<keyof typeof SETTING_KEYS>;
	const maps = await Promise.all(
		names.map((name) => repos.settings.getSettingForAllTenants(SETTING_KEYS[name])),
	);
	const result = {} as SettingMaps;
	names.forEach((name, index) => {
		result[name] = maps[index] ?? new Map();
	});
	return result;
}

/** 1 テナント分の保存値を `resolveDueFlags` の入力形へ写す (未保存は undefined のまま渡す)。 */
function pickTenantSettings(
	maps: SettingMaps,
	tenantId: string,
): Omit<Parameters<typeof resolveDueFlags>[0], 'tenantId' | 'now'> {
	return {
		weeklyEnabled: maps.weeklyEnabled.get(tenantId),
		weeklyDay: maps.weeklyDay.get(tenantId),
		weeklySentWeek: maps.weeklySentWeek.get(tenantId),
		remindersEnabled: maps.remindersEnabled.get(tenantId),
		reminderTime: maps.reminderTime.get(tenantId),
		reminderSentDate: maps.reminderSentDate.get(tenantId),
		streakEnabled: maps.streakEnabled.get(tenantId),
		streakSentDate: maps.streakSentDate.get(tenantId),
	};
}

/** 1 テナント分の配信。送れたものだけマーカーを立て、送信できた種別を返す。 */
async function deliverForTenant(
	tenantId: string,
	due: DueFlags,
	ctx: { now: Date; dryRun: boolean; today: string; weekKey: string },
): Promise<{ weekly: boolean; reminder: boolean; streak: boolean }> {
	const repos = getRepos();
	const mark = async (key: string, value: string): Promise<void> => {
		// dryRun ではマーカーを書かない (次回の実行判定を汚さない)
		if (!ctx.dryRun) await repos.settings.setSetting(key, value, tenantId);
	};

	const weekly = due.weekly && (await sendWeeklyReport(tenantId, ctx.now, ctx.dryRun)) > 0;
	if (weekly) await mark(SETTING_KEYS.weeklySentWeek, ctx.weekKey);

	const reminder = due.reminder && (await sendReminder(tenantId, ctx.dryRun));
	if (reminder) await mark(SETTING_KEYS.reminderSentDate, ctx.today);

	const streak = due.streak && (await sendStreakWarning(tenantId, ctx.now, ctx.dryRun));
	if (streak) await mark(SETTING_KEYS.streakSentDate, ctx.today);

	return { weekly, reminder, streak };
}

/**
 * 1 テナントを配信して結果を集計する。
 *
 * **1 テナントの失敗で残り全テナントの配信を止めない。** マーカーは立てないので次回再試行される。
 */
async function deliverAndTally(
	tenantId: string,
	due: DueFlags,
	ctx: { now: Date; dryRun: boolean; today: string; weekKey: string },
	result: NotificationDeliveryResult,
): Promise<void> {
	try {
		const sent = await deliverForTenant(tenantId, due, ctx);
		if (sent.weekly) result.weeklyReportSent++;
		if (sent.reminder) result.reminderSent++;
		if (sent.streak) result.streakWarningSent++;
	} catch (err) {
		result.errors++;
		logger.error('[notification-delivery] テナント処理に失敗 (他テナントは継続)', {
			error: err instanceof Error ? err.message : String(err),
			context: { tenantId },
		});
	}
}

export async function runNotificationDelivery(
	options: NotificationDeliveryOptions = {},
): Promise<NotificationDeliveryResult> {
	const now = options.now ?? new Date();
	const dryRun = options.dryRun === true;
	const budget = options.budget ?? createTimeBudget();
	const tenantLimit = options.tenantLimit ?? DEFAULT_TENANT_LIMIT;
	const repos = getRepos();

	const tenants = await repos.auth.listAllTenants();

	// 判定用の設定は「キーごとに 1 クエリ」で全テナント分を読む (N+1 回避、ADR-0065 原則 2)
	const settingMaps = await loadSettingMaps();

	const ctx = { now, dryRun, today: toJSTDateString(now), weekKey: weekStartJST(now) };

	const result: NotificationDeliveryResult = {
		scanned: 0,
		weeklyReportSent: 0,
		reminderSent: 0,
		streakWarningSent: 0,
		errors: 0,
		tenantsRemaining: 0,
		dryRun,
	};

	for (const [index, tenant] of tenants.entries()) {
		if (budget.exceeded() || result.scanned >= tenantLimit) {
			result.tenantsRemaining = tenants.length - index;
			break;
		}
		result.scanned++;
		const tenantId = tenant.tenantId;

		const due = resolveDueFlags({ tenantId, now, ...pickTenantSettings(settingMaps, tenantId) });
		if (!due.weekly && !due.reminder && !due.streak) continue;

		await deliverAndTally(tenantId, due, ctx, result);
	}

	logger.info('[notification-delivery] 配信バッチ完了', {
		context: { ...result, elapsedMs: budget.elapsedMs() },
	});
	return result;
}
