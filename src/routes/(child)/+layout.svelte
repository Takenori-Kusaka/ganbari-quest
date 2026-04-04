<script lang="ts">
import { invalidateAll } from '$app/navigation';
import { navigating } from '$app/stores';
import { ICON_HOME, ICON_STATUS, ICON_SWITCH, getModeLabels } from '$lib/domain/icons';
import type { UiMode } from '$lib/domain/validation/age-tier';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';
import StampCard from '$lib/ui/components/StampCard.svelte';
import TutorialOverlay from '$lib/ui/components/TutorialOverlay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { SOUND_TIER_CONFIG, loadSoundSettings, soundService } from '$lib/ui/sound';
import { CHILD_TUTORIAL_CHAPTERS } from '$lib/ui/tutorial/tutorial-chapters-child';
import { resetChapters, setChapters, startTutorial } from '$lib/ui/tutorial/tutorial-store.svelte';
import { onMount } from 'svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'kinder');
// #0289: モード別ラベルを一元定数から取得
const modeLabels = $derived(getModeLabels(uiMode));
const navItems = $derived([
	{ href: `/${uiMode}/home`, icon: ICON_HOME, label: 'ホーム' },
	{ href: `/${uiMode}/status`, icon: ICON_STATUS, label: modeLabels.status },
	{ href: '/switch', icon: ICON_SWITCH, label: modeLabels.switch },
]);

// サウンドシステム初期化 + オートリロード + チュートリアル設定
onMount(() => {
	loadSoundSettings();
	soundService.configure(uiMode as UiMode);
	const config = SOUND_TIER_CONFIG[uiMode as UiMode];
	if (config) {
		soundService.preload(config.enabledSounds);
	}

	// 子供用チュートリアルチャプターに切り替え
	setChapters(CHILD_TUTORIAL_CHAPTERS);

	// 1分間隔で自動リロード（親の変更を反映）
	const autoReloadTimer = setInterval(() => {
		// バックグラウンドタブやダイアログ表示中はスキップ
		if (document.hidden) return;
		if (document.querySelector('[data-scope="dialog"][data-state="open"]')) return;
		invalidateAll();
	}, 60_000);

	return () => {
		clearInterval(autoReloadTimer);
		resetChapters();
	};
});

let stampDialogOpen = $state(false);

function handleStartChildTutorial() {
	startTutorial();
}
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header nickname={data.child.nickname} totalPoints={data.balance} avatarUrl={data.child.avatarUrl} pointSettings={data.pointSettings} stampProgress={data.stampProgress} onStampClick={() => { stampDialogOpen = true; }} onHelpClick={handleStartChildTutorial} isPremium={data.isPremium} />
	{/if}

	<main class="relative z-0 pb-20 pt-[var(--sp-sm)]">
		{#if $navigating}
			<div class="px-[var(--sp-md)] py-[var(--sp-sm)] flex flex-col gap-[var(--sp-md)]">
				<div class="skeleton-block h-32 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>

	<BottomNav items={navItems} />
	<TutorialOverlay />
</div>

<!-- Stamp card dialog (opened from header) -->
{#if data.stampCard}
	<Dialog bind:open={stampDialogOpen} title="スタンプカード">
		<StampCard
			weekStart={data.stampCard.weekStart}
			weekEnd={data.stampCard.weekEnd}
			entries={data.stampCard.entries}
			canStampToday={data.stampCard.canStampToday}
			totalSlots={data.stampCard.totalSlots}
			filledSlots={data.stampCard.filledSlots}
			status={data.stampCard.status}
			redeemedPoints={data.stampCard.redeemedPoints}
		/>
	</Dialog>
{/if}
