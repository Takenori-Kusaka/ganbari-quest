// #2320 (EPIC #2319 ①): notifications グループ load + action。
// 旧 /admin/settings/+page.server.ts から notification 関連を移行。
// 1 section だけのため軽量サブページ。

import { fail } from '@sveltejs/kit';
import { DEFAULT_QUIET_END, DEFAULT_QUIET_START } from '$lib/domain/constants/notification';
import { requireTenantId } from '$lib/server/auth/factory';
import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	let notificationSettings = {
		remindersEnabled: true,
		reminderTime: '09:00',
		streakEnabled: true,
		achievementsEnabled: true,
		quietStart: DEFAULT_QUIET_START,
		quietEnd: DEFAULT_QUIET_END,
	};

	try {
		const ns = await getSettings(
			[
				'notification_reminders_enabled',
				'notification_reminder_time',
				'notification_streak_enabled',
				'notification_achievements_enabled',
				'notification_quiet_start',
				'notification_quiet_end',
			],
			tenantId,
		);
		notificationSettings = {
			remindersEnabled: ns.notification_reminders_enabled !== 'false',
			reminderTime: ns.notification_reminder_time ?? '09:00',
			streakEnabled: ns.notification_streak_enabled !== 'false',
			achievementsEnabled: ns.notification_achievements_enabled !== 'false',
			quietStart: ns.notification_quiet_start ?? DEFAULT_QUIET_START,
			quietEnd: ns.notification_quiet_end ?? DEFAULT_QUIET_END,
		};
	} catch (err) {
		logger.error('[settings/notifications] load failed', { error: String(err) });
	}

	return { notificationSettings };
};

export const actions = {
	updateNotificationSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();

		const achievementsEnabled = form.has('achievementsEnabled') ? 'true' : 'false';
		const quietStart = form.get('quietStart')?.toString() ?? DEFAULT_QUIET_START;
		const quietEnd = form.get('quietEnd')?.toString() ?? DEFAULT_QUIET_END;

		const timeRegex = /^\d{2}:\d{2}$/;
		if (!timeRegex.test(quietStart) || !timeRegex.test(quietEnd)) {
			return fail(400, { notificationError: '時刻の形式が不正です' });
		}

		// #4664 F5: リマインダー / ストリーク警告 は配信するスケジューラが無いため UI から外した。
		//   保存値 (notification_reminders_enabled / _reminder_time / _streak_enabled) は
		//   **書き換えない** — フォームに欄が無いことを理由に 'false' で潰すと、配信を実装した
		//   ときに全テナントの設定が失われる。
		await setSetting('notification_achievements_enabled', achievementsEnabled, tenantId);
		await setSetting('notification_quiet_start', quietStart, tenantId);
		await setSetting('notification_quiet_end', quietEnd, tenantId);

		return { notificationSuccess: true };
	},
} satisfies Actions;
