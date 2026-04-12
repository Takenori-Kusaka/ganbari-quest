<script lang="ts">
import '$lib/ui/styles/app.css';
import NavigationProgress from '$lib/ui/components/NavigationProgress.svelte';

let { children } = $props();

// #702: E2E hydration marker. $effect は SSR では走らずクライアント mount 後にのみ
// 走るため、ここで window.__APP_HYDRATED__ を立てると Playwright から
// 「Svelte 5 onclick ハンドラがバインド済みであること」を確認できる。
// dev mode では Vite の lazy compile によりハイドレーションがかなり遅れることがあり、
// 単に visible になっただけで click すると no-op になる回帰が頻発したため
// （#702 のデモガイド step skip 修正の検証時に発見）。
$effect(() => {
	// biome-ignore lint/suspicious/noExplicitAny: window への一時的なフラグ書き込み
	(window as any).__APP_HYDRATED__ = true;
});
</script>

<svelte:head>
	<title>がんばりクエスト</title>
	<meta name="description" content="子供の活動をゲーミフィケーションで動機付けする家庭内Webアプリ" />
</svelte:head>

<NavigationProgress />
{@render children()}
