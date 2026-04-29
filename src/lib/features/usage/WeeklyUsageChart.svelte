<!-- WeeklyUsageChart.svelte -->
<!-- #1576: 親ダッシュボード 週次使用時間 bar chart -->
<!-- OSS 選定: Pure SVG 実装（0KB 追加）。週次7日×子供N人の単純な棒グラフに Chart.js/D3.js は過剰 -->
<script lang="ts">
import { USAGE_TIME_LABELS } from '$lib/domain/labels';

interface DailySummary {
	date: string; // YYYY-MM-DD
	durationMin: number;
}

interface ChildWeeklyData {
	childId: number;
	childName: string;
	dailySummary: DailySummary[];
}

interface Props {
	data: ChildWeeklyData[];
	/** 縦軸の最大値（分）。未指定の場合はデータから自動計算（最低15分） */
	maxMinutes?: number;
}

let { data, maxMinutes: maxMinutesProp }: Props = $props();

// SVG 寸法定数
const SVG_WIDTH = 280;
const SVG_HEIGHT = 120;
const CHART_LEFT = 28; // 縦軸ラベル分の余白
const CHART_TOP = 8;
const CHART_RIGHT = 4;
const CHART_BOTTOM = 24; // 横軸ラベル分の余白
const CHART_W = SVG_WIDTH - CHART_LEFT - CHART_RIGHT;
const CHART_H = SVG_HEIGHT - CHART_TOP - CHART_BOTTOM;

// 子供ごとの色（最大5人想定。セマンティックトークンは SVG 内では CSS var() が機能する）
// 子供ごとの色はインデックスベースで固定割り当て
const CHILD_COLORS = [
	'var(--color-action-primary)',
	'var(--color-action-accent)',
	'var(--color-action-success)',
	'var(--color-action-trial)',
	'var(--color-action-danger)',
] as const;

// 先頭の子供データを基準に7日分の日付リストを作る
const dates = $derived(data[0]?.dailySummary.map((d) => d.date) ?? []);

// データが全て0かどうか
const hasAnyData = $derived(
	data.some((child) => child.dailySummary.some((d) => d.durationMin > 0)),
);

// 縦軸最大値を計算（指定がなければデータから 15 以上で計算）
const computedMax = $derived(() => {
	if (maxMinutesProp !== undefined) return Math.max(15, maxMinutesProp);
	let max = 15;
	for (const child of data) {
		for (const d of child.dailySummary) {
			if (d.durationMin > max) max = d.durationMin;
		}
	}
	// 見やすい上限に切り上げ（15の倍数）
	return Math.ceil(max / 15) * 15;
});

// 1日あたりのバー群の幅（子供複数の場合は並べる）
const daySlotWidth = $derived(CHART_W / Math.max(dates.length, 1));
const barGroupPad = 4; // グループの左右余白
const barPad = 1; // バー間の余白
const barWidth = $derived(
	data.length > 0
		? Math.max(4, (daySlotWidth - barGroupPad * 2 - barPad * (data.length - 1)) / data.length)
		: 8,
);

/** 使用時間（分）→ SVG Y 座標に変換 */
function minToY(min: number): number {
	const max = computedMax();
	const ratio = Math.min(1, min / max);
	return CHART_TOP + CHART_H - ratio * CHART_H;
}

/** 使用時間（分）→ バーの高さに変換 */
function minToBarH(min: number): number {
	const max = computedMax();
	return Math.min(1, min / max) * CHART_H;
}

/** i 番目の日付スロット × j 番目の子供のバー X 座標 */
function barX(dayIdx: number, childIdx: number): number {
	const slotLeft = CHART_LEFT + dayIdx * daySlotWidth + barGroupPad;
	return slotLeft + childIdx * (barWidth + barPad);
}

/** 縦軸ラベル用の目盛り（0, max/2, max）*/
const yTicks = $derived([0, Math.round(computedMax() / 2), computedMax()]);
</script>

<div class="weekly-chart" data-testid="weekly-usage-chart" role="figure" aria-label={USAGE_TIME_LABELS.weeklyUsage}>
	{#if !hasAnyData}
		<p class="weekly-chart__empty">{USAGE_TIME_LABELS.noData}</p>
	{:else}
		<!-- 凡例（子供が複数の場合のみ） -->
		{#if data.length > 1}
			<div class="weekly-chart__legend" aria-hidden="true">
				{#each data as child, i}
					<span class="weekly-chart__legend-item">
						<span
							class="weekly-chart__legend-dot"
							style:background={CHILD_COLORS[i % CHILD_COLORS.length]}
						></span>
						{child.childName}
					</span>
				{/each}
			</div>
		{/if}

		<!-- SVG バーチャート -->
		<svg
			viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}"
			width="100%"
			aria-hidden="true"
			class="weekly-chart__svg"
		>
			<!-- 横グリッド線 -->
			{#each yTicks as tick}
				{@const y = minToY(tick)}
				<line
					x1={CHART_LEFT}
					y1={y}
					x2={SVG_WIDTH - CHART_RIGHT}
					y2={y}
					class="weekly-chart__grid"
				/>
				<!-- 縦軸ラベル -->
				<text
					x={CHART_LEFT - 3}
					y={y + 3}
					class="weekly-chart__axis-label"
					text-anchor="end"
				>{tick}</text>
			{/each}

			<!-- 棒グラフ本体 -->
			{#each dates as date, dayIdx}
				{#each data as child, childIdx}
					{@const min = child.dailySummary[dayIdx]?.durationMin ?? 0}
					{@const barH = minToBarH(min)}
					{@const x = barX(dayIdx, childIdx)}
					{@const y = minToY(min)}
					{@const color = CHILD_COLORS[childIdx % CHILD_COLORS.length]}
					<rect
						{x}
						y={barH > 0 ? y : CHART_TOP + CHART_H - 1}
						width={barWidth}
						height={barH > 0 ? barH : 1}
						fill={color}
						rx="2"
						opacity={barH > 0 ? 1 : 0.15}
						role="img"
						aria-label={USAGE_TIME_LABELS.chartBarAriaLabel(child.childName, date, min)}
					/>
				{/each}

				<!-- 横軸（曜日）ラベル -->
				<text
					x={CHART_LEFT + dayIdx * daySlotWidth + daySlotWidth / 2}
					y={SVG_HEIGHT - 4}
					class="weekly-chart__axis-label"
					text-anchor="middle"
				>{USAGE_TIME_LABELS.dayOfWeek(date)}</text>
			{/each}
		</svg>

		<!-- 縦軸単位テキスト（アクセシビリティ用可視ラベル） -->
		<p class="weekly-chart__unit-label" aria-hidden="true">{USAGE_TIME_LABELS.minutesUnitDisplay}</p>
	{/if}
</div>

<style>
	.weekly-chart {
		width: 100%;
	}

	.weekly-chart__empty {
		font-size: 0.8rem;
		color: var(--color-text-tertiary);
		text-align: center;
		padding: 1.5rem 0;
	}

	.weekly-chart__legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin-bottom: 0.5rem;
	}

	.weekly-chart__legend-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.weekly-chart__legend-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.weekly-chart__svg {
		display: block;
		overflow: visible;
	}

	.weekly-chart__grid {
		stroke: var(--color-border-light);
		stroke-width: 1;
	}

	.weekly-chart__axis-label {
		font-size: 9px;
		fill: var(--color-text-tertiary);
		font-family: system-ui, sans-serif;
	}

	.weekly-chart__unit-label {
		font-size: 0.65rem;
		color: var(--color-text-tertiary);
		margin: 0;
		text-align: left;
	}
</style>
