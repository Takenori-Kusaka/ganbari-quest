<script lang="ts">
import {
	ADMIN_CHILDREN_LABELS,
	APP_LABELS,
	getAgeTierLabel,
	PAGE_TITLES,
} from '$lib/domain/labels';
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

// Detail tabs shown on production (read-only in demo)
const detailTabs = [
	{ id: 'info', label: '📋 基本情報' },
	{ id: 'status', label: '📊 ステータス' },
	{ id: 'logs', label: '📝 活動記録' },
	{ id: 'achievements', label: '🏆 実績' },
	{ id: 'voice', label: '📢 ボイス' },
] as const;

let selectedChildId = $state<number | null>(null);
let detailTab = $state<string>('info');

const selectedChild = $derived(
	data.children.find((c: { id: number }) => c.id === selectedChildId) ?? null,
);
</script>

<svelte:head>
	<title>{PAGE_TITLES.children}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4">
	<DemoBanner />

	<!-- Header (matches production) -->
	<div class="flex items-center justify-between">
		<div>
			<Button
				variant="primary"
				size="sm"
				class="bg-[var(--color-feedback-info-border)] cursor-not-allowed"
				disabled
			>
				{ADMIN_CHILDREN_LABELS.addButton}
			</Button>
		</div>
	</div>

	<!-- Children List (matches production card style) -->
	{#if !selectedChildId}
		<div class="grid gap-3">
			{#each data.children as child (child.id)}
				<Button
					variant="ghost"
					size="md"
					class="w-full bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 hover:shadow-md text-left"
					onclick={() => selectedChildId = child.id}
				>
					{#if child.avatarUrl}
						<img src={child.avatarUrl} alt={child.nickname} class="w-12 h-12 rounded-full object-cover" loading="lazy" />
					{:else}
						<span class="text-3xl">👤</span>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="font-bold text-[var(--color-text-primary)]">{child.nickname}</p>
						<p class="text-sm text-[var(--color-text-tertiary)]">{child.age + '歳'} / {getAgeTierLabel(child.uiMode ?? 'preschool')}</p>
					</div>
					<div class="text-right">
						<p class="text-lg font-bold text-[var(--color-feedback-warning-text)]">{fmtBal(child.balance)}</p>
					</div>
				</Button>
			{/each}
		</div>
	{/if}

	<!-- Child Detail View (matches production tab layout) -->
	{#if selectedChild}
		<div>
			<Button
				variant="ghost"
				size="sm"
				class="text-[var(--color-feedback-info-text)] hover:text-[var(--color-feedback-info-text)] mb-3"
				onclick={() => selectedChildId = null}
			>
				{ADMIN_CHILDREN_LABELS.backToList}
			</Button>

			<!-- Child Header -->
			<Card class="mb-4">
				<div class="flex items-center gap-4">
					{#if selectedChild.avatarUrl}
						<img src={selectedChild.avatarUrl} alt={selectedChild.nickname} class="w-16 h-16 rounded-full object-cover" />
					{:else}
						<span class="text-5xl">👤</span>
					{/if}
					<div class="flex-1">
						<h2 class="text-lg font-bold text-[var(--color-text-primary)]">{selectedChild.nickname}</h2>
						<p class="text-sm text-[var(--color-text-tertiary)]">{selectedChild.age + '歳'} / {getAgeTierLabel(selectedChild.uiMode ?? 'preschool')}</p>
					</div>
					<div class="text-right">
						<p class="text-2xl font-bold text-[var(--color-feedback-warning-text)]">{fmtBal(selectedChild.balance)}</p>
						<p class="text-xs text-[var(--color-text-tertiary)]">{unit}</p>
					</div>
				</div>
			</Card>

			<!-- Tab Navigation (matches production 6-tab system) -->
			<div class="flex overflow-x-auto gap-1 mb-4 pb-1">
				{#each detailTabs as tab}
					<Button
						variant={detailTab === tab.id ? 'primary' : 'ghost'}
						size="sm"
						class="whitespace-nowrap
							{detailTab === tab.id ? '' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-tertiary)]'}"
						onclick={() => detailTab = tab.id}
					>
						{tab.label}
					</Button>
				{/each}
			</div>

			<!-- Tab Content -->
			<Card>
				{#if detailTab === 'info'}
					<div class="grid grid-cols-2 gap-3">
						<div class="bg-[var(--color-feedback-info-bg)] rounded-lg p-3 text-center">
							<p class="text-xs text-[var(--color-text-muted)]">{ADMIN_CHILDREN_LABELS.statAgeLabel}</p>
							<p class="text-lg font-bold text-[var(--color-feedback-info-text)]">{selectedChild.age + '歳'}</p>
						</div>
						<div class="bg-[var(--color-stat-purple-bg)] rounded-lg p-3 text-center">
							<p class="text-xs text-[var(--color-text-muted)]">{ADMIN_CHILDREN_LABELS.statAgeTierLabel}</p>
							<p class="text-lg font-bold text-[var(--color-stat-purple)]">{getAgeTierLabel(selectedChild.uiMode ?? 'preschool')}</p>
						</div>
						<div class="bg-[var(--color-feedback-warning-bg)] rounded-lg p-3 text-center">
							<p class="text-xs text-[var(--color-text-muted)]">{unit}{ADMIN_CHILDREN_LABELS.statBalanceSuffix}</p>
							<p class="text-lg font-bold text-[var(--color-feedback-warning-text)]">{fmtBal(selectedChild.balance)}</p>
						</div>
						<div class="bg-[var(--color-feedback-success-bg)] rounded-lg p-3 text-center">
							<p class="text-xs text-[var(--color-text-muted)]">{ADMIN_CHILDREN_LABELS.statLevelLabel}</p>
							<p class="text-lg font-bold text-[var(--color-feedback-success-text)]">Lv.{selectedChild.level ?? 1}</p>
						</div>
					</div>
				{:else if detailTab === 'status'}
					<div class="text-center py-8 text-[var(--color-text-tertiary)]">
						<p class="text-3xl mb-2">📊</p>
						<p class="text-sm">{ADMIN_CHILDREN_LABELS.statusTabEmpty}</p>
					</div>
				{:else if detailTab === 'logs'}
					<div class="text-center py-8 text-[var(--color-text-tertiary)]">
						<p class="text-3xl mb-2">📝</p>
						<p class="text-sm">{ADMIN_CHILDREN_LABELS.logsTabEmpty}</p>
					</div>
				{:else if detailTab === 'achievements'}
					<div class="text-center py-8 text-[var(--color-text-tertiary)]">
						<p class="text-3xl mb-2">🏆</p>
						<p class="text-sm">{ADMIN_CHILDREN_LABELS.achievementsTabEmpty}</p>
					</div>
				{:else if detailTab === 'voice'}
					<div class="text-center py-8 text-[var(--color-text-tertiary)]">
						<p class="text-3xl mb-2">📢</p>
						<p class="text-sm">{ADMIN_CHILDREN_LABELS.voiceTabEmpty}</p>
					</div>
				{/if}
			</Card>
		</div>
	{/if}

	<DemoCta
		title="お子さまを登録しませんか？"
		description="登録すると、お子さまの成長をリアルタイムで見守れます。"
	/>
</div>
