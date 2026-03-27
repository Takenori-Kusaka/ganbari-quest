<script lang="ts">
import '$lib/ui/styles/app.css';
import NavigationProgress from '$lib/ui/components/NavigationProgress.svelte';

let { children } = $props();
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
		href="https://ganbari-quest.com/auth/signup"
		class="inline-block bg-white text-orange-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-orange-50 transition-colors"
	>
		本番で使ってみる
	</a>
</div>

<div class="pt-10">
	{@render children()}
</div>
