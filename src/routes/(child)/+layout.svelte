<script lang="ts">
import { invalidateAll } from '$app/navigation';
import { navigating } from '$app/stores';
import type { UiMode } from '$lib/domain/validation/age-tier';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';
import { SOUND_TIER_CONFIG, loadSoundSettings, soundService } from '$lib/ui/sound';
import { onMount } from 'svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'kinder');
const customSoundPath = $derived(data.avatarConfig?.customSoundPath ?? null);

// きろくおん設定がデータ更新で変わったら反映
$effect(() => {
	soundService.setCustomRecordSound(customSoundPath);
});
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
	// きろくおんカスタム設定
	soundService.setCustomRecordSound(data.avatarConfig?.customSoundPath ?? null);

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
		<Header nickname={data.child.nickname} totalPoints={data.balance} level={data.level} showLevel={true} avatarUrl={data.child.avatarUrl} avatarConfig={data.avatarConfig} pointSettings={data.pointSettings} />
	{/if}

	<main class="pb-20 pt-[var(--spacing-sm)]">
		{#if $navigating}
			<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)] flex flex-col gap-[var(--spacing-md)]">
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
