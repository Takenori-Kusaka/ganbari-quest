<script lang="ts">
import { MARKETPLACE_LABELS } from '$lib/domain/labels';
import type {
	ActivityPackPayload,
	ChecklistPayload,
	MarketplaceItem,
	PersonaTag,
	RewardSetPayload,
	RulePresetPayload,
} from '$lib/domain/marketplace-item';
import {
	MARKETPLACE_TYPE_ICONS,
	MARKETPLACE_TYPE_LABELS,
	PERSONA_LABELS,
} from '$lib/domain/marketplace-item';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const item: MarketplaceItem = data.item;

const isActivityPack = $derived(item.type === 'activity-pack');
const isRewardSet = $derived(item.type === 'reward-set');
const isChecklist = $derived(item.type === 'checklist');
const isRulePreset = $derived(item.type === 'rule-preset');

const hasLegacyPack = $derived(
	isActivityPack && 'legacyPackId' in (item.payload as unknown as Record<string, unknown>),
);
</script>

<svelte:head>
	<title>{item.name} - {MARKETPLACE_LABELS.pageTitle} - がんばりクエスト</title>
	<meta name="description" content={item.description} />
	<!-- OGP for SNS sharing -->
	<meta property="og:title" content="{item.name} - がんばりクエスト {MARKETPLACE_LABELS.pageTitle}" />
	<meta property="og:description" content={item.description} />
	<meta property="og:type" content="website" />
</svelte:head>

