// #2140 MP-5: setup wizard β 採用 (3 step 分割) — step 3「おうちのルール一括追加」
// `setup/rewards/+page.server.ts` を template として横展開（ADR-0014 整合）。
//
// rule-preset 4 ruleType (bonus / exchange / penalty / special) の取込を MP-3 service
// (`rule-preset-import-service.ts`) に委譲する。
// - bonus: tenant スコープで取込 (childId 不要)
// - exchange: childId が必要 (special_rewards に紐付け)
// - penalty / special: ADR-0012 §6 細則で「未実装 ruleType」、本ステップでは
//   選択肢を提示するが取込試行は warning として記録される。setup フローでは敢えて
//   非表示にして bonus + exchange のみ提示する (Pre-PMF UX 単純化)。

import { redirect } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { RulePresetPayload } from '$lib/domain/marketplace-item';
// #2368 (ADR-0052 P3): Strategy 経由 (Registry 経由) で 4 ruleType sub-dispatcher を呼ぶ
import { marketplaceRegistry } from '$lib/marketplace';
import type { rulePresetStrategy } from '$lib/marketplace/strategies/rule-preset-strategy';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
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

	const ages = children.map((c) => c.age);
	const minAge = Math.min(...ages);
	const maxAge = Math.max(...ages);

	// setup フローでは bonus + exchange のみ表示 (penalty/special は ADR-0012 §6 で
	// 「専用 ADR 合意後に解除」、Pre-PMF UX 単純化のため非表示)
	const rulePresetMetas = getMarketplaceIndex().filter((m) => m.type === 'rule-preset');

	const rulePresetsWithPreview = rulePresetMetas
		.map((p) => {
			const full = getMarketplaceItem('rule-preset', p.itemId);
			const payload = full?.payload as RulePresetPayload | undefined;
			if (!payload) return null;
			// setup では bonus + exchange のみ
			if (payload.ruleType !== 'bonus' && payload.ruleType !== 'exchange') {
				return null;
			}
			return {
				itemId: p.itemId,
				name: p.name,
				description: p.description,
				icon: p.icon,
				targetAgeMin: p.targetAgeMin,
				targetAgeMax: p.targetAgeMax,
				tags: p.tags,
				ruleType: payload.ruleType,
				ruleCount: payload.rules.length,
				rules: payload.rules.map((r) => ({
					title: r.title,
					icon: r.icon,
					description: r.description,
					pointBonus: r.pointBonus,
					pointCost: r.pointCost,
				})),
			};
		})
		.filter((x): x is NonNullable<typeof x> => x !== null);

	return {
		rulePresets: rulePresetsWithPreview,
		children: children.map((c) => ({ id: c.id, nickname: c.nickname, age: c.age })),
		childAgeMin: minAge,
		childAgeMax: maxAge,
	};
};

export const actions: Actions = {
	importRules: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const itemIds = formData.getAll('itemIds').map((v) => v.toString());
		const childIdRaw = formData.get('childId')?.toString();
		const childId = childIdRaw && childIdRaw !== '' ? Number(childIdRaw) : undefined;

		if (itemIds.length === 0) {
			redirect(302, '/setup/activities-defaults?rulesImported=0&rulesSkipped=0');
		}

		let totalImported = 0;
		let totalSkipped = 0;
		const allErrors: string[] = [];
		const allWarnings: string[] = [];

		for (const itemId of itemIds) {
			try {
				const item = getMarketplaceItem('rule-preset', itemId);
				if (!item) {
					allErrors.push(`ルール「${itemId}」が見つかりません`);
					continue;
				}
				const payload = item.payload as RulePresetPayload;

				// exchange は childId 必須 — 未選択なら skip
				if (payload.ruleType === 'exchange' && (childId === undefined || Number.isNaN(childId))) {
					totalSkipped++;
					continue;
				}

				// #2368: Strategy 経由 (Registry 経由で本番 / demo 環境とも同一動作)
				const strategy = marketplaceRegistry.get('rule-preset')
					.strategy as typeof rulePresetStrategy;
				const identity = {
					presetId: item.itemId,
					presetName: item.name,
					presetIcon: item.icon,
				};
				const ctx = { tenantId, childId };

				const preview = await strategy.previewRulePreset(identity, payload, ctx);
				if (preview.alreadyImported) {
					totalSkipped++;
					continue;
				}

				const result = await strategy.applyRulePreset(identity, payload, ctx);
				totalImported += result.imported;
				totalSkipped += result.skipped;
				allErrors.push(...result.errors);
				allWarnings.push(...result.warnings);
			} catch {
				allErrors.push(`ルール「${itemId}」の読み込みに失敗しました`);
			}
		}

		trackSetupFunnel('setup_rules_selected', tenantId, {
			itemCount: itemIds.length,
			imported: totalImported,
			warnings: allWarnings.length,
		});
		redirect(
			302,
			`/setup/activities-defaults?rulesImported=${totalImported}&rulesSkipped=${totalSkipped}`,
		);
	},

	skip: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_rules_skipped', tenantId, {});
		// #2140 MP-5: rule preset の auto-import は行わない (Pre-PMF UX 単純化 +
		// rule は親判断要素が強い)。次の step に進むだけ
		redirect(302, '/setup/activities-defaults?rulesImported=0&rulesSkipped=0');
	},
};
