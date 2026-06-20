<script lang="ts">
import { page } from '$app/state';
import AdminHome from '$lib/features/admin/components/AdminHome.svelte';
import RedemptionPendingBanner from '$lib/features/admin/components/RedemptionPendingBanner.svelte';
import { getScreenshotModeKind } from '$lib/features/demo/screenshot-mode';

let { data } = $props();

// #3144: ごほうび交換の承認待ち件数 (admin ホームの発見性バナー)
const pendingRedemptionCount = $derived<number>(data.pendingRedemptionCount ?? 0);
// #3144: `?screenshot=all` 時はバナーを代表件数 (2) で強制描画し SS 撮影可能にする
// (MilestoneBanner の bypassSeenCheck と同型の正規パターン、src/routes/CLAUDE.md §?screenshot)。
const isScreenshotAll = $derived(getScreenshotModeKind() === 'all');
const bannerCount = $derived(
	isScreenshotAll ? Math.max(pendingRedemptionCount, 2) : pendingRedemptionCount,
);
// #3148: 承認待ち件数の取得が失敗したか。true なら「取得失敗」導線を出し、障害時に承認待ちを
// silent 非表示にしない (true-0 と failure-0 を区別)。screenshot 撮影時は failure 状態を描画しない。
const pendingCountFailed = $derived(!isScreenshotAll && data.pendingRedemptionCountFailed === true);

// ADR-0048 Phase B-1 (#2097): demo Lambda (AUTH_MODE=anonymous) では
// `(parent)/admin/+page.svelte` も isDemo=true として描画される。
// hooks.server.ts が locals.isDemo=true をセットし、+layout.server.ts が
// $page.data.isDemo に伝搬。本 page は AdminHome の `mode` prop に橋渡しすることで、
// shared コンポーネントの `isDemo = mode === 'demo'` 派生を server-side SSOT と同期させる。
// これにより onboarding ダイアログ等の本番専用 UI が demo Lambda 上で誤表示されない (A-6 ISSUE-003)。
const adminMode = $derived<'live' | 'demo'>(page.data.isDemo ? 'demo' : 'live');
</script>

<!-- #3144: ごほうび交換の承認待ち導線 (pending > 0 のときのみ)。
     子供の engagement バッジ (#2109 撤廃) でなく親の管理タスク導線のため ADR-0012 非抵触。 -->
{#if bannerCount > 0}
	<RedemptionPendingBanner variant="pending" count={bannerCount} />
{:else if pendingCountFailed}
	<!-- #3148: 件数取得失敗時は silent 非表示にせず、承認待ち確認ページへの導線を出す
	     (true-0 = 承認待ちなし と failure-0 = 取得障害 を区別し、親が承認待ちを見落とさない)。 -->
	<RedemptionPendingBanner variant="error" />
{/if}

<AdminHome
	children={data.children}
	pointSettings={data.pointSettings}
	tutorialStarted={data.tutorialStarted}
	onboarding={data.onboarding}
	mode={adminMode}
	basePath="/admin"
	monthlySummaries={data.monthlySummaries}
	currentMonth={data.currentMonth}
	planTier={data.planTier}
	showPremiumWelcome={data.showPremiumWelcome}
	todayUsage={data.todayUsage}
	weeklyUsage={data.weeklyUsage}
	valuePreview={data.valuePreview}
/>
