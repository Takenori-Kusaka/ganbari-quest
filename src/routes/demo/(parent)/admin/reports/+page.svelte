<script lang="ts">
import { formatChildName } from '$lib/domain/child-display';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';

let { data } = $props();

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
</script>

<svelte:head>
	<title>週間レポート（デモ） - がんばりクエスト</title>
</svelte:head>

<DemoBanner />

<div class="space-y-6">
	<h2 class="text-lg font-bold">📊 週間レポート</h2>

	{#each data.reports as report}
		<div class="rounded-xl border bg-white shadow-sm">
			<div class="rounded-t-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-3 text-white">
				<h3 class="text-base font-bold">{formatChildName(report.childName, 'possessive')}週間レポート</h3>
				<p class="text-xs opacity-80">{formatWeek(report.weekStart, report.weekEnd)}</p>
			</div>
			<div class="space-y-4 p-4">
				<div class="flex gap-3">
					<div class="flex-1 rounded-lg bg-[var(--color-feedback-info-bg)] p-3 text-center">
						<p class="text-xs text-[var(--color-feedback-info-text)]">活動</p>
						<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">{report.totalActivities}</p>
						<p class="text-[10px] text-[var(--color-feedback-info-text)]">回</p>
					</div>
					<div class="flex-1 rounded-lg bg-[var(--color-feedback-warning-bg)] p-3 text-center">
						<p class="text-xs text-[var(--color-feedback-warning-text)]">ポイント</p>
						<p class="text-xl font-bold text-[var(--color-feedback-warning-text)]">{report.totalPoints}</p>
						<p class="text-[10px] text-[var(--color-feedback-warning-text)]">pt</p>
					</div>
					<div class="flex-1 rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-center">
						<p class="text-xs text-[var(--color-feedback-success-text)]">実績</p>
						<p class="text-xl font-bold text-[var(--color-feedback-success-text)]">{report.newAchievements.length}</p>
						<p class="text-[10px] text-[var(--color-feedback-success-text)]">獲得</p>
					</div>
				</div>

				{#if report.highlights.length > 0}
					<div>
						<h4 class="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">🏆 今週のハイライト</h4>
						<div class="space-y-1.5">
							{#each report.highlights as highlight}
								<div class="flex items-center gap-2 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
									<span class="text-base">{highlight.icon}</span>
									<span class="text-xs text-[var(--color-text-primary)]">{highlight.message}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div>
					<h4 class="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">📈 カテゴリ別の様子</h4>
					<div class="space-y-2">
						{#each report.categories as cat}
							<div class="flex items-center gap-2">
								<span class="w-5 text-center text-sm">{cat.categoryIcon}</span>
								<span class="w-16 text-xs font-semibold text-[var(--color-text-primary)]">{cat.categoryName}</span>
								<div class="flex-1">
									<div class="h-3 overflow-hidden rounded-full bg-[var(--color-surface-secondary)]">
										<ProgressFill
											pct={progressPct(cat.totalXp, cat.level)}
											class="h-full rounded-full bg-[var(--color-feedback-info-border)] transition-all"
										/>
									</div>
								</div>
								<span class="w-12 text-right text-[10px] font-bold text-[var(--color-text-muted)]">Lv.{cat.level}</span>
								<span class="w-8 text-right text-[10px] text-[var(--color-text-tertiary)]">{cat.activityCount}回</span>
							</div>
						{/each}
					</div>
				</div>

				<div class="rounded-lg border-l-4 border-[var(--color-feedback-info-border)] bg-[var(--color-feedback-info-bg)] p-3">
					<p class="text-xs font-bold text-[var(--color-feedback-info-text)]">💡 アドバイス</p>
					<p class="mt-1 text-xs text-[var(--color-feedback-info-text)]">{report.advice.message}</p>
				</div>
			</div>
		</div>
	{/each}

	<DemoCta title="毎週の成長が見える！" description="お子さまの頑張りを週次レポートで確認しましょう" />
</div>
