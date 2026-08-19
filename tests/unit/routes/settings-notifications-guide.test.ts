// tests/unit/routes/settings-notifications-guide.test.ts
// #4664 (EPIC #4650): 通知設定の「届かないものを約束する」class を機械 gate 化する。
//
// 観測された実害:
//   - リマインダー / ストリーク警告 の endpoint は存在するが、それを叩く cron が
//     schedule-registry.ts にも cron-dispatcher にも登録されていない = **一度も届かない**。
//     それでも設定画面にチェックボックスがあり、ガイドも「活動のリマインド」を訴求していた
//   - ガイドの goal が「お子さま自身が活動を思い出すきっかけ」で、届く先（購読した保護者の
//     この端末）と逆の印象を与えていた
//   - 通知種別が「連続記録のお祝い」で、実チェックボックス（達成通知 / ストリーク警告）とずれていた
//
// 「配信経路の無い通知種別を UI / ガイドに出していないか」は、cron 登録の有無から機械判定できる。

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
const SERVER = path.join(
	REPO_ROOT,
	'src/routes/(parent)/admin/settings/notifications/+page.server.ts',
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

/** 通知 endpoint が cron から起動されるか（起動されないものは「届かない」）。 */
function isScheduled(endpoint: string): boolean {
	return scheduleRegistry.some((job) => job.endpoint === endpoint);
}

describe('#4664 通知設定は「届くもの」だけを約束する', () => {
	// 前提の固定: この test の存在理由そのもの。将来 cron を実装したらここが false になり、
	// [N2] / [N3] を見直す合図になる（黙って前提が変わらない）。
	it('[N1] リマインダー / ストリーク警告 の配信 cron はまだ登録されていない', () => {
		expect(isScheduled('/api/v1/admin/notifications/reminder')).toBe(false);
		expect(isScheduled('/api/v1/admin/notifications/streak-warning')).toBe(false);
	});

	it('[N2] 配信経路の無い通知種別を設定画面に出していない', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		for (const name of ['remindersEnabled', 'reminderTime', 'streakEnabled']) {
			expect(source, `未配信の設定 "${name}" が入力欄として残っている`).not.toMatch(
				new RegExp(`name="${name}"`),
			);
		}
	});

	it('[N3] ガイドが未配信のお知らせ（リマインダー / ストリーク）を訴求していない', () => {
		for (const word of ['リマインダー', 'ストリーク']) {
			expect(ALL_TEXT, `ガイドが未配信の "${word}" を訴求している`).not.toContain(word);
		}
	});

	// UI から外しても保存値は消さない（配信を実装したら以前の設定で復帰させる）。
	it('[N4] 未配信設定の保存値をフォーム欄が無いことを理由に潰していない', () => {
		const source = fs.readFileSync(SERVER, 'utf8');
		for (const key of [
			'notification_reminders_enabled',
			'notification_reminder_time',
			'notification_streak_enabled',
		]) {
			expect(source, `${key} を setSetting で上書きしている`).not.toContain(`setSetting('${key}'`);
		}
	});

	it('[N5] 届く先が「保護者のこの端末」だと概要で述べている', () => {
		const intro = STEPS['settings-notifications-intro'];
		expect(`${intro.what}\n${intro.goal}`).toMatch(/端末/);
		// 「お子さま自身が思い出す」型の逆説明が残っていないこと
		expect(ALL_TEXT).not.toMatch(/お子さま自身が/);
	});

	it('[N6] 種類 step が画面のチェックボックス名をそのまま使っている', () => {
		expect(STEPS['settings-notifications-types'].how).toContain(
			SETTINGS_LABELS.notificationAchievementLabel,
		);
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
