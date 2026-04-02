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
	<div class="setup-container">
		<div class="setup-header">
			<Logo variant="compact" size={200} />
			<p class="setup-subtitle">初期セットアップ</p>
		</div>

		<!-- Step indicator -->
		<div class="step-indicator">
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

		<div class="setup-content">
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

	.setup-container {
		width: 100%;
		max-width: 480px;
	}

	.setup-header {
		text-align: center;
		margin-bottom: 24px;
	}

	.setup-subtitle {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-top: 4px;
	}

	.step-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0;
		margin-bottom: 24px;
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

	.step--active .step-circle {
		background: var(--color-brand-600);
		color: white;
	}

	.step--done .step-circle {
		background: var(--color-success);
		color: white;
	}

	.step-label {
		font-size: 0.75rem;
		color: var(--color-neutral-400);
		white-space: nowrap;
	}

	.step--active .step-label {
		color: var(--color-brand-600);
		font-weight: 600;
	}

	.step--done .step-label {
		color: var(--color-success);
	}

	.step-line {
		width: 40px;
		height: 2px;
		background: var(--color-neutral-200);
		margin-bottom: 20px;
	}

	.step-line--done {
		background: var(--color-success);
	}

	.setup-content {
		background: var(--color-surface-card);
		border-radius: var(--radius-md);
		padding: 24px;
		box-shadow: var(--card-shadow);
	}
</style>
