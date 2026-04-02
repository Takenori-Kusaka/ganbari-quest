<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { calcDeviationScore, getComparisonLabel } from '$lib/domain/validation/status';
import { SuccessAlert } from '$lib/ui/components';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

/** 偏差値帯から親向け自然言語へ変換 */
function getAnalysisText(deviationScore: number): { text: string; color: string } {
	if (deviationScore >= 60) return { text: '同年齢の中でも特に活発です', color: 'text-green-600' };
	if (deviationScore >= 45)
		return { text: '平均的なペースで成長しています', color: 'text-blue-600' };
	return { text: 'これから伸びる余地がたくさんあります', color: 'text-orange-500' };
}

let benchmarkAge = $state(4);
let benchmarkSuccess = $state(false);

// ベンチマーク入力値のリアルタイム追跡
let bmInputMean: Record<string, string> = $state({});
let bmInputSd: Record<string, string> = $state({});

const benchmarksForAge = $derived(data.benchmarks.filter((b) => b.age === benchmarkAge));

// 年齢別参考値ガイド（XPスケール）
// 月30日×2活動×8XP÷5カテゴリ≒96 XP/月/カテゴリを基準
const guideBaseXp = $derived(Math.round((benchmarkAge - 2) * 80));
const guideMeanLow = $derived(Math.round(guideBaseXp * 0.8));
const guideMeanHigh = $derived(Math.round(guideBaseXp * 1.5));
const guideSdLow = $derived(Math.round(guideBaseXp * 0.3));
const guideSdHigh = $derived(Math.round(guideBaseXp * 0.6));

// 未設定ベンチマーク警告
const hasUnsetBenchmarks = $derived(
	data.categoryDefs.some((catDef) => {
		const bm = benchmarksForAge.find((b) => b.categoryId === catDef.id);
		return !bm || (bm.mean === 0 && bm.stdDev === 10);
	}),
);

// プレビュー用の子供選択（override + $derived パターン）
let previewChildIdOverride = $state<number | undefined>(undefined);
const previewChildId = $derived(
	previewChildIdOverride !== undefined && data.children.some((c) => c.id === previewChildIdOverride)
		? previewChildIdOverride
		: (data.children[0]?.id ?? 0),
);
const previewChild = $derived(data.children.find((c) => c.id === previewChildId));

// 成長レポート用のレーダーチャートデータ
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

	<!-- 成長レポート -->
	{#if previewChild?.status}
		<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
			<h3 class="text-lg font-bold text-gray-700 mb-3">
				📊 {previewChild.nickname}の成長レポート
			</h3>

			<!-- ベンチマーク比較レーダーチャート (G7) -->
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

			<!-- 分析サマリー (G8) -->
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

			<!-- 月次変化量テーブル (G9) -->
			{#if previewChild.monthlyComparison}
				{@const mc = previewChild.monthlyComparison}
				<div class="bg-gray-50 rounded-lg p-3">
					<h4 class="text-sm font-bold text-gray-600 mb-2">📈 先月からの変化</h4>
					<div class="space-y-1">
						{#each CATEGORY_DEFS as catDef (catDef.id)}
							{@const change = mc.changes[catDef.id] ?? 0}
							{@const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→'}
							{@const color = change > 0 ? 'text-green-600' : change < 0 ? 'text-red-500' : 'text-gray-400'}
							<div class="flex items-center gap-2 text-sm">
								<span class="w-5 text-center">{catDef.icon}</span>
								<span class="font-bold text-gray-700 w-20">{catDef.name}</span>
								<span class={color}>
									{change > 0 ? '+' : ''}{change} {arrow}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- 称号カスタマイズセクション -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
		<Button
			type="button"
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
								<Button
									type="submit"
									variant="primary"
									size="sm"
									class="bg-purple-500 hover:bg-purple-600 text-xs whitespace-nowrap"
								>
									保存
								</Button>
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
								<Button
									type="submit"
									variant="ghost"
									size="sm"
									class="text-xs text-gray-400 hover:text-red-500 whitespace-nowrap"
									title="デフォルトに戻す"
								>
									リセット
								</Button>
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
						<Button
							type="submit"
							variant="ghost"
							size="sm"
							class="text-sm text-red-500 hover:text-red-600"
						>
							全ての称号をデフォルトに戻す
						</Button>
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
						<Button
							type="button"
							variant={previewChildId === child.id ? 'primary' : 'outline'}
							size="sm"
							class="text-xs {previewChildId === child.id ? '' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}"
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
					type="button"
					variant={benchmarkAge === age ? 'success' : 'outline'}
					size="sm"
					class="text-xs whitespace-nowrap {benchmarkAge === age ? '' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}"
					onclick={() => { benchmarkAge = age; benchmarkSuccess = false; bmInputMean = {}; bmInputSd = {}; }}
				>
					{age}歳
				</Button>
			{/each}
		</div>

		<!-- 年齢別参考値ガイド -->
		<p class="text-xs text-gray-400 mb-4">
			{benchmarkAge}歳の目安: 平均 {guideMeanLow}〜{guideMeanHigh} XP、SD {guideSdLow}〜{guideSdHigh}（XPベース）
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
						<Button
							type="submit"
							variant="success"
							size="sm"
							class="text-xs"
						>
							保存
						</Button>
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
