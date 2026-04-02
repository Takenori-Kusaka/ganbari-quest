<script lang="ts">
let { data } = $props();

function formatWeek(start: string, end: string): string {
	return `${start.replace(/-/g, '/')} 〜 ${end.replace(/-/g, '/')}`;
}

function progressPct(xp: number, level: number): number {
	// 簡易的なレベル内進捗計算
	const thresholds = [0, 30, 80, 150, 250, 400, 600, 850, 1200, 1600];
	const currentThreshold = thresholds[level - 1] ?? 0;
	const nextThreshold = thresholds[level] ?? currentThreshold + 200;
	const range = nextThreshold - currentThreshold;
	if (range <= 0) return 100;
	return Math.min(100, Math.round(((xp - currentThreshold) / range) * 100));
}
</script>

<svelte:head>
	<title>しゅうかんレポート - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-lg font-bold">📊 しゅうかんレポート</h2>

	{#if data.reports.length === 0}
		<div class="rounded-xl border bg-white p-8 text-center">
			<p class="text-2xl">📋</p>
			<p class="mt-2 text-sm font-semibold text-gray-500">レポートがありません</p>
			<p class="text-xs text-gray-400">子どもを登録すると、毎週レポートが生成されます</p>
		</div>
	{:else}
		{#each data.reports as report}
			<div class="rounded-xl border bg-white shadow-sm">
				<!-- Header -->
				<div class="rounded-t-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-3 text-white">
					<h3 class="text-base font-bold">{report.childName}ちゃんの しゅうかんレポート</h3>
					<p class="text-xs opacity-80">{formatWeek(report.weekStart, report.weekEnd)}</p>
				</div>

				<div class="space-y-4 p-4">
					<!-- Summary -->
					<div class="flex gap-3">
						<div class="flex-1 rounded-lg bg-blue-50 p-3 text-center">
							<p class="text-xs text-blue-600">かつどう</p>
							<p class="text-xl font-bold text-blue-700">{report.totalActivities}</p>
							<p class="text-[10px] text-blue-500">かい</p>
						</div>
						<div class="flex-1 rounded-lg bg-amber-50 p-3 text-center">
							<p class="text-xs text-amber-600">ポイント</p>
							<p class="text-xl font-bold text-amber-700">{report.totalPoints}</p>
							<p class="text-[10px] text-amber-500">pt</p>
						</div>
						<div class="flex-1 rounded-lg bg-green-50 p-3 text-center">
							<p class="text-xs text-green-600">じっせき</p>
							<p class="text-xl font-bold text-green-700">{report.newAchievements.length}</p>
							<p class="text-[10px] text-green-500">かくとく</p>
						</div>
					</div>

					<!-- Highlights -->
					{#if report.highlights.length > 0}
						<div>
							<h4 class="mb-2 text-xs font-bold text-gray-600">🏆 こんしゅうのハイライト</h4>
							<div class="space-y-1.5">
								{#each report.highlights as highlight}
									<div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
										<span class="text-base">{highlight.icon}</span>
										<span class="text-xs text-gray-700">{highlight.message}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Category breakdown -->
					<div>
						<h4 class="mb-2 text-xs font-bold text-gray-600">📈 カテゴリべつの ようす</h4>
						<div class="space-y-2">
							{#each report.categories as cat}
								<div class="flex items-center gap-2">
									<span class="w-5 text-center text-sm">{cat.categoryIcon}</span>
									<span class="w-16 text-xs font-semibold text-gray-700">{cat.categoryName}</span>
									<div class="flex-1">
										<div class="h-3 overflow-hidden rounded-full bg-gray-100">
											<div
												class="h-full rounded-full bg-blue-400 transition-all"
												style="width: {progressPct(cat.totalXp, cat.level)}%"
											></div>
										</div>
									</div>
									<span class="w-12 text-right text-[10px] font-bold text-gray-500">
										Lv.{cat.level}
									</span>
									<span class="w-8 text-right text-[10px] text-gray-400">
										{cat.activityCount}回
									</span>
								</div>
							{/each}
						</div>
					</div>

					<!-- Achievements -->
					{#if report.newAchievements.length > 0}
						<div>
							<h4 class="mb-2 text-xs font-bold text-gray-600">🎖️ かくとくした じっせき</h4>
							<div class="flex flex-wrap gap-2">
								{#each report.newAchievements as ach}
									<div class="rounded-lg border bg-amber-50 px-2.5 py-1.5">
										<span class="text-sm">{ach.icon}</span>
										<span class="text-xs font-semibold text-amber-800">{ach.name}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Advice -->
					<div class="rounded-lg border-l-4 border-blue-400 bg-blue-50 p-3">
						<p class="text-xs font-bold text-blue-700">💡 アドバイス</p>
						<p class="mt-1 text-xs text-blue-600">{report.advice.message}</p>
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>
