<script lang="ts">
import '$lib/ui/styles/app.css';
import { page } from '$app/stores';
import DemoGuideBar from '$lib/features/demo/DemoGuideBar.svelte';
import { trackDemoEvent } from '$lib/features/demo/demo-analytics.js';
import { getGuideState } from '$lib/features/demo/demo-guide-state.svelte.js';
import NavigationProgress from '$lib/ui/components/NavigationProgress.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { children } = $props();

const guide = getGuideState();

// Track demo page views on navigation
$effect(() => {
	const path = $page.url.pathname;
	trackDemoEvent('demo_page_view', { path });
});

let showFloatingCta = $state(false);
let floatingCtaDismissed = $state(false);

$effect(() => {
	const timer = setTimeout(
		() => {
			showFloatingCta = true;
		},
		5 * 60 * 1000,
	);
	return () => clearTimeout(timer);
});
</script>

<svelte:head>
	<title>デモ体験 - がんばりクエスト</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<NavigationProgress />

<!-- デモバナー -->
<div class="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-center py-2 px-4 text-sm font-bold shadow-md flex items-center justify-center gap-3">
	<span>これはデモです。データは保存されません。</span>
	<a
		href="/demo/signup"
		class="inline-block bg-white text-orange-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-orange-50 transition-colors"
	>
		本番で使ってみる
	</a>
</div>

<div class="pt-10">
	{@render children()}
</div>

<!-- ガイド付きデモバー -->
<DemoGuideBar />

<!-- 5分後に表示されるフローティングCTA（ガイドが非アクティブ時のみ） -->
{#if showFloatingCta && !floatingCtaDismissed && !guide.active}
	<div class="fixed bottom-20 left-4 right-4 z-40 bg-white rounded-2xl shadow-xl border border-orange-200 p-4 animate-slide-up">
		<Button
			variant="ghost"
			size="sm"
			class="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-lg leading-none"
			onclick={() => { floatingCtaDismissed = true; }}
			aria-label="閉じる"
		>
			&times;
		</Button>
		<p class="text-sm font-bold text-gray-700 mb-1">お子さまの ぼうけん、はじめよう！</p>
		<p class="text-xs text-gray-500 mb-3">初月無料・いつでもキャンセルOK</p>
		<a
			href="/demo/signup"
			class="block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-sm"
		>
			無料で はじめる →
		</a>
	</div>
{/if}

<style>
	@keyframes slide-up {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	:global(.animate-slide-up) {
		animation: slide-up 0.4s ease-out;
	}
</style>
