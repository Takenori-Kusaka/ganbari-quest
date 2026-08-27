<script lang="ts">
import { page } from '$app/stores';
import { SETUP_LABELS } from '$lib/domain/labels';
import Logo from '$lib/ui/components/Logo.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { children } = $props();

// #2140 MP-5: setup wizard β 採用 — packs/rewards/rules の 3 step に分割
// #2298: 家族チャレンジ step を rules の後に追加 (任意 step、auto-add 3 件)
const steps = [
	{ path: '/setup/children', label: SETUP_LABELS.stepChildren },
	{ path: '/setup/questionnaire', label: SETUP_LABELS.stepQuestionnaire },
	{ path: '/setup/packs', label: SETUP_LABELS.stepPacks },
	{ path: '/setup/rewards', label: SETUP_LABELS.stepRewards },
	{ path: '/setup/rules', label: SETUP_LABELS.stepRules },
	// #2322 (EPIC #2319 ③): 活動・ポイント初期設定 (任意 step、skip 可)
	{ path: '/setup/activities-defaults', label: SETUP_LABELS.stepActivitiesDefaults },
	{ path: '/setup/challenges', label: SETUP_LABELS.stepChallenges },
	{ path: '/setup/first-adventure', label: SETUP_LABELS.stepFirstAdventure },
	{ path: '/setup/complete', label: SETUP_LABELS.stepComplete },
];

const currentStepIndex = $derived(
	Math.max(
		steps.findIndex((s) => $page.url.pathname === s.path),
		0,
	),
);
// steps は空にならないが、index アクセスの型を確定させるため fallback を明示する
const currentStep = $derived(steps[currentStepIndex] ?? steps[0]);
</script>

<div class="setup-page">
	<div class="w-full max-w-[480px]">
		<div class="text-center mb-6">
			<Logo variant="compact" size={200} />
			<p class="text-sm text-[var(--color-text-muted)] mt-1">{SETUP_LABELS.layoutTitle}</p>
		</div>

		<!-- Step indicator (#4417)
		     step 名を全 step 分並べると nowrap のラベルが必ず画面幅を超えるため、
		     並べるのは丸だけにして「現在どの step か」は下の 1 行に集約する。
		     CSS 側は丸を `flex: 0 1 32px; min-width: 20px` (32px を上限に縮む)、線を
		     `flex: 1 1 4px; max-width: 24px` (余りを分け合う) にしてあるので、
		     step が増減しても横幅は器に収まる。 -->
		<div class="steps">
			{#each steps as step, i (step.path)}
				<div
					class="step"
					class:step--active={i === currentStepIndex}
					class:step--done={i < currentStepIndex}
					aria-label={step.label}
					aria-current={i === currentStepIndex ? 'step' : undefined}
				>
					{#if i < currentStepIndex}
						<span aria-hidden="true">&#10003;</span>
					{:else}
						{i + 1}
					{/if}
				</div>
				{#if i < steps.length - 1}
					<div class="step-line" class:step-line--done={i < currentStepIndex}></div>
				{/if}
			{/each}
		</div>
		<p class="step-caption mb-6">
			<span class="step-caption__count">{currentStepIndex + 1} / {steps.length}</span>
			<span class="step-caption__label">{currentStep?.label}</span>
		</p>

		<Card padding="lg">
			{@render children()}
		</Card>
	</div>
</div>

<style>
	.setup-page {
		min-height: 100dvh;
		background: linear-gradient(to bottom, var(--color-brand-100), var(--color-brand-200));
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.steps {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 8px;
	}

	.step {
		flex: 0 1 32px;
		min-width: 20px;
		aspect-ratio: 1;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8125rem;
		font-weight: 700;
		background: var(--color-neutral-200);
		color: var(--color-neutral-400);
		transition: background-color 0.2s, color 0.2s;
	}

	.step--active { background: var(--color-brand-600); color: var(--color-text-inverse); }
	.step--done { background: var(--color-success); color: var(--color-text-inverse); }

	.step-line { flex: 1 1 4px; min-width: 4px; max-width: 24px; height: 2px; background: var(--color-neutral-200); }
	.step-line--done { background: var(--color-success); }

	.step-caption {
		display: flex;
		justify-content: center;
		gap: 6px;
		font-size: 0.75rem;
	}
	.step-caption__count { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
	.step-caption__label { color: var(--color-brand-600); font-weight: 600; }
</style>
