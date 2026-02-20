<script lang="ts">
	interface Props {
		points: number;
		label?: string;
		size?: 'sm' | 'md' | 'lg';
		animated?: boolean;
	}

	let { points, label, size = 'md', animated = false }: Props = $props();

	const sizeClasses = {
		sm: 'text-lg',
		md: 'text-2xl',
		lg: 'text-hero',
	};
</script>

<div
	class="inline-flex items-center gap-1 font-bold text-[var(--color-point)]
		{sizeClasses[size]} {animated ? 'animate-point-pop' : ''}"
	aria-label="{label ?? ''}{points}ポイント"
>
	{#if label}
		<span class="text-[var(--color-text)] text-sm mr-1">{label}</span>
	{/if}
	<span>+{points}</span>
	<span class="text-sm">P</span>
</div>
