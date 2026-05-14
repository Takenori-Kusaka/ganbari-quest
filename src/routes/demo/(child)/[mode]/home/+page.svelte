<!--
  Demo child home — Issue #2097 真の共通化 (6 回目指摘)

  薄ラッパに刷新。dashboard 描画は本番側と**全く同じ**
  `$lib/features/child-home/components/DashboardView.svelte` (1 ファイル) を呼ぶ。

  本ファイルの責務:
    - page スコープで `DemoDashboardService` を再注入 (`todayRecorded` 込み snapshot)
    - DashboardView に data をそのまま渡す

  demo は sessionStorage + $state でブラウザタブ単位の隔離状態を維持。
  pin / mission badge / xp animation / baby inline form / event badge 等の
  本番固有 feature も demo に表示される (DemoDashboardService が mock データで対応)。
  これは Issue #2097 §統合方針「本番固有 feature を demo に逆輸入しない誘惑を排除」の
  期待動作 — LP SS が本番 SS に寄って見えるのが正常。
-->
<script lang="ts">
import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import DashboardView from '$lib/features/child-home/components/DashboardView.svelte';
import { setDashboardService } from '$lib/services/context';
import { createDemoDashboardService } from '$lib/services/demo/DashboardService';

let { data } = $props();

// #2097 ADR-0046: page スコープで DemoDashboardService を再注入。
// layout 側で配備済の service は `todayRecorded: []` で初期化されているため、
// home page の load 由来 todayRecorded を含む snapshot で上書きする。
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

<!--
  #2097: 本番側と同じく、Drizzle 推論型を持つ PageData を共通 DashboardData 契約に
  橋渡しするため as never キャストを使う。
-->
<DashboardView data={data as never} />
