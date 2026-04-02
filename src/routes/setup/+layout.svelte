<script lang="ts">
import { page } from '$app/stores';
import Logo from '$lib/ui/components/Logo.svelte';

let { children } = $props();

const steps = [
	{ path: '/setup/children', label: '子供登録' },
	{ path: '/setup/packs', label: '活動パック' },
	{ path: '/setup/first-adventure', label: 'はじめての冒険' },
	{ path: '/setup/complete', label: '冒険の始まり' },
];

const currentStepIndex = $derived(
	Math.max(
		steps.findIndex((s) => $page.url.pathname === s.path),
		0,
	),
);
</script>

<div class="setup-page">
	<div class="w-full max-w-[480px]">
		<div class="text-center mb-6">
			<Logo variant="compact" size={200} />
			<p class="text-sm text-[var(--color-text-muted)] mt-1">初期セットアップ</p>
		</div>

		<!-- Step indicator -->
		<div class="flex items-center justify-center mb-6">
			{#each steps as step, i (step.path)}
				<div class="step" class:step--active={i === currentStepIndex} class:step--done={i < currentStepIndex}>
					<div class="step-circle">
						{#if i < currentStepIndex}
							<span>&#10003;</span>
						{:else}
							{i + 1}
						{/if}
					</div>
					<span class="step-label">{step.label}</span>
				</div>
				{#if i < steps.length - 1}
					<div class="step-line" class:step-line--done={i < currentStepIndex}></div>
				{/if}
			{/each}
		</div>

		<div class="bg-[var(--color-surface-card)] rounded-[var(--radius-md)] p-6 shadow-[var(--card-shadow)]">
			{@render children()}
		</div>
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

	.step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.step-circle {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		font-weight: 700;
		background: var(--color-neutral-200);
		color: var(--color-neutral-400);
		transition: all 0.2s;
	}

	.step--active .step-circle { background: var(--color-brand-600); color: white; }
	.step--done .step-circle { background: var(--color-success); color: white; }

	.step-label { font-size: 0.75rem; color: var(--color-neutral-400); white-space: nowrap; }
	.step--active .step-label { color: var(--color-brand-600); font-weight: 600; }
	.step--done .step-label { color: var(--color-success); }

	.step-line { width: 40px; height: 2px; background: var(--color-neutral-200); margin-bottom: 20px; }
	.step-line--done { background: var(--color-success); }
</style>
