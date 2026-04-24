<script lang="ts">
import { enhance } from '$app/forms';
import { todayDateJST } from '$lib/domain/date-utils';
import { APP_LABELS, CHALLENGES_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();

const isFamily = $derived(data.planTier === 'family');
let creating = $state(false);

interface TargetConfig {
	metric: string;
	baseTarget: number;
	categoryId?: number;
}
interface RewardConfig {
	points: number;
	message?: string;
}

function parseJSON<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json);
	} catch {
		return fallback;
	}
}

function formatDate(d: string): string {
	return d.replace(/-/g, '/');
}

function isCurrentlyActive(challenge: {
	isActive: number;
	status: string;
	startDate: string;
	endDate: string;
}): boolean {
	const today = todayDateJST();
	return (
		challenge.isActive === 1 &&
		challenge.status === 'active' &&
		challenge.startDate <= today &&
		challenge.endDate >= today
	);
}

const typeLabel = (t: string) =>
	t === 'cooperative'
		? CHALLENGES_LABELS.typeLabelCooperative
		: CHALLENGES_LABELS.typeLabelCompetitive;
const periodLabel = (t: string) => {
	switch (t) {
		case 'weekly':
			return CHALLENGES_LABELS.periodLabelWeekly;
		case 'monthly':
			return CHALLENGES_LABELS.periodLabelMonthly;
		default:
			return CHALLENGES_LABELS.periodLabelCustom;
	}
};

const categories: Record<number, string> = {
	1: CHALLENGES_LABELS.categoryUndou,
	2: CHALLENGES_LABELS.categoryBenkyou,
	3: CHALLENGES_LABELS.categorySeikatsu,
	4: CHALLENGES_LABELS.categoryKouryuu,
	5: CHALLENGES_LABELS.categorySouzou,
};
</script>

