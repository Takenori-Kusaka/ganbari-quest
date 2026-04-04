<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';

interface RankingData {
	childId: number;
	childName: string;
	totalCount: number;
	categoryCounts: Record<number, number>;
}

interface Props {
	rankings: RankingData[];
	width?: number;
	height?: number;
}

let { rankings, width = 360, height = 180 }: Props = $props();

const CHILD_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

const CATEGORIES = CATEGORY_DEFS.map((c) => ({ id: c.id, label: c.name, icon: c.icon }));

const PADDING = { top: 12, right: 12, bottom: 40, left: 32 };
const chartW = $derived(width - PADDING.left - PADDING.right);
const chartH = $derived(height - PADDING.top - PADDING.bottom);

const maxCount = $derived(
	Math.max(1, ...rankings.flatMap((r) => CATEGORIES.map((cat) => r.categoryCounts[cat.id] ?? 0))),
);

const groupWidth = $derived(chartW / CATEGORIES.length);
const barWidth = $derived(Math.min(16, (groupWidth - 8) / Math.max(1, rankings.length)));

const ariaLabel = $derived(
	`きょうだいカテゴリ比較グラフ。${rankings.map((r) => r.childName).join('、')}の5カテゴリ別の件数を比較しています。`,
);
</script>

{#if rankings.length > 1}
	<div class="cat-chart">
		<svg viewBox="0 0 {width} {height}" {width} {height} class="cat-svg" role="img" aria-label={ariaLabel}>
			<title>{ariaLabel}</title>
			<!-- Y axis grid -->
			{#each [0, Math.ceil(maxCount / 2), maxCount] as tick}
				{@const py = PADDING.top + chartH - (tick / maxCount) * chartH}
				<line
					x1={PADDING.left}
					y1={py}
					x2={PADDING.left + chartW}
					y2={py}
					stroke="var(--color-border-default, #e2e8f0)"
					stroke-width="0.5"
				/>
				<text x={PADDING.left - 4} y={py + 3} text-anchor="end" class="tick-label">
					{tick}
				</text>
			{/each}

			<!-- Category groups -->
			{#each CATEGORIES as cat, catIdx}
				{@const groupX = PADDING.left + catIdx * groupWidth + groupWidth / 2}

				<!-- Category label -->
				<text
					x={groupX}
					y={height - 4}
					text-anchor="middle"
					class="cat-label"
				>{cat.icon}</text>
				<text
					x={groupX}
					y={height - 16}
					text-anchor="middle"
					class="tick-label"
				>{cat.label}</text>

				<!-- Bars per child -->
				{#each rankings as ranking, childIdx}
					{@const count = ranking.categoryCounts[cat.id] ?? 0}
					{@const barH = (count / maxCount) * chartH}
					{@const bx = groupX - (rankings.length * barWidth) / 2 + childIdx * barWidth}
					{@const rectWidth = Math.max(barWidth - 1, 1)}
					<rect
						x={bx}
						y={PADDING.top + chartH - barH}
						width={rectWidth}
						height={barH}
						fill={CHILD_COLORS[childIdx % CHILD_COLORS.length]}
						rx="2"
					/>
				{/each}
			{/each}
		</svg>

		<!-- Legend -->
		<div class="cat-legend">
			{#each rankings as ranking, ci}
				<span class="cat-legend__item">
					<span
						class="cat-legend__dot"
						style:background={CHILD_COLORS[ci % CHILD_COLORS.length]}
					></span>
					{ranking.childName}
				</span>
			{/each}
		</div>
	</div>
{/if}

<style>
	.cat-chart {
		width: 100%;
	}

	.cat-svg {
		width: 100%;
		height: auto;
		display: block;
	}

	.tick-label {
		font-size: 10px;
		fill: var(--color-text-tertiary, #94a3b8);
	}

	.cat-label {
		font-size: 14px;
	}

	.cat-legend {
		display: flex;
		justify-content: center;
		gap: 1rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}

	.cat-legend__item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary, #64748b);
	}

	.cat-legend__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
