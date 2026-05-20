// #2320 (EPIC #2319 ①): notifications グループ load + action。
// 旧 /admin/settings/+page.server.ts から notification 関連を移行。
// 1 section だけのため軽量サブページ。

import { fail } from '@sveltejs/kit';
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
		quietStart: '21:00',
		quietEnd: '07:00',
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
			quietStart: ns.notification_quiet_start ?? '21:00',
			quietEnd: ns.notification_quiet_end ?? '07:00',
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

		const remindersEnabled = form.has('remindersEnabled') ? 'true' : 'false';
		const reminderTime = form.get('reminderTime')?.toString() ?? '09:00';
		const streakEnabled = form.has('streakEnabled') ? 'true' : 'false';
		const achievementsEnabled = form.has('achievementsEnabled') ? 'true' : 'false';
		const quietStart = form.get('quietStart')?.toString() ?? '21:00';
		const quietEnd = form.get('quietEnd')?.toString() ?? '07:00';

		const timeRegex = /^\d{2}:\d{2}$/;
		if (!timeRegex.test(reminderTime) || !timeRegex.test(quietStart) || !timeRegex.test(quietEnd)) {
			return fail(400, { notificationError: '時刻の形式が不正です' });
		}

		await setSetting('notification_reminders_enabled', remindersEnabled, tenantId);
		await setSetting('notification_reminder_time', reminderTime, tenantId);
		await setSetting('notification_streak_enabled', streakEnabled, tenantId);
		await setSetting('notification_achievements_enabled', achievementsEnabled, tenantId);
		await setSetting('notification_quiet_start', quietStart, tenantId);
		await setSetting('notification_quiet_end', quietEnd, tenantId);

		return { notificationSuccess: true };
	},
} satisfies Actions;
