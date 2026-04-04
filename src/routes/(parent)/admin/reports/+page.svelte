<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';
import SiblingCategoryChart from '$lib/ui/components/SiblingCategoryChart.svelte';
import SiblingTrendChart from '$lib/ui/components/SiblingTrendChart.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

type TabId = 'monthly' | 'weekly';
let activeTab = $state<TabId>('monthly');

const dayLabels: Record<string, string> = {
	monday: '月曜日',
	tuesday: '火曜日',
	wednesday: '水曜日',
	thursday: '木曜日',
	friday: '金曜日',
	saturday: '土曜日',
	sunday: '日曜日',
};

function formatWeek(start: string, end: string): string {
	return `${start.replace(/-/g, '/')} 〜 ${end.replace(/-/g, '/')}`;
}

function progressPct(xp: number, level: number): number {
	const thresholds = [0, 30, 80, 150, 250, 400, 600, 850, 1200, 1600];
	const currentThreshold = thresholds[level - 1] ?? 0;
	const nextThreshold = thresholds[level] ?? currentThreshold + 200;
	const range = nextThreshold - currentThreshold;
	if (range <= 0) return 100;
	return Math.min(100, Math.round(((xp - currentThreshold) / range) * 100));
}

function formatMonth(ym: string): string {
	const [y, m] = ym.split('-');
	return `${y}年${Number(m)}月`;
}

function navigateMonth(offset: number) {
	const parts = data.selectedMonth.split('-').map(Number);
	const y = parts[0] ?? 2026;
	const m = parts[1] ?? 1;
	const d = new Date(y, m - 1 + offset, 1);
	const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	goto(`?month=${newMonth}`, { replaceState: true });
}

// 先月との比較データ取得
function getPrevReport(childId: number) {
	return data.prevMonthlyReports?.find((r: { childId: number }) => r.childId === childId);
}

function diffLabel(current: number, prev: number | undefined): string {
	if (prev === undefined) return '';
	const diff = current - prev;
	if (diff > 0) return `+${diff}`;
	if (diff < 0) return `${diff}`;
	return '±0';
}

function diffColor(current: number, prev: number | undefined): string {
	if (prev === undefined) return '';
	const diff = current - prev;
	if (diff > 0) return 'text-green-600';
	if (diff < 0) return 'text-red-500';
	return 'text-gray-400';
}

// カテゴリ名の取得（IDから）
const categoryNames: Record<string, string> = {
	'1': '運動',
	'2': '勉強',
	'3': '生活',
	'4': '交流',
	'5': '創造',
	unknown: 'その他',
};

function getCategoryName(catId: string): string {
	return categoryNames[catId] ?? `カテゴリ${catId}`;
}

// カテゴリ内訳の最大値を取得（グラフ描画用）
function maxCategoryCount(breakdown: Record<string, number>): number {
	const vals = Object.values(breakdown);
	return vals.length > 0 ? Math.max(...vals) : 1;
}
</script>

