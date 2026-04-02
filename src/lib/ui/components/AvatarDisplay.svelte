<script lang="ts">
interface Props {
	nickname?: string;
	avatarUrl?: string | null;
	bgCss?: string;
	frameCss?: string;
	effectClass?: string;
	size?: 'sm' | 'md' | 'lg';
}

let {
	nickname = '',
	avatarUrl = null,
	bgCss = '#ffffff',
	frameCss = '2px solid #bdbdbd',
	effectClass = '',
	size = 'md',
}: Props = $props();

const sizeMap = { sm: 36, md: 64, lg: 96 };
const fontSize = { sm: '1rem', md: '1.75rem', lg: '2.5rem' };
const px = $derived(sizeMap[size]);
</script>

<div
	class="avatar-wrap {effectClass}"
	style:width="{px}px"
	style:height="{px}px"
>
	<div
		class="avatar-ring"
		style:background={bgCss}
		style:border={frameCss}
		style:width="{px}px"
		style:height="{px}px"
	>
		{#if avatarUrl}
			<img
				src={avatarUrl}
				alt={nickname}
				class="avatar-img"
				style:width="{px - 6}px"
				style:height="{px - 6}px"
			/>
		{:else}
			<span class="avatar-fallback" style:font-size={fontSize[size]}>👤</span>
		{/if}
	</div>
</div>

<style>
	.avatar-wrap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		flex-shrink: 0;
	}

	.avatar-ring {
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.avatar-img {
		border-radius: 50%;
		object-fit: cover;
	}

	.avatar-fallback {
		line-height: 1;
	}

	/* --- Effects --- */
	:global(.avatar-effect-sparkle) {
		animation: avatar-sparkle 2s ease-in-out infinite;
	}
	:global(.avatar-effect-pulse) {
		animation: avatar-pulse 1.5s ease-in-out infinite;
	}
	:global(.avatar-effect-glow) {
		filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.6));
		animation: avatar-glow 2s ease-in-out infinite;
	}
	:global(.avatar-effect-rainbow) {
		animation: avatar-rainbow 3s linear infinite;
	}

	@keyframes -global-avatar-sparkle {
		0%, 100% { filter: drop-shadow(0 0 2px rgba(255,255,255,0.3)); }
		50% { filter: drop-shadow(0 0 8px rgba(255,215,0,0.7)); }
	}
	@keyframes -global-avatar-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.06); }
	}
	@keyframes -global-avatar-glow {
		0%, 100% { filter: drop-shadow(0 0 4px rgba(255,215,0,0.4)); }
		50% { filter: drop-shadow(0 0 10px rgba(255,215,0,0.8)); }
	}
	@keyframes -global-avatar-rainbow {
		0% { filter: hue-rotate(0deg) drop-shadow(0 0 4px rgba(255,0,0,0.4)); }
		33% { filter: hue-rotate(120deg) drop-shadow(0 0 4px rgba(0,255,0,0.4)); }
		66% { filter: hue-rotate(240deg) drop-shadow(0 0 4px rgba(0,0,255,0.4)); }
		100% { filter: hue-rotate(360deg) drop-shadow(0 0 4px rgba(255,0,0,0.4)); }
	}
</style>
