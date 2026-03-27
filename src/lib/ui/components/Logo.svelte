<script lang="ts">
type LogoVariant = 'symbol' | 'full' | 'compact';

interface Props {
	variant?: LogoVariant;
	size?: number;
	class?: string;
}

let { variant = 'symbol', size, class: className = '' }: Props = $props();

const defaultSizes: Record<LogoVariant, { width: number; height: number }> = {
	symbol: { width: 48, height: 48 },
	full: { width: 240, height: 60 },
	compact: { width: 160, height: 24 },
};

const src: Record<LogoVariant, string> = {
	symbol: '/favicon.svg',
	full: '/logo.svg',
	compact: '/logo-compact.svg',
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

<img
	src={src[variant]}
	alt="がんばりクエスト"
	width={dims.width}
	height={dims.height}
	class="logo {className}"
/>

<style>
	.logo {
		display: inline-block;
		vertical-align: middle;
		object-fit: contain;
	}
</style>
