<script lang="ts">
import { APP_LABELS, DEMO_STATUS_LABELS, PAGE_TITLES, STATUS_LABELS } from '$lib/domain/labels';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { calcDeviationScore, getComparisonLabel } from '$lib/domain/validation/status';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

function getAnalysisText(deviationScore: number): { text: string; color: string } {
	if (deviationScore >= 60)
		return {
			text: '同年齢の中でも特に活発です',
			color: 'text-[var(--color-feedback-success-text)]',
		};
	if (deviationScore >= 45)
		return {
			text: '平均的なペースで成長しています',
			color: 'text-[var(--color-feedback-info-text)]',
		};
	return { text: 'これから伸びる余地がたくさんあります', color: 'text-orange-500' };
}

let benchmarkAge = $state(5);

const benchmarksForAge = $derived(
	data.benchmarks.filter((b: { age: number }) => b.age === benchmarkAge),
);

const guideBaseXp = $derived(Math.round((benchmarkAge - 2) * 80));
const guideMeanLow = $derived(Math.round(guideBaseXp * 0.8));
const guideMeanHigh = $derived(Math.round(guideBaseXp * 1.5));
const guideSdLow = $derived(Math.round(guideBaseXp * 0.3));
const guideSdHigh = $derived(Math.round(guideBaseXp * 0.6));

let previewChildIdOverride = $state<number | undefined>(undefined);
const previewChildId = $derived(
	previewChildIdOverride !== undefined &&
		data.children.some((c: { id: number }) => c.id === previewChildIdOverride)
		? previewChildIdOverride
		: (data.children[0]?.id ?? 0),
);
const previewChild = $derived(data.children.find((c: { id: number }) => c.id === previewChildId));

const previewRadarCategories = $derived(
	previewChild?.status
		? CATEGORY_DEFS.map((catDef) => {
				const s = previewChild.status?.statuses[catDef.id];
				return {
					categoryId: catDef.id,
					name: catDef.name,
					value: s?.value ?? 0,
					maxValue: previewChild.status?.maxValue ?? 100000,
					level: s?.level ?? 1,
					deviationScore: s?.deviationScore ?? 50,
					stars: s?.stars ?? 0,
					trend: (s?.trend ?? 'stable') as 'up' | 'down' | 'stable',
				};
			})
		: [],
);

let showLevelTitles = $state(false);
</script>

