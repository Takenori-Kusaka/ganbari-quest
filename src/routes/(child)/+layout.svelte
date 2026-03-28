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
// モード別ナビラベル (#0167)
const NAV_LABELS: Record<
	string,
	{ history: string; status: string; achievements: string; switch: string }
> = {
	baby: { history: 'きろく', status: 'つよさ', achievements: 'じっせき', switch: 'きりかえ' },
	kinder: { history: 'きろく', status: 'つよさ', achievements: 'じっせき', switch: 'きりかえ' },
	lower: { history: 'きろく', status: 'つよさ', achievements: '実績', switch: 'きりかえ' },
	upper: { history: '活動記録', status: 'ステータス', achievements: '実績', switch: '切替' },
	teen: { history: '記録', status: '実績', achievements: '称号', switch: '切替' },
};
const labels = $derived(NAV_LABELS[uiMode] ?? NAV_LABELS.kinder!);
const navItems = $derived([
	{ href: `/${uiMode}/home`, icon: '🏠', label: 'ホーム' },
	{ href: `/${uiMode}/history`, icon: '📋', label: labels!.history },
	{ href: `/${uiMode}/status`, icon: '⭐', label: labels!.status },
	{ href: `/${uiMode}/achievements`, icon: '🏆', label: labels!.achievements },
	{ href: '/switch', icon: '👤', label: labels!.switch },
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