<svelte:head>
	<title>レポート - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold">📊 レポート</h2>
		<div class="flex gap-2">
			<a
				href="/admin/certificates"
				class="text-sm font-medium px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors inline-flex items-center gap-1"
			>
				📜 証明書
			</a>
			<a
				href="/admin/growth-book"
				class="text-sm font-medium px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors inline-flex items-center gap-1"
			>
				📖 記録ブック
			</a>
		</div>
	</div>

	{#if form?.settingsUpdated}
		<div class="rounded-lg bg-green-50 p-3 text-sm text-green-700">設定を更新しました</div>
	{/if}

	<!-- Tab navigation -->
	<div class="flex gap-1 rounded-lg bg-gray-100 p-1">
		<button
			class="tab-btn"
			class:active={activeTab === 'monthly'}
			onclick={() => (activeTab = 'monthly')}
		>
			月次レポート
		</button>
		<button
			class="tab-btn"
			class:active={activeTab === 'weekly'}
			onclick={() => (activeTab = 'weekly')}
		>
			週次レポート
		</button>
	</div>

	{#if activeTab === 'monthly'}
		<!-- Monthly Report Section -->
		<div class="space-y-4">
			<!-- Month selector -->
			<div class="flex items-center justify-center gap-4">
				<button class="month-nav-btn" onclick={() => navigateMonth(-1)}>◀</button>
				<span class="text-base font-bold text-gray-700">{formatMonth(data.selectedMonth)}</span>
				<button class="month-nav-btn" onclick={() => navigateMonth(1)}>▶</button>
			</div>

			{#if data.monthlyReports.length === 0}
				<div class="rounded-xl border bg-white p-8 text-center">
					<p class="text-2xl">📋</p>
					<p class="mt-2 text-sm font-semibold text-gray-500">
						{formatMonth(data.selectedMonth)}のレポートがありません
					</p>
					<p class="text-xs text-gray-400">活動を記録すると、月次レポートが生成されます</p>
				</div>
			{:else}
				{#each data.monthlyReports as report}
					{@const prev = getPrevReport(report.childId)}
					<div class="rounded-xl border bg-white shadow-sm">
						<!-- Header -->
						<div class="monthly-report-header">
							<h3 class="text-base font-bold">{report.childName}ちゃんの がんばりレポート</h3>
							<p class="text-xs opacity-80">{formatMonth(report.month)}</p>
						</div>

						<div class="space-y-4 p-4">
							<!-- Highlight cards -->
							<div class="grid grid-cols-2 gap-3">
								<div class="rounded-lg bg-blue-50 p-3 text-center">
									<p class="text-xs text-blue-600">活動</p>
									<p class="text-xl font-bold text-blue-700">{report.totalActivities}</p>
									<p class="text-[10px] text-blue-500">回</p>
									{#if prev}
										<p class="text-[10px] font-semibold {diffColor(report.totalActivities, prev.totalActivities)}">
											{diffLabel(report.totalActivities, prev.totalActivities)} 先月比
										</p>
									{/if}
								</div>
								<div class="rounded-lg bg-amber-50 p-3 text-center">
									<p class="text-xs text-amber-600">ポイント</p>
									<p class="text-xl font-bold text-amber-700">{report.totalPoints}</p>
									<p class="text-[10px] text-amber-500">pt</p>
									{#if prev}
										<p class="text-[10px] font-semibold {diffColor(report.totalPoints, prev.totalPoints)}">
											{diffLabel(report.totalPoints, prev.totalPoints)} 先月比
										</p>
									{/if}
								</div>
								<div class="rounded-lg bg-purple-50 p-3 text-center">
									<p class="text-xs text-purple-600">レベル</p>
									<p class="text-xl font-bold text-purple-700">{report.currentLevel}</p>
									{#if prev}
										<p class="text-[10px] font-semibold {diffColor(report.currentLevel, prev.currentLevel)}">
											{diffLabel(report.currentLevel, prev.currentLevel)} 先月比
										</p>
									{/if}
								</div>
								<div class="rounded-lg bg-orange-50 p-3 text-center">
									<p class="text-xs text-orange-600">連続</p>
									<p class="text-xl font-bold text-orange-700">{report.maxStreakDays}</p>
									<p class="text-[10px] text-orange-500">日</p>
								</div>
							</div>

							<!-- Stats row -->
							<div class="flex gap-3">
								<div class="flex-1 rounded-lg bg-green-50 p-2 text-center">
									<p class="text-xs text-green-600">実績</p>
									<p class="text-lg font-bold text-green-700">{report.totalNewAchievements}</p>
									<p class="text-[10px] text-green-500">獲得</p>
								</div>
								<div class="flex-1 rounded-lg bg-teal-50 p-2 text-center">
									<p class="text-xs text-teal-600">活動日数</p>
									<p class="text-lg font-bold text-teal-700">{report.daysWithActivity}</p>
									<p class="text-[10px] text-teal-500">/ {report.totalDays}日</p>
								</div>
								<div class="flex-1 rounded-lg bg-indigo-50 p-2 text-center">
									<p class="text-xs text-indigo-600">1日平均</p>
									<p class="text-lg font-bold text-indigo-700">{report.avgDailyActivities}</p>
									<p class="text-[10px] text-indigo-500">回</p>
								</div>
							</div>

							<!-- Category breakdown -->
							{#if Object.keys(report.categoryBreakdown).length > 0}
								<div>
									<h4 class="mb-2 text-xs font-bold text-gray-600">📈 カテゴリ別の様子</h4>
									<div class="space-y-2">
										{#each Object.entries(report.categoryBreakdown) as [catId, rawCount]}
											{@const count = rawCount as number}
											{@const prevCat = prev?.categoryBreakdown?.[catId] as number | undefined}
											{@const maxCount = maxCategoryCount(report.categoryBreakdown)}
											<div class="flex items-center gap-2">
												<span class="w-16 text-xs font-semibold text-gray-700 truncate">{getCategoryName(catId)}</span>
												<div class="flex-1">
													<div class="h-4 overflow-hidden rounded-full bg-gray-100">
														<div
															class="h-full rounded-full bg-blue-400 transition-all"
															style:width="{Math.round((count / maxCount) * 100)}%"
														></div>
													</div>
												</div>
												<span class="w-10 text-right text-xs font-bold text-gray-600">{count}回</span>
												{#if prevCat !== undefined}
													<span class="w-10 text-right text-[10px] font-semibold {diffColor(count, prevCat)}">
														{diffLabel(count, prevCat)} 先月比
													</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	{:else}
		<!-- Weekly Report Section (existing) -->
		<!-- 設定セクション -->
		<form method="POST" action="?/updateSettings" use:enhance class="rounded-xl border bg-white p-4">
			<h3 class="mb-3 text-sm font-bold text-gray-700">⚙️ レポート設定</h3>
			<div class="flex flex-wrap items-center gap-4">
				<FormField label="週次レポートを有効にする">
					{#snippet children()}
						<input
							type="checkbox"
							name="enabled"
							checked={data.settings.enabled}
							class="h-4 w-4 rounded border-gray-300"
						/>
					{/snippet}
				</FormField>
				<FormField label="配信曜日">
					{#snippet children()}
						<select name="day" class="rounded-[var(--input-radius)] border bg-[var(--input-bg)] px-2 py-1 text-sm">
							{#each Object.entries(dayLabels) as [value, label]}
								<option {value} selected={data.settings.day === value}>{label}</option>
							{/each}
						</select>
					{/snippet}
				</FormField>
				<Button type="submit" variant="primary" size="sm">
					保存
				</Button>
			</div>
		</form>

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
						<h3 class="text-base font-bold">{report.childName}ちゃんの 週間レポート</h3>
						<p class="text-xs opacity-80">{formatWeek(report.weekStart, report.weekEnd)}</p>
					</div>

					<div class="space-y-4 p-4">
						<!-- Summary -->
						<div class="flex gap-3">
							<div class="flex-1 rounded-lg bg-blue-50 p-3 text-center">
								<p class="text-xs text-blue-600">活動</p>
								<p class="text-xl font-bold text-blue-700">{report.totalActivities}</p>
								<p class="text-[10px] text-blue-500">回</p>
							</div>
							<div class="flex-1 rounded-lg bg-amber-50 p-3 text-center">
								<p class="text-xs text-amber-600">ポイント</p>
								<p class="text-xl font-bold text-amber-700">{report.totalPoints}</p>
								<p class="text-[10px] text-amber-500">pt</p>
							</div>
							<div class="flex-1 rounded-lg bg-green-50 p-3 text-center">
								<p class="text-xs text-green-600">実績</p>
								<p class="text-xl font-bold text-green-700">{report.newAchievements.length}</p>
								<p class="text-[10px] text-green-500">獲得</p>
							</div>
						</div>

						<!-- Highlights -->
						{#if report.highlights.length > 0}
							<div>
								<h4 class="mb-2 text-xs font-bold text-gray-600">🏆 今週のハイライト</h4>
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
							<h4 class="mb-2 text-xs font-bold text-gray-600">📈 カテゴリ別の様子</h4>
							<div class="space-y-2">
								{#each report.categories as cat}
									<div class="flex items-center gap-2">
										<span class="w-5 text-center text-sm">{cat.categoryIcon}</span>
										<span class="w-16 text-xs font-semibold text-gray-700">{cat.categoryName}</span>
										<div class="flex-1">
											<div class="h-3 overflow-hidden rounded-full bg-gray-100">
												<ProgressFill
													pct={progressPct(cat.totalXp, cat.level)}
													class="h-full rounded-full bg-blue-400 transition-all"
												/>
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
								<h4 class="mb-2 text-xs font-bold text-gray-600">🎖️ 獲得した実績</h4>
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
	{/if}

	<!-- きょうだいランキング強化セクション (#373) -->
	{#if data.isFamily && data.rankingData && data.rankingData.rankings.length > 1}
		<section class="space-y-4">
			<h3 class="text-base font-bold text-gray-700">👫 きょうだいランキング</h3>

			<!-- 今週の概要 -->
			<div class="bg-white rounded-xl p-4 shadow-sm">
				<p class="text-sm font-bold text-gray-600 mb-2">📊 今週のまとめ</p>
				{#if data.rankingData.mostActive}
					<p class="text-sm text-gray-700">
						🏆 もっとも活発: <strong>{data.rankingData.mostActive.childName}</strong>（{data.rankingData.mostActive.count}回）
					</p>
				{/if}
				<p class="text-sm text-gray-500 mt-1">{data.rankingData.encouragement}</p>
			</div>

			<!-- 活動数推移グラフ -->
			{#if data.trendData && data.trendData.weeks.length > 1}
				<div class="bg-white rounded-xl p-4 shadow-sm">
					<p class="text-sm font-bold text-gray-600 mb-3">📈 週別 活動数のうつりかわり</p>
					<SiblingTrendChart weeks={data.trendData.weeks} />
				</div>
			{/if}

			<!-- カテゴリ別比較 -->
			<div class="bg-white rounded-xl p-4 shadow-sm">
				<p class="text-sm font-bold text-gray-600 mb-3">📊 今週のカテゴリ別くらべっこ</p>
				<SiblingCategoryChart rankings={data.rankingData.rankings} />
			</div>
		</section>
	{/if}
</div>

<style>
	.tab-btn {
		flex: 1;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-neutral-500, #6b7280);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tab-btn.active {
		background: white;
		color: var(--color-neutral-700, #374151);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.month-nav-btn {
		padding: 6px 12px;
		border: 1px solid var(--color-border-default, #e5e7eb);
		border-radius: 8px;
		background: white;
		color: var(--color-neutral-600, #4b5563);
		cursor: pointer;
		font-size: 0.85rem;
		transition: background 0.15s;
	}

	.month-nav-btn:hover {
		background: var(--color-neutral-50, #f9fafb);
	}

	.monthly-report-header {
		border-radius: 12px 12px 0 0;
		background: linear-gradient(135deg, var(--color-violet-500, #8b5cf6), var(--color-violet-600, #7c3aed));
		padding: 12px 16px;
		color: white;
	}
</style>
