<!--
  Demo Child Home — ADR-0047 Phase 3 (#2097)

  ## 構造

  ADR-0047 §決定 (PO Q1 = B 子供は未認証で本番 UX を体験) に従い、本ページは本番
  `(child)/[uiMode=uiMode]/home/+page.svelte` と **同じ DashboardView を ViewModel 経路で呼ぶ**
  薄いラッパ。

  - `DemoDashboardService.toViewModel()` で `ChildHomeViewModel` を構築
  - `<DashboardView {viewModel} />` を呼ぶ (本番と同じコンポーネント、同じ contract)
  - demo 固有の divergence は `viewModel.features.*` field で明示化 (隠蔽不可)

  ## 過去 5 回失敗パターンとの差分

  | 過去回 | 失敗パターン | Phase 3 でどう変わるか |
  |---|---|---|
  | #531 / #561 / #562 / #563 / #566 | 「Tier N で統合」「scope 外」「Tier 段階で進める」 | 本 PR で DashboardView を `viewModel` 経路に変更 (型強制) |
  | #2069 (PR #2079) | 「POC scope」「UI 等価性 SS 維持」 | viewModel が ChildHomeViewModel 型のみを受け取るため、shim が型違反になる |

  ## 関連

  - ADR-0047: Demo / 本番 UI Contract SSOT
  - ADR-0046: Service Interface + Context DI
  - 禁止語 SSOT: `docs/decisions/forbidden-escape-language.md`
-->
<script lang="ts">
import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import type { UiMode } from '$lib/domain/validation/age-tier';
import DashboardView from '$lib/features/child-home/components/DashboardView.svelte';
import { setDashboardService } from '$lib/services/context';
import { createDemoDashboardService } from '$lib/services/demo/DashboardService';

let { data } = $props();

// Service 注入: SSR / CSR の両環境で 1 回だけ実行される。
// getter 関数を渡すことで form action 完了後の todayRecorded 更新にも追従する
// (Svelte 5 state_referenced_locally 警告を回避、ADR-0046)。
const dashboardService = createDemoDashboardService(() => ({
	child: data.child ?? null,
	todayRecorded: data.todayRecorded ?? [],
	pointSettings: data.pointSettings,
}));
setDashboardService(dashboardService);

// ADR-0047 Phase 3 (#2097): toViewModel() で ChildHomeViewModel を構築。
// 本番 +page.svelte と同じ ViewModel 経路で DashboardView を呼ぶ (型レベル SSOT)。
const viewModel = $derived(
	dashboardService.toViewModel({
		uiMode: (data.uiMode ?? 'preschool') as
			| 'baby'
			| 'preschool'
			| 'elementary'
			| 'junior'
			| 'senior',
		planTier: data.planTier ?? 'standard',
		isTrialActive: false,
		isPremium: data.isPremium ?? true,
		activities: data.activities,
		mustStatus: data.mustStatus,
		dailyMissions: data.dailyMissions,
		categoryXp: data.categoryXp,
		activeEventBadge: null,
	}),
);

// 本番互換ブリッジ用 auxiliary activities (Drizzle 詳細 fields)。
// Phase 4 で `ChildHomeActivity` に統合予定。
const auxiliaryActivities = $derived(
	data.activities.map(
		(a: {
			id: number;
			displayName: string;
			source?: string;
			triggerHint?: string | null;
			isMainQuest?: boolean | number;
		}) => ({
			id: a.id,
			displayName: a.displayName,
			frozen: false, // demo は frozen 状態なし
			triggerHint: a.triggerHint ?? null,
			isMainQuest: a.isMainQuest ?? 0,
		}),
	),
);

// per-category mission counts
function getCategoryMissionCount(categoryId: number): number {
	return data.activities.filter(
		(a: { categoryId: number; isMission: boolean }) => a.categoryId === categoryId && a.isMission,
	).length;
}
function getCategoryCompletedMissionCount(categoryId: number): number {
	const recordedMap = new Map(
		(data.todayRecorded ?? []).map((r: { activityId: number; count: number }) => [
			r.activityId,
			r.count,
		]),
	);
	return data.activities.filter(
		(a: { id: number; categoryId: number; isMission: boolean; dailyLimit: number | null }) => {
			if (a.categoryId !== categoryId || !a.isMission) return false;
			const limit = a.dailyLimit ?? 1;
			if (limit === 0) return false;
			return ((recordedMap.get(a.id) as number) ?? 0) >= limit;
		},
	).length;
}

function getCategoryXpWithAnim(categoryId: number) {
	return data.categoryXp?.[categoryId] ?? null;
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.childHome}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<div class="px-[var(--sp-sm)] py-1" data-testid="{data.uiMode}-home-page">
	<DashboardView
		{viewModel}
		{auxiliaryActivities}
		mustStatus={data.mustStatus}
		siblingRanking={null}
		displayConfig={null}
		childId={data.child?.id ?? 0}
		submitting={false}
		pendingActivityId={null}
		{getCategoryXpWithAnim}
		xpAnimatingCategoryId={null}
		{getCategoryMissionCount}
		{getCategoryCompletedMissionCount}
		activeEventBadge={null}
	/>
</div>
