<script lang="ts">
import type { UiMode } from '$lib/domain/validation/age-tier';
import { invalidateAll } from '$app/navigation';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';
import { SOUND_TIER_CONFIG, loadSoundSettings, soundService } from '$lib/ui/sound';
import { onMount } from 'svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'kinder');
const navItems = $derived([
	{ href: `/${uiMode}/home`, icon: '🏠', label: 'ホーム' },
	{ href: `/${uiMode}/history`, icon: '📋', label: 'きろく' },
	{ href: `/${uiMode}/status`, icon: '⭐', label: 'つよさ' },
	{ href: `/${uiMode}/achievements`, icon: '🏆', label: 'じっせき' },
	{ href: '/switch', icon: '👤', label: 'きりかえ' },
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
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header nickname={data.child.nickname} totalPoints={data.balance} level={data.level} showLevel={true} avatarUrl={data.child.avatarUrl} />
	{/if}

	<main class="pb-20 pt-[var(--spacing-sm)]">
		{@render children()}
	</main>

	<BottomNav items={navItems} />
</div>
