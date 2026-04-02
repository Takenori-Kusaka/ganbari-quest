import { requireTenantId } from '$lib/server/auth/factory';
import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import { generateReportsForChildren } from '$lib/server/services/weekly-report-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	const [children, reportSettings] = await Promise.all([
		getAllChildren(tenantId),
		getSettings(['weekly_report_enabled', 'weekly_report_day'], tenantId),
	]);

	const childList = children.map((c) => ({ id: c.id, nickname: c.nickname }));
	const reports = await generateReportsForChildren(childList, tenantId);

	return {
		reports,
		settings: {
			enabled: reportSettings.weekly_report_enabled !== '0',
			day: reportSettings.weekly_report_day ?? 'monday',
		},
	};
};

export const actions: Actions = {
	updateSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const enabled = fd.get('enabled') === 'on' ? '1' : '0';
		const day = String(fd.get('day') ?? 'monday');

		const validDays = [
			'monday',
			'tuesday',
			'wednesday',
			'thursday',
			'friday',
			'saturday',
			'sunday',
		];
		if (!validDays.includes(day)) {
			return fail(400, { error: '無効な曜日です' });
		}

		await setSetting('weekly_report_enabled', enabled, tenantId);
		await setSetting('weekly_report_day', day, tenantId);

		return { settingsUpdated: true };
	},
};
