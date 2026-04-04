import { redirect } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { setSetting } from '$lib/server/db/settings-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	applyChecklistPresets,
	getActivityDisplayCount,
	getRecommendedPresets,
} from '$lib/server/services/questionnaire-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}
	return { children };
};

export const actions: Actions = {
	submit: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();

		const challenges = formData.getAll('challenges').map(String);
		const activityLevel = (formData.get('activityLevel')?.toString() || 'normal') as
			| 'few'
			| 'normal'
			| 'many';
		const selectedPresets = formData.getAll('checklistPresets').map(String);

		// アンケート回答を設定に保存
		await setSetting('questionnaire_challenges', challenges.join(','), tenantId);
		await setSetting('questionnaire_activity_level', activityLevel, tenantId);
		await setSetting(
			'questionnaire_activity_display_count',
			String(getActivityDisplayCount(activityLevel)),
			tenantId,
		);

		// チェックリストプリセットを全子供に適用
		const presetsToApply =
			selectedPresets.length > 0 ? selectedPresets : getRecommendedPresets(challenges);

		const children = await getAllChildren(tenantId);
		for (const child of children) {
			await applyChecklistPresets(child.id, presetsToApply, tenantId);
		}

		trackSetupFunnel('setup_questionnaire_completed', tenantId, {
			challenges,
			activityLevel,
			presetCount: presetsToApply.length,
		});

		redirect(302, '/setup/packs');
	},

	skip: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_questionnaire_skipped', tenantId);
		redirect(302, '/setup/packs');
	},
};
