<script lang="ts">
import '$lib/ui/styles/app.css';
import { page } from '$app/stores';
import { APP_LABELS } from '$lib/domain/labels';
import DemoBanner from '$lib/features/demo/DemoBanner.svelte';
import NavigationProgress from '$lib/ui/components/NavigationProgress.svelte';
import Toast from '$lib/ui/primitives/Toast.svelte';

let { children, data } = $props();

// ADR-0039 Phase 2 完遂 (#2097): `hooks.server.ts` で `?mode=demo` / cookie から
// 判定された `locals.isDemo` を `+layout.server.ts` が `data.isDemo` として配布。
// root layout 上部に DemoBanner を常時マウントし、デモ状態を全ページで可視化する。
//
// Phase 1 までは `/demo/**` 別ツリーが独自バナーを描画していたため backward compat
// で root DemoBanner を抑止していたが、Phase 2 で `/demo/**` を削除済 (47 ファイル)。
// 本番ルートで `?mode=demo` 駆動時に root DemoBanner のみ表示する。
const isDemo = $derived(data?.isDemo ?? $page.data?.isDemo ?? false);

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
	<title>{APP_LABELS.name}</title>
	<meta name="description" content={APP_LABELS.tagline} />
</svelte:head>

<NavigationProgress />
<DemoBanner {isDemo} />
<Toast />
{@render children()}
