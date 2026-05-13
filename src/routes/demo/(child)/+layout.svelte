<script lang="ts">
import { navigating } from '$app/stores';
import {
	getModeLabels,
	ICON_CHECKLIST,
	ICON_HOME,
	ICON_STATUS,
	ICON_SWITCH,
} from '$lib/domain/icons';
import { getScreenshotModeKind } from '$lib/features/demo/screenshot-mode.js';
import MilestoneBanner from '$lib/features/value-preview/MilestoneBanner.svelte';
import type { MilestoneId } from '$lib/server/services/value-preview-service';
// Issue #2069 POC: DemoDashboardService を Context に配備する。
// layout 段階では home 専用の todayRecorded を持たない (page.svelte 階層で上書き)。
import { setDashboardService } from '$lib/services/context';
import { createDemoDashboardService } from '$lib/services/demo/DashboardService';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';

let { data, children } = $props();

// Issue #2069 POC: demo 配下の Context 配備。home page で seed を上書きする
// (この階層では home 固有の todayRecorded を持たないため空配列で初期化)。
// getter 関数を渡すことで data 変化 (mode 切替 navigation 等) に追従できる
// (Svelte 5 state_referenced_locally 警告を回避)。
setDashboardService(
	createDemoDashboardService(() => ({
		child: data.child ?? null,
		todayRecorded: [],
		pointSettings: data.pointSettings,
	})),
);

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'preschool');

// #1893 (PO-4-7、8 回目指摘): `?screenshot=all` で本番一致演出を強制表示する。
// LP 配信 SS が本番 NUC ユーザの実画面と一致するよう、demo 配下でも MilestoneBanner を
// 強制表示する（`?screenshot=all` の場合のみ。通常 demo 表示には影響しない）。
//
// 本番側 `src/routes/(child)/+layout.svelte` は `data.milestones` を `+layout.server.ts` から
// 受け取って表示するが、demo 側は `+layout.server.ts` で milestones を計算していないため、
// 本コンポーネント内で screenshot=all 用の固定 milestone (records_10 達成済) を生成する。
// これは demo 限定の SS 撮影専用ロジックであり、本番アプリには影響しない。
const screenshotKind = $derived(getScreenshotModeKind());
const isScreenshotAll = $derived(screenshotKind === 'all');

// records_10 マイルストーン (LP 撮影用)。childId は data.child.id を使用。
const screenshotMilestones = $derived.by(() => {
	if (!isScreenshotAll || !data.child) return [];
	return [
		{
			id: 'records_10' as MilestoneId,
			threshold: 10,
			achieved: true,
			achievedAt: new Date().toISOString(),
		},
	];
});

// #0289: 本番と同じナビ構成（3項目）に統一
const modeLabels = $derived(getModeLabels(uiMode));
const navItems = $derived([
	{
		href: `/demo/${uiMode}/home?childId=${data.child?.id ?? ''}`,
		icon: ICON_HOME,
		label: 'ホーム',
	},
	{
		href: `/demo/checklist?childId=${data.child?.id ?? ''}`,
		icon: ICON_CHECKLIST,
		label: modeLabels.checklist,
	},
	{
		href: `/demo/${uiMode}/status?childId=${data.child?.id ?? ''}`,
		icon: ICON_STATUS,
		label: modeLabels.status,
	},
	{ href: '/demo', icon: ICON_SWITCH, label: modeLabels.switch },
]);
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header
			nickname={data.child.nickname}
			totalPoints={data.balance}
			avatarUrl={data.child.avatarUrl}
			pointSettings={data.pointSettings}
		/>
	{/if}

	<main class="relative z-0 pb-20 pt-[var(--sp-sm)]">
		{#if $navigating}
			<div class="px-[var(--sp-md)] py-[var(--sp-sm)] flex flex-col gap-[var(--sp-md)]">
				<div class="skeleton-block h-32 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
			</div>
		{:else}
			<!-- #1893: `?screenshot=all` で本番側 (child)/+layout の MilestoneBanner と同等の演出を強制表示 -->
			{#if isScreenshotAll && data.child && screenshotMilestones.length > 0}
				<div class="px-[var(--sp-md)]">
					<MilestoneBanner
						milestones={screenshotMilestones}
						childId={data.child.id}
						bypassSeenCheck
					/>
				</div>
			{/if}
			{@render children()}
		{/if}
	</main>

	<BottomNav items={navItems} />
</div>
