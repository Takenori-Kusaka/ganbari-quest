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
			<p class="font-bold text-green-700">すべてのセットアップが完了しました！</p>
			<form method="POST" action="?/dismissOnboarding">
				<button type="submit" class="dismiss-complete-btn">非表示にする</button>
			</form>
		</div>
	{:else if !isDemo && !tutorialStarted && !onboarding}
		<!-- Fallback: Legacy tutorial banner -->
		<div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg" data-tutorial="tutorial-banner">
			<div class="flex items-center gap-3">
				<span class="text-2xl">📖</span>
				<div class="flex-1">
					<p class="font-bold text-gray-700">初めてご利用ですか？</p>
					<p class="text-sm text-gray-500">チュートリアルで使い方を確認しましょう（約3分）</p>
				</div>
				<div class="flex gap-2">
					<button
						class="px-3 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors"
						onclick={handleStartTutorial}
					>
						開始
					</button>
					<button
						class="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
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
				<span class="plan-quick-link__hint">もっと便利に使いませんか？</span>
			</span>
			<span class="plan-quick-link__action">⭐ アップグレード →</span>
		</a>
	{/if}

	<!-- Seasonal Content Info -->
	{#if !isDemo && seasonalInfo && seasonalInfo.activeEvents.length > 0}
		<section class="bg-white rounded-xl p-4 shadow-sm">
			<h2 class="text-sm font-bold text-gray-700 mb-3">🌸 季節コンテンツ</h2>
			<div class="space-y-2">
				{#each seasonalInfo.activeEvents as event}
					<div class="flex items-center gap-2 text-sm">
						<span>{event.bannerIcon}</span>
						<span class="font-medium text-gray-800">{event.name}</span>
						<span class="text-xs text-gray-400 ml-auto">
							{event.startDate} 〜 {event.endDate}
						</span>
					</div>
				{/each}
			</div>
			{#if seasonalInfo.memoryTicket && (planTier === 'standard' || planTier === 'family')}
				<div class="mt-3 pt-3 border-t border-gray-100">
					<div class="flex items-center justify-between text-sm">
						<span class="text-gray-600">🎫 思い出チケット</span>
						<span class="font-bold text-purple-600">
							{seasonalInfo.memoryTicket.ticketsAvailable}枚
						</span>
					</div>
					<p class="text-xs text-gray-400 mt-1">
						継続{seasonalInfo.memoryTicket.totalMonths}ヶ月 — 次のチケットまで{seasonalInfo.memoryTicket.nextTicketAt}ヶ月
					</p>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Summary Cards -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tutorial="summary-cards">
		<div class="bg-white rounded-xl p-4 shadow-sm text-center">
			<p class="text-2xl font-bold text-blue-600">{children.length}</p>
			<p class="text-xs text-gray-500 mt-1">こどもの数</p>
		</div>
		<div class="bg-white rounded-xl p-4 shadow-sm text-center">
			<p class="text-2xl font-bold text-amber-500">
				{fmtBal(children.reduce((sum, c) => sum + c.balance, 0))}
			</p>
			<p class="text-xs text-gray-500 mt-1">合計{unit}</p>
		</div>
	</div>

	<!-- Monthly Summary -->
	{#if currentMonth && children.length > 0}
		{@const monthLabel = currentMonth.replace(/^(\d{4})-0?(\d{1,2})$/, '$1年$2月')}
		<section>
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-lg font-bold text-gray-700">📊 {monthLabel}のがんばり</h2>
				<a href="{basePath}/reports" class="text-xs text-blue-500 hover:underline">詳しく見る →</a>
			</div>
			<div class="grid gap-3">
				{#each children as child}
					{@const summary = monthlySummaries[child.id]}
					{#if summary}
						<div class="bg-white rounded-xl p-4 shadow-sm">
							<p class="text-sm font-bold text-gray-700 mb-2">{child.nickname}</p>
							<div class="flex gap-3">
								<div class="flex-1 rounded-lg bg-blue-50 p-2 text-center">
									<p class="text-xs text-blue-600">かつどう</p>
									<p class="text-lg font-bold text-blue-700">{summary.totalActivities}</p>
									<p class="text-[10px] text-blue-400">かい</p>
								</div>
								<div class="flex-1 rounded-lg bg-purple-50 p-2 text-center">
									<p class="text-xs text-purple-600">レベル</p>
									<p class="text-lg font-bold text-purple-700">{summary.currentLevel}</p>
								</div>
								<div class="flex-1 rounded-lg bg-amber-50 p-2 text-center">
									<p class="text-xs text-amber-600">じっせき</p>
									<p class="text-lg font-bold text-amber-700">{summary.newAchievements}</p>
									<p class="text-[10px] text-amber-400">かくとく</p>
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
		<h2 class="text-lg font-bold text-gray-700 mb-3">こども一覧</h2>
		{#if children.length === 0}
			<div class="bg-white rounded-xl p-8 shadow-sm text-center text-gray-400">
				<p>まだこどもが登録されていません</p>
			</div>
		{:else}
			<div class="grid gap-3">
				{#each children as child}
					<a
						href={childLink(child)}
						class="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"
					>
						{#if child.avatarUrl}
							<img src={child.avatarUrl} alt={child.nickname} class="w-10 h-10 rounded-full object-cover" loading="lazy" />
						{:else}
							<span class="text-3xl">👤</span>
						{/if}
						<div class="flex-1">
							<p class="font-bold text-gray-700">{child.nickname}</p>
							<p class="text-sm text-gray-400">{child.age}歳 / {child.uiMode}</p>
						</div>
						<div class="text-right">
							<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance)}</p>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Demo CTA (demo only) -->
	{#if isDemo}
		<div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 rounded-xl p-4 text-center">
			<p class="text-sm font-bold text-gray-700 mb-1">いかがでしたか？</p>
			<p class="text-xs text-gray-500 mb-3">
				お子さまの「がんばり」を冒険に変えませんか？
			</p>
			<a
				href="/demo/signup"
				class="inline-block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-sm"
			>
				無料で はじめる →
			</a>
		</div>
	{/if}
</div>

<style>
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
