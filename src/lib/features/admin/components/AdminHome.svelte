<script lang="ts">
import { invalidateAll } from '$app/navigation';
import type { PointSettings } from '$lib/domain/point-display';
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';
import type { OnboardingProgress } from '$lib/server/services/onboarding-service';
import {
	dismissTutorialBanner,
	markTutorialStarted,
	startTutorial,
} from '$lib/ui/tutorial/tutorial-store.svelte';
import NotificationPermissionBanner from './NotificationPermissionBanner.svelte';
import OnboardingChecklist from './OnboardingChecklist.svelte';
import PremiumWelcome from './PremiumWelcome.svelte';

interface ChildSummary {
	id: number;
	nickname: string;
	age: number;
	uiMode: string;
	balance: number;
	avatarUrl?: string | null;
	level?: number;
	levelTitle?: string;
}

interface MonthSummaryData {
	totalActivities: number;
	currentLevel: number;
	newAchievements: number;
}

interface SeasonEventInfo {
	name: string;
	eventType: string;
	startDate: string;
	endDate: string;
	bannerIcon: string;
}

interface MemoryTicketInfo {
	totalMonths: number;
	ticketsEarned: number;
	ticketsAvailable: number;
	nextTicketAt: number;
}

interface Props {
	children: ChildSummary[];
	pointSettings: PointSettings;
	tutorialStarted?: boolean;
	onboarding?: OnboardingProgress | null;
	mode: 'live' | 'demo';
	basePath: string;
	monthlySummaries?: Record<number, MonthSummaryData>;
	currentMonth?: string;
	planTier?: 'free' | 'standard' | 'family';
	planStats?: {
		activityCount: number;
		activityMax: number | null;
		childCount: number;
		childMax: number | null;
		retentionDays: number | null;
	};
	showPremiumWelcome?: boolean;
	seasonalInfo?: {
		activeEvents: SeasonEventInfo[];
		memoryTicket: MemoryTicketInfo | null;
	} | null;
}

let {
	children,
	pointSettings,
	tutorialStarted = true,
	onboarding = null,
	mode,
	basePath,
	monthlySummaries = {},
	currentMonth = '',
	planTier = 'free',
	planStats,
	showPremiumWelcome = false,
	seasonalInfo = null,
}: Props = $props();

let welcomeVisible = $state(showPremiumWelcome);

async function handleDismissWelcome() {
	welcomeVisible = false;
	try {
		const formData = new FormData();
		formData.append('', '');
		await fetch('?/dismissPremiumWelcome', { method: 'POST', body: formData });
	} catch {
		// Dismissal UI already hidden; server persist failure is non-critical
	}
}

const isDemo = $derived(mode === 'demo');
const showOnboarding = $derived(
	!isDemo && onboarding && !onboarding.dismissed && !onboarding.allCompleted,
);
const onboardingComplete = $derived(!isDemo && onboarding?.allCompleted && !onboarding?.dismissed);

async function handleStartTutorial() {
	await markTutorialStarted();
	await startTutorial();
	await invalidateAll();
}

async function handleDismissBanner() {
	await dismissTutorialBanner();
	await invalidateAll();
}

