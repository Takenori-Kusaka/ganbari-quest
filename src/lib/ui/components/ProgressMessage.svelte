<script lang="ts">
import { onMount } from 'svelte';

interface Props {
	messages: string[];
	intervalMs?: number;
	ontimeout?: () => void;
}

let { messages, intervalMs = 3000, ontimeout }: Props = $props();

let currentIndex = $state(0);
let currentMessage = $derived(messages[currentIndex] ?? messages[0] ?? '');

onMount(() => {
	if (messages.length <= 1) return;

	const timer = setInterval(() => {
		if (currentIndex < messages.length - 1) {
			currentIndex++;
		} else {
			clearInterval(timer);
			ontimeout?.();
		}
	}, intervalMs);

	return () => clearInterval(timer);
});
</script>

<div class="progress-message" role="status" aria-live="polite">
	<span class="progress-message__dot" aria-hidden="true"></span>
	<span class="progress-message__text">{currentMessage}</span>
</div>

<style>
	.progress-message {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.875rem;
		color: #6b7280;
	}

	.progress-message__dot {
		display: inline-flex;
		gap: 3px;
	}

	.progress-message__dot::before,
	.progress-message__dot::after,
	.progress-message__dot {
		content: '';
	}

	/* Three bouncing dots */
	.progress-message__dot {
		width: 6px;
		height: 6px;
		background: currentColor;
		border-radius: 50%;
		animation: dot-bounce 1.2s ease-in-out infinite;
	}

	.progress-message__text {
		animation: fade-in 0.3s ease-out;
	}

	@keyframes dot-bounce {
		0%,
		80%,
		100% {
			transform: scale(0.6);
			opacity: 0.4;
		}
		40% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