<svelte:head>
	<title>{PAGE_TITLES.statusBenchmark}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<div class="flex items-center justify-end">
		<a
			href="/demo/admin/children"
			class="text-sm text-[var(--color-feedback-info-text)] hover:text-[var(--color-feedback-info-text)] font-bold"
		>
			{STATUS_LABELS.childrenEditLink}
		</a>
	</div>

	<!-- 成長レポート -->
	{#if previewChild?.status}
		<Card>
			<h3 class="text-lg font-bold text-[var(--color-text-primary)] mb-3">
				{STATUS_LABELS.growthReportTitle(previewChild.nickname)}
			</h3>

			<div class="flex justify-center mb-4">
				<RadarChart
					categories={previewRadarCategories}
					comparisonValues={previewChild.benchmarkValues}
					comparisonLabel={STATUS_LABELS.comparisonLabel}
					size={280}
				/>
			</div>
			<p class="text-xs text-[var(--color-text-tertiary)] text-center mb-4">
				{STATUS_LABELS.radarChartNote}
			</p>

			<!-- 分析サマリー -->
			<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 mb-4">
				<h4 class="text-sm font-bold text-[var(--color-text-secondary)] mb-2">{STATUS_LABELS.analysisSummaryTitle}</h4>
				<div class="space-y-1">
					{#each CATEGORY_DEFS as catDef (catDef.id)}
						{@const stat = previewChild.status?.statuses[catDef.id]}
						{#if stat}
							{@const analysis = getAnalysisText(stat.deviationScore)}
							<div class="flex items-center gap-2 text-sm">
								<span class="w-5 text-center">{catDef.icon}</span>
								<span class="font-bold text-[var(--color-text-primary)] w-20">{catDef.name}</span>
								<span class={analysis.color}>{analysis.text}</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		</Card>
	{/if}

	<!-- 称号カスタマイズ -->
	<Card padding="none">
		<Button
			variant="ghost"
			size="md"
			class="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--color-surface-muted)]"
			onclick={() => { showLevelTitles = !showLevelTitles; }}
		>
			<h3 class="text-lg font-bold text-[var(--color-text-primary)]">{STATUS_LABELS.levelTitleSectionTitle}</h3>
			<span class="text-[var(--color-text-tertiary)] text-sm">{showLevelTitles ? STATUS_LABELS.levelTitleCloseLabel : STATUS_LABELS.levelTitleOpenLabel}</span>
		</Button>

		{#if showLevelTitles}
			<div class="px-4 pb-4 space-y-3">
				<p class="text-xs text-[var(--color-text-muted)]">
					{STATUS_LABELS.levelTitleDesc}
				</p>

				{#each data.levelTitles as lt (lt.level)}
					<div class="flex items-center gap-3 bg-[var(--color-surface-muted)] rounded-lg p-3">
						<span class="text-sm font-bold text-[var(--color-text-muted)] w-12">Lv.{lt.level}</span>
						<div class="flex-1 min-w-0 flex items-center gap-2">
							<FormField label={DEMO_STATUS_LABELS.levelTitleLabel} type="text" maxlength={20} placeholder={lt.defaultTitle} disabled class="flex-1" />
							<Button
								variant="ghost"
								size="sm"
								class="bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed"
								disabled
							>
								{STATUS_LABELS.levelTitleSaveButton}
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</Card>

	<div>
		<!-- 機能説明 -->
		<div class="bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] rounded-lg p-3 mb-4 text-sm text-[var(--color-feedback-info-text)]">
			<p class="font-bold mb-1">{STATUS_LABELS.benchmarkInfoTitle}</p>
			<p>
				{STATUS_LABELS.benchmarkInfoDesc1}
				{STATUS_LABELS.benchmarkInfoDesc2}
			</p>
		</div>

		<!-- プレビュー用の子供選択 -->
		{#if data.children.length > 0}
			<div class="flex items-center gap-2 mb-4">
				<span class="text-xs text-[var(--color-text-muted)]">{STATUS_LABELS.previewLabel}</span>
				<div class="flex gap-1 flex-wrap">
					{#each data.children as child (child.id)}
						<Button
							variant={previewChildId === child.id ? 'primary' : 'ghost'}
							size="sm"
							class={previewChildId === child.id
								? ''
								: 'bg-white text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]'}
							onclick={() => { previewChildIdOverride = child.id; }}
						>
							{child.nickname}
						</Button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- 年齢選択 -->
		<div class="flex gap-1 mb-2 overflow-x-auto pb-2">
			{#each Array.from({ length: 10 }, (_, i) => i + 3) as age (age)}
				<Button
					variant={benchmarkAge === age ? 'success' : 'ghost'}
					size="sm"
					class="whitespace-nowrap
						{benchmarkAge === age
						? ''
						: 'bg-white text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]'}"
					onclick={() => { benchmarkAge = age; }}
				>
					{age + '歳'}
				</Button>
			{/each}
		</div>

		<!-- 年齢別参考値ガイド -->
		<p class="text-xs text-[var(--color-text-tertiary)] mb-4">
			{STATUS_LABELS.benchmarkGuide(benchmarkAge, guideMeanLow, guideMeanHigh, guideSdLow, guideSdHigh)}
		</p>

		<div class="flex flex-col gap-3">
			{#each data.categoryDefs as catDef (catDef.id)}
				{@const bm = benchmarksForAge.find((b: { categoryId: number }) => b.categoryId === catDef.id)}
				{@const inputMean = bm?.mean ?? 0}
				{@const inputSd = bm?.stdDev ?? 10}
				<Card>
					<div class="flex items-center gap-3 flex-wrap">
						<span class="text-lg">{catDef.icon}</span>
						<span class="font-bold text-[var(--color-text-primary)] w-24">{catDef.name}</span>
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<FormField label={DEMO_STATUS_LABELS.meanLabel} type="number" value={inputMean} disabled class="w-24" />
							<FormField label={DEMO_STATUS_LABELS.sdLabel} type="number" value={inputSd} disabled class="w-24" />
						</div>
						<Button
							variant="ghost"
							size="sm"
							class="bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed"
							disabled
						>
							{STATUS_LABELS.benchmarkSaveButton}
						</Button>
					</div>

					{#if previewChild?.status}
						{@const stat = previewChild.status.statuses[catDef.id]}
						{#if stat}
							{@const childVal = stat.value}
							{@const deviation = calcDeviationScore(childVal, inputMean, inputSd)}
							{@const label = getComparisonLabel(deviation)}
							<p class="text-xs text-[var(--color-text-tertiary)] mt-2 ml-8">
								{STATUS_LABELS.deviationPreview(previewChild.nickname, deviation, label.emoji, label.text)}
							</p>
						{/if}
					{/if}
				</Card>
			{/each}
		</div>
	</div>

	<DemoCta
		title={DEMO_STATUS_LABELS.ctaTitle}
		description={DEMO_STATUS_LABELS.ctaDesc}
	/>
</div>
