<script lang="ts">
import { createEmptyMandalaChart } from '$lib/domain/validation/career';
import CareerFieldSelector from '$lib/features/career/components/CareerFieldSelector.svelte';
import CareerTimeline from '$lib/features/career/components/CareerTimeline.svelte';
import MandalaChart from '$lib/features/career/components/MandalaChart.svelte';
import type { CareerField, MandalaChart as MandalaChartType } from '$lib/features/career/types';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

// 画面モード
type ViewMode = 'select' | 'edit' | 'view';
let mode = $state<ViewMode>(data.plan ? 'view' : 'select');

// 編集中データ
let selectedFieldId = $state<number | null>(data.plan?.careerFieldId ?? null);
let dreamText = $state(data.plan?.dreamText ?? '');
let mandalaChart = $state<MandalaChartType>(data.plan?.mandalaChart ?? createEmptyMandalaChart());
let timeline3y = $state(data.plan?.timeline3y ?? '');
let timeline5y = $state(data.plan?.timeline5y ?? '');
let timeline10y = $state(data.plan?.timeline10y ?? '');

let saving = $state(false);
let pointsMessage = $state('');

let selectedField = $derived(
	data.careerFields.find((f: CareerField) => f.id === selectedFieldId) ?? null,
);

async function handleFieldSelect(field: CareerField) {
	soundService.play('tap');
	selectedFieldId = field.id;
	dreamText = `${field.name}になりたい！`;
	mandalaChart = createEmptyMandalaChart();
	mandalaChart.center = dreamText;
	mode = 'edit';
}

