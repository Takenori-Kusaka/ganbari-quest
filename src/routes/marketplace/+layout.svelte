<script lang="ts">
import type { Snippet } from 'svelte';
import { page } from '$app/stores';
import { FEATURES_LABELS } from '$lib/domain/labels';
import PageGuideOverlay from '$lib/ui/components/PageGuideOverlay.svelte';
import IconButton from '$lib/ui/primitives/IconButton.svelte';
import {
	filterGuideStepsByTier,
	filterGuideStepsToOverview,
	getPageGuide,
	resolvePageGuide,
} from '$lib/ui/tutorial/page-guide-registry';
import { startPageGuide } from '$lib/ui/tutorial/page-guide-store.svelte';
import { endTutorial } from '$lib/ui/tutorial/tutorial-store.svelte';

// #3263 (EPIC #3260 F2): marketplace は AdminLayout 非使用のため、ページガイド機構
// (? trigger + PageGuideOverlay) をここで独自配線する。機構は AdminLayout と同一
// (getPageGuide → filterGuideStepsByTier → startPageGuide)。リッチコンテンツは C5 #3269。
let { children }: { children: Snippet } = $props();

// marketplace ガイドは requiredTier を持たないため、tier フィルタは常に全手順を通す
// (free でも全 step 表示)。AdminLayout と同じ filterGuideStepsByTier 機構を共用する。
const GUIDE_TIER = 'free' as const;

// registry にガイドが登録されているか (= ? ボタンを出すか) の判定。
let hasPageGuide = $state(false);

$effect(() => {
	const path = $page.url.pathname;
	hasPageGuide = false;
	getPageGuide(path).then((guide) => {
		hasPageGuide = guide !== null && filterGuideStepsByTier(guide, GUIDE_TIER) !== null;
	});
});

async function handleStartPageGuide() {
	// v1 tutorial を強制終了し v1/v2 同時 active を防止 (AdminLayout と同方針)
	endTutorial();
	const resolved = await resolvePageGuide($page.url.pathname);
	if (!resolved) return;
	// #3304: 親フォールバック継承時は概要 step のみに絞る (AdminLayout と同方針)。dedicated 詳細
	// ガイド (#3269/#3314) は viaFallback=false のため全 step 維持。
	const guide = resolved.viaFallback
		? (filterGuideStepsToOverview(resolved.guide) ?? resolved.guide)
		: resolved.guide;
	const filtered = filterGuideStepsByTier(guide, GUIDE_TIER);
	if (filtered) {
		startPageGuide(filtered);
	}
}
</script>

{#if hasPageGuide}
	<div class="page-guide-trigger">
		<IconButton
			variant="outline"
			size="md"
			label={FEATURES_LABELS.adminLayout.pageGuideTitle}
			data-tutorial="page-guide-btn"
			onclick={handleStartPageGuide}
		>
			❓
		</IconButton>
	</div>
{/if}

{@render children()}

<PageGuideOverlay />

<style>
	/* Fixed ? trigger at the top-right (sticky band that avoids the marketplace header). */
	.page-guide-trigger {
		position: fixed;
		top: 0.75rem;
		right: 0.75rem;
		/* DESIGN.md section 10 z-index token (dropdown band: above content, below overlay). */
		z-index: var(--z-dropdown);
	}
</style>