const ps = $derived(pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

function childLink(child: ChildSummary): string {
	if (isDemo) {
		return `/demo/${child.uiMode}/home?childId=${child.id}`;
	}
	return `${basePath}/children?id=${child.id}`;
}
</script>

<svelte:head>
	<title>管理画面 - がんばりクエスト{isDemo ? ' デモ' : ''}</title>
</svelte:head>

{#if welcomeVisible && (planTier === 'standard' || planTier === 'family')}
	<PremiumWelcome planTier={planTier} onDismiss={handleDismissWelcome} />
{/if}

<div class="space-y-6">
	<!-- Onboarding Checklist (replaces tutorial banner for new users) -->
	{#if showOnboarding && onboarding}
		<OnboardingChecklist {onboarding} />
	{:else if onboardingComplete && onboarding}
		<div class="onboarding-complete-card" data-testid="onboarding-complete">
			<span class="text-2xl">🎉</span>
			<p class="font-bold text-[var(--color-feedback-success-text)]">すべてのセットアップが完了しました！</p>
			<form method="POST" action="?/dismissOnboarding">
				<button type="submit" class="dismiss-complete-btn">非表示にする</button>
			</form>
		</div>
	{:else if !isDemo && !tutorialStarted && !onboarding}
		<!-- Fallback: Legacy tutorial banner -->
		<div class="bg-[var(--color-feedback-info-bg)] border-l-4 border-[var(--color-brand-500)] p-4 rounded-lg" data-tutorial="tutorial-banner">
			<div class="flex items-center gap-3">
				<span class="text-2xl">📖</span>
				<div class="flex-1">
					<p class="font-bold text-[var(--color-text)]">初めてご利用ですか？</p>
					<p class="text-sm text-[var(--color-text-muted)]">チュートリアルで使い方を確認しましょう（約3分）</p>				</div>				<div class="flex gap-2">
					<button
						class="px-3 py-1.5 bg-[var(--color-brand-600)] text-white text-sm font-bold rounded-lg hover:bg-[var(--color-brand-700)] transition-colors"
						onclick={handleStartTutorial}
					>
						開始
					</button>
					<button
						class="px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
						onclick={handleDismissBanner}
					>
						あとで
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- 通知許可バナー -->
	{#if !isDemo}
		<NotificationPermissionBanner />
	{/if}

	<!-- Plan quick link (details moved to /admin/license page) -->
	{#if !isDemo && planTier === 'free'}
		<a href="{basePath}/license" class="plan-quick-link plan-quick-link--free">
			<span class="plan-quick-link__info">
				<span class="plan-quick-link__name">無料プラン</span>
				<span class="plan-quick-link__hint">カスタマイズ機能をアンロックしませんか？</span>
			</span>
			<span class="plan-quick-link__action">⭐ アップグレード →</span>
		</a>
	{/if}

	<!-- Seasonal Content Info -->
	{#if !isDemo && seasonalInfo && seasonalInfo.activeEvents.length > 0}
		<section class="bg-[var(--color-surface-card)] rounded-xl p-4 shadow-sm">
			<h2 class="text-sm font-bold text-[var(--color-text)] mb-3">🌸 季節コンテンツ</h2>
			<div class="space-y-2">
				{#each seasonalInfo.activeEvents as event}
					<div class="flex items-center gap-2 text-sm">
						<span>{event.bannerIcon}</span>
						<span class="font-medium text-[var(--color-text)]">{event.name}</span>
						<span class="text-xs text-[var(--color-text-muted)] ml-auto">
							{event.startDate} 〜 {event.endDate}
						</span>
					</div>
				{/each}
			</div>
			{#if seasonalInfo.memoryTicket && (planTier === 'standard' || planTier === 'family')}
				<div class="mt-3 pt-3 border-t border-[var(--color-border-default)]">
					<div class="flex items-center justify-between text-sm">
						<span class="text-[var(--color-text)]">🎫 思い出チケット</span>
						<span class="font-bold text-[var(--color-premium)]">
							{seasonalInfo.memoryTicket.ticketsAvailable}枚
						</span>
					</div>
					<p class="text-xs text-[var(--color-text-muted)] mt-1">
						継続{seasonalInfo.memoryTicket.totalMonths}ヶ月 — 次のチケットまで{seasonalInfo.memoryTicket.nextTicketAt}ヶ月
					</p>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Page heading (visually compact, semantically correct) -->
	<h1 class="dashboard-heading">管理ダッシュボード{isDemo ? '（デモ）' : ''}</h1>

	<!-- Summary Cards -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tutorial="summary-cards">
		<div class="summary-card" role="group" aria-label="登録こども数">
			<p class="summary-card__value">{children.length}</p>
			<p class="summary-card__label">こどもの数</p>
		</div>
		<div class="summary-card" role="group" aria-label="全ポイント合計">
			<p class="summary-card__value summary-card__value--accent">
				{fmtBal(children.reduce((sum, c) => sum + c.balance, 0))}
			</p>
			<p class="summary-card__label">合計{unit}</p>
		</div>
	</div>

	<!-- Monthly Summary -->
	{#if currentMonth && children.length > 0}
		{@const monthLabel = currentMonth.replace(/^(\d{4})-0?(\d{1,2})$/, '$1年$2月')}
		<section>
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-lg font-bold text-[var(--color-text)]">📊 {monthLabel}のがんばり</h2>
				<a href="{basePath}/reports" class="text-xs text-[var(--color-brand-500)] hover:underline">詳しく見る →</a>
			</div>
			<div class="grid gap-3">
				{#each children as child}
					{@const summary = monthlySummaries[child.id]}
					{#if summary}
						<div class="bg-[var(--color-surface-card)] rounded-xl p-4 shadow-sm">
							<p class="text-sm font-bold text-[var(--color-text)] mb-2">{child.nickname}</p>
							<div class="flex gap-3">
								<div class="monthly-stat monthly-stat--blue" role="group" aria-label="{child.nickname}の活動回数">
									<p class="monthly-stat__heading">活動回数</p>
									<p class="monthly-stat__value">{summary.totalActivities}</p>
									<p class="monthly-stat__unit">回</p>
								</div>
								<div class="monthly-stat monthly-stat--purple" role="group" aria-label="{child.nickname}のレベル">
									<p class="monthly-stat__heading">レベル</p>
									<p class="monthly-stat__value">{summary.currentLevel}</p>
								</div>
								<div class="monthly-stat monthly-stat--amber" role="group" aria-label="{child.nickname}の実績">
									<p class="monthly-stat__heading">実績</p>
									<p class="monthly-stat__value">{summary.newAchievements}</p>
									<p class="monthly-stat__unit">獲得</p>
								</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/if}

	<!-- Children Overview -->
	<section data-tutorial="children-overview">
		<h2 class="text-lg font-bold text-[var(--color-text)] mb-3">こども一覧</h2>
		{#if children.length === 0}
			<div class="bg-[var(--color-surface-card)] rounded-xl p-8 shadow-sm text-center text-[var(--color-text-muted)]">
				<p>まだこどもが登録されていません</p>
			</div>
		{:else}
			<div class="grid gap-3">
				{#each children as child}
					<a
						href={childLink(child)}
						class="child-list-item"
					>
						{#if child.avatarUrl}
							<img src={child.avatarUrl} alt={child.nickname} class="w-10 h-10 rounded-full object-cover" loading="lazy" />
						{:else}
							<span class="text-3xl">👤</span>
						{/if}
						<div class="flex-1">
							<p class="font-bold text-[var(--color-text)]">{child.nickname}</p>
							<p class="text-sm text-[var(--color-text-muted)]">{child.age}歳 / {child.uiMode}</p>
						</div>
						<div class="text-right">
							<p class="text-lg font-bold text-[var(--color-warning)]">{fmtBal(child.balance)}</p>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Demo CTA (demo only) -->
	{#if isDemo}
		<div class="bg-gradient-to-r from-[var(--color-feedback-warning-bg)] to-[var(--color-orange-50)] border border-[var(--color-feedback-warning-border)] rounded-xl p-4 text-center">			<p class="text-sm font-bold text-[var(--color-text)] mb-1">いかがでしたか？</p>			<p class="text-xs text-[var(--color-text-muted)] mb-3">
				お子さまの「がんばり」を冒険に変えませんか？
			</p>
			<a
				href="/demo/signup"
				class="inline-block w-full py-2.5 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-orange-500)] text-white font-bold rounded-xl text-center text-sm"			>				無料で はじめる →
			</a>
		</div>
	{/if}
</div>

<style>
	/* #508: Page heading */
	.dashboard-heading {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
		margin: 0;
	}

	/* #489 + #508: Summary cards */
	.summary-card {
		background: var(--color-surface-card, #fff);
		border-radius: var(--radius-lg, 12px);
		padding: 1rem;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
		text-align: center;
	}

	.summary-card__value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-action-primary, #2563eb);
	}

	.summary-card__value--accent {
		color: var(--color-gold-600, #d97706);
	}

	.summary-card__label {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #4b5563);
		margin-top: 0.25rem;
	}

	/* #503 + #508: Monthly stat cards */
	.monthly-stat {
		flex: 1;
		border-radius: 0.5rem;
		padding: 0.5rem;
		text-align: center;
	}

	.monthly-stat--blue {
		background: var(--color-info-50, #eff6ff);
	}

	.monthly-stat--purple {
		background: var(--color-stat-purple-bg, #f5f3ff);
	}

	.monthly-stat--amber {
		background: var(--color-warning-50, #fffbeb);
	}

	.monthly-stat__heading {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary, #4b5563);
	}

	.monthly-stat__value {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
	}

	.monthly-stat__unit {
		font-size: 0.6875rem;
		color: var(--color-text-tertiary, #6b7280);
	}

	/* #508: Child list item with focus indicator */
	.child-list-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: var(--color-surface-card, #fff);
		border-radius: var(--radius-lg, 12px);
		padding: 1rem;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
		text-decoration: none;
		color: inherit;
		transition: box-shadow 0.15s;
	}

	.child-list-item:hover {
		box-shadow: 0 4px 6px rgb(0 0 0 / 0.1);
	}

	.child-list-item:focus-visible {
		outline: 2px solid var(--color-action-primary, #2563eb);
		outline-offset: 2px;
	}

	.onboarding-complete-card {
		display: flex;
		align-items: center;
		gap: 12px;
		background: linear-gradient(135deg, var(--color-success-50, #f0fdf4), var(--color-surface-card));
		border: 1px solid var(--color-success-300, #86efac);
		border-radius: var(--radius-lg, 12px);
		padding: 16px;
	}

	.dismiss-complete-btn {
		margin-left: auto;
		background: none;
		border: none;
		color: var(--color-text-tertiary);
		font-size: 0.75rem;
		cursor: pointer;
		text-decoration: underline;
	}

	.plan-quick-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-lg, 12px);
		text-decoration: none;
		transition: all 0.15s;
	}

	.plan-quick-link--free {
		background: var(--color-premium-bg);
		border: 1px solid var(--color-premium-bg);
	}

	.plan-quick-link--free:hover {
		border-color: var(--color-premium);
	}

	.plan-quick-link__info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.plan-quick-link__name {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-text-secondary);
	}

	.plan-quick-link__hint {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
	}

	.plan-quick-link__action {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-premium);
		white-space: nowrap;
	}

</style>