async function savePlan() {
	saving = true;
	pointsMessage = '';
	try {
		const body = {
			careerFieldId: selectedFieldId ?? undefined,
			dreamText: dreamText || undefined,
			mandalaChart: mandalaChart.center ? mandalaChart : undefined,
			timeline3y: timeline3y || undefined,
			timeline5y: timeline5y || undefined,
			timeline10y: timeline10y || undefined,
		};

		const isUpdate = !!data.plan;
		const url = `/api/v1/career-plans/${data.child?.id}`;
		const res = await fetch(url, {
			method: isUpdate ? 'PUT' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const err = await res.json();
			alert(err.message ?? 'エラーが発生しました');
			return;
		}

		const result = await res.json();
		soundService.play('record-complete');
		if (result.pointsAwarded > 0) {
			pointsMessage = `+${result.pointsAwarded}pt ゲット！`;
			setTimeout(() => {
				pointsMessage = '';
			}, 3000);
		}

		// データを反映
		data.plan = result.plan;
		mode = 'view';
	} finally {
		saving = false;
	}
}

function startEdit() {
	if (data.plan) {
		selectedFieldId = data.plan.careerFieldId;
		dreamText = data.plan.dreamText ?? '';
		mandalaChart = data.plan.mandalaChart ?? createEmptyMandalaChart();
		timeline3y = data.plan.timeline3y ?? '';
		timeline5y = data.plan.timeline5y ?? '';
		timeline10y = data.plan.timeline10y ?? '';
	}
	mode = 'edit';
}
</script>

<svelte:head>
	<title>目標設定 - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	<h1 class="page-title">目標設定</h1>

	{#if pointsMessage}
		<div class="points-toast">{pointsMessage}</div>
	{/if}

	<!-- ステップ1: 職業選択 -->
	{#if mode === 'select'}
		<div class="section">
			<h2 class="section-title">将来、何になりたい？</h2>
			<p class="section-desc">興味のある職業を選んでみよう！</p>
			{#if data.careerFields.length === 0}
				<div class="text-center py-8">
					<span class="text-4xl block mb-2">🌟</span>
					<p class="text-lg font-bold" style="color: var(--color-text)">職業データを準備中...</p>
					<p class="text-xs mt-1" style="color: var(--color-text-muted)">保護者に設定を依頼してください</p>
				</div>
			{:else}
				<CareerFieldSelector
					fields={data.careerFields}
					bind:selectedId={selectedFieldId}
					onselect={handleFieldSelect}
				/>
			{/if}
		</div>

	<!-- ステップ2: マンダラ＋タイムライン編集 -->
	{:else if mode === 'edit'}
		<div class="section">
			{#if selectedField}
				<div class="selected-field-banner">
					<span class="field-icon">{selectedField.icon ?? '💼'}</span>
					<span class="field-name">{selectedField.name}</span>
					<button class="change-btn" onclick={() => (mode = 'select')}>変更</button>
				</div>
			{/if}

			<h2 class="section-title">目標のマンダラチャート</h2>
			<p class="section-desc">中央に「目標」を書いて、周りに「やるべきこと」を書こう！</p>
			<MandalaChart bind:chart={mandalaChart} readonly={false} />
		</div>

		<div class="section">
			<h2 class="section-title">将来のタイムライン</h2>
			<p class="section-desc">将来、どんな自分になりたい？</p>
			<CareerTimeline
				bind:timeline3y
				bind:timeline5y
				bind:timeline10y
				readonly={false}
			/>
		</div>

		<div class="save-area">
			<button class="save-btn" onclick={savePlan} disabled={saving || !mandalaChart.center}>
				{saving ? '保存中...' : '保存する'}
			</button>
		</div>

	<!-- ステップ3: プラン閲覧 -->
	{:else if mode === 'view' && data.plan}
		<div class="section">
			{#if data.plan.careerField}
				<div class="selected-field-banner">
					<span class="field-icon">{data.plan.careerField.icon ?? '💼'}</span>
					<span class="field-name">{data.plan.careerField.name}</span>
				</div>
			{/if}

			<h2 class="section-title">目標のマンダラチャート</h2>
			<MandalaChart chart={data.plan.mandalaChart} readonly={true} />
		</div>

		<div class="section">
			<h2 class="section-title">将来のタイムライン</h2>
			<CareerTimeline
				timeline3y={data.plan.timeline3y ?? ''}
				timeline5y={data.plan.timeline5y ?? ''}
				timeline10y={data.plan.timeline10y ?? ''}
				readonly={true}
			/>
		</div>

		<div class="edit-area">
			<button class="edit-btn" onclick={startEdit}>編集する</button>
		</div>
	{/if}
</div>

<style>
	.page-title {
		text-align: center;
		font-size: var(--font-xl);
		font-weight: 800;
		margin-bottom: var(--sp-md);
	}
	.section {
		background: white;
		border-radius: var(--radius-md);
		padding: var(--sp-md);
		margin-bottom: var(--sp-md);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
	.section-title {
		font-size: var(--font-lg);
		font-weight: 700;
		margin: 0 0 var(--sp-xs);
	}
	.section-desc {
		font-size: var(--font-sm);
		color: #6b7280;
		margin: 0 0 var(--sp-md);
	}
	.selected-field-banner {
		display: flex;
		align-items: center;
		gap: var(--sp-sm);
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		padding: var(--sp-sm) var(--sp-md);
		border-radius: var(--radius-md);
		margin-bottom: var(--sp-md);
	}
	.field-icon {
		font-size: 1.5rem;
	}
	.field-name {
		font-weight: 700;
		flex: 1;
	}
	.change-btn {
		font-size: var(--font-xs);
		padding: var(--sp-xs) var(--sp-sm);
		background: white;
		border: 1px solid #d1d5db;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.save-area, .edit-area {
		text-align: center;
		margin-bottom: var(--sp-xl);
	}
	.save-btn {
		padding: var(--sp-sm) var(--sp-xl);
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--font-md);
		font-weight: 700;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.edit-btn {
		padding: var(--sp-sm) var(--sp-xl);
		background: white;
		color: var(--color-primary, #6366f1);
		border: 2px solid var(--color-primary, #6366f1);
		border-radius: var(--radius-md);
		font-size: var(--font-md);
		font-weight: 700;
		cursor: pointer;
	}
	.points-toast {
		position: fixed;
		top: var(--sp-lg);
		left: 50%;
		transform: translateX(-50%);
		background: linear-gradient(135deg, #fbbf24, #f59e0b);
		color: white;
		padding: var(--sp-sm) var(--sp-lg);
		border-radius: var(--radius-lg);
		font-weight: 800;
		font-size: var(--font-lg);
		z-index: 100;
		animation: fadeInOut 3s ease-in-out;
		box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
	}
	@keyframes fadeInOut {
		0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
		15% { opacity: 1; transform: translateX(-50%) translateY(0); }
		85% { opacity: 1; }
		100% { opacity: 0; }
	}
</style>
