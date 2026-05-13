<!--
  Demo Child Home — Issue #2069 POC (Service Interface + Context DI)

  POC 実装方針:
    - 本ページ自身は薄いラッパに留め、DashboardView (`$lib/features/child-home/components/DashboardView.svelte`)
      に UI 描画を委譲する。
    - `setDashboardService(createDemoDashboardService(...))` で
      DemoDashboardService を Context に注入し、配下の DashboardView から
      `getDashboardService()` で取得させる (ADR-0046)。

  follow-up (Issue #2069 残り):
    - 本番 `(child)/[uiMode=uiMode]/home/+page.svelte` も同じ DashboardView に
      移行する。本 PR では本番側を触らず、demo のみで Service DI 機構を実証する
      (UI 等価性を SS で証明するため)。
-->
<script lang="ts">
import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import DashboardView from '$lib/features/child-home/components/DashboardView.svelte';
import { setDashboardService } from '$lib/services/context';
import { createDemoDashboardService } from '$lib/services/demo/DashboardService';

let { data } = $props();

// Service 注入: SSR / CSR の両環境で 1 回だけ実行される
// (Svelte 5 の setContext はコンポーネント初期化中のみ呼び出し可能、
//  $effect の中で呼ぶと動作しないため top-level で実行する)。
// getter 関数を渡すことで form action 完了後の todayRecorded 更新にも追従する
// (Svelte 5 state_referenced_locally 警告を回避)。
setDashboardService(
	createDemoDashboardService(() => ({
		child: data.child ?? null,
		todayRecorded: data.todayRecorded ?? [],
		pointSettings: data.pointSettings,
	})),
);
</script>

<svelte:head>
	<title>{PAGE_TITLES.childHome}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<DashboardView
	pageData={{
		activities: data.activities,
		uiMode: data.uiMode,
		hasChecklists: data.hasChecklists,
		checklistProgress: data.checklistProgress,
		dailyMissions: data.dailyMissions,
		mustStatus: data.mustStatus,
	}}
/>
