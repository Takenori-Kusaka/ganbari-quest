<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import {
	calcDeviationScore,
	getComparisonLabel,
	getMaxForAge,
} from '$lib/domain/validation/status';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';

let { data, form } = $props();

const initialChildId = data.children[0]?.id ?? 0;
let selectedChildId = $state(initialChildId);
let editSuccess = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

// スライダー操作中の値を追跡（カテゴリ名 → 現在値）
let sliderValues: Record<number, number> = $state({});
let benchmarkAge = $state(4);
let benchmarkSuccess = $state(false);

// ベンチマーク入力値のリアルタイム追跡
let bmInputMean: Record<string, string> = $state({});
let bmInputSd: Record<string, string> = $state({});

function starText(stars: number): string {
	return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

const benchmarksForAge = $derived(data.benchmarks.filter((b) => b.age === benchmarkAge));

// 年齢別参考値ガイド
const guideMaxVal = $derived(getMaxForAge(benchmarkAge));
const guideMeanLow = $derived(Math.round(guideMaxVal * 0.35));
const guideMeanHigh = $derived(Math.round(guideMaxVal * 0.5));
const guideSdLow = $derived(Math.round(guideMaxVal * 0.1));
const guideSdHigh = $derived(Math.round(guideMaxVal * 0.18));

// 未設定ベンチマーク警告
const hasUnsetBenchmarks = $derived(
	data.categoryDefs.some((catDef) => {
		const bm = benchmarksForAge.find((b) => b.categoryId === catDef.id);
		return !bm || (bm.mean === 0 && bm.stdDev === 10);
	}),
);
</script>

<svelte:head>
	<title>ステータス管理 - がんばりクエスト管理</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-xl font-bold text-gray-700 mb-6">📊 ステータス管理</h2>

	<!-- 子供選択 -->
	{#if data.children.length > 0}
		<div class="flex gap-2 mb-6 overflow-x-auto pb-2">
			{#each data.children as child (child.id)}
				<button
					type="button"
					class="px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors
						{selectedChildId === child.id
						? 'bg-blue-500 text-white'
						: 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}"
					onclick={() => {
						selectedChildId = child.id;
						editSuccess = false;
						sliderValues = {};
					}}
				>
					{child.nickname}
					{#if child.status}
						<span class="text-xs opacity-75">Lv.{child.status.level}</span>
					{/if}
				</button>
			{/each}
		</div>

		{#if selectedChild?.status}
			{#if editSuccess}
				<SuccessAlert message="ステータスを更新しました" />
			{/if}

			{#if form?.error}
				<ErrorAlert message={form.error} severity="warning" action="fix_input" />
			{/if}

			<!-- レベル情報 -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-500">レベル</p>
						<p class="text-2xl font-bold text-gray-700">
							Lv.{selectedChild.status.level}
						</p>
					</div>
					<div class="text-right">
						<p class="text-sm text-gray-500">称号</p>
						<p class="text-lg font-bold text-blue-600">
							{selectedChild.status.levelTitle}
						</p>
					</div>
				</div>
			</div>

			<!-- カテゴリ別ステータス -->
			<div class="flex flex-col gap-3">
				{#each data.categoryDefs as catDef (catDef.id)}
					
					{@const stat = selectedChild.status.statuses[catDef.id]}
					{#if stat}
						{@const maxVal = selectedChild.status?.maxValue ?? 100}
						{@const sliderStep = maxVal > 100 ? 1 : 0.5}
						{@const currentVal = sliderValues[catDef.id] ?? stat.value}
						{@const diff = currentVal - stat.value}
						{@const hasChanged = Math.abs(diff) >= 0.5}
						<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
							<div class="flex items-center justify-between mb-2">
								<div class="flex items-center gap-2">
									<span class="text-xl">{catDef.icon}</span>
									<span class="font-bold text-gray-700">{catDef.name}</span>
								</div>
								<span class="text-sm text-yellow-500">{starText(stat.stars)}</span>
							</div>

							<form
								method="POST"
								action="?/updateStatus"
								use:enhance={() => {
									editSuccess = false;
									return async ({ result }) => {
										if (result.type === 'success') {
											editSuccess = true;
											delete sliderValues[catDef.id];
											await invalidateAll();
										}
									};
								}}
								class="space-y-2"
							>
								<input type="hidden" name="childId" value={selectedChildId} />
								<input type="hidden" name="categoryId" value={catDef.id} />
								<div>
									<input
										type="range"
										name="value"
										min="0"
										max={maxVal}
										step={sliderStep}
										value={currentVal}
										oninput={(e) => {
											sliderValues[catDef.id] = Number(e.currentTarget.value);
										}}
										class="w-full accent-blue-500"
									/>
								</div>
								<div class="flex items-center justify-between">
									<div>
										<span class="text-2xl font-bold text-gray-700">{currentVal}</span>
										<span class="text-sm text-gray-400"> / {maxVal}</span>
										{#if hasChanged}
											<span class="ml-2 text-sm font-bold {diff > 0 ? 'text-green-500' : 'text-red-500'}">
												{diff > 0 ? '+' : ''}{diff.toFixed(1)}
											</span>
										{/if}
									</div>
									<button
										type="submit"
										disabled={!hasChanged}
										class="px-4 py-1.5 text-sm font-bold rounded-lg transition-colors
											{hasChanged
											? 'bg-blue-500 text-white hover:bg-blue-600'
											: 'bg-gray-200 text-gray-400 cursor-not-allowed'}"
									>
										保存
									</button>
								</div>
							</form>
						</div>
					{/if}
				{/each}
			</div>
		{:else if selectedChild}
			<div class="text-center text-gray-500 py-8">
				<p>ステータスデータがありません</p>
			</div>
		{/if}
	{:else}
		<div class="text-center text-gray-500 py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">子供が登録されていません</p>
		</div>
	{/if}

	<!-- ベンチマーク管理 -->
	<div class="mt-8">
		<h3 class="text-lg font-bold text-gray-700 mb-4">📈 ベンチマーク管理</h3>

		<!-- 機能説明 -->
		<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
			<p class="font-bold mb-1">ベンチマークとは？</p>
			<p>
				子供のステータスを「同じ年齢の目安値」と比べて偏差値を計算するためのデータです。
				設定すると、子供画面に「みんなよりすごい！」などの比較メッセージが表示されます。
			</p>
		</div>

		<!-- 年齢選択 -->
		<div class="flex gap-1 mb-2 overflow-x-auto pb-2">
			{#each Array.from({ length: 10 }, (_, i) => i + 3) as age (age)}
				<button
					type="button"
					class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors
						{benchmarkAge === age
						? 'bg-green-500 text-white'
						: 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}"
					onclick={() => { benchmarkAge = age; benchmarkSuccess = false; bmInputMean = {}; bmInputSd = {}; }}
				>
					{age}歳
				</button>
			{/each}
		</div>

		<!-- 年齢別参考値ガイド -->
		<p class="text-xs text-gray-400 mb-4">
			{benchmarkAge}歳の目安: 平均 {guideMeanLow}〜{guideMeanHigh}、SD {guideSdLow}〜{guideSdHigh}（最大値: {guideMaxVal}）
		</p>

		<!-- 未設定警告 -->
		{#if hasUnsetBenchmarks}
			<div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-4">
				{benchmarkAge}歳のベンチマークが未設定のカテゴリがあります。設定すると子供画面の比較メッセージが正しく機能します。
			</div>
		{/if}

		{#if benchmarkSuccess}
			<SuccessAlert message="ベンチマークを更新しました" />
		{/if}

		<div class="flex flex-col gap-3">
			{#each data.categoryDefs as catDef (catDef.id)}
				{@const bm = benchmarksForAge.find((b) => b.categoryId === catDef.id)}
				{@const bmKey = `${benchmarkAge}-${catDef.id}`}
				{@const inputMean = Number(bmInputMean[bmKey] ?? String(bm?.mean ?? 0))}
				{@const inputSd = Number(bmInputSd[bmKey] ?? String(bm?.stdDev ?? 10))}
				<form
					method="POST"
					action="?/updateBenchmark"
					use:enhance={() => {
						benchmarkSuccess = false;
						return async ({ result }) => {
							if (result.type === 'success') {
								benchmarkSuccess = true;
								delete bmInputMean[bmKey];
								delete bmInputSd[bmKey];
								await invalidateAll();
							}
						};
					}}
					class="bg-white rounded-xl shadow-sm border border-gray-200 p-4"
				>
					<input type="hidden" name="age" value={benchmarkAge} />
					<input type="hidden" name="categoryId" value={catDef.id} />
					<div class="flex items-center gap-3 flex-wrap">
						<span class="text-lg">{catDef.icon}</span>
						<span class="font-bold text-gray-700 w-24">{catDef.name}</span>
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<label class="text-xs text-gray-500 whitespace-nowrap">
								平均<span class="hidden sm:inline text-gray-400">（目安値）</span>:
							</label>
							<input
								type="number"
								name="mean"
								step="0.1"
								min="0"
								value={bm?.mean ?? 0}
								oninput={(e) => { bmInputMean[bmKey] = e.currentTarget.value; }}
								class="w-20 px-2 py-1 border rounded text-sm text-right"
							/>
							<label class="text-xs text-gray-500 whitespace-nowrap">
								SD<span class="hidden sm:inline text-gray-400">（ばらつき）</span>:
							</label>
							<input
								type="number"
								name="stdDev"
								step="0.1"
								min="0.1"
								value={bm?.stdDev ?? 10}
								oninput={(e) => { bmInputSd[bmKey] = e.currentTarget.value; }}
								class="w-20 px-2 py-1 border rounded text-sm text-right"
							/>
						</div>
						<button
							type="submit"
							class="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors"
						>
							保存
						</button>
					</div>

					<!-- 偏差値プレビュー -->
					{#if selectedChild?.status}
						{@const stat = selectedChild.status.statuses[catDef.id]}
						{#if stat}
							{@const childVal = stat.value}
							{@const deviation = calcDeviationScore(childVal, inputMean, inputSd)}
							{@const label = getComparisonLabel(deviation)}
							<p class="text-xs text-gray-400 mt-2 ml-8">
								{selectedChild.nickname}: 偏差値 {deviation}（{label.emoji} {label.text}）
							</p>
						{/if}
					{/if}
				</form>
			{/each}
		</div>
	</div>
</div>