<svelte:head>
	<title>{PAGE_TITLES.challenges}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4">
	<!-- Family Streak -->
	{#if data.familyStreak && data.familyStreak.currentStreak > 0}
		<div class="rounded-xl border bg-white p-4">
			<div class="flex items-center gap-2 mb-2">
				<span class="text-xl">🔥</span>
				<h3 class="font-bold text-sm">{CHALLENGES_LABELS.familyStreakTitle(data.familyStreak.currentStreak)}</h3>
			</div>
			<p class="text-xs text-[var(--color-text-muted)]">
				{data.familyStreak.hasRecordedToday
					? `今日は${data.familyStreak.todayRecorders.length + '人'}が記録済み`
					: '今日はまだ誰も記録していません'}
			</p>
			{#if data.familyStreak.nextMilestone}
				<p class="text-xs text-[var(--color-text-tertiary)] mt-1">
					{CHALLENGES_LABELS.familyStreakMilestone(data.familyStreak.nextMilestone.remaining, data.familyStreak.nextMilestone.days, data.familyStreak.nextMilestone.points)}
				</p>
			{/if}
		</div>
	{/if}

	{#if !isFamily}
		<div class="rounded-xl border border-[var(--color-feedback-warning-border)] bg-[var(--color-feedback-warning-bg)] p-4 text-center">
			<p class="text-sm font-bold text-[var(--color-feedback-warning-text)]">{CHALLENGES_LABELS.familyPlanTitle}</p>
			<p class="text-xs text-[var(--color-feedback-warning-text)] mt-1">{CHALLENGES_LABELS.familyPlanDesc}</p>
			<a href="/admin/license" class="inline-block mt-2 px-3 py-1 text-xs font-bold rounded-lg bg-[var(--color-stat-amber)] text-white">
				{CHALLENGES_LABELS.familyPlanButton}
			</a>
		</div>
	{:else}

	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold">{CHALLENGES_LABELS.sectionTitle}</h2>
		<Button
			variant={creating ? 'ghost' : 'primary'}
			size="sm"
			onclick={() => { creating = !creating; }}
		>
			{creating ? CHALLENGES_LABELS.cancelButton : CHALLENGES_LABELS.createButton}
		</Button>
	</div>

	{#if form?.error}
		<div class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)]">{form.error}</div>
	{/if}
	{#if form?.created}
		<div class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)]">{CHALLENGES_LABELS.createdNotice}</div>
	{/if}
	{#if form?.deleted}
		<div class="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-primary)]">{CHALLENGES_LABELS.deletedNotice}</div>
	{/if}

	<!-- 作成フォーム -->
	{#if creating}
		<form method="POST" action="?/create" use:enhance class="rounded-xl border bg-white p-4 space-y-3">
			<h3 class="font-bold text-sm">{CHALLENGES_LABELS.formTitle}</h3>
			<div class="grid grid-cols-2 gap-3">
				<FormField label={CHALLENGES_LABELS.titleLabel} type="text" name="title" placeholder={CHALLENGES_LABELS.titlePlaceholder} required class="col-span-2" />
				<FormField label={CHALLENGES_LABELS.descLabel} type="text" name="description" placeholder={CHALLENGES_LABELS.descPlaceholder} class="col-span-2" />
			</div>
			<div class="grid grid-cols-3 gap-3">
				<FormField label={CHALLENGES_LABELS.typeLabel}>
					{#snippet children()}
						<NativeSelect
							name="challengeType"
							options={[
								{ value: 'cooperative', label: '協力' },
								{ value: 'competitive', label: '競争' },
							]}
						/>
					{/snippet}
				</FormField>
				<FormField label={CHALLENGES_LABELS.periodLabel}>
					{#snippet children()}
						<NativeSelect
							name="periodType"
							options={[
								{ value: 'weekly', label: '週間' },
								{ value: 'monthly', label: '月間' },
								{ value: 'custom', label: 'カスタム' },
							]}
						/>
					{/snippet}
				</FormField>
				<FormField label={CHALLENGES_LABELS.categoryLabel}>
					{#snippet children()}
						<NativeSelect
							name="categoryId"
							options={[
								{ value: '', label: CHALLENGES_LABELS.categoryAll },
								...Object.entries(categories).map(([id, name]) => ({ value: id, label: name })),
							]}
						/>
					{/snippet}
				</FormField>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label={CHALLENGES_LABELS.startDateLabel} type="date" name="startDate" required />
				<FormField label={CHALLENGES_LABELS.endDateLabel} type="date" name="endDate" required />
			</div>
			<div class="grid grid-cols-3 gap-3">
				<FormField label={CHALLENGES_LABELS.targetLabel} type="number" name="baseTarget" value={3} min={1} required />
				<FormField label={CHALLENGES_LABELS.rewardPointsLabel} type="number" name="rewardPoints" value={50} min={1} required />
				<FormField label={CHALLENGES_LABELS.rewardMessageLabel} type="text" name="rewardMessage" placeholder={CHALLENGES_LABELS.rewardMessagePlaceholder} />
			</div>
			<input type="hidden" name="metric" value="count" />
			<Button type="submit" variant="primary" size="sm" class="w-full">
				{CHALLENGES_LABELS.submitButton}
			</Button>
		</form>
	{/if}

	<!-- チャレンジ一覧 -->
	{#if data.challenges.length === 0}
		<div class="rounded-xl border bg-white p-8 text-center">
			<p class="text-2xl">{CHALLENGES_LABELS.noChallengeTitleIcon}</p>
			<p class="mt-2 text-sm font-semibold text-[var(--color-text-muted)]">{CHALLENGES_LABELS.noChallengeTitle}</p>
			<p class="text-xs text-[var(--color-text-tertiary)]">{CHALLENGES_LABELS.noChallengeDesc}</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.challenges as challenge (challenge.id)}
				{@const active = isCurrentlyActive(challenge)}
				{@const target = parseJSON<TargetConfig>(challenge.targetConfig, { metric: 'count', baseTarget: 0 })}
				{@const reward = parseJSON<RewardConfig>(challenge.rewardConfig, { points: 0 })}
				<div class="rounded-xl border bg-white p-4" class:border-[var(--color-feedback-info-border)]={active}>
					<div class="flex items-start justify-between gap-2">
						<div class="flex-1">
							<h3 class="font-bold text-sm">
								{challenge.title}
								{#if challenge.allCompleted}
									<span class="ml-1 rounded bg-[var(--color-feedback-success-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-success-text)]">{CHALLENGES_LABELS.badgeAllCompleted}</span>
								{/if}
								{#if active}
									<span class="ml-1 rounded bg-[var(--color-feedback-info-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-info-text)]">{CHALLENGES_LABELS.badgeActive}</span>
								{/if}
								{#if challenge.status === 'expired'}
									<span class="ml-1 rounded bg-[var(--color-surface-secondary)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-text-muted)]">{CHALLENGES_LABELS.badgeExpired}</span>
								{/if}
							</h3>
							<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
								{typeLabel(challenge.challengeType)} · {periodLabel(challenge.periodType)}
								· {formatDate(challenge.startDate)}{CHALLENGES_LABELS.dateSeparator}{formatDate(challenge.endDate)}
								· {CHALLENGES_LABELS.targetGoal(target.baseTarget)}
								{#if target.categoryId}
									· {categories[target.categoryId] ?? ''}
								{/if}
								· {CHALLENGES_LABELS.rewardLabel(reward.points)}
							</p>
							{#if challenge.description}
								<p class="text-xs text-[var(--color-text-secondary)] mt-1">{challenge.description}</p>
							{/if}

							<!-- 進捗表示 -->
							{#if challenge.progress.length > 0}
								<div class="mt-2 space-y-1">
									{#each challenge.progress as prog}
										{@const child = data.children.find((c: { id: number }) => c.id === prog.childId)}
										<div class="flex items-center gap-2">
											<span class="text-xs font-medium text-[var(--color-text-primary)] w-16 truncate">
												{child?.nickname ?? `#${prog.childId}`}
											</span>
											<div class="flex-1 h-2 bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
												<ProgressFill
													pct={Math.min(100, Math.round((prog.currentValue / prog.targetValue) * 100))}
													class="h-full rounded-full transition-all {prog.completed === 1 ? 'bg-[var(--color-feedback-success-border)]' : 'bg-[var(--color-feedback-info-border)]'}"
												/>
											</div>
											<span class="text-[10px] text-[var(--color-text-muted)] w-12 text-right">
												{prog.currentValue}/{prog.targetValue}
												{#if prog.completed === 1}✅{/if}
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
						<form method="POST" action="?/delete" use:enhance
							onsubmit={(e) => { if (!confirm(CHALLENGES_LABELS.deleteConfirm(challenge.title))) e.preventDefault(); }}
						>
							<input type="hidden" name="id" value={challenge.id} />
							<Button type="submit" variant="danger" size="sm">{CHALLENGES_LABELS.deleteButton}</Button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{/if}<!-- /isFamily -->
</div>
