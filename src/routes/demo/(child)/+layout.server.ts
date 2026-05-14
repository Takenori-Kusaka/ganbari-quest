import { normalizeUiMode } from '$lib/domain/validation/age-tier';
import { DEMO_CHILDREN } from '$lib/server/demo/demo-data.js';
import { getDemoChildLayoutData } from '$lib/server/demo/demo-service.js';
import type { LayoutServerLoad } from './$types';

/**
 * Issue #2097: 真の child home UI 統合 (6 回目指摘)
 *
 * demo 側 layout も本番側 (`(child)/+layout.server.ts`) と同等のフィールドを返す。
 * 本番 layout が返す `planLimits` / `isPremium` / `milestones` / `stampProgress` /
 * `stampCard` / `planTier` を demo 側も提供することで、共通 `DashboardView.svelte`
 * が 1 つの prop 契約で本番 / demo 両方を描画できる。
 *
 * demo は実装の事実上 free プラン体験を提供する想定。`planLimits` は free 相当の
 * 既定値、`isPremium` は false、`milestones` は空配列 (screenshot=all モード時のみ
 * +layout.svelte で固定 milestone を別途生成)。
 */

import { getPlanLimits, isPaidTier } from '$lib/server/services/plan-limit-service';

export const load: LayoutServerLoad = async ({ url }) => {
	// childId from query string (set when selecting a child from demo landing)
	const childIdParam = url.searchParams.get('childId');

	// Extract mode from path: /demo/[mode]/...
	const segments = url.pathname.split('/');
	const rawMode = segments[2]; // /demo/[mode]/...
	// Normalize legacy mode names (kinder→preschool, lower→elementary, etc.)
	const mode = rawMode ? normalizeUiMode(rawMode) : undefined;

	let childId: number | null = childIdParam ? Number(childIdParam) : null;

	// If no explicit childId, find the first child matching the mode
	if (!childId && mode) {
		const child = DEMO_CHILDREN.find((c) => c.uiMode === mode);
		childId = child?.id ?? null;
	}

	// Fallback to switch page if no child found
	const layoutData = childId ? getDemoChildLayoutData(childId) : getDemoChildLayoutData(0);

	// #2097: 本番 layout が返す追加フィールドを demo でも提供
	// demo は free 相当の体験。
	const planTier = 'free' as const;
	const planLimits = getPlanLimits(planTier);
	const isPremium = isPaidTier(planTier);

	return {
		...layoutData,
		planTier,
		planLimits,
		isPremium,
		stampProgress: null,
		stampCard: null,
		milestones: [],
	};
};
