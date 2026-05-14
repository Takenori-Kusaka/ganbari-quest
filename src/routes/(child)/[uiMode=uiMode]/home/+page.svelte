<!--
  本番 child home — Issue #2097 真の共通化 (6 回目指摘)

  薄ラッパに刷新。dashboard 描画は `$lib/features/child-home/components/DashboardView.svelte`
  に SSOT 化されている。demo / 本番両方が同じ DashboardView を呼ぶ (1 ファイル描画)。

  本ファイルの責務:
    - Cognito 認証は `+page.server.ts` の `requireTenantId` に閉じ込め済
    - page スコープで `ProductionDashboardService` を再注入 (`todayRecorded` 込み snapshot)
    - DashboardView に data をそのまま渡す

  本番固有 feature (pin / mission badge / xp animation / baby inline form / event badge /
  sibling ranking / monthly reward) はすべて DashboardView 内に集約済。
-->
<script lang="ts">
import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import DashboardView from '$lib/features/child-home/components/DashboardView.svelte';
import { setDashboardService } from '$lib/services/context';
import { createProductionDashboardService } from '$lib/services/production/DashboardService';

let { data } = $props();

// #2097 ADR-0046: page スコープで ProductionDashboardService を再注入。
// layout 側で配備済の service は `todayRecorded: []` で初期化されているため、
// home page の load 由来 todayRecorded を含む snapshot で上書きする。
// getter 関数を渡すことで invalidateAll() / form action 完了後の data 変化に追従。
setDashboardService(
	createProductionDashboardService(() => ({
		child: data.child ?? null,
		todayRecorded: data.todayRecorded ?? [],
		pointSettings: data.pointSettings,
	})),
);
</script>

<svelte:head>
	<title>{PAGE_TITLES.childHome}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<!--
  #2097: DashboardView は本番 / demo の PageData 共通 subset のみを契約として持つため、
  Drizzle 推論型 (Child 等) を含む PageData をそのまま受けるとシグネチャ不一致になる。
  描画ロジックは Service Interface (getDashboardService) と Partial(PageData) 経由で
  整合性が取れているため、ここで as never 経由のキャストを行う。
-->
<DashboardView data={data as never} />
