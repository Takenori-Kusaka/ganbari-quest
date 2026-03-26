<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
	loading?: boolean;
	loadingText?: string;
	disabled?: boolean;
	variant?: 'primary' | 'child';
	type?: 'submit' | 'button';
	onclick?: () => void;
	class?: string;
	children: Snippet;
}

let {
	loading = false,
	loadingText,
	disabled = false,
	variant = 'primary',
	type = 'submit',
	onclick,
	class: className = '',
	children,
}: Props = $props();
</script>

<button
	{type}
	disabled={loading || disabled}
	class="loading-button loading-button--{variant} {className}"
	{onclick}
	aria-busy={loading}
>
	{#if loading}
		<span class="loading-button__spinner" aria-hidden="true"></span>
		<span class="loading-button__text">{loadingText ?? '処理中...'}</span>
	{:else}
		{@render children()}
	{/if}
</button>

<style>
	.loading-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-weight: 600;
		border: none;
		cursor: pointer;
		transition:
			opacity 0.15s,
			transform 0.1s;
	}

	.loading-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.loading-button[aria-busy='true'] {
		animation: btn-pulse 1.2s ease-in-out infinite;
	}

	/* Primary variant — inherits parent styles by default */
	.loading-button--primary {
		/* No forced styles — parent page controls appearance */
	}

	/* Child variant — larger touch target, playful animation */
	.loading-button--child {
		font-size: 1.1rem;
		min-height: 48px;
		border-radius: 12px;
	}

	.loading-button--child[aria-busy='true'] {
		animation: btn-bounce 0.8s ease-in-out infinite;
	}

	/* Spinner */
	.loading-button__spinner {
		display: inline-block;
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spinner-rotate 0.6s linear infinite;
	}

	.loading-button--child .loading-button__spinner {
		width: 1.2em;
		height: 1.2em;
		border-width: 3px;
	}

	.loading-button__text {
		white-space: nowrap;
	}

	@keyframes spinner-rotate {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes btn-pulse {
		0%,
		100% {
			opacity: 0.6;
		}
		50% {
			opacity: 0.8;
		}
	}

	@keyframes btn-bounce {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(0.97);
		}
	}
</style>
