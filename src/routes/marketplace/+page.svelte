<script lang="ts">
import { MARKETPLACE_LABELS } from '$lib/domain/labels';
import type { MarketplaceItemType } from '$lib/domain/marketplace-item';
import {
	AGE_BANDS,
	MARKETPLACE_TYPE_ICONS,
	MARKETPLACE_TYPE_LABELS,
} from '$lib/domain/marketplace-item';
import Logo from '$lib/ui/components/Logo.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const typeKeys: MarketplaceItemType[] = ['activity-pack', 'reward-set', 'checklist', 'rule-preset'];

function filterUrl(params: Record<string, string | null>): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v) sp.set(k, v);
	}
	const qs = sp.toString();
	return qs ? `/marketplace?${qs}` : '/marketplace';
}

const activeType = $derived(data.filters.type);
const activeAge = $derived(data.filters.age);
const activeTag = $derived(data.filters.tag);
</script>

<svelte:head>
	<title>{MARKETPLACE_LABELS.pageTitle} - がんばりクエスト</title>
	<meta name="description" content={MARKETPLACE_LABELS.metaDescription} />
</svelte:head>

<div class="min-h-dvh bg-[var(--color-surface-base)]">
	<div class="max-w-4xl mx-auto px-4 py-8">
		<!-- Header -->
		<div class="text-center mb-8">
			<div class="flex justify-center mb-3">
				<Logo variant="compact" size={160} />
			</div>
			<h1 class="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
				{MARKETPLACE_LABELS.pageTitle}
			</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				{MARKETPLACE_LABELS.pageDescription}
			</p>
		</div>

		<!-- Type counts summary -->
		<div class="grid grid-cols-4 gap-2 mb-6">
			{#each typeKeys as t}
				<a
					href={filterUrl({ type: activeType === t ? null : t, age: activeAge, tag: activeTag })}
					class="rounded-xl p-3 text-center transition-all {activeType === t
						? 'bg-[var(--color-action-primary)] text-white shadow-md'
						: 'bg-[var(--color-surface-card)] text-[var(--color-text-primary)] hover:shadow-sm'}"
				>
					<span class="text-xl block">{MARKETPLACE_TYPE_ICONS[t]}</span>
					<span class="text-xs font-bold block mt-1">{MARKETPLACE_TYPE_LABELS[t]}</span>
					<span class="text-xs opacity-70">{data.counts[t]}種</span>
				</a>
			{/each}
		</div>

		<!-- Filters -->
		<div class="flex flex-wrap gap-2 mb-6">
			<!-- Age filter -->
			<div class="flex flex-wrap gap-1">
				{#each AGE_BANDS as band}
					<a
						href={filterUrl({
							type: activeType,
							age: activeAge === String(band.min) ? null : String(band.min),
							tag: activeTag,
						})}
						class="px-2 py-1 rounded-full text-xs font-medium transition-all {activeAge ===
						String(band.min)
							? 'bg-[var(--color-brand-500)] text-white'
							: 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]'}"
					>
						{band.label}
					</a>
				{/each}
			</div>
		</div>

		<!-- Tag cloud -->
		{#if data.tags.length > 0}
			<div class="flex flex-wrap gap-1 mb-6">
				{#each data.tags as tag}
					<a
						href={filterUrl({
							type: activeType,
							age: activeAge,
							tag: activeTag === tag ? null : tag,
						})}
						class="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all {activeTag ===
						tag
							? 'bg-[var(--color-action-primary)] text-white'
							: 'bg-[var(--color-surface-muted)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}"
					>
						{tag}
					</a>
				{/each}
			</div>
		{/if}

		<!-- Active filter indicator -->
		{#if activeType || activeAge || activeTag}
			<div class="flex items-center gap-2 mb-4">
				<span class="text-xs text-[var(--color-text-tertiary)]">
					{data.items.length}件
				</span>
				<a
					href="/marketplace"
					class="text-xs text-[var(--color-action-primary)] hover:underline"
				>
					{MARKETPLACE_LABELS.filterClear}
				</a>
			</div>
		{/if}

		<!-- Items grid -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
			{#each data.items as item (item.type + '/' + item.itemId)}
				<a
					href="/marketplace/{item.type}/{item.itemId}"
					class="block hover:shadow-md transition-shadow"
				>
					<Card padding="lg">
						{#snippet children()}
						<div class="flex items-start gap-3">
							<span class="text-3xl">{item.icon}</span>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-1 mb-1">
									<Badge variant="info" size="sm">
										{MARKETPLACE_TYPE_ICONS[item.type]} {MARKETPLACE_TYPE_LABELS[item.type]}
									</Badge>
								</div>
								<h2 class="text-sm font-bold text-[var(--color-text-primary)] truncate">
									{item.name}
								</h2>
								<p class="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">
									{item.description}
								</p>
								<div class="flex items-center gap-2 mt-2">
									<span class="text-[10px] text-[var(--color-text-tertiary)]">
										{item.targetAgeMin}〜{item.targetAgeMax}歳
									</span>
									{#if item.itemCount > 0}
										<span class="text-[10px] text-[var(--color-text-tertiary)]">
											{item.itemCount}件
										</span>
									{/if}
								</div>
								<div class="flex flex-wrap gap-1 mt-2">
									{#each item.tags.slice(0, 3) as tag}
										<span
											class="text-[10px] bg-[var(--color-surface-muted)] text-[var(--color-text-tertiary)] px-1.5 py-0.5 rounded-full"
										>
											{tag}
										</span>
									{/each}
								</div>
							</div>
						</div>
						{/snippet}
					</Card>
				</a>
			{/each}
		</div>

		{#if data.items.length === 0}
			<div class="text-center py-12">
				<p class="text-lg text-[var(--color-text-secondary)]">
					{MARKETPLACE_LABELS.emptyState}
				</p>
				<a
					href="/marketplace"
					class="text-sm text-[var(--color-action-primary)] hover:underline mt-2 inline-block"
				>
					{MARKETPLACE_LABELS.filterClear}
				</a>
			</div>
		{/if}

		<!-- CTA -->
		<Card variant="default" padding="lg">
			{#snippet children()}
			<div class="text-center">
				<p class="text-sm font-bold text-[var(--color-text-primary)] mb-1">
					{MARKETPLACE_LABELS.ctaHeading}
				</p>
				<p class="text-xs text-[var(--color-text-secondary)] mb-3">
					{MARKETPLACE_LABELS.ctaSubheading}
				</p>
				<a
					href="/auth/signup"
					class="inline-block px-6 py-2.5 bg-[var(--color-action-primary)] text-white font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
				>
					{MARKETPLACE_LABELS.ctaStart}
				</a>
			</div>
			{/snippet}
		</Card>

		<!-- Back links -->
		<div class="text-center mt-6 flex justify-center gap-4">
			<a href="/" class="text-sm text-[var(--color-action-primary)] hover:underline">
				{MARKETPLACE_LABELS.backToHome}
			</a>
			<a href="/demo" class="text-sm text-[var(--color-action-primary)] hover:underline">
				{MARKETPLACE_LABELS.backToDemo}
			</a>
		</div>
	</div>
</div>
