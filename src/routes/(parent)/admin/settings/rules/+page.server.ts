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
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
// #2391 (Phase 2): rule-preset in-page UnifiedImportHub のため dispatcher 経由 import 追加
import { dispatchImport } from '$lib/marketplace';
// #2368 (ADR-0052): bonus state SSOT は marketplace strategy 配下に移動済。
import {
	loadBonusOverrides,
	removeBonusPreset,
	setBonusPresetEnabled,
} from '$lib/marketplace/strategies/rule-preset/bonus-state';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);

	let bonusOverrides: Awaited<ReturnType<typeof loadBonusOverrides>> = { presets: [] };
	try {
		bonusOverrides = await loadBonusOverrides(tenantId);
	} catch (e) {
		logger.error('[admin/settings/rules] loadBonusOverrides 失敗', { error: String(e) });
	}

	// #2391 (Phase 2): rule-preset の UnifiedImportHub preset 一覧
	const rulePresets = getMarketplaceIndex()
		.filter((m) => m.type === 'rule-preset')
		.map((m) => ({
			itemId: m.itemId,
			name: m.name,
			icon: m.icon,
			itemCount: m.itemCount,
			targetAgeMin: m.targetAgeMin,
			targetAgeMax: m.targetAgeMax,
		}));

	// #2362 PR-6: `?import=<presetId>` で marketplace から遷移した場合、
	// 自動取込のために presetId を validate し client 側 $effect で `?/importMarketplaceRulePreset`
	// action を 1 度だけ POST する。dialog 不要 (family scope、即取込 + toast)。
	// 不正な presetId / 非 bonus type は client 側 toast で error 表示。
	const importPresetIdRaw = url.searchParams.get('import')?.trim() || null;
	let importPresetId: string | null = null;
	let importPresetError: 'not-found' | 'wrong-type' | null = null;
	if (importPresetIdRaw) {
		const item = getMarketplaceItem('rule-preset', importPresetIdRaw);
		if (!item) {
			importPresetError = 'not-found';
		} else if (
			!('ruleType' in item.payload) ||
			(item.payload as { ruleType: string }).ruleType !== 'bonus'
		) {
			// exchange / penalty / special は本画面の auto-import 対象外。
			// exchange は admin/rewards 経由、penalty / special は ADR-0012 細則で取込不可。
			importPresetError = 'wrong-type';
		} else {
			importPresetId = importPresetIdRaw;
		}
	}

	return {
		bonusPresets: bonusOverrides.presets,
		rulePresets,
		importPresetId,
		importPresetIdRaw,
		importPresetError,
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

	// #2391 (Phase 2): UnifiedImportHub から rule-preset 一括追加 (ADR-0052 dispatchImport 経由)
	importMarketplaceRulePreset: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const presetId = String(formData.get('presetId') ?? '').trim();
		if (!presetId) return fail(400, { error: 'プリセットIDが必要です' });

		const item = getMarketplaceItem('rule-preset', presetId);
		if (!item) {
			return fail(404, { error: `プリセット「${presetId}」が見つかりません` });
		}

		try {
			const result = await dispatchImport({
				typeCode: 'rule-preset',
				rawPayload: item.payload,
				displayName: item.name,
				ctx: { tenantId, presetId },
			});
			// Hub 互換 top-level shape
			return {
				packName: result.packName,
				imported: result.imported,
				skipped: result.skipped,
				total: result.total,
				errors: result.errors,
				presetId,
			};
		} catch (e) {
			logger.error('[admin/settings/rules] importMarketplaceRulePreset 失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { presetId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},
};
