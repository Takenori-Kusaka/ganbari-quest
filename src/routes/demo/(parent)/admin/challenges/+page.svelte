<script lang="ts">
import { APP_LABELS, DEMO_CHALLENGES_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';

let { data } = $props();

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

const typeLabel = (t: string) => (t === 'cooperative' ? '協力' : '競争');
const periodLabel = (t: string) => {
	switch (t) {
		case 'weekly':
			return '週間';
		case 'monthly':
			return '月間';
		default:
			return 'カスタム';
	}
};

const categories: Record<number, string> = {
	1: 'うんどう',
	2: 'べんきょう',
	3: 'せいかつ',
	4: 'こうりゅう',
	5: 'そうぞう',
};
</script>

<svelte:head>
	<title>{PAGE_TITLES.demoAdminChallenges}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<DemoBanner />

<div class="space-y-4">
	<h2 class="text-lg font-bold">{DEMO_CHALLENGES_LABELS.sectionTitle}</h2>

	{#each data.challenges as challenge (challenge.id)}
		{@const target = parseJSON<TargetConfig>(challenge.targetConfig, { metric: 'count', baseTarget: 0 })}
		{@const reward = parseJSON<RewardConfig>(challenge.rewardConfig, { points: 0 })}
		<div class="rounded-xl border bg-white p-4" class:border-[var(--color-feedback-info-border)]={challenge.status === 'active'}>
			<div class="flex-1">
				<h3 class="font-bold text-sm">
					{challenge.title}
					{#if challenge.allCompleted}
						<span class="ml-1 rounded bg-[var(--color-feedback-success-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-success-text)]">{DEMO_CHALLENGES_LABELS.allClearedBadge}</span>
					{/if}
					{#if challenge.status === 'active'}
						<span class="ml-1 rounded bg-[var(--color-feedback-info-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-info-text)]">{DEMO_CHALLENGES_LABELS.activeBadge}</span>
					{/if}
				</h3>
				<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
					{typeLabel(challenge.challengeType)} · {periodLabel(challenge.periodType)}
					· {formatDate(challenge.startDate)} {DEMO_CHALLENGES_LABELS.dateRangeSeparator} {formatDate(challenge.endDate)}
					· {DEMO_CHALLENGES_LABELS.targetPrefix}{target.baseTarget + '回'} · {DEMO_CHALLENGES_LABELS.rewardPrefix}{reward.points}P
					{#if target.categoryId}
						· {categories[target.categoryId] ?? ''}
					{/if}
				</p>
				{#if challenge.description}
					<p class="text-xs text-[var(--color-text-secondary)] mt-1">{challenge.description}</p>
				{/if}

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
		</div>
	{/each}

	<DemoCta
		title="きょうだいチャレンジを使ってみよう"
		description="家族みんなで協力チャレンジを作成して、きょうだいの絆を深めましょう"
		ctaText="無料で始める"
		ctaHref="/auth/register"
	/>
</div>
