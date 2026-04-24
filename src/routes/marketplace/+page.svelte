<script lang="ts">
import { APP_LABELS, MARKETPLACE_FILTER_LABELS, MARKETPLACE_LABELS, type MarketplaceSortKey } from '$lib/domain/labels';
import type { MarketplaceGender, MarketplaceItemType } from '$lib/domain/marketplace-item';
import { MARKETPLACE_TYPE_ICONS, MARKETPLACE_TYPE_LABELS } from '$lib/domain/marketplace-item';
import Logo from '$lib/ui/components/Logo.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import Select from '$lib/ui/primitives/Select.svelte';

let { data } = $props();

const typeKeys: MarketplaceItemType[] = ['activity-pack', 'reward-set', 'checklist', 'rule-preset'];

const activeType = $derived(data.filters.type);
const activeAge = $derived(data.filters.age);
const activeTag = $derived(data.filters.tag);
const activeGender = $derived<MarketplaceGender | null>(data.filters.gender);
const activeSort = $derived<MarketplaceSortKey>(data.filters.sort);

const hasAnyFilter = $derived(
	Boolean(activeType || activeAge || activeTag || activeGender || activeSort !== 'popularity'),
);

let mobileFilterOpen = $state(false);

function filterUrl(overrides: Partial<Record<string, string | null>>): string {
	const params: Record<string, string | null> = {
		type: activeType,
		age: activeAge,
		tag: activeTag,
		gender: activeGender,
		sort: activeSort === 'popularity' ? null : activeSort,
		...overrides,
	};
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v) sp.set(k, v);
	}
	const qs = sp.toString();
	return qs ? `/marketplace?${qs}` : '/marketplace';
}

// #1171: Select primitive 用の並び替えオプション
const sortSelectItems = Object.entries(MARKETPLACE_FILTER_LABELS.sortOptions).map(
	([value, label]) => ({ value, label }),
);
// svelte-ignore state_referenced_locally
let sortSelectValue = $state([activeSort]);
$effect(() => {
	sortSelectValue = [activeSort];
});
function onSortChange(details: { value: string[] }) {
	const next = details.value[0] as MarketplaceSortKey;
	if (next && next !== activeSort) {
		window.location.href = filterUrl({
			sort: next === 'popularity' ? null : next,
		});
	}
}

const genderKeys: MarketplaceGender[] = ['boy', 'girl', 'neutral'];
</script>

<svelte:head>
	<title>{MARKETPLACE_LABELS.pageTitle}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="description" content={MARKETPLACE_LABELS.metaDescription} />
</svelte:head>

