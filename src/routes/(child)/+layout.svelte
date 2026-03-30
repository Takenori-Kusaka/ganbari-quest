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
// 親の声カスタムボイスがあればショップ音より優先
const effectiveSoundPath = $derived(
	data.avatarConfig?.customVoicePath ?? data.avatarConfig?.customSoundPath ?? null,
);

// きろくおん設定がデータ更新で変わったら反映
$effect(() => {
	soundService.setCustomRecordSound(effectiveSoundPath);
});
// モード別ナビラベル (#0173 ゲームループ再設計)
const NAV_LABELS: Record<string, { character: string; switch: string }> = {
	baby: { character: 'つよさ', switch: 'きりかえ' },
	kinder: { character: 'つよさ', switch: 'きりかえ' },
	lower: { character: 'つよさ', switch: 'きりかえ' },
	upper: { character: 'ステータス', switch: '切替' },
	teen: { character: 'ステータス', switch: '切替' },
};
const labels = $derived(NAV_LABELS[uiMode] ?? NAV_LABELS.kinder!);
const SKILL_TREE_MODES = ['lower', 'upper', 'teen'];
const SHOP_MODES = ['kinder'];
const navItems = $derived([
	{ href: `/${uiMode}/home`, icon: '🏠', label: 'ホーム' },
	{ href: `/${uiMode}/status`, icon: '🛡️', label: labels!.character },
	...(SKILL_TREE_MODES.includes(uiMode)
		? [{ href: `/${uiMode}/skill-tree`, icon: '⚔️', label: 'スキル' }]
		: SHOP_MODES.includes(uiMode)
			? [{ href: `/${uiMode}/shop`, icon: '🛒', label: 'ショップ' }]
			: []),
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
	// きろくおんカスタム設定（親の声ボイス優先）
	soundService.setCustomRecordSound(
		data.avatarConfig?.customVoicePath ?? data.avatarConfig?.customSoundPath ?? null,
	);

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
		<Header nickname={data.child.nickname} totalPoints={data.balance} avatarUrl={data.child.avatarUrl} avatarConfig={data.avatarConfig} pointSettings={data.pointSettings} activeTitle={data.activeTitle} />
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
