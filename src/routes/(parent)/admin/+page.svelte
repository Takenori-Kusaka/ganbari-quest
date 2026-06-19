<script lang="ts">
import { page } from '$app/state';
import { ADMIN_HOME_LABELS } from '$lib/domain/labels';
import AdminHome from '$lib/features/admin/components/AdminHome.svelte';
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
	<a class="redemption-pending-banner" href="/admin/rewards/requests" data-testid="redemption-pending-banner">
		<span class="redemption-pending-banner__icon" aria-hidden="true">🎁</span>
		<span class="redemption-pending-banner__text">{ADMIN_HOME_LABELS.pendingRedemptionBanner(bannerCount)}</span>
		<span class="redemption-pending-banner__cta" aria-hidden="true">▶</span>
	</a>
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

<style>
	.redemption-pending-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 16px;
		padding: 0.875rem 1rem;
		border: 1px solid var(--color-border-warning);
		border-radius: 0.75rem;
		background: var(--color-surface-warning);
		color: var(--color-text-warm);
		text-decoration: none;
		font-weight: 600;
	}
	.redemption-pending-banner:hover {
		background: var(--color-feedback-warning-bg-strong);
	}
	.redemption-pending-banner__icon {
		font-size: 1.25rem;
	}
	.redemption-pending-banner__text {
		flex: 1;
		min-width: 0;
	}
	.redemption-pending-banner__cta {
		color: var(--color-text-warm-muted);
	}
</style>
