// src/routes/(parent)/admin/settings/rules/+page.server.ts
// #2895: 取込済 bonus rule-preset の確認 + 有効/無効トグル + 削除のみのシンプル画面。
//
// PO 判断 (2026-06-04): 「とくべつルール (rule-preset)」の in-page marketplace 風 browse UI /
// OverflowMenu / help-restore-export dialog 系の装飾を削ぎ落とし、本画面は「現在ある bonus ルールを
// 確認して ON / OFF を切り替える + 削除する」だけに簡素化した。
//
// 動作する bonus 機構 (streak-bonus / category-challenge / early-bird / weekend-special 2x /
// self-study-reward) は存続させる。marketplace 詳細 → `?import=<presetId>` の bonus auto-import 経路は
// bonus 取込導線として維持する (family scope、即取込 + toast)。
//
// 既存取込済テナントのデータ整合: settings KVS の rule_preset_bonus_overrides JSON に
// 残る preset entry (撤去済 sibling-coop 等を含む) はそのまま toggle / 削除できる
// (graceful degradation、loadBonusOverrides 参照)。

import { fail } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
// #2368 (ADR-0052): bonus state SSOT は marketplace strategy 配下に移動済。
import { dispatchImport } from '$lib/marketplace';
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

	// marketplace 詳細 → `?import=<presetId>` で遷移した bonus preset の auto-import 用 validate。
	// 不正な presetId / 非 bonus type は client 側 toast で error 表示。dialog 不要 (family scope)。
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
			// exchange は admin/rewards 経由、penalty / special は ADR-0012 細則で取込不可。
			importPresetError = 'wrong-type';
		} else {
			importPresetId = importPresetIdRaw;
		}
	}

	return {
		bonusPresets: bonusOverrides.presets,
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

	// marketplace 詳細 → `?import=<presetId>` bonus auto-import (ADR-0052 dispatchImport 経由)
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
			return {
				packName: result.packName,
				imported: result.imported,
				skipped: result.skipped,
				total: result.total,
				errors: result.errors,
				// #2955: rule-preset の errors は warnings (already-imported 等の非失敗) を merge した
				// 表示ログ。失敗判定は genuine error 数の failed を使う (warnings 誤算入の根治)。
				failed: result.failed,
				presetId,
			};
		} catch (e) {
			logger.error('[admin/settings/rules] importMarketplaceRulePreset 失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { presetId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},
};
