<script lang="ts">
import type { UiMode } from '$lib/domain/validation/age-tier';
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

// サウンドシステム初期化
onMount(() => {
	loadSoundSettings();
	soundService.configure(uiMode as UiMode);
	const config = SOUND_TIER_CONFIG[uiMode as UiMode];
	if (config) {
		soundService.preload(config.enabledSounds);
	}
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
