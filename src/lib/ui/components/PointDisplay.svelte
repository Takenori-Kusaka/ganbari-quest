<script lang="ts">
import type { PointSettings } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS, formatPointValueWithSign } from '$lib/domain/point-display';

interface Props {
	points: number;
	label?: string;
	size?: 'sm' | 'md' | 'lg';
	animated?: boolean;
	pointSettings?: PointSettings;
}

let { points, label, size = 'md', animated = false, pointSettings }: Props = $props();

const settings = $derived(pointSettings ?? DEFAULT_POINT_SETTINGS);
const displayValue = $derived(
	formatPointValueWithSign(points, settings.mode, settings.currency, settings.rate),
);

const sizeClasses = {
	sm: 'text-lg',
	md: 'text-2xl',
	lg: 'text-hero',
};
</script>

<div
	class="inline-flex items-center gap-1 font-bold text-[var(--color-point)]
		{sizeClasses[size]} {animated ? 'animate-point-pop' : ''}"
	aria-label="{label ?? ''}{displayValue}"
>
	{#if label}
		<span class="text-[var(--color-text)] text-sm mr-1">{label}</span>
	{/if}
	<span>{displayValue}</span>
</div>
