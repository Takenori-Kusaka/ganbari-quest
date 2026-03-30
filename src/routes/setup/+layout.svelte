<script lang="ts">
import { page } from '$app/stores';
import Logo from '$lib/ui/components/Logo.svelte';

let { children } = $props();

const steps = [
	{ path: '/setup', label: 'PIN設定' },
	{ path: '/setup/children', label: '子供登録' },
	{ path: '/setup/packs', label: '活動パック' },
	{ path: '/setup/complete', label: '完了' },
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
		background: linear-gradient(to bottom, #eff6ff, #dbeafe);
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

	.setup-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1e40af;
		margin: 0;
	}

	.setup-subtitle {
		font-size: 0.875rem;
		color: #6b7280;
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
		background: #e5e7eb;
		color: #9ca3af;
		transition: all 0.2s;
	}

	.step--active .step-circle {
		background: #3b82f6;
		color: white;
	}

	.step--done .step-circle {
		background: #22c55e;
		color: white;
	}

	.step-label {
		font-size: 0.75rem;
		color: #9ca3af;
		white-space: nowrap;
	}

	.step--active .step-label {
		color: #3b82f6;
		font-weight: 600;
	}

	.step--done .step-label {
		color: #22c55e;
	}

	.step-line {
		width: 40px;
		height: 2px;
		background: #e5e7eb;
		margin-bottom: 20px;
	}

	.step-line--done {
		background: #22c55e;
	}

	.setup-content {
		background: white;
		border-radius: 16px;
		padding: 24px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
</style>
