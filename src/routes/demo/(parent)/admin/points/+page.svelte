<script lang="ts">
import { APP_LABELS, DEMO_POINTS_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

const totalBalance = $derived(
	data.children.reduce((sum: number, c: { balance: number }) => sum + c.balance, 0),
);

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

const selectedChild = $derived(data.children.find((c: { id: number }) => c.id === selectedChildId));
</script>

<svelte:head>
	<title>{PAGE_TITLES.points}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4">
	<DemoBanner />

	<!-- Child selector tabs (matches production) -->
	<div class="flex overflow-x-auto gap-2 pb-1">
		{#each data.children as child (child.id)}
			<Button
				variant={selectedChildId === child.id ? 'primary' : 'ghost'}
				size="sm"
				class="flex items-center gap-2 whitespace-nowrap
					{selectedChildId === child.id
					? 'shadow-sm'
					: 'bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] shadow-sm'}"
				onclick={() => selectedChildId = child.id}
			>
				{#if child.avatarUrl}
					<img src={child.avatarUrl} alt="" class="w-6 h-6 rounded-full object-cover" />
				{:else}
					<span>👤</span>
				{/if}
				{child.nickname}
			</Button>
		{/each}
	</div>

	{#if selectedChild}
		<!-- Balance Card (matches production) -->
		<Card padding="lg">
			<div class="text-center">
				<p class="text-xs text-[var(--color-text-tertiary)] mb-1">{DEMO_POINTS_LABELS.currentBalanceLabel(unit)}</p>
				<p class="text-4xl font-bold text-[var(--color-feedback-warning-text)]">{fmtBal(selectedChild.balance)}</p>
			</div>
		</Card>

		<!-- Convert Modes (disabled in demo, but shows the UI) -->
		<Card>
			<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">{DEMO_POINTS_LABELS.convertSectionTitle}</h3>
			<div class="flex gap-2 mb-4">
				<Button
					variant="primary"
					size="sm"
					class="flex-1"
					disabled
				>
					{DEMO_POINTS_LABELS.modeSimple}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="flex-1 bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]"
					disabled
				>
					{DEMO_POINTS_LABELS.modeFreeInput}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="flex-1 bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]"
					disabled
				>
					{DEMO_POINTS_LABELS.modeOcr}
				</Button>
			</div>

			<!-- Preset amounts (matches production) -->
			<div class="grid grid-cols-4 gap-2 mb-4">
				{#each [100, 300, 500, 1000] as amount}
					<Button
						variant={amount === 500 ? 'outline' : 'ghost'}
						size="sm"
						class="py-3 rounded-xl shadow-sm
							{amount === 500 ? 'bg-[var(--color-feedback-info-bg)] border-2 border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-tertiary)]'}"
						disabled
					>
						{amount}
					</Button>
				{/each}
			</div>

			<Button
				variant="ghost"
				size="md"
				class="w-full bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed"
				disabled
			>
				{DEMO_POINTS_LABELS.demoConvertDisabled}
			</Button>
		</Card>

		<!-- Summary Stats (matches production) -->
		<div class="grid grid-cols-2 gap-3">
			<Card>
				<div class="text-center">
					<p class="text-xs text-[var(--color-text-tertiary)] mb-1">{DEMO_POINTS_LABELS.thisMonthConvertLabel}</p>
					<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">{fmtBal(0)}</p>
				</div>
			</Card>
			<Card>
				<div class="text-center">
					<p class="text-xs text-[var(--color-text-tertiary)] mb-1">{DEMO_POINTS_LABELS.totalConvertLabel}</p>
					<p class="text-xl font-bold text-[var(--color-stat-purple)]">{fmtBal(0)}</p>
				</div>
			</Card>
		</div>
	{/if}

	<!-- Explanation -->
	<Card>
		<h2 class="text-sm font-bold text-[var(--color-text-primary)] mb-2">{DEMO_POINTS_LABELS.aboutTitle}</h2>
		<ul class="text-xs text-[var(--color-text-muted)] space-y-1.5">
			<li>&#x2022; {DEMO_POINTS_LABELS.aboutNote1}</li>
			<li>&#x2022; {DEMO_POINTS_LABELS.aboutNote2}</li>
			<li>&#x2022; {DEMO_POINTS_LABELS.aboutNote3}</li>
			<li>&#x2022; {DEMO_POINTS_LABELS.aboutNote4}</li>
		</ul>
	</Card>

	<DemoCta
		title={DEMO_POINTS_LABELS.ctaTitle}
		description={DEMO_POINTS_LABELS.ctaDesc}
	/>
</div>
