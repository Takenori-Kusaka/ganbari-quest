<script lang="ts">
type LogoVariant = 'symbol' | 'full' | 'compact';
type PlanLabel = 'free' | 'standard' | 'family';

interface Props {
	variant?: LogoVariant;
	size?: number;
	class?: string;
	planTier?: PlanLabel;
}

let { variant = 'symbol', size, class: className = '', planTier }: Props = $props();

const defaultSizes: Record<LogoVariant, { width: number; height: number }> = {
	symbol: { width: 48, height: 51 },
	full: { width: 240, height: 69 },
	compact: { width: 160, height: 65 },
};

const src: Record<LogoVariant, string> = {
	symbol: '/icon-character.png',
	full: '/logo.png',
	compact: '/logo-compact.png',
};

const dims = $derived.by(() => {
	const d = defaultSizes[variant];
	if (!size) return d;
	const ratio = d.width / d.height;
	return variant === 'symbol'
		? { width: size, height: size }
		: { width: size, height: Math.round(size / ratio) };
});
</script>

<span class="logo-wrapper {className}">
	<img
		src={src[variant]}
		alt="がんばりクエスト"
		width={dims.width}
		height={dims.height}
		class="logo"
	/>
	{#if planTier === 'standard'}
		<span class="plan-label plan-label--standard">⭐ プレミアム</span>
	{:else if planTier === 'family'}
		<span class="plan-label plan-label--family">⭐⭐ ファミリー</span>
	{/if}
</span>

<style>
	.logo-wrapper {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		vertical-align: middle;
	}
	.logo {
		display: inline-block;
		vertical-align: middle;
		object-fit: contain;
	}
	.plan-label {
		font-size: 0.6rem;
		font-weight: 700;
		padding: 0.125rem 0.375rem;
		border-radius: 9999px;
		white-space: nowrap;
		line-height: 1.4;
	}
	.plan-label--standard {
		background: var(--plan-badge-bg, #f3e8ff);
		color: var(--plan-badge-text, #6d28d9);
	}
	.plan-label--family {
		background: var(--plan-badge-bg, #fef3c7);
		color: var(--plan-badge-text, #92400e);
	}
</style>
