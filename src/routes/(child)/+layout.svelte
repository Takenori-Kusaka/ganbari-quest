<script lang="ts">
import { invalidateAll } from '$app/navigation';
import { navigating } from '$app/stores';
import type { UiMode } from '$lib/domain/validation/age-tier';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';
import StampCard from '$lib/ui/components/StampCard.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { SOUND_TIER_CONFIG, loadSoundSettings, soundService } from '$lib/ui/sound';
import { onMount } from 'svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'kinder');
// モード別ナビラベル (#0173 ゲームループ再設計)
const NAV_LABELS: Record<string, { character: string; switch: string }> = {
	baby: { character: 'つよさ', switch: 'きりかえ' },
	kinder: { character: 'つよさ', switch: 'きりかえ' },
	lower: { character: 'つよさ', switch: 'きりかえ' },
	upper: { character: 'ステータス', switch: '切替' },
	teen: { character: 'ステータス', switch: '切替' },
};
const labels = $derived(NAV_LABELS[uiMode] ?? NAV_LABELS.kinder);
const navItems = $derived([
	{ href: `/${uiMode}/home`, icon: '🏠', label: 'ホーム' },
	{ href: `/${uiMode}/status`, icon: '🛡️', label: labels?.character ?? 'つよさ' },
	{ href: '/switch', icon: '👤', label: labels?.switch ?? 'きりかえ' },
]);

// サウンドシステム初期化 + オートリロード
onMount(() => {
	loadSoundSettings();
	soundService.configure(uiMode as UiMode);
	const config = SOUND_TIER_CONFIG[uiMode as UiMode];
	if (config) {
		soundService.preload(config.enabledSounds);
	}

	// 1分間隔で自動リロード（親の変更を反映）
	const autoReloadTimer = setInterval(() => {
		// バックグラウンドタブやダイアログ表示中はスキップ
		if (document.hidden) return;
		if (document.querySelector('[data-scope="dialog"][data-state="open"]')) return;
		invalidateAll();
	}, 60_000);

	return () => clearInterval(autoReloadTimer);
});

let stampDialogOpen = $state(false);
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header nickname={data.child.nickname} totalPoints={data.balance} avatarUrl={data.child.avatarUrl} pointSettings={data.pointSettings} activeTitle={data.activeTitle} stampProgress={data.stampProgress} onStampClick={() => { stampDialogOpen = true; }} />
	{/if}

	<main class="pb-20 pt-[var(--sp-sm)]">
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
