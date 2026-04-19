<script lang="ts">
import '$lib/ui/styles/app.css';
import { page } from '$app/stores';
import DemoBanner from '$lib/features/demo/DemoBanner.svelte';
import NavigationProgress from '$lib/ui/components/NavigationProgress.svelte';

let { children, data } = $props();

// ADR-0039 / #1180: `hooks.server.ts` で `?mode=demo` / cookie から判定された
// `locals.isDemo` を `+layout.server.ts` が `data.isDemo` として配布。
// root layout 上部に DemoBanner を常時マウントし、デモ状態を全ページで可視化する。
//
// Phase 1 backward compat: `/demo/*` 配下は従来の `src/routes/demo/+layout.svelte` が
// 独自の橙バナーを描画するため、二重表示を避けるために root DemoBanner を抑止する。
// Phase 2 で `/demo/**` 削除時にこの条件は不要になる。
const isLegacyDemoPath = $derived($page.url?.pathname?.startsWith('/demo') ?? false);
const isDemo = $derived(!isLegacyDemoPath && (data?.isDemo ?? $page.data?.isDemo ?? false));

// #702: E2E hydration marker. $effect は SSR では走らずクライアント mount 後にのみ
// 走るため、ここで window.__APP_HYDRATED__ を立てると Playwright から
// 「Svelte 5 onclick ハンドラがバインド済みであること」を確認できる。
// dev mode では Vite の lazy compile によりハイドレーションがかなり遅れることがあり、
// 単に visible になっただけで click すると no-op になる回帰が頻発したため
// （#702 のデモガイド step skip 修正の検証時に発見）。
$effect(() => {
	window.__APP_HYDRATED__ = true;
});
</script>

<svelte:head>
	<title>がんばりクエスト</title>
	<meta name="description" content="子供の活動をゲーミフィケーションで動機付けする家庭内Webアプリ" />
</svelte:head>

<NavigationProgress />
<DemoBanner {isDemo} />
{@render children()}
