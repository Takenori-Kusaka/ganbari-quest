<script lang="ts">
import { navigating } from '$app/stores';
</script>

{#if $navigating}
	<div class="navigation-progress" aria-hidden="true">
		<div class="navigation-progress-bar"></div>
	</div>
{/if}

<style>
	.navigation-progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		z-index: 9999;
		pointer-events: none;
	}

	.navigation-progress-bar {
		height: 100%;
		background: var(--theme-accent, #4f46e5);
		animation: progress 1.5s ease-in-out infinite;
		transform-origin: left;
	}

	@keyframes progress {
		0% {
			transform: scaleX(0);
			opacity: 1;
		}
		50% {
			transform: scaleX(0.7);
			opacity: 1;
		}
		100% {
			transform: scaleX(1);
			opacity: 0;
		}
	}
</style>
