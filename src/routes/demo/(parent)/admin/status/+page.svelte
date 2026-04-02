<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { calcDeviationScore, getComparisonLabel } from '$lib/domain/validation/status';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

function getAnalysisText(deviationScore: number): { text: string; color: string } {
	if (deviationScore >= 60) return { text: '同年齢の中でも特に活発です', color: 'text-green-600' };
	if (deviationScore >= 45)
		return { text: '平均的なペースで成長しています', color: 'text-blue-600' };
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
	<title>ベンチマーク管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<div class="flex items-center justify-end">
		<a
			href="/demo/admin/children"
			class="text-sm text-blue-500 hover:text-blue-600 font-bold"
		>
			こども管理でステータス編集 →
		</a>
	</div>

	<!-- 成長レポート -->
	{#if previewChild?.status}
		<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
			<h3 class="text-lg font-bold text-gray-700 mb-3">
				📊 {previewChild.nickname}の成長レポート
			</h3>

			<div class="flex justify-center mb-4">
				<RadarChart
					categories={previewRadarCategories}
					comparisonValues={previewChild.benchmarkValues}
					comparisonLabel="同年齢の平均"
					size={280}
				/>
			</div>
			<p class="text-xs text-gray-400 text-center mb-4">
				※ 参考値です。お子さまの個性やペースを大切にしてください
			</p>

			<!-- 分析サマリー -->
			<div class="bg-gray-50 rounded-lg p-3 mb-4">
				<h4 class="text-sm font-bold text-gray-600 mb-2">📋 分析サマリー</h4>
				<div class="space-y-1">
					{#each CATEGORY_DEFS as catDef (catDef.id)}
						{@const stat = previewChild.status?.statuses[catDef.id]}
						{#if stat}
							{@const analysis = getAnalysisText(stat.deviationScore)}
							<div class="flex items-center gap-2 text-sm">
								<span class="w-5 text-center">{catDef.icon}</span>
								<span class="font-bold text-gray-700 w-20">{catDef.name}</span>
								<span class={analysis.color}>{analysis.text}</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- 称号カスタマイズ -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
		<Button
			variant="ghost"
			size="md"
			class="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
			onclick={() => { showLevelTitles = !showLevelTitles; }}
		>
			<h3 class="text-lg font-bold text-gray-700">🏷️ レベル称号カスタマイズ</h3>
			<span class="text-gray-400 text-sm">{showLevelTitles ? '▲ 閉じる' : '▼ 開く'}</span>
		</Button>

		{#if showLevelTitles}
			<div class="px-4 pb-4 space-y-3">
				<p class="text-xs text-gray-500">
					各レベルの称号を家庭オリジナルに変更できます。空欄にするとデフォルトに戻ります。
				</p>

				{#each data.levelTitles as lt (lt.level)}
					<div class="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
						<span class="text-sm font-bold text-gray-500 w-12">Lv.{lt.level}</span>
						<div class="flex-1 min-w-0 flex items-center gap-2">
							<input
								type="text"
								maxlength={20}
								placeholder={lt.defaultTitle}
								disabled
								class="flex-1 px-3 py-1.5 border rounded-lg text-sm border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
							/>
							<Button
								variant="ghost"
								size="sm"
								class="bg-gray-200 text-gray-400 cursor-not-allowed"
								disabled
							>
								保存
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div>
		<!-- 機能説明 -->
		<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
			<p class="font-bold mb-1">ベンチマークとは？</p>
			<p>
				子供のステータスを「同じ年齢の目安値」と比べて偏差値を計算するためのデータです。
				設定すると、子供画面に「みんなよりすごい！」などの比較メッセージが表示されます。
			</p>
		</div>

		<!-- プレビュー用の子供選択 -->
		{#if data.children.length > 0}
			<div class="flex items-center gap-2 mb-4">
				<span class="text-xs text-gray-500">プレビュー:</span>
				<div class="flex gap-1 flex-wrap">
					{#each data.children as child (child.id)}
						<Button
							variant={previewChildId === child.id ? 'primary' : 'ghost'}
							size="sm"
							class={previewChildId === child.id
								? ''
								: 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}
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
						: 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}"
					onclick={() => { benchmarkAge = age; }}
				>
					{age}歳
				</Button>
			{/each}
		</div>

		<!-- 年齢別参考値ガイド -->
		<p class="text-xs text-gray-400 mb-4">
			{benchmarkAge}歳の目安: 平均 {guideMeanLow}〜{guideMeanHigh} XP、SD {guideSdLow}〜{guideSdHigh}（XPベース）
		</p>

		<div class="flex flex-col gap-3">
			{#each data.categoryDefs as catDef (catDef.id)}
				{@const bm = benchmarksForAge.find((b: { categoryId: number }) => b.categoryId === catDef.id)}
				{@const inputMean = bm?.mean ?? 0}
				{@const inputSd = bm?.stdDev ?? 10}
				<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
					<div class="flex items-center gap-3 flex-wrap">
						<span class="text-lg">{catDef.icon}</span>
						<span class="font-bold text-gray-700 w-24">{catDef.name}</span>
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<label class="text-xs text-gray-500 whitespace-nowrap">
								平均:
							</label>
							<input
								type="number"
								value={inputMean}
								disabled
								class="w-20 px-2 py-1 border rounded text-sm text-right bg-gray-50 text-gray-400 cursor-not-allowed"
							/>
							<label class="text-xs text-gray-500 whitespace-nowrap">
								SD:
							</label>
							<input
								type="number"
								value={inputSd}
								disabled
								class="w-20 px-2 py-1 border rounded text-sm text-right bg-gray-50 text-gray-400 cursor-not-allowed"
							/>
						</div>
						<Button
							variant="ghost"
							size="sm"
							class="bg-gray-200 text-gray-400 cursor-not-allowed"
							disabled
						>
							保存
						</Button>
					</div>

					{#if previewChild?.status}
						{@const stat = previewChild.status.statuses[catDef.id]}
						{#if stat}
							{@const childVal = stat.value}
							{@const deviation = calcDeviationScore(childVal, inputMean, inputSd)}
							{@const label = getComparisonLabel(deviation)}
							<p class="text-xs text-gray-400 mt-2 ml-8">
								{previewChild.nickname}: 偏差値 {deviation}（{label.emoji} {label.text}）
							</p>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<DemoCta
		title="ベンチマークを自由に設定しませんか？"
		description="登録すると、年齢別の目安値を自由に設定して成長レポートをカスタマイズできます。"
	/>
</div>
