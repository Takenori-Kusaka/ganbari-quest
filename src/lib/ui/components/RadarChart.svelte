<script lang="ts">
import { cubicOut } from 'svelte/easing';
import { tweened } from 'svelte/motion';

interface CategoryData {
	categoryId: number;
	name: string;
	value: number;
	maxValue: number;
	level?: number;
	deviationScore?: number;
	stars?: number;
	trend: 'up' | 'down' | 'stable';
}

interface Props {
	categories: CategoryData[];
	comparisonValues?: Record<number, number>;
	comparisonLabel?: string;
	size?: number;
}

let { categories, comparisonValues, comparisonLabel, size = 300 }: Props = $props();

const LEVELS = [25, 50, 75, 100];
const padding = 60;
const viewBoxSize = $derived(size + padding * 2);
const center = $derived(size / 2);
const maxRadius = $derived(size * 0.4);
const labelRadius = $derived(size * 0.52);

const chartColors: Record<number, string> = {
	1: '#4caf50', // うんどう
	2: '#2196f3', // べんきょう
	3: '#ff9800', // せいかつ
	4: '#9c27b0', // こうりゅう
	5: '#e91e63', // そうぞう
};

const trendIcons: Record<string, string> = {
	up: '📈',
	down: '📉',
	stable: '➡️',
};

// レベルベースでレーダーチャートの値を正規化（0-100%）
// レベル15で100%表示。低レベル帯でも見やすいスケール
const RADAR_VISUAL_MAX_LEVEL = 15;
const normalizedValues = $derived(
	categories.map((c) => {
		const level = c.level ?? 1;
		const pct = (level / RADAR_VISUAL_MAX_LEVEL) * 100;
		return Math.min(100, Math.max(5, pct));
	}),
);

// Comparison polygon values (previous month) — XPからレベルに変換
const compNormalized = $derived(
	comparisonValues
		? categories.map((c) => {
				const prevXp = comparisonValues[c.categoryId] ?? 0;
				// 簡易レベル推定: 同カテゴリの現在レベルとXP比率から推定
				const currentLevel = c.level ?? 1;
				const currentXp = c.value || 1;
				const prevLevel =
					currentXp > 0 ? Math.max(1, Math.round(currentLevel * (prevXp / currentXp))) : 1;
				const pct = (prevLevel / RADAR_VISUAL_MAX_LEVEL) * 100;
				return Math.min(100, Math.max(5, pct));
			})
		: null,
);

// Animated values — tweened は初期値のみ使用。$effect で正しい値に更新する
const animatedValues = tweened([0, 0, 0, 0, 0], {
	duration: 800,
	easing: cubicOut,
});

const animatedComp = tweened([0, 0, 0, 0, 0], {
	duration: 800,
	easing: cubicOut,
});

$effect(() => {
	animatedValues.set(normalizedValues);
});

$effect(() => {
	if (compNormalized) {
		animatedComp.set(compNormalized);
	}
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
</script>

<svg
	viewBox="{-padding} {-padding} {viewBoxSize} {viewBoxSize}"
	width="100%"
	style:max-width="{viewBoxSize}px"
	overflow="visible"
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
			opacity={level === 100 ? 0.7 : 0.4}
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

	<!-- Comparison polygon (previous month) -->
	{#if compNormalized}
		<polygon
			points={polygonPoints($animatedComp, maxRadius)}
			fill="none"
			stroke="var(--color-text-muted, #999)"
			stroke-width="1.5"
			stroke-dasharray="6,4"
			stroke-linejoin="round"
			opacity="0.5"
		/>
	{/if}

	<!-- Filled area -->
	<polygon
		points={polygonPoints($animatedValues, maxRadius)}
		fill="var(--theme-primary, #ff69b4)"
		fill-opacity="0.25"
		stroke="var(--theme-primary, #ff69b4)"
		stroke-width="2.5"
		stroke-linejoin="round"
	/>

	<!-- Data points -->
	{#each $animatedValues as val, i}
		{@const p = getPoint(i, val, maxRadius)}
		{@const color = chartColors[categories[i]?.categoryId ?? 0] ?? 'var(--theme-primary)'}
		<circle cx={p.x} cy={p.y} r="5" fill={color} stroke="white" stroke-width="2" />
	{/each}

	<!-- Labels -->
	{#each categories as cat, i}
		{@const lp = getPoint(i, 100, labelRadius)}
		{@const color = chartColors[cat.categoryId] ?? '#666'}
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
			class="radar-trend"
		>
			{trendIcons[cat.trend] ?? '➡️'}
		</text>
	{/each}

	<!-- Legend (when comparison is shown) -->
	{#if compNormalized}
		<g transform="translate({center - 60}, {size / 2 + maxRadius + 20})">
			<line x1="0" y1="0" x2="16" y2="0" stroke="var(--theme-primary, #ff69b4)" stroke-width="2" />
			<text x="20" y="4" class="radar-legend" fill="var(--color-text)">いま</text>
			<line x1="56" y1="0" x2="72" y2="0" stroke="var(--color-text-muted, #999)" stroke-width="1.5" stroke-dasharray="4,3" />
			<text x="76" y="4" class="radar-legend" fill="var(--color-text-muted)">{comparisonLabel ?? 'せんげつ'}</text>
		</g>
	{/if}
</svg>

<style>
	.radar-label {
		font-size: 13px;
		font-weight: 700;
	}
	.radar-trend {
		font-size: 12px;
	}
	.radar-legend {
		font-size: 11px;
		font-weight: 700;
	}
</style>