{#snippet filterPanel(variant: 'desktop' | 'mobile')}
	<div class="flex flex-col gap-4" data-testid="filter-panel-{variant}">
		<!-- Age -->
		<div>
			<h3 class="text-xs font-bold text-[var(--color-text-primary)] mb-2">
				{MARKETPLACE_FILTER_LABELS.age}
			</h3>
			<div class="flex flex-wrap gap-1">
				{#each data.ageBands as band (band.id)}
					<a
						href={filterUrl({ age: activeAge === band.id ? null : band.id })}
						data-testid="filter-age-{band.id}"
						class="px-3 py-1 rounded-full text-xs font-medium transition-all {activeAge === band.id
							? 'bg-[var(--color-action-primary)] text-white shadow'
							: 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}"
					>
						{band.label}
					</a>
				{/each}
			</div>
		</div>

		<!-- Gender -->
		<div>
			<h3 class="text-xs font-bold text-[var(--color-text-primary)] mb-2">
				{MARKETPLACE_FILTER_LABELS.gender}
			</h3>
			<div class="flex flex-wrap gap-1">
				<a
					href={filterUrl({ gender: null })}
					data-testid="filter-gender-all"
					class="px-3 py-1 rounded-full text-xs font-medium transition-all {activeGender === null
						? 'bg-[var(--color-action-primary)] text-white shadow'
						: 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}"
				>
					{MARKETPLACE_FILTER_LABELS.genderOptions.all}
				</a>
				{#each genderKeys as g (g)}
					<a
						href={filterUrl({ gender: activeGender === g ? null : g })}
						data-testid="filter-gender-{g}"
						class="px-3 py-1 rounded-full text-xs font-medium transition-all {activeGender === g
							? 'bg-[var(--color-action-primary)] text-white shadow'
							: 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}"
					>
						{MARKETPLACE_FILTER_LABELS.genderOptions[g]}
					</a>
				{/each}
			</div>
		</div>

		<!-- Tag cloud -->
		{#if data.tags.length > 0}
			<div>
				<h3 class="text-xs font-bold text-[var(--color-text-primary)] mb-2">
					{MARKETPLACE_FILTER_LABELS.tag}
				</h3>
				<div class="flex flex-wrap gap-1">
					{#each data.tags as tag (tag)}
						<a
							href={filterUrl({ tag: activeTag === tag ? null : tag })}
							class="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all {activeTag === tag
								? 'bg-[var(--color-action-primary)] text-white'
								: 'bg-[var(--color-surface-muted)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}"
						>
							{tag}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Reset -->
		{#if hasAnyFilter}
			<div>
				<a
					href="/marketplace"
					data-testid="filter-reset"
					class="inline-flex items-center gap-1 text-sm text-[var(--color-action-primary)] hover:underline"
				>
					✕ {MARKETPLACE_FILTER_LABELS.reset}
				</a>
			</div>
		{/if}
	</div>
{/snippet}

<div class="min-h-dvh bg-[var(--color-surface-base)]">
	<div class="max-w-5xl mx-auto px-4 py-8">
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
			{#each typeKeys as t (t)}
				<a
					href={filterUrl({ type: activeType === t ? null : t })}
					data-testid="filter-type-{t}"
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

		<!-- Result count + sort + mobile filter button -->
		<div class="flex items-center justify-between gap-2 mb-4">
			<span
				class="text-sm font-medium text-[var(--color-text-secondary)]"
				data-testid="result-count"
			>
				{MARKETPLACE_FILTER_LABELS.resultCount(data.items.length)}
			</span>
			<div class="flex items-center gap-2">
				<!-- Mobile filter open button -->
				<button
					type="button"
					class="md:hidden tap-target inline-flex items-center gap-1 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-card)] border border-[var(--color-border-default)] text-sm font-medium text-[var(--color-text-primary)]"
					data-testid="filter-open-button"
					onclick={() => {
						mobileFilterOpen = true;
					}}
				>
					⚙️ {MARKETPLACE_FILTER_LABELS.open}
				</button>
				<!-- Sort select -->
				<div class="w-36" data-testid="sort-select">
					<Select
						label=""
						items={sortSelectItems}
						bind:value={sortSelectValue}
						onValueChange={onSortChange}
					/>
				</div>
			</div>
		</div>

		<!-- Desktop layout: filter sidebar + items grid -->
		<div class="md:grid md:grid-cols-[240px_1fr] md:gap-6">
			<!-- Desktop filter sidebar -->
			<aside class="hidden md:block">
				<div
					class="sticky top-4 bg-[var(--color-surface-card)] rounded-xl p-4 border border-[var(--color-border-light)]"
				>
					<h2 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">
						{MARKETPLACE_FILTER_LABELS.sectionTitle}
					</h2>
					{@render filterPanel('desktop')}
				</div>
			</aside>

			<div>
				<!-- Items grid -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
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
											<h2
												class="text-sm font-bold text-[var(--color-text-primary)] truncate"
											>
												{item.name}
											</h2>
											<p
												class="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2"
											>
												{item.description}
											</p>
											<div class="flex items-center gap-2 mt-2">
												<span class="text-[10px] text-[var(--color-text-tertiary)]">
													{item.targetAgeMin + '〜'}{item.targetAgeMax + '歳'}
												</span>
												{#if item.itemCount > 0}
													<span class="text-[10px] text-[var(--color-text-tertiary)]">
														{item.itemCount + '件'}
													</span>
												{/if}
											</div>
											<div class="flex flex-wrap gap-1 mt-2">
												{#each item.tags.slice(0, 3) as tag (tag)}
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
							{MARKETPLACE_FILTER_LABELS.empty}
						</p>
						<a
							href="/marketplace"
							class="text-sm text-[var(--color-action-primary)] hover:underline mt-2 inline-block"
						>
							{MARKETPLACE_FILTER_LABELS.reset}
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
	</div>
</div>

<!-- Mobile bottom-sheet filter Dialog -->
<Dialog
	bind:open={mobileFilterOpen}
	title={MARKETPLACE_FILTER_LABELS.sectionTitle}
	size="md"
	testid="filter-dialog-mobile"
>
	{#snippet children()}
		{@render filterPanel('mobile')}
		<div class="mt-6 flex justify-end">
			<Button
				variant="primary"
				size="md"
				onclick={() => {
					mobileFilterOpen = false;
				}}
			>
				{MARKETPLACE_FILTER_LABELS.apply}
			</Button>
		</div>
	{/snippet}
</Dialog>
