<script lang="ts">
import '$lib/ui/styles/app.css';
import { page } from '$app/stores';
import { APP_LABELS } from '$lib/domain/labels';
import DemoBanner from '$lib/features/demo/DemoBanner.svelte';
import {
	resolveScreenshotMode,
	setScreenshotModeContext,
} from '$lib/features/demo/screenshot-mode';
import NavigationProgress from '$lib/ui/components/NavigationProgress.svelte';
import Toast from '$lib/ui/primitives/Toast.svelte';

let { children, data } = $props();

// ADR-0039 / #1180: `hooks.server.ts` で `?mode=demo` / cookie から判定された
// `locals.isDemo` を `+layout.server.ts` が `data.isDemo` として配布。
// root layout 上部に DemoBanner を常時マウントし、デモ状態を全ページで可視化する。
//
// Phase 1 backward compat: `/demo/*` 配下は従来の `src/routes/demo/+layout.svelte` が
// 独自の橙バナーを描画するため、二重表示を避けるために root DemoBanner を抑止する。
// Phase 2 で `/demo/**` 削除時にこの条件は不要になる。
const isLegacyDemoPath = $derived($page.url?.pathname?.startsWith('/demo') ?? false);

// #2097 EPIC PR-B1 (2026-05-17): LP SS 撮影時 (`?screenshot=all` / `?screenshot=1`) は
// DemoBanner を抑止する。Multi-Lambda demo Lambda 上で本番ルートを撮影する際に
// 「これはデモアプリです」表示が映り込み LP 訴求を毀損する事故への対策 (PO 2026-05-17 指摘)。
// page 側の `?screenshot` 再呼出禁止ルール (src/routes/CLAUDE.md) は **page** が対象であり、
// root layout は SSOT helper `resolveScreenshotMode` を経由する限り抵触しない。
const screenshotKind = $derived(
	resolveScreenshotMode($page.url?.searchParams?.get('screenshot') ?? null),
);
const isScreenshotMode = $derived(screenshotKind !== 'off');

// #2097 EPIC PR-B1 hotfix (2026-05-17): 全 route で screenshot mode context を共有する。
// 旧 `src/routes/demo/+layout.svelte` でのみ context 提供されていたため、PR-B1 で本番ルート
// 撮影に切替後、本番 child home の SiblingCheerOverlay / MonthlyRewardDialog が SS に
// 被って LP 訴求を毀損する事故が発生 (PO 2026-05-17 指摘)。本 context を root layout で
// 提供することで全 route の page/component が `getScreenshotMode()` / `getScreenshotModeKind()`
// 経由で抑止判定できるようになる。
setScreenshotModeContext(
	() => isScreenshotMode,
	() => screenshotKind,
);

const isDemo = $derived(
	!isLegacyDemoPath && !isScreenshotMode && (data?.isDemo ?? $page.data?.isDemo ?? false),
);

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
