// src/routes/(parent)/admin/settings/rules/+page.server.ts
// #2138 (MP-3): 取込済 rule-preset 管理画面
//
// マーケットプレイス取込済の bonus / exchange 系 rule-preset を一覧 + 管理する。
// - bonus preset: ON/OFF 切替 + 削除 (settings KVS の rule_preset_bonus_overrides JSON)
// - exchange preset: 子供ごとの special_rewards 一覧へのリンク (削除は /admin/rewards から)
//
// ADR-0012 §6 anti-engagement 細則: penalty / special タイプは本画面に表示しない
// (取込試行は audit log として settings.rule_preset_import_warnings に記録されるのみ)。

import { fail } from '@sveltejs/kit';
// #2368 (ADR-0052): bonus state SSOT は marketplace strategy 配下に移動済。
import {
	loadBonusOverrides,
	removeBonusPreset,
	setBonusPresetEnabled,
} from '$lib/marketplace/strategies/rule-preset/bonus-state';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	let bonusOverrides: Awaited<ReturnType<typeof loadBonusOverrides>> = { presets: [] };
	try {
		bonusOverrides = await loadBonusOverrides(tenantId);
	} catch (e) {
		logger.error('[admin/settings/rules] loadBonusOverrides 失敗', { error: String(e) });
	}

	return {
		bonusPresets: bonusOverrides.presets,
	};
};

export const actions: Actions = {
	togglePreset: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const presetId = String(formData.get('presetId') ?? '').trim();
		const enabledRaw = String(formData.get('enabled') ?? '').trim();

		if (!presetId) return fail(400, { error: 'プリセットIDが必要です' });
		const enabled = enabledRaw === 'true';

		try {
			await setBonusPresetEnabled(presetId, enabled, tenantId);
			return { toggleSuccess: true, presetId, enabled };
		} catch (e) {
			logger.error('[admin/settings/rules] togglePreset 失敗', {
				error: String(e),
				context: { presetId, enabled },
			});
			return fail(500, { error: 'ルール更新に失敗しました' });
		}
	},

	removePreset: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const presetId = String(formData.get('presetId') ?? '').trim();

		if (!presetId) return fail(400, { error: 'プリセットIDが必要です' });

		try {
			await removeBonusPreset(presetId, tenantId);
			return { removeSuccess: true, presetId };
		} catch (e) {
			logger.error('[admin/settings/rules] removePreset 失敗', {
				error: String(e),
				context: { presetId },
			});
			return fail(500, { error: 'ルール削除に失敗しました' });
		}
	},
};
