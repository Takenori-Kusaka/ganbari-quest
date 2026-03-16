<script lang="ts">
import type { MandalaChart } from '../types';

let { chart = $bindable(), readonly = false }: {
	chart: MandalaChart;
	readonly: boolean;
} = $props();

let selectedGoalIndex = $state<number | null>(null);

/** 周囲8マスのインデックスに対応するグリッド配置 (0-7 → 3x3の外周) */
const positionMap = [
	{ row: 0, col: 0 }, // 0: 左上
	{ row: 0, col: 1 }, // 1: 上
	{ row: 0, col: 2 }, // 2: 右上
	{ row: 1, col: 0 }, // 3: 左
	// (1,1) = 中心
	{ row: 1, col: 2 }, // 4: 右
	{ row: 2, col: 0 }, // 5: 左下
	{ row: 2, col: 1 }, // 6: 下
	{ row: 2, col: 2 }, // 7: 右下
];

function handleCenterInput(e: Event) {
	const target = e.target as HTMLInputElement;
	chart.center = target.value;
}

function handleGoalInput(index: number, e: Event) {
	const target = e.target as HTMLInputElement;
	if (!chart.surrounding[index]) {
		chart.surrounding[index] = { goal: '', actions: [] };
	}
	chart.surrounding[index].goal = target.value;
}

function handleActionInput(goalIdx: number, actionIdx: number, e: Event) {
	const target = e.target as HTMLInputElement;
	if (!chart.surrounding[goalIdx].actions[actionIdx]) {
		// パディング
		while (chart.surrounding[goalIdx].actions.length <= actionIdx) {
			chart.surrounding[goalIdx].actions.push('');
		}
	}
	chart.surrounding[goalIdx].actions[actionIdx] = target.value;
}

function selectGoal(index: number) {
	if (selectedGoalIndex === index) {
		selectedGoalIndex = null;
	} else {
		selectedGoalIndex = index;
	}
}
</script>

<div class="mandala-container">
	<!-- メイン3x3グリッド -->
	<div class="mandala-grid">
		{#each positionMap as pos, i}
			{@const goal = chart.surrounding[i]}
			<button
				class="mandala-cell goal-cell"
				class:has-content={!!goal?.goal}
				class:selected={selectedGoalIndex === i}
				style="grid-row: {pos.row + 1}; grid-column: {pos.col + 1};"
				onclick={() => selectGoal(i)}
				disabled={readonly}
			>
				{#if readonly || goal?.goal}
					<span class="cell-text">{goal?.goal || ''}</span>
				{:else}
					<span class="cell-placeholder">もくひょう{i + 1}</span>
				{/if}
			</button>
		{/each}

		<!-- 中心セル -->
		<div class="mandala-cell center-cell" style="grid-row: 2; grid-column: 2;">
			{#if readonly}
				<span class="center-text">{chart.center || '？'}</span>
			{:else}
				<input
					class="center-input"
					type="text"
					placeholder="しょうらいのゆめ"
					maxlength="100"
					value={chart.center}
					oninput={handleCenterInput}
				/>
			{/if}
		</div>
	</div>

	<!-- 選択中の中目標の詳細（アクション） -->
	{#if selectedGoalIndex !== null}
		{@const goal = chart.surrounding[selectedGoalIndex]}
		<div class="actions-panel">
			<div class="actions-header">
				{#if !readonly}
					<input
						class="goal-edit-input"
						type="text"
						placeholder="もくひょうをかこう"
						maxlength="100"
						value={goal?.goal ?? ''}
						oninput={(e) => handleGoalInput(selectedGoalIndex!, e)}
					/>
				{:else}
					<h3 class="goal-title">{goal?.goal || `もくひょう${selectedGoalIndex + 1}`}</h3>
				{/if}
			</div>
			<div class="actions-list">
				{#each Array(4) as _, actionIdx}
					{@const actionText = goal?.actions[actionIdx] ?? ''}
					<div class="action-item">
						<span class="action-number">{actionIdx + 1}.</span>
						{#if readonly}
							<span class="action-text">{actionText || '—'}</span>
						{:else}
							<input
								class="action-input"
								type="text"
								placeholder="やること"
								maxlength="100"
								value={actionText}
								oninput={(e) => handleActionInput(selectedGoalIndex!, actionIdx, e)}
							/>
						{/if}
					</div>
				{/each}
			</div>
			<button class="close-btn" onclick={() => (selectedGoalIndex = null)}>とじる</button>
		</div>
	{/if}
</div>

<style>
	.mandala-container {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.mandala-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: var(--spacing-xs);
		aspect-ratio: 1;
		max-width: 360px;
		margin: 0 auto;
	}
	.mandala-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs);
		min-height: 0;
		font-size: var(--font-xs);
		text-align: center;
		word-break: break-all;
		overflow: hidden;
	}
	.center-cell {
		background: linear-gradient(135deg, #fbbf24, #f59e0b);
		border: 3px solid #d97706;
		color: white;
		font-weight: 700;
	}
	.center-input {
		width: 100%;
		height: 100%;
		background: transparent;
		border: none;
		color: white;
		font-weight: 700;
		font-size: var(--font-xs);
		text-align: center;
		outline: none;
	}
	.center-input::placeholder {
		color: rgba(255, 255, 255, 0.7);
	}
	.center-text {
		font-weight: 700;
	}
	.goal-cell {
		background: #f3f4f6;
		border: 2px solid #d1d5db;
		cursor: pointer;
		transition: all 0.2s;
	}
	.goal-cell:hover:not(:disabled) {
		border-color: var(--color-primary, #6366f1);
		background: #eef2ff;
	}
	.goal-cell.has-content {
		background: #dbeafe;
		border-color: #93c5fd;
	}
	.goal-cell.selected {
		border-color: var(--color-primary, #6366f1);
		background: #c7d2fe;
		box-shadow: 0 0 0 2px var(--color-primary, #6366f1);
	}
	.cell-placeholder {
		color: #9ca3af;
		font-size: 0.65rem;
	}
	.cell-text {
		font-weight: 600;
		line-height: 1.2;
	}
	.actions-panel {
		background: white;
		border: 2px solid var(--color-primary, #6366f1);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}
	.actions-header {
		margin-bottom: var(--spacing-sm);
	}
	.goal-edit-input {
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-sm);
		border: 2px solid #d1d5db;
		border-radius: var(--radius-sm);
		font-size: var(--font-sm);
		font-weight: 600;
	}
	.goal-title {
		font-size: var(--font-md);
		font-weight: 700;
		margin: 0;
	}
	.actions-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.action-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}
	.action-number {
		font-weight: 600;
		color: #6b7280;
		min-width: 1.5rem;
	}
	.action-input {
		flex: 1;
		padding: var(--spacing-xs);
		border: 1px solid #d1d5db;
		border-radius: var(--radius-sm);
		font-size: var(--font-sm);
	}
	.action-text {
		color: #374151;
	}
	.close-btn {
		margin-top: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-md);
		background: #f3f4f6;
		border: 1px solid #d1d5db;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-sm);
	}
</style>
