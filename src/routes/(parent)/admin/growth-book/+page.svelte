<script lang="ts">
import { goto } from '$app/navigation';
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
			<h2 class="text-lg font-bold text-gray-700">📖 成長記録ブック</h2>
			<div class="flex gap-2">
				<a href="/admin/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; レポートへ</a>
				{#if data.isPremium && data.book}
					<Button type="button" variant="primary" size="sm" onclick={handlePrint}>
						🖨️ 印刷 / PDF
					</Button>
				{/if}
			</div>
		</div>

		{#if !data.isPremium}
			<div class="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
				<span>⭐</span>
				<p class="text-amber-700">
					PDF保存は<a href="/admin/license" class="underline font-medium">プレミアムプラン</a>で利用できます。
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
						class="whitespace-nowrap {data.book?.childId === child.id ? '' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}"
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
				<h1 class="text-xl font-bold text-gray-800 mb-1">
					{book.childName}ちゃんの がんばり記録
				</h1>
				<p class="text-gray-500">{book.fiscalYear}年度（{book.fiscalYear}年4月〜{Number(book.fiscalYear) + 1}年3月）</p>
				{#if book.levelTitle}
					<p class="mt-2 text-sm font-medium text-blue-600">
						現在レベル: {book.currentLevel}（{book.levelTitle}）
					</p>
				{/if}
			</div>
			{/snippet}
		</Card>

		<!-- Annual Summary -->
		<Card variant="default" padding="md">
			{#snippet children()}
			<h3 class="text-base font-bold text-gray-700 mb-3">📊 年間サマリー</h3>
			<div class="grid grid-cols-2 gap-3">
				<div class="text-center p-3 bg-blue-50 rounded-lg">
					<p class="text-2xl font-bold text-blue-600">{book.totalActivities}</p>
					<p class="text-xs text-gray-500">かつどうかいすう</p>
				</div>
				<div class="text-center p-3 bg-green-50 rounded-lg">
					<p class="text-2xl font-bold text-green-600">{book.totalPoints.toLocaleString()}</p>
					<p class="text-xs text-gray-500">かくとくポイント</p>
				</div>
				<div class="text-center p-3 bg-orange-50 rounded-lg">
					<p class="text-2xl font-bold text-orange-600">{book.maxStreakDays}</p>
					<p class="text-xs text-gray-500">さいちょうストリーク</p>
				</div>
				<div class="text-center p-3 bg-purple-50 rounded-lg">
					<p class="text-2xl font-bold text-purple-600">{book.certificateCount}</p>
					<p class="text-xs text-gray-500">しょうめいしょ</p>
				</div>
			</div>
			{#if book.bestMonth}
				<p class="text-sm text-gray-600 mt-3">
					いちばんがんばった月: <strong>{formatMonth(book.bestMonth)}</strong>
				</p>
			{/if}
			{#if book.bestCategory && categoryNames[book.bestCategory]}
				<p class="text-sm text-gray-600">
					とくいなカテゴリ: <strong>{categoryNames[book.bestCategory]}</strong>
				</p>
			{/if}
			{/snippet}
		</Card>

		<!-- Monthly pages -->
		<h3 class="text-base font-bold text-gray-700">📅 月べつのきろく</h3>
		{#each book.months as month (month.month)}
			{@const hasActivity = month.totalActivities > 0}
			<Card variant="default" padding="sm">
				{#snippet children()}
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<span class="text-2xl">{hasActivity ? '✅' : '⬜'}</span>
						<div>
							<p class="font-bold text-sm text-gray-700">{formatMonth(month.month)}</p>
							<p class="text-xs text-gray-500">
								{month.totalActivities}回 / {month.daysWithActivity}日活動
							</p>
						</div>
					</div>
					<div class="text-right">
						<p class="text-sm font-bold text-blue-600">{month.totalPoints.toLocaleString()}pt</p>
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
				class="text-sm font-medium text-blue-600 hover:underline"
			>
				📜 証明書一覧を見る →
			</a>
		</div>
	{:else if data.children.length === 0}
		<div class="text-center text-gray-500 py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">子供が登録されていません</p>
		</div>
	{:else}
		<div class="text-center text-gray-500 py-12">
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
