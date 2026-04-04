<script lang="ts">
interface WeekData {
	weekLabel: string;
	children: { childId: number; childName: string; count: number }[];
}

interface Props {
	weeks: WeekData[];
	width?: number;
	height?: number;
}

let { weeks, width = 360, height = 200 }: Props = $props();

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];
const PADDING = { top: 20, right: 16, bottom: 32, left: 36 };

const chartW = $derived(width - PADDING.left - PADDING.right);
const chartH = $derived(height - PADDING.top - PADDING.bottom);

const childNames = $derived(weeks[0]?.children.map((c) => c.childName) ?? []);

const maxCount = $derived(Math.max(1, ...weeks.flatMap((w) => w.children.map((c) => c.count))));

function x(i: number): number {
	if (weeks.length <= 1) return PADDING.left + chartW / 2;
	return PADDING.left + (i / (weeks.length - 1)) * chartW;
}

function y(count: number): number {
	return PADDING.top + chartH - (count / maxCount) * chartH;
}

function linePath(childIdx: number): string {
	return weeks
		.map((w, i) => {
			const c = w.children[childIdx];
			const px = x(i);
			const py = y(c?.count ?? 0);
			return `${i === 0 ? 'M' : 'L'}${px},${py}`;
		})
		.join(' ');
}

// Y axis ticks
const yTicks = $derived.by(() => {
	const step = maxCount <= 5 ? 1 : Math.ceil(maxCount / 4);
	const ticks: number[] = [];
	for (let v = 0; v <= maxCount; v += step) ticks.push(v);
	return ticks;
});
</script>

{#if weeks.length > 0 && childNames.length > 1}
	<div class="trend-chart">
		<svg viewBox="0 0 {width} {height}" {width} {height} class="trend-svg">
			<!-- Y axis grid -->
			{#each yTicks as tick}
				<line
					x1={PADDING.left}
					y1={y(tick)}
					x2={PADDING.left + chartW}
					y2={y(tick)}
					stroke="var(--color-border-default, #e2e8f0)"
					stroke-width="0.5"
				/>
				<text
					x={PADDING.left - 4}
					y={y(tick) + 3}
					text-anchor="end"
					class="tick-label"
				>{tick}</text>
			{/each}

			<!-- X axis labels -->
			{#each weeks as week, i}
				<text
					x={x(i)}
					y={height - 4}
					text-anchor="middle"
					class="tick-label"
				>{week.weekLabel}</text>
			{/each}

			<!-- Lines -->
			{#each childNames as _name, ci}
				<path
					d={linePath(ci)}
					fill="none"
					stroke={COLORS[ci % COLORS.length]}
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<!-- Data points -->
				{#each weeks as w, wi}
					{@const c = w.children[ci]}
					<circle
						cx={x(wi)}
						cy={y(c?.count ?? 0)}
						r="3.5"
						fill={COLORS[ci % COLORS.length]}
					/>
				{/each}
			{/each}
		</svg>

		<!-- Legend -->
		<div class="trend-legend">
			{#each childNames as name, ci}
				<span class="trend-legend__item">
					<span
						class="trend-legend__dot"
						style:background={COLORS[ci % COLORS.length]}
					></span>
					{name}
				</span>
			{/each}
		</div>
	</div>
{/if}

<style>
	.trend-chart {
		width: 100%;
	}

	.trend-svg {
		width: 100%;
		height: auto;
		display: block;
	}

	.tick-label {
		font-size: 10px;
		fill: var(--color-text-tertiary, #94a3b8);
	}

	.trend-legend {
		display: flex;
		justify-content: center;
		gap: 1rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}

	.trend-legend__item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary, #64748b);
	}

	.trend-legend__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
