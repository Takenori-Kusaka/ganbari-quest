<script lang="ts">
import { getCategoryByCode } from '$lib/domain/validation/activity.js';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const pack = $derived(data.pack);

// Group activities by category
const groupedActivities = $derived.by(() => {
	const groups = new Map<string, typeof pack.activities>();
	for (const activity of pack.activities) {
		const catDef = getCategoryByCode(activity.categoryCode);
		const label = catDef?.name ?? activity.categoryCode;
		if (!groups.has(label)) {
			groups.set(label, []);
		}
		groups.get(label)?.push(activity);
	}
	return [...groups.entries()];
});
</script>

<svelte:head>
	<title>{pack.packName} - かつどうパック - がんばりクエスト</title>
	<meta name="description" content={pack.description} />
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-[var(--color-feedback-warning-bg)] to-[var(--color-orange-50)]">	<div class="max-w-2xl mx-auto px-4 py-8">		<!-- Back link -->		<a href="/activity-packs" class="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-6">
			&larr; かつどうパック一覧
		</a>

		<!-- Pack header -->
		<Card variant="default" padding="lg" class="mb-6">
			{#snippet children()}
			<div class="flex items-start gap-4 mb-4">
				<span class="text-4xl">{pack.icon}</span>
				<div class="flex-1">
					<h1 class="text-xl font-bold text-[var(--color-text)] mb-1">{pack.packName}</h1>
					<p class="text-sm text-[var(--color-text-muted)]">
						{pack.targetAgeMin}〜{pack.targetAgeMax}歳向け ・ {pack.activities.length}件のかつどう
					</p>
				</div>
			</div>
			<p class="text-sm text-[var(--color-text)] mb-4">{pack.description}</p>
			<div class="flex flex-wrap gap-1.5">
				{#each pack.tags as tag}
					<span class="text-xs bg-[var(--color-feedback-warning-bg)] text-[var(--color-feedback-warning-text)] px-2 py-0.5 rounded-full">{tag}</span>
				{/each}
			</div>
			{/snippet}
		</Card>

		<!-- Activity list by category -->
		{#each groupedActivities as [categoryName, activities]}
			{@const catDef = getCategoryByCode(activities[0]?.categoryCode ?? 'seikatsu')}
			<Card variant="default" padding="md" class="mb-4">
				{#snippet children()}
				<h2 class="text-sm font-bold text-[var(--color-text)] mb-3 flex items-center gap-1">
					<span>{catDef?.icon ?? ''}</span>
					{categoryName}
					<span class="text-xs text-[var(--color-text-muted)] font-normal ml-auto">{activities.length}件</span>
				</h2>
				<div class="space-y-2">
					{#each activities as activity}
						<div class="flex items-center gap-3 py-1.5 border-b border-[var(--color-border-default)] last:border-0">
							<span class="text-xl w-8 text-center flex-shrink-0">{activity.icon}</span>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate">{activity.name}</p>
								{#if activity.triggerHint}
									<p class="text-xs text-[var(--color-text-muted)] truncate">{activity.triggerHint}</p>
								{/if}
							</div>
							<span class="text-xs text-[var(--color-warning)] font-bold flex-shrink-0">+{activity.basePoints}pt</span>
						</div>
					{/each}
				</div>
				{/snippet}
			</Card>
		{/each}

		<!-- CTA -->
		<div class="bg-gradient-to-r from-[var(--color-feedback-warning-bg)] to-[var(--color-orange-50)] rounded-2xl border border-[var(--color-feedback-warning-border)] p-6 text-center mb-6">			<p class="text-sm font-bold text-[var(--color-text)] mb-1">このパックを使ってみませんか？</p>			<p class="text-xs text-[var(--color-text-muted)] mb-3">				アカウント登録後、管理画面からインポートできます
			</p>
			<a
				href="/auth/signup"
				class="block w-full py-2.5 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-orange-500)] text-white font-bold rounded-xl text-sm"			>				無料で はじめる
			</a>
		</div>

		<!-- Demo link -->
		<div class="text-center">
			<a href="/demo" class="text-sm text-[var(--color-brand-500)] hover:underline">
				デモを体験してみる
			</a>
		</div>
	</div>
</div>
