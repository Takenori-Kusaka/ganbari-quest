// tests/unit/routes/settings-notifications-guide.test.ts
// #4664 (EPIC #4650): 「設定できるのに届かない」class を機械 gate 化する。
//
// 観測された実害:
//   - リマインダー / ストリーク警告 のチェックボックスは設定画面にあるのに、それを送る
//     cron が `schedule-registry.ts` にも cron-dispatcher にも登録されておらず、ON にしても
//     一度も届かなかった (#4706 / PR #4796 が配信 cron を実装して解消)
//   - ガイドの goal が「お子さま自身が活動を思い出すきっかけ」で、届く先 (購読した保護者の
//     この端末) と逆の印象を与えていた
//   - 通知種別が「連続記録のお祝い」で、実チェックボックス名 (ストリーク警告) とずれていた
//   - リマインダー時刻 / サイレント時間帯 / 1 日の上限 / 「ブロック中」の復旧手順が未説明
//
// 本 test が固定する不変条件は 1 つ:
//   **設定画面が入力欄を出す通知種別には、必ず配信経路がある**
// 配信経路は 2 種類しかない — cron (`scheduleRegistry` に登録された endpoint) か、
// 記録時の同期送信 (`sendAchievementNotification`)。どちらも無い種別の入力欄を出したら fail する。
//
// PO 決裁 (2026-08-20): 同じ欠陥に対し「UI を撤去する」案と「配信を実装する」案が並走していたが、
// ADR-0012 §6 がこの 3 種 (リマインダー / ストリーク警告 / 達成通知) を名指しで許容している
// ため、**配信を実装する**方を採る。本 test は撤去側の gate ではなく「約束したものは届く」側の
// gate として働く (#4796 の cron が登録されている限り緑、外れたら赤)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_QUIET_END,
	DEFAULT_QUIET_START,
	MAX_DAILY_NOTIFICATIONS,
} from '$lib/domain/constants/notification';
import { PAGE_GUIDE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
import { scheduleRegistry } from '$lib/server/cron/schedule-registry';
import { SETTINGS_NOTIFICATIONS_GUIDE } from '../../../src/routes/(parent)/admin/settings/notifications/_guide';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings/notifications/+page.svelte');
const ACTIVITY_LOG_SERVICE = path.join(
	REPO_ROOT,
	'src/lib/server/services/activity-log-service.ts',
);

const STEPS = PAGE_GUIDE_LABELS.adminSettingsNotifications.steps;
/** `as const` 由来のリテラル union を、tips 有無に依らず読める形に落とす。 */
type GuideStepText = {
	title: string;
	what: string;
	how: string;
	goal: string;
	tips?: readonly string[];
};
const ALL_TEXT = (Object.values(STEPS) as GuideStepText[])
	.flatMap((s) => [s.title, s.what, s.how, s.goal, ...(s.tips ?? [])])
	.join('\n');

/**
 * 設定画面が入力欄を出す通知種別と、その配信経路 (SSOT)。
 *
 * `cronEndpoint` … `scheduleRegistry` に登録された endpoint が送る (定期配信)
 * `syncSender`   … 記録時に service から同期送信される関数名 (cron 不要)
 *
 * **入力欄を増やしたらここにも足す**。足さずに欄だけ増やすと [N2] が「配信経路が無い」で落ちる。
 */
const PROMISED_DELIVERIES = [
	{
		field: 'remindersEnabled',
		label: () => SETTINGS_LABELS.notificationReminderLabel,
		cronEndpoint: '/api/cron/notification-delivery',
		syncSender: null,
	},
	{
		field: 'streakEnabled',
		label: () => SETTINGS_LABELS.notificationStreakLabel,
		cronEndpoint: '/api/cron/notification-delivery',
		syncSender: null,
	},
	{
		field: 'achievementsEnabled',
		label: () => SETTINGS_LABELS.notificationAchievementLabel,
		cronEndpoint: null,
		syncSender: 'sendAchievementNotification',
	},
] as const;

/** endpoint が cron から起動されるか (起動されないものは「届かない」)。 */
function isScheduled(endpoint: string): boolean {
	return scheduleRegistry.some((job) => job.endpoint === endpoint);
}

describe('#4664 通知設定は「届くもの」だけを約束する', () => {
	// 設定画面に出ている入力欄の集合を、SSOT の宣言と突き合わせる。
	// 「欄はあるのに宣言が無い」= 配信経路を誰も確認していない状態を作らせない。
	it('[N1] 設定画面の入力欄と PROMISED_DELIVERIES が過不足なく一致する', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		const onPage = [...source.matchAll(/name="(\w+Enabled)"/g)]
			.map((m) => m[1])
			.filter((n): n is string => n !== undefined);
		expect([...new Set(onPage)].sort()).toEqual(PROMISED_DELIVERIES.map((d) => d.field).sort());
	});

	// 本 test の中心。**約束したものは届く**。
	it('[N2] 入力欄を出している通知種別には配信経路がある (cron 登録 or 同期送信)', () => {
		const undelivered: string[] = [];
		const activityLogSource = fs.readFileSync(ACTIVITY_LOG_SERVICE, 'utf8');
		for (const d of PROMISED_DELIVERIES) {
			if (d.cronEndpoint !== null) {
				if (!isScheduled(d.cronEndpoint)) {
					undelivered.push(`${d.field}: cron ${d.cronEndpoint} が scheduleRegistry に無い`);
				}
				continue;
			}
			if (d.syncSender !== null && !activityLogSource.includes(d.syncSender)) {
				undelivered.push(`${d.field}: 同期送信 ${d.syncSender} の呼び出しが無い`);
			}
		}
		expect(
			undelivered,
			`設定画面が約束しているのに配信経路が無い通知:\n  ${undelivered.join('\n  ')}\n` +
				'→ 配信を実装する (cron なら schedule-registry.ts に登録) か、入力欄を出さない',
		).toEqual([]);
	});

	// ガイドが挙げる種別名 = 画面のチェックボックス名。片方だけ増減すると顧客が探せなくなる。
	it('[N3] ガイドが 3 種すべてを画面と同じ語で挙げている', () => {
		const how = STEPS['settings-notifications-types'].how;
		const what = STEPS['settings-notifications-types'].what;
		const text = `${what}\n${how}`;
		for (const d of PROMISED_DELIVERIES) {
			expect(text, `ガイドが「${d.label()}」に触れていない`).toContain(d.label());
		}
	});

	it('[N4] 保存 action が入力欄のある設定を全て書き込む', () => {
		const server = fs.readFileSync(
			path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings/notifications/+page.server.ts'),
			'utf8',
		);
		for (const key of [
			'notification_reminders_enabled',
			'notification_reminder_time',
			'notification_streak_enabled',
			'notification_achievements_enabled',
		]) {
			expect(server, `${key} を保存していない`).toContain(`setSetting('${key}'`);
		}
	});

	it('[N5] 届く先が「保護者のこの端末」だと概要で述べている', () => {
		const intro = STEPS['settings-notifications-intro'];
		expect(`${intro.what}\n${intro.goal}`).toMatch(/端末/);
		// 「お子さま自身が思い出す」型の逆説明が残っていないこと
		expect(ALL_TEXT).not.toMatch(/お子さま自身が/);
	});

	// #4664 M: 時刻欄は checkbox を押した瞬間ではなく、保存後の再読込 data で描画される。
	it('[N6] リマインダー時刻の出現条件がガイドと実装で一致する', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		expect(source, '時刻欄が remindersEnabled の保存値で出し分けられていない').toContain(
			'{#if data.notificationSettings.remindersEnabled}',
		);
		const types = STEPS['settings-notifications-types'] as GuideStepText;
		const text = [types.how, ...(types.tips ?? [])].join('\n');
		expect(text, '「保存したあとに出る」条件を述べていない').toMatch(/保存/);
		expect(text).toContain(SETTINGS_LABELS.notificationReminderTimeLabel);
	});

	it('[N7] ブロック中の復旧手順がガイドで読める', () => {
		const how = STEPS['settings-notifications-status'].how;
		expect(how, 'ブロック中に触れていない').toContain(SETTINGS_LABELS.notificationStatusBlocked);
		expect(how, '復旧手順（サイト設定 → 再読み込み）が無い').toMatch(/サイト設定/);
		expect(how).toMatch(/再読み込み/);
	});

	it('[N8] サイレント時間帯の既定値と 1 日上限が実装の値と一致する', () => {
		const quiet = STEPS['settings-notifications-quiet'] as GuideStepText;
		expect(quiet.what).toContain(DEFAULT_QUIET_START);
		expect(quiet.what).toContain(DEFAULT_QUIET_END);
		expect((quiet.tips ?? []).join('\n')).toContain(String(MAX_DAILY_NOTIFICATIONS));
	});

	it('[N9] 保存 step があり、保存ボタン名が画面と一致する', () => {
		const save = STEPS['settings-notifications-save'];
		expect(save.how).toContain(SETTINGS_LABELS.notificationSaveAction);
		expect(save.goal, '保存後に何が起きるかが結果表現で書かれていない').toMatch(/届く/);
	});

	it('[N10] 全 step が常設要素を指し、anchor がページに実在する', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		for (const step of SETTINGS_NOTIFICATIONS_GUIDE.steps) {
			expect(step.optional ?? false, `${step.id} に optional が付いている`).toBe(false);
			if (!step.selector) continue;
			const anchor = step.selector.match(/data-tutorial="([a-z0-9-]+)"/)?.[1];
			expect(anchor, `${step.id} の selector が data-tutorial 形式でない`).toBeDefined();
			expect(source, `${step.id} の anchor "${anchor}" がページに無い`).toContain(
				`data-tutorial="${anchor}"`,
			);
		}
	});
});