<div class="min-h-dvh bg-[var(--color-surface-base)]">
	<div class="max-w-2xl mx-auto px-4 py-8">
		<!-- Breadcrumb -->
		<nav class="text-xs text-[var(--color-text-tertiary)] mb-6">
			<a href="/marketplace" class="hover:text-[var(--color-action-primary)]">{MARKETPLACE_LABELS.breadcrumbRoot}</a>
			<span class="mx-1">/</span>
			<a
				href="/marketplace?type={item.type}"
				class="hover:text-[var(--color-action-primary)]"
			>
				{MARKETPLACE_TYPE_LABELS[item.type]}
			</a>
			<span class="mx-1">/</span>
			<span class="text-[var(--color-text-secondary)]">{item.name}</span>
		</nav>

		<!-- Header -->
		<div class="flex items-start gap-4 mb-6">
			<span class="text-5xl">{item.icon}</span>
			<div class="flex-1">
				<div class="flex items-center gap-2 mb-1">
					<Badge variant="info" size="sm">
						{MARKETPLACE_TYPE_ICONS[item.type]} {MARKETPLACE_TYPE_LABELS[item.type]}
					</Badge>
					<Badge variant="info" size="sm">
						{item.targetAgeMin}〜{item.targetAgeMax}歳
					</Badge>
				</div>
				<h1 class="text-xl font-bold text-[var(--color-text-primary)]">
					{item.name}
				</h1>
				<p class="text-sm text-[var(--color-text-secondary)] mt-1">
					{item.description}
				</p>
			</div>
		</div>

		<!-- Tags -->
		<div class="flex flex-wrap gap-1 mb-4">
			{#each item.tags as tag}
				<a
					href="/marketplace?tag={tag}"
					class="text-[10px] bg-[var(--color-surface-muted)] text-[var(--color-text-tertiary)] px-2 py-0.5 rounded-full hover:text-[var(--color-text-secondary)]"
				>
					{tag}
				</a>
			{/each}
		</div>

		<!-- Persona tags -->
		{#if item.personas.length > 0}
			<div class="flex flex-wrap gap-1 mb-6">
				{#each item.personas as persona}
					<span
						class="text-[10px] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] px-2 py-0.5 rounded-full"
					>
						{PERSONA_LABELS[persona as PersonaTag] ?? persona}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Content preview -->
		<Card padding="lg">
			{#snippet children()}
			<h2 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">
				{#if isActivityPack}
					{MARKETPLACE_LABELS.detailIncludedActivities}
				{:else if isRewardSet}
					{MARKETPLACE_LABELS.detailIncludedRewards}
				{:else if isChecklist}
					{MARKETPLACE_LABELS.detailChecklistItems}
				{:else if isRulePreset}
					{MARKETPLACE_LABELS.detailRuleContent}
				{/if}
			</h2>

			{#if isActivityPack && !hasLegacyPack}
				{@const payload = item.payload as ActivityPackPayload}
				<div class="space-y-2">
					{#each payload.activities as act}
						<div class="flex items-center gap-2 py-1 border-b border-[var(--color-border-subtle)] last:border-0">
							<span class="text-lg">{act.icon}</span>
							<div class="flex-1">
								<span class="text-sm font-medium text-[var(--color-text-primary)]">{act.name}</span>
								{#if act.triggerHint}
									<p class="text-xs text-[var(--color-text-tertiary)]">{act.triggerHint}</p>
								{/if}
							</div>
							<span class="text-xs text-[var(--color-text-tertiary)]">+{act.basePoints}P</span>
						</div>
					{/each}
				</div>
			{:else if isActivityPack && hasLegacyPack}
				<p class="text-sm text-[var(--color-text-secondary)]">
					{MARKETPLACE_LABELS.detailLegacyPackNote}
					<a href="/activity-packs/{item.itemId}" class="text-[var(--color-action-primary)] hover:underline">
						{MARKETPLACE_LABELS.detailLegacyPackLink}
					</a>
					{MARKETPLACE_LABELS.detailLegacyPackSuffix}
				</p>
			{:else if isRewardSet}
				{@const payload = item.payload as RewardSetPayload}
				<div class="space-y-2">
					{#each payload.rewards as reward}
						<div class="flex items-center gap-2 py-1 border-b border-[var(--color-border-subtle)] last:border-0">
							<span class="text-lg">{reward.icon}</span>
							<div class="flex-1">
								<span class="text-sm font-medium text-[var(--color-text-primary)]">{reward.title}</span>
								{#if reward.description}
									<p class="text-xs text-[var(--color-text-tertiary)]">{reward.description}</p>
								{/if}
							</div>
							<span class="text-xs text-[var(--color-text-tertiary)]">{reward.points}P</span>
						</div>
					{/each}
				</div>
			{:else if isChecklist}
				{@const payload = item.payload as ChecklistPayload}
				<div class="space-y-1">
					{#each payload.items as checkItem}
						<div class="flex items-center gap-2 py-1">
							<span class="text-base">{checkItem.icon}</span>
							<span class="text-sm text-[var(--color-text-primary)]">{checkItem.label}</span>
						</div>
					{/each}
				</div>
			{:else if isRulePreset}
				{@const payload = item.payload as RulePresetPayload}
				<div class="space-y-3">
					{#each payload.rules as rule}
						<div class="p-3 rounded-lg bg-[var(--color-surface-muted)]">
							<div class="flex items-center gap-2 mb-1">
								<span class="text-lg">{rule.icon}</span>
								<span class="text-sm font-bold text-[var(--color-text-primary)]">{rule.title}</span>
							</div>
							<p class="text-xs text-[var(--color-text-secondary)] ml-8">{rule.description}</p>
							{#if rule.pointCost}
								<p class="text-xs text-[var(--color-status-error)] ml-8 mt-1">
									{MARKETPLACE_LABELS.detailRulePointCost}: {rule.pointCost}P
								</p>
							{/if}
							{#if rule.pointBonus}
								<p class="text-xs text-[var(--color-status-success)] ml-8 mt-1">
									{MARKETPLACE_LABELS.detailRulePointBonus}: +{rule.pointBonus}P
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{/snippet}
		</Card>

		<!-- CTA -->
		<div class="mt-6 space-y-3">
			<a href="/auth/signup" class="block">
				<Button variant="primary" size="lg" class="w-full">
					{MARKETPLACE_LABELS.detailCtaSignup}
				</Button>
			</a>
		</div>

		<!-- Back -->
		<div class="text-center mt-6">
			<a
				href="/marketplace?type={item.type}"
				class="text-sm text-[var(--color-action-primary)] hover:underline"
			>
				{MARKETPLACE_TYPE_LABELS[item.type]}{MARKETPLACE_LABELS.backToTypeListSuffix}
			</a>
		</div>
	</div>
</div>
