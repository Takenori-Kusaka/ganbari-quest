<script lang="ts">
import { formatPointValueWithSign } from '$lib/domain/point-display';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

let detailOpen = $state(false);
let selectedReview = $state<(typeof data.reviews)[number] | null>(null);

const healthLabels: Record<string, { label: string; icon: string }> = {
	no_injury: { label: 'おおきなけがをしなかった', icon: '🩹' },
	no_cold: { label: 'かぜをあまりひかなかった', icon: '🤧' },
	played_outside: { label: 'たくさんそとであそんだ', icon: '🌞' },
	ate_well: { label: 'すききらいなくたべられた', icon: '🍽️' },
	slept_well: { label: 'はやねはやおきができた', icon: '😴' },
};

function parseHealthChecks(json: string): Record<string, boolean> {
	try {
		return JSON.parse(json);
	} catch {
		return {};
	}
}

function getCheckedCount(review: (typeof data.reviews)[number]): number {
	const checks = parseHealthChecks(review.healthChecks);
	return Object.values(checks).filter(Boolean).length;
}

function handleTap(review: (typeof data.reviews)[number]) {
	selectedReview = review;
	detailOpen = true;
}
</script>

<svelte:head>
	<title>おもいで - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<!-- Header -->
	<div class="flex items-center justify-center gap-[var(--spacing-sm)] mb-[var(--spacing-md)]">
		<span class="text-3xl">📖</span>
		<p class="text-lg font-bold">おたんじょうびのおもいで</p>
	</div>

	{#if data.reviews.length > 0}
		<div class="flex flex-col gap-[var(--spacing-md)]">
			{#each data.reviews as review (review.id)}
				<button
					class="tap-target w-full text-left bg-white rounded-[var(--radius-lg)] shadow-sm border-2 border-amber-200 overflow-hidden transition-all active:scale-[0.98]"
					onclick={() => handleTap(review)}
				>
					<!-- Year header -->
					<div class="bg-gradient-to-r from-pink-100 to-amber-100 px-4 py-2 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="text-2xl">🎂</span>
							<span class="font-bold text-lg">{review.reviewYear}ねん</span>
						</div>
						<span class="text-sm font-bold text-[var(--color-text-muted)]">
							{review.ageAtReview}さい
						</span>
					</div>

					<!-- Content summary -->
					<div class="px-4 py-3 flex flex-col gap-2">
						<!-- Health check summary -->
						<div class="flex items-center gap-2">
							<span class="text-sm">🩺</span>
							<span class="text-sm">
								けんこう: {getCheckedCount(review)}/5
							</span>
						</div>

						<!-- Aspiration -->
						{#if review.aspirationText}
							<div class="flex items-center gap-2">
								<span class="text-sm">🌟</span>
								<span class="text-sm truncate">
									{review.aspirationText}
								</span>
							</div>
						{/if}

						<!-- Points -->
						<div class="flex items-center gap-2">
							<span class="text-sm">💎</span>
							<span class="text-sm font-bold text-[var(--color-point)]">
								{fmtPts(review.totalPoints)}
							</span>
						</div>
					</div>
				</button>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--spacing-sm)]">📖</span>
			<p class="font-bold">おもいでがまだないよ</p>
			<p class="text-sm mt-1">おたんじょうびにふりかえりをしよう！</p>
		</div>
	{/if}

	<!-- Back link -->
	<div class="mt-[var(--spacing-lg)] text-center">
		<a href="/kinder/status" class="text-sm text-[var(--color-text-muted)] underline">
			← つよさにもどる
		</a>
	</div>
</div>

<!-- Review detail dialog -->
<Dialog bind:open={detailOpen} title="">
	{#if selectedReview}
		{@const checks = parseHealthChecks(selectedReview.healthChecks)}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<!-- Year & Age -->
			<div class="text-5xl">🎂</div>
			<div>
				<p class="text-xl font-bold">{selectedReview.reviewYear}ねんのおもいで</p>
				<p class="text-sm text-[var(--color-text-muted)]">
					{selectedReview.ageAtReview}さいのおたんじょうび
				</p>
			</div>

			<!-- Health checks -->
			<div class="w-full text-left bg-green-50 rounded-[var(--radius-md)] p-3">
				<p class="text-sm font-bold mb-2">🩺 けんこうチェック</p>
				{#each Object.entries(healthLabels) as [key, item] (key)}
					<div class="flex items-center gap-2 py-1">
						<span class="text-sm">{checks[key] ? '✅' : '⬜'}</span>
						<span class="text-sm">{item.icon} {item.label}</span>
					</div>
				{/each}
			</div>

			<!-- Aspiration -->
			{#if selectedReview.aspirationText}
				<div class="w-full text-left bg-blue-50 rounded-[var(--radius-md)] p-3">
					<p class="text-sm font-bold mb-1">🌟 ことしのもくひょう</p>
					<p class="text-sm">{selectedReview.aspirationText}</p>
				</div>
			{/if}

			<!-- Points breakdown -->
			<div class="w-full text-left bg-amber-50 rounded-[var(--radius-md)] p-3">
				<p class="text-sm font-bold mb-2">💎 もらったポイント</p>
				<div class="flex flex-col gap-1 text-sm">
					<div class="flex justify-between">
						<span>おたんじょうびボーナス</span>
						<span class="font-bold">{fmtPts(selectedReview.basePoints)}</span>
					</div>
					{#if selectedReview.healthPoints > 0}
						<div class="flex justify-between">
							<span>けんこうポイント</span>
							<span class="font-bold">{fmtPts(selectedReview.healthPoints)}</span>
						</div>
					{/if}
					{#if selectedReview.aspirationPoints > 0}
						<div class="flex justify-between">
							<span>もくひょうポイント</span>
							<span class="font-bold">{fmtPts(selectedReview.aspirationPoints)}</span>
						</div>
					{/if}
					<div class="flex justify-between border-t pt-1 mt-1">
						<span class="font-bold">ごうけい</span>
						<span class="font-bold text-[var(--color-point)]">{fmtPts(selectedReview.totalPoints)}</span>
					</div>
				</div>
			</div>

			<!-- Date -->
			{#if selectedReview.createdAt}
				<p class="text-xs text-[var(--color-text-muted)]">
					{new Date(selectedReview.createdAt).toLocaleDateString('ja-JP')} にきろく
				</p>
			{/if}
		</div>
	{/if}
</Dialog>
