<script lang="ts">
import { goto } from '$app/navigation';
import { ACTIVITIES_INTRODUCE_LABELS, APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { getCategoryById } from '$lib/domain/validation/activity';
import ActivityIntroCard from '$lib/features/admin/components/ActivityIntroCard.svelte';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let currentIndex = $state(0);

const total = $derived(data.activities.length);
const activity = $derived(data.activities[currentIndex]);
const categoryColor = $derived(
	activity ? (getCategoryById(activity.categoryId)?.color ?? '#888') : '#888',
);
const categoryName = $derived(activity ? (getCategoryById(activity.categoryId)?.name ?? '') : '');

function prev() {
	if (currentIndex > 0) currentIndex--;
}

function next() {
	if (currentIndex < total - 1) currentIndex++;
}

function finish() {
	goto('/admin/activities');
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.activitiesIntroduce}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="min-h-full bg-gradient-to-b from-blue-50 to-white flex flex-col">
	{#if total === 0}
		<div class="flex-1 flex flex-col items-center justify-center p-6">
			<span class="text-5xl mb-4">📋</span>
			<p class="text-lg font-bold text-[var(--color-text-secondary)]">{ACTIVITIES_INTRODUCE_LABELS.noActivitiesTitle}</p>
			<p class="text-sm text-[var(--color-text-tertiary)] mt-1">{ACTIVITIES_INTRODUCE_LABELS.noActivitiesDesc}</p>
			<Button onclick={finish} variant="ghost" size="sm" class="mt-6">
				{ACTIVITIES_INTRODUCE_LABELS.backButton}
			</Button>
		</div>
	{:else if activity}
		<!-- Progress bar -->
		<div class="px-4 pt-4 pb-2">
			<div class="flex items-center justify-between text-xs text-[var(--color-text-muted)] mb-1">
				<span>{currentIndex + 1} / {total} {ACTIVITIES_INTRODUCE_LABELS.progressSuffix}</span>
				<span class="text-[var(--color-text-tertiary)]">{categoryName}</span>
			</div>
			<div class="w-full h-1.5 bg-[var(--color-surface-tertiary)] rounded-full overflow-hidden">
				<ProgressFill
					pct={((currentIndex + 1) / total) * 100}
					color={categoryColor}
					class="h-full rounded-full transition-all duration-300"
				/>
			</div>
		</div>

		<!-- Card area -->
		<div class="flex-1 flex flex-col items-center justify-center px-6 py-4">
			<!-- Activity card (large) -->
			<ActivityIntroCard
				icon={activity.icon}
				name={activity.name}
				borderColor={categoryColor}
			/>

			<!-- Trigger hint balloon -->
			{#if activity.triggerHint}
				<div class="mt-6 w-72">
					<div class="relative bg-orange-50 border-2 border-orange-200 rounded-2xl px-5 py-4 text-center">
						<div class="absolute -top-2.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-orange-50 border-l-2 border-t-2 border-orange-200 rotate-45"></div>
						<p class="text-xs text-orange-400 font-bold mb-1">{ACTIVITIES_INTRODUCE_LABELS.triggerHintGuide}</p>
						<p class="text-lg font-bold text-orange-600 leading-snug">
							{ACTIVITIES_INTRODUCE_LABELS.triggerHintOpen}{activity.triggerHint}{ACTIVITIES_INTRODUCE_LABELS.triggerHintClose}
						</p>
					</div>
				</div>
			{:else if activity.description}
				<div class="mt-6 w-72">
					<div class="bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-center">
						<p class="text-xs text-[var(--color-text-tertiary)] font-bold mb-1">{ACTIVITIES_INTRODUCE_LABELS.activityDescLabel}</p>
						<p class="text-sm text-[var(--color-text-secondary)] leading-snug">{activity.description}</p>
					</div>
				</div>
			{:else}
				<div class="mt-6 w-72">
					<div class="bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-center">
						<p class="text-sm text-[var(--color-text-tertiary)]">
							{ACTIVITIES_INTRODUCE_LABELS.noHintMessage}
						</p>
						<p class="text-xs text-[var(--color-text-disabled)] mt-1">{ACTIVITIES_INTRODUCE_LABELS.noHintEditNote}</p>
					</div>
				</div>
			{/if}

			<!-- Points info -->
			<div class="mt-4 text-center">
				<span class="inline-flex items-center gap-1 px-3 py-1 bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] rounded-full text-xs font-bold">
					⭐ {activity.basePoints}P
				</span>
			</div>
		</div>

		<!-- Navigation buttons -->
		<div class="sticky bottom-0 px-4 pb-6 pt-4 space-y-2 bg-white/80 backdrop-blur-sm border-t border-[var(--color-border-light)]">
			<div class="flex gap-2">
				<Button onclick={prev} disabled={currentIndex === 0} variant="outline" size="sm" class="flex-1">
					{ACTIVITIES_INTRODUCE_LABELS.prevButton}
				</Button>
				<Button onclick={next} disabled={currentIndex >= total - 1} variant="primary" size="sm" class="flex-1">
					{ACTIVITIES_INTRODUCE_LABELS.nextButton}
				</Button>
			</div>
			<Button onclick={finish} variant="ghost" size="sm" class="w-full">
				{ACTIVITIES_INTRODUCE_LABELS.finishButton}
			</Button>
		</div>
	{/if}
</div>
