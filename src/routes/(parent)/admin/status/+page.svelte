<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import {
	calcDeviationScore,
	getComparisonLabel,
	getMaxForAge,
} from '$lib/domain/validation/status';
import { SuccessAlert } from '$lib/ui/components';

let { data } = $props();

let benchmarkAge = $state(4);
let benchmarkSuccess = $state(false);

// ベンチマーク入力値のリアルタイム追跡
let bmInputMean: Record<string, string> = $state({});
let bmInputSd: Record<string, string> = $state({});

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

// プレビュー用の子供選択
const initialChildId = data.children[0]?.id ?? 0;
let previewChildId = $state(initialChildId);
const previewChild = $derived(data.children.find((c) => c.id === previewChildId));

// 称号カスタマイズ
let showLevelTitles = $state(false);
let levelTitleSuccess = $state(false);
let levelTitleInputs: Record<number, string> = $state({});
</script>

<svelte:head>
	<title>ベンチマーク管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-end">
		<a
			href="/admin/children"
			class="text-sm text-blue-500 hover:text-blue-600 font-bold"
		>
			こども管理でステータス編集 →
		</a>
	</div>

	<!-- 称号カスタマイズセクション -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
		<button
			type="button"
			class="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
			onclick={() => { showLevelTitles = !showLevelTitles; }}
		>
			<h3 class="text-lg font-bold text-gray-700">🏷️ レベル称号カスタマイズ</h3>
			<span class="text-gray-400 text-sm">{showLevelTitles ? '▲ 閉じる' : '▼ 開く'}</span>
		</button>

		{#if showLevelTitles}
			<div class="px-4 pb-4 space-y-3">
				<p class="text-xs text-gray-500">
					各レベルの称号を家庭オリジナルに変更できます。空欄にするとデフォルトに戻ります。
				</p>

				{#if levelTitleSuccess}
					<SuccessAlert message="称号を更新しました" />
				{/if}

				{#each data.levelTitles as lt (lt.level)}
					<div class="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
						<span class="text-sm font-bold text-gray-500 w-12">Lv.{lt.level}</span>
						<div class="flex-1 min-w-0">
							<form
								method="POST"
								action="?/saveLevelTitle"
								use:enhance={() => {
									levelTitleSuccess = false;
									return async ({ result }) => {
										if (result.type === 'success') {
											levelTitleSuccess = true;
											delete levelTitleInputs[lt.level];
											await invalidateAll();
										}
									};
								}}
								class="flex items-center gap-2"
							>
								<input type="hidden" name="level" value={lt.level} />
								<input
									type="text"
									name="customTitle"
									maxlength={20}
									placeholder={lt.defaultTitle}
									value={levelTitleInputs[lt.level] ?? lt.customTitle ?? ''}
									oninput={(e) => { levelTitleInputs[lt.level] = e.currentTarget.value; }}
									class="flex-1 px-3 py-1.5 border rounded-lg text-sm
										{lt.customTitle ? 'border-purple-300 bg-purple-50' : 'border-gray-200'}"
								/>
								<button
									type="submit"
									class="px-3 py-1.5 bg-purple-500 text-white text-xs font-bold rounded-lg hover:bg-purple-600 transition-colors whitespace-nowrap"
								>
									保存
								</button>
							</form>
						</div>
						{#if lt.customTitle}
							<form
								method="POST"
								action="?/resetLevelTitle"
								use:enhance={() => {
									levelTitleSuccess = false;
									return async ({ result }) => {
										if (result.type === 'success') {
											levelTitleSuccess = true;
											delete levelTitleInputs[lt.level];
											await invalidateAll();
										}
									};
								}}
							>
								<input type="hidden" name="level" value={lt.level} />
								<button
									type="submit"
									class="px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors whitespace-nowrap"
									title="デフォルトに戻す"
								>
									リセット
								</button>
							</form>
						{/if}
					</div>
				{/each}

				<!-- 全リセットボタン -->
				{#if data.levelTitles.some((lt) => lt.customTitle)}
					<form
						method="POST"
						action="?/resetAllLevelTitles"
						use:enhance={() => {
							levelTitleSuccess = false;
							return async ({ result }) => {
								if (result.type === 'success') {
									levelTitleSuccess = true;
									levelTitleInputs = {};
									await invalidateAll();
								}
							};
						}}
						class="pt-2 border-t border-gray-200"
					>
						<button
							type="submit"
							class="px-4 py-2 text-sm text-red-500 hover:text-red-600 font-bold transition-colors"
						>
							全ての称号をデフォルトに戻す
						</button>
					</form>
				{/if}
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
						<button
							type="button"
							class="px-2 py-1 rounded text-xs font-bold transition-colors
								{previewChildId === child.id
								? 'bg-blue-500 text-white'
								: 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}"
							onclick={() => { previewChildId = child.id; }}
						>
							{child.nickname}
						</button>
					{/each}
				</div>
			</div>
		{/if}

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
				</form>
			{/each}
		</div>
	</div>
</div>
