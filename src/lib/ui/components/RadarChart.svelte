<script lang="ts">
	import { tweened } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	interface CategoryData {
		name: string;
		value: number;
		maxValue: number;
		deviationScore: number;
		stars: number;
		trend: 'up' | 'down' | 'stable';
	}

	interface Props {
		categories: CategoryData[];
		size?: number;
	}

	let { categories, size = 300 }: Props = $props();

	const LEVELS = [25, 50, 75, 100];
	const padding = $derived(size * 0.2);
	const viewBoxSize = $derived(size + padding * 2);
	const center = $derived(size / 2);
	const maxRadius = $derived(size * 0.35);
	const labelRadius = $derived(size * 0.47);

	const categoryColors: Record<string, string> = {
		うんどう: '#4caf50',
		べんきょう: '#2196f3',
		せいかつ: '#ff9800',
		こうりゅう: '#9c27b0',
		そうぞう: '#e91e63',
	};

	const trendIcons: Record<string, string> = {
		up: '📈',
		down: '📉',
		stable: '➡️',
	};

	// Normalize deviation scores to visually meaningful 0-100 percentage
	// Map deviation score range [20, 70] → [0%, 100%] so stars align with chart size:
	//   1★ (<42)  → <44%   2★ (42-49) → 44-58%
	//   3★ (50-57) → 60-74%  4★ (58-64) → 76-88%  5★ (65+) → 90%+
	const normalizedValues = $derived(
		categories.map((c) => {
			const ds = c.deviationScore;
			return Math.min(100, Math.max(5, ((ds - 20) / 50) * 100));
		}),
	);

	// Animated values
	const animatedValues = tweened(categories.map(() => 0), {
		duration: 800,
		easing: cubicOut,
	});

	$effect(() => {
		animatedValues.set(normalizedValues);
	});

	// SVG coordinate helpers
	function getAngle(index: number): number {
		return (Math.PI * 2 * index) / 5 - Math.PI / 2;
	}

	function getPoint(index: number, pct: number, radius: number): { x: number; y: number } {
		const angle = getAngle(index);
		const r = (pct / 100) * radius;
		return {
			x: center + r * Math.cos(angle),
			y: center + r * Math.sin(angle),
		};
	}

	function polygonPoints(values: number[], radius: number): string {
		return values
			.map((v, i) => {
				const p = getPoint(i, v, radius);
				return `${p.x},${p.y}`;
			})
			.join(' ');
	}

	function gridPolygon(pct: number): string {
		return Array.from({ length: 5 }, (_, i) => {
			const p = getPoint(i, pct, maxRadius);
			return `${p.x},${p.y}`;
		}).join(' ');
	}

	const starText = (stars: number) => '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars));
</script>

<svg
	viewBox="{-padding} {-padding} {viewBoxSize} {viewBoxSize}"
	width="100%"
	style="max-width: {viewBoxSize}px;"
	role="img"
	aria-label="ステータスレーダーチャート"
>
	<!-- Grid lines -->
	{#each LEVELS as level}
		<polygon
			points={gridPolygon(level)}
			fill="none"
			stroke="var(--color-border, #e0e0e0)"
			stroke-width="1"
			stroke-dasharray={level < 100 ? '4,4' : '0'}
			opacity={level === 100 ? 0.6 : 0.3}
		/>
	{/each}

	<!-- Axis lines -->
	{#each categories as _, i}
		{@const p = getPoint(i, 100, maxRadius)}
		<line
			x1={center}
			y1={center}
			x2={p.x}
			y2={p.y}
			stroke="var(--color-border, #e0e0e0)"
			stroke-width="1"
			opacity="0.3"
		/>
	{/each}

	<!-- Filled area -->
	<polygon
		points={polygonPoints($animatedValues, maxRadius)}
		fill="var(--theme-primary, #ff69b4)"
		fill-opacity="0.25"
		stroke="var(--theme-primary, #ff69b4)"
		stroke-width="2"
		stroke-linejoin="round"
	/>

	<!-- Data points -->
	{#each $animatedValues as val, i}
		{@const p = getPoint(i, val, maxRadius)}
		{@const color = categoryColors[categories[i]?.name ?? ''] ?? 'var(--theme-primary)'}
		<circle cx={p.x} cy={p.y} r="4" fill={color} stroke="white" stroke-width="1.5" />
	{/each}

	<!-- Labels -->
	{#each categories as cat, i}
		{@const lp = getPoint(i, 100, labelRadius)}
		{@const color = categoryColors[cat.name] ?? '#666'}
		{@const anchor = i === 0 ? 'middle' : i < 3 ? 'start' : 'end'}
		{@const dy = i === 0 ? -8 : i === 2 || i === 3 ? 16 : 0}
		<text
			x={lp.x}
			y={lp.y + dy}
			text-anchor={anchor}
			dominant-baseline="central"
			class="radar-label"
			fill={color}
		>
			{cat.name}
		</text>
		<text
			x={lp.x}
			y={lp.y + dy + 14}
			text-anchor={anchor}
			dominant-baseline="central"
			class="radar-stars"
			fill="var(--color-point, #ffc107)"
		>
			{starText(cat.stars)}
		</text>
		<text
			x={lp.x}
			y={lp.y + dy + 28}
			text-anchor={anchor}
			dominant-baseline="central"
			class="radar-trend"
		>
			{trendIcons[cat.trend] ?? '➡️'}
		</text>
	{/each}
</svg>

<style>
	.radar-label {
		font-size: 12px;
		font-weight: 700;
	}
	.radar-stars {
		font-size: 10px;
	}
	.radar-trend {
		font-size: 11px;
	}
</style>
