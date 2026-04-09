<script lang="ts">
import { goto } from '$app/navigation';
import { formatChildName } from '$lib/domain/child-display';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const categoryNames: Record<string, string> = {
	'1': 'うんどう',
	'2': 'べんきょう',
	'3': 'せいかつ',
	'4': 'こうりゅう',
	'5': 'そうぞう',
};

function formatMonth(ym: string): string {
	const [_y, m] = ym.split('-');
	return `${Number(m)}月`;
}

function handleChildChange(childId: number) {
	goto(`?childId=${childId}&year=${data.fiscalYear}`, { replaceState: true });
}

function handlePrint() {
	window.print();
}
</script>

<svelte:head>
	<title>成長記録ブック - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<div class="screen-controls">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-bold text-[var(--color-text-primary)]">📖 成長記録ブック</h2>
			<div class="flex gap-2">
				<a href="/admin/reports" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">&larr; レポートへ</a>
				{#if data.isPremium && data.book}
					<Button type="button" variant="primary" size="sm" onclick={handlePrint}>
						🖨️ 印刷 / PDF
					</Button>
				{/if}
			</div>
		</div>

		{#if !data.isPremium}
			<div class="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-sm">
				<span>⭐</span>
				<p class="text-[var(--color-feedback-warning-text)]">
					PDF保存は<a href="/admin/license" class="underline font-medium">スタンダードプラン以上</a>で利用できます。
				</p>
			</div>
		{/if}

		{#if data.children.length > 1}
			<div class="flex gap-2 overflow-x-auto pb-2">
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
					{formatChildName(book.childName, 'possessive')}がんばり記録
				</h1>
				<p class="text-[var(--color-text-muted)]">{book.fiscalYear}年度（{book.fiscalYear}年4月〜{Number(book.fiscalYear) + 1}年3月）</p>
				{#if book.levelTitle}
					<p class="mt-2 text-sm font-medium text-[var(--color-feedback-info-text)]">
						現在レベル: {book.currentLevel}（{book.levelTitle}）
					</p>
				{/if}
			</div>
			{/snippet}
		</Card>

		<!-- Annual Summary -->
		<Card variant="default" padding="md">
			{#snippet children()}
			<h3 class="text-base font-bold text-[var(--color-text-primary)] mb-3">📊 年間サマリー</h3>
			<div class="grid grid-cols-2 gap-3">
				<div class="text-center p-3 bg-[var(--color-feedback-info-bg)] rounded-lg">
					<p class="text-2xl font-bold text-[var(--color-feedback-info-text)]">{book.totalActivities}</p>
					<p class="text-xs text-[var(--color-text-muted)]">活動回数</p>
				</div>
				<div class="text-center p-3 bg-[var(--color-feedback-success-bg)] rounded-lg">
					<p class="text-2xl font-bold text-[var(--color-feedback-success-text)]">{book.totalPoints.toLocaleString()}</p>
					<p class="text-xs text-[var(--color-text-muted)]">獲得ポイント</p>
				</div>
				<div class="text-center p-3 bg-orange-50 rounded-lg">
					<p class="text-2xl font-bold text-orange-600">{book.maxStreakDays}</p>
					<p class="text-xs text-[var(--color-text-muted)]">さいちょうストリーク</p>
				</div>
				<div class="text-center p-3 bg-[var(--color-stat-purple-bg)] rounded-lg">
					<p class="text-2xl font-bold text-[var(--color-stat-purple)]">{book.certificateCount}</p>
					<p class="text-xs text-[var(--color-text-muted)]">しょうめいしょ</p>
				</div>
			</div>
			{#if book.bestMonth}
				<p class="text-sm text-[var(--color-text-secondary)] mt-3">
					いちばんがんばった月: <strong>{formatMonth(book.bestMonth)}</strong>
				</p>
			{/if}
			{#if book.bestCategory && categoryNames[book.bestCategory]}
				<p class="text-sm text-[var(--color-text-secondary)]">
					とくいなカテゴリ: <strong>{categoryNames[book.bestCategory]}</strong>
				</p>
			{/if}
			{/snippet}
		</Card>

		<!-- Monthly pages -->
		<h3 class="text-base font-bold text-[var(--color-text-primary)]">📅 月別の記録</h3>
		{#each book.months as month (month.month)}
			{@const hasActivity = month.totalActivities > 0}
			<Card variant="default" padding="sm">
				{#snippet children()}
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<span class="text-2xl">{hasActivity ? '✅' : '⬜'}</span>
						<div>
							<p class="font-bold text-sm text-[var(--color-text-primary)]">{formatMonth(month.month)}</p>
							<p class="text-xs text-[var(--color-text-muted)]">
								{month.totalActivities}回 / {month.daysWithActivity}日活動
							</p>
						</div>
					</div>
					<div class="text-right">
						<p class="text-sm font-bold text-[var(--color-feedback-info-text)]">{month.totalPoints.toLocaleString()}pt</p>
						{#if month.maxStreakDays > 0}
							<p class="text-xs text-orange-500">🔥 {month.maxStreakDays}日連続</p>
						{/if}
					</div>
				</div>
				{/snippet}
			</Card>
		{/each}

		<!-- Certificate link -->
		<div class="text-center py-4">
			<a
				href="/admin/certificates"
				class="text-sm font-medium text-[var(--color-feedback-info-text)] hover:underline"
			>
				📜 証明書一覧を見る →
			</a>
		</div>
	{:else if data.children.length === 0}
		<div class="text-center text-[var(--color-text-muted)] py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">子供が登録されていません</p>
		</div>
	{:else}
		<div class="text-center text-[var(--color-text-muted)] py-12">
			<p class="text-4xl mb-2">📖</p>
			<p class="font-bold">データがありません</p>
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
