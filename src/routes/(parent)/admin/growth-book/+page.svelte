<script lang="ts">
import { goto } from '$app/navigation';
import { formatChildName } from '$lib/domain/child-display';
import type { ChildId } from '$lib/domain/ids';
import { APP_LABELS, formatMonthOnly, GROWTH_BOOK_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const categoryNames: Record<string, string> = {
	'1': GROWTH_BOOK_LABELS.categoryUndou,
	'2': GROWTH_BOOK_LABELS.categoryBenkyou,
	'3': GROWTH_BOOK_LABELS.categorySeikatsu,
	'4': GROWTH_BOOK_LABELS.categoryKouryuu,
	'5': GROWTH_BOOK_LABELS.categorySouzou,
};

function formatMonth(ym: string): string {
	const [_y, m] = ym.split('-');
	return formatMonthOnly(m ?? 0);
}

function handleChildChange(childId: ChildId) {
	goto(`?childId=${childId}&year=${data.fiscalYear}`, { replaceState: true });
}

function handlePrint() {
	window.print();
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.growth}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<div class="screen-controls">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-bold text-[var(--color-text-primary)]">{GROWTH_BOOK_LABELS.pageHeading}</h2>
			<div class="flex gap-2">
				<a href="/admin/reports" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">{GROWTH_BOOK_LABELS.backToReports}</a>
				{#if data.isPremium && data.book}
					<Button type="button" variant="primary" size="sm" onclick={handlePrint} data-tutorial="growth-book-print">
						{GROWTH_BOOK_LABELS.printButton}
					</Button>
				{/if}
			</div>
		</div>

		{#if !data.isPremium}
			<div class="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-sm">
				<span>⭐</span>
				<p class="text-[var(--color-feedback-warning-text)]">
					{GROWTH_BOOK_LABELS.premiumNotePrefix}<a href="/admin/subscription" class="underline font-medium">{GROWTH_BOOK_LABELS.premiumNoteLink}</a>{GROWTH_BOOK_LABELS.premiumNoteSuffix}
				</p>
			</div>
		{/if}

		{#if data.children.length > 1}
			<div class="flex gap-2 overflow-x-auto pb-2" data-tutorial="growth-book-child-tabs">
				{#each data.children as child (child.id)}
					<Button
						type="button"
						variant={data.book?.childId === child.id ? 'primary' : 'outline'}
						size="sm"
						class="whitespace-nowrap {data.book?.childId === child.id ? '' : 'bg-white text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]'}"
						onclick={() => handleChildChange(child.id)}
					>
						{child.nickname}
					</Button>
				{/each}
			</div>
		{/if}
	</div>

	{#if data.book}
		{@const book = data.book}

		<!-- Cover -->
		<Card variant="default" padding="lg">
			{#snippet children()}
			<div class="text-center py-4">
				<p class="text-4xl mb-2">📖</p>
				<h1 class="text-xl font-bold text-[var(--color-text)] mb-1">
					{formatChildName(book.childName, 'possessive')}{GROWTH_BOOK_LABELS.titleSuffix}
				</h1>
				<p class="text-[var(--color-text-muted)]">{GROWTH_BOOK_LABELS.fiscalYearRange(Number(book.fiscalYear))}</p>
				{#if book.levelTitle}
					<p class="mt-2 text-sm font-medium text-[var(--color-feedback-info-text)]">
						{GROWTH_BOOK_LABELS.currentLevel(book.currentLevel, book.levelTitle)}
					</p>
				{/if}
			</div>
			{/snippet}
		</Card>

		<!-- Annual Summary (#4675: ページガイド anchor) -->
		<Card variant="default" padding="md" data-tutorial="growth-book-summary">
			{#snippet children()}
			<h3 class="text-base font-bold text-[var(--color-text-primary)] mb-3">{GROWTH_BOOK_LABELS.annualSummaryTitle}</h3>
			<div class="grid grid-cols-2 gap-3">
				<div class="text-center p-3 bg-[var(--color-feedback-info-bg)] rounded-lg">
					<p class="text-2xl font-bold text-[var(--color-feedback-info-text)]">{book.totalActivities}</p>
					<p class="text-xs text-[var(--color-text-muted)]">{GROWTH_BOOK_LABELS.statActivities}</p>
				</div>
				<div class="text-center p-3 bg-[var(--color-feedback-success-bg)] rounded-lg">
					<p class="text-2xl font-bold text-[var(--color-feedback-success-text)]">{book.totalPoints.toLocaleString()}</p>
					<p class="text-xs text-[var(--color-text-muted)]">{GROWTH_BOOK_LABELS.statPoints}</p>
				</div>
				<div class="text-center p-3 bg-orange-50 rounded-lg">
					<p class="text-2xl font-bold text-orange-600">{book.maxStreakDays}</p>
					<p class="text-xs text-[var(--color-text-muted)]">{GROWTH_BOOK_LABELS.statMaxStreak}</p>
				</div>
				<div class="text-center p-3 bg-[var(--color-stat-purple-bg)] rounded-lg">
					<p class="text-2xl font-bold text-[var(--color-stat-purple)]">{book.certificateCount}</p>
					<p class="text-xs text-[var(--color-text-muted)]">{GROWTH_BOOK_LABELS.statCertificates}</p>
				</div>
			</div>
			{#if book.bestMonth}
				<p class="text-sm text-[var(--color-text-secondary)] mt-3">
					{GROWTH_BOOK_LABELS.bestMonthLabel}<strong>{formatMonth(book.bestMonth)}</strong>
				</p>
			{/if}
			{#if book.bestCategory && categoryNames[book.bestCategory]}
				<p class="text-sm text-[var(--color-text-secondary)]">
					{GROWTH_BOOK_LABELS.bestCategoryLabel}<strong>{categoryNames[book.bestCategory]}</strong>
				</p>
			{/if}
			{/snippet}
		</Card>

		<!-- Monthly pages -->
		<h3 class="text-base font-bold text-[var(--color-text-primary)]">{GROWTH_BOOK_LABELS.monthlyTitle}</h3>
		{#each book.months as month (month.month)}
			{@const hasActivity = month.totalActivities > 0}
			<!-- #4697: まだ来ていない月は数値を出さない。年度は 4 月〜翌 3 月を必ず 12 行並べるため
			     未来月の枠ができるが、そこに数字が入ると「未来の記録」になってしまう -->
			<Card variant="default" padding="sm">
				{#snippet children()}
				<div class="flex items-center justify-between" data-testid="growth-book-month-{month.month}">
					<div class="flex items-center gap-3">
						<span class="text-2xl">{month.isFuture ? '⋯' : hasActivity ? '✅' : '⬜'}</span>
						<div>
							<p class="font-bold text-sm text-[var(--color-text-primary)]">{formatMonth(month.month)}</p>
							<p class="text-xs text-[var(--color-text-muted)]">
								{#if month.isFuture}
									{GROWTH_BOOK_LABELS.monthlyFutureNote}
								{:else}
									{GROWTH_BOOK_LABELS.monthlyActivities(month.totalActivities)} / {GROWTH_BOOK_LABELS.monthlyDays(month.daysWithActivity)}
								{/if}
							</p>
						</div>
					</div>
					<div class="text-right">
						<p class="text-sm font-bold text-[var(--color-feedback-info-text)]">
							{month.isFuture
								? GROWTH_BOOK_LABELS.valueNotYet
								: `${month.totalPoints.toLocaleString()}pt`}
						</p>
						{#if !month.isFuture && month.maxStreakDays > 0}
							<p class="text-xs text-[var(--color-text-warning-strong)]">{GROWTH_BOOK_LABELS.monthlyStreak(month.maxStreakDays)}</p>
						{/if}
					</div>
				</div>
				{/snippet}
			</Card>
		{/each}

		<!-- Certificate link (#4675: ページガイド anchor) -->
		<div class="text-center py-4" data-tutorial="growth-book-certificates">
			<a
				href="/admin/certificates"
				class="text-sm font-medium text-[var(--color-feedback-info-text)] hover:underline"
			>
				{GROWTH_BOOK_LABELS.certificateLink}
			</a>
		</div>
	{:else if data.children.length === 0}
		<div class="text-center text-[var(--color-text-muted)] py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">{GROWTH_BOOK_LABELS.noChildrenText}</p>
		</div>
	{:else}
		<div class="text-center text-[var(--color-text-muted)] py-12">
			<p class="text-4xl mb-2">📖</p>
			<p class="font-bold">{GROWTH_BOOK_LABELS.noDataText}</p>
		</div>
	{/if}
</div>

<style>
	@media print {
		.screen-controls {
			display: none !important;
		}

		:global(.admin-shell > header),
		:global(.admin-shell > nav),
		:global(.safe-area-bottom) {
			display: none !important;
		}

		:global(.admin-shell > main) {
			max-width: none;
			padding: 10mm;
			margin: 0;
		}

		:global(.admin-shell) {
			background: white !important;
		}
	}
</style>
