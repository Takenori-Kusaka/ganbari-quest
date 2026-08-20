<script lang="ts">
import { goto } from '$app/navigation';
import {
	jstDateOfEpochSeconds,
	jstDateOfIso,
	jstDayOfWeek,
	toJSTDateString,
} from '$lib/domain/date-utils';
import { asCategoryId } from '$lib/domain/ids';
import { APP_LABELS, getMilestoneLabel, UI_LABELS } from '$lib/domain/labels';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import { getCategoryById } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { getModeVariant } from '$lib/features/child-home/variants';
import Card from '$lib/ui/primitives/Card.svelte';
import Tabs from '$lib/ui/primitives/Tabs.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

// #2170: achievement 期間表示の区切り文字 (ESLint local/no-hardcoded-jp-text 回避のため定数化、
// 単独「〜」記号は UI 言語非依存セパレータだが ESLint regex で JP 判定されるため抽出)
const ACHIEVEMENT_DATE_SEP = '〜'; // 〜 (U+301C WAVE DASH)

const uiMode = $derived((data.uiMode ?? 'preschool') as UiMode);
const t = $derived(getModeVariant(uiMode).text);

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

// #2170: 外側タブ = データ種別 (4 種)、内側タブ = 期間 (3 種、活動のみ)
const kindTabs = $derived([
	{ value: 'activities', label: t.historyKindActivities },
	{ value: 'achievements', label: t.historyKindAchievements },
	{ value: 'purchases', label: t.historyKindPurchases },
	{ value: 'milestones', label: t.historyKindMilestones },
]);

const periodTabs = $derived([
	{ value: 'today', label: t.historyTabToday },
	{ value: 'week', label: t.historyTabWeek },
	{ value: 'month', label: t.historyTabMonth },
]);

function handleKindChange(details: { value: string }) {
	soundService.play('tap');
	const search = new URLSearchParams();
	search.set('kind', details.value);
	if (data.period && details.value === 'activities') {
		search.set('period', data.period);
	}
	goto(`?${search.toString()}`, { replaceState: true, keepFocus: true });
}

function handlePeriodChange(details: { value: string }) {
	soundService.play('tap');
	const search = new URLSearchParams();
	search.set('kind', 'activities');
	search.set('period', details.value);
	goto(`?${search.toString()}`, { replaceState: true, keepFocus: true });
}

const logsByDate = $derived(() => {
	const groups: Record<string, typeof data.logs> = {};
	for (const log of data.logs) {
		const date = jstDateOfIso(log.recordedAt);
		if (!groups[date]) groups[date] = [];
		groups[date]?.push(log);
	}
	return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
});

function formatDate(dateStr: string): string {
	// 暦要素は文字列 / JST SSOT から取る (ローカル getter は runtime TZ 依存、#4127)
	const [, m, dd] = dateStr.split('-').map(Number);
	const month = m ?? 0;
	const day = dd ?? 0;
	const weekday = t.weekdays[jstDayOfWeek(new Date(`${dateStr}T00:00:00Z`))];
	// #4509 ⑥: 年齢帯は uiMode 由来の variant からのみ導出する
	// (旧実装は `t.historyCountUnit === 'かい'` という別ラベルの値をプロキシにしていた)
	return `${month}${t.dateMonthSuffix}${day}${t.dateDaySuffix}（${weekday}）`;
}

/**
 * #4632: 引数は **epoch 秒** (DB 格納値)。旧実装は `new Date(unix)` で秒を **ミリ秒**として
 * 解釈しており、交換履歴の日付が全件 1970 年 (「1月22日（木）」) になっていた。
 * 秒 / ミリ秒の取り違えを名前で防ぐため、変換は date-utils の専用関数に閉じる。
 */
function formatEpochSecondsDate(epochSeconds: number): string {
	return formatDate(jstDateOfEpochSeconds(epochSeconds));
}

function purchaseStatusLabel(status: string): string {
	switch (status) {
		case 'approved':
			return t.historyPurchaseStatusApproved;
		case 'rejected':
			return t.historyPurchaseStatusRejected;
		case 'pending_parent_approval':
			return t.historyPurchaseStatusPending;
		case 'expired':
			return t.historyPurchaseStatusExpired;
		default:
			return status;
	}
}

function purchaseStatusTone(status: string): string {
	switch (status) {
		case 'approved':
			return 'feedback-success';
		case 'rejected':
			return 'feedback-error';
		case 'pending_parent_approval':
			return 'feedback-warning';
		default:
			return 'text-muted';
	}
}
</script>

<svelte:head>
	<title>{t.historyTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	<!-- #2170: 外側タブ = データ種別 4 種 (活動 / 達成 / 交換 / 記念) -->
	<!-- ArkTabs.Content は全パネルを mount するため、snippet param `kindValue` で
	     パネルごとの分岐を行う (data.kind での分岐は SSR 時に 4 パネル全てが同一内容になり
	     `tab-today` 等のテストid 重複を引き起こす — Tabs primitive 仕様、PR-2237 #2170 fix) -->
	<Tabs items={kindTabs} value={data.kind} onValueChange={handleKindChange}>
		{#snippet children(kindValue)}
			{#if kindValue === 'activities'}
				<!-- 活動タブ: 既存の期間タブ + 活動ログリスト -->
				<div class="mb-[var(--sp-sm)]">
					<Tabs items={periodTabs} value={data.period} onValueChange={handlePeriodChange}>
						{#snippet children(_pv)}
							<Card variant="elevated" padding="md" class="mb-[var(--sp-md)]">
								{#snippet children()}
									<div class="flex justify-between items-center mb-[var(--sp-sm)]">
										<span class="text-sm text-[var(--color-text-muted)]">{t.historyTotalLabel}</span>
										<span class="font-bold text-lg">{data.summary.totalCount}{t.historyCountUnit}</span>
									</div>
									<div class="flex justify-between items-center">
										<span class="text-sm text-[var(--color-text-muted)]">{UI_LABELS.points}</span>
										<span class="font-bold text-lg text-[var(--color-point)]">{fmtBal(data.summary.totalPoints)}</span>
									</div>
									{#if Object.keys(data.summary.byCategory).length > 0}
										<div class="flex flex-wrap gap-[var(--sp-xs)] mt-[var(--sp-sm)]">
											{#each Object.entries(data.summary.byCategory) as [cat, info]}
												<span
													class="text-xs px-2 py-1 rounded-[var(--radius-full)] text-white font-bold"
													style:background-color={getCategoryById(asCategoryId(cat))?.color ?? 'var(--theme-primary)'}
												>
													{getCategoryById(asCategoryId(cat))?.name ?? cat} {info.count}{t.historyCountUnit}
												</span>
											{/each}
										</div>
									{/if}
								{/snippet}
							</Card>

							{#if data.logs.length === 0}
								<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
									<span class="text-4xl mb-[var(--sp-sm)]">📝</span>
									<p class="font-bold">{t.historyEmpty}</p>
								</div>
							{:else}
								{#each logsByDate() as [date, logs] (date)}
									<div class="mb-[var(--sp-md)]">
										<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-xs)]">
											{formatDate(date)}
										</h3>
										<div class="flex flex-col gap-[var(--sp-xs)]">
											{#each logs as log (log.id)}
												<div class="flex items-center gap-[var(--sp-sm)] bg-white rounded-[var(--radius-sm)] px-[var(--sp-sm)] py-[var(--sp-xs)] shadow-sm">
													<span class="text-2xl">{log.activityIcon}</span>
													<div class="flex-1 min-w-0">
														<p class="text-sm font-bold truncate">{log.activityName}</p>
														<p class="text-xs text-[var(--color-text-muted)]">
															<span
																class="inline-block w-2 h-2 rounded-[var(--radius-full)] mr-1"
																style:background-color={getCategoryById(log.categoryId)?.color ?? 'var(--theme-primary)'}
															></span>
															{getCategoryById(log.categoryId)?.name ?? ""}
														</p>
													</div>
													<div class="text-right shrink-0">
														<p class="text-sm font-bold text-[var(--color-point)]">{fmtPts(log.points + log.streakBonus)}</p>
														{#if log.streakDays >= 2}
															<p class="text-xs text-[var(--theme-accent)]">{log.streakDays}{t.historyStreakSuffix}</p>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									</div>
								{/each}
							{/if}
						{/snippet}
					</Tabs>
				</div>
			{:else if kindValue === 'achievements'}
				<!-- 達成タブ: チャレンジ達成履歴 -->
				{#if data.achievements.length === 0}
					<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]" data-testid="history-empty-achievements">
						<span class="text-4xl mb-[var(--sp-sm)]">🏆</span>
						<p class="font-bold">{t.historyEmptyAchievements}</p>
					</div>
				{:else}
					<div class="flex flex-col gap-[var(--sp-sm)]" data-testid="history-list-achievements">
						{#each data.achievements as a (a.id)}
							<div class="flex items-center gap-[var(--sp-sm)] bg-white rounded-[var(--radius-sm)] px-[var(--sp-sm)] py-[var(--sp-sm)] shadow-sm">
								<span class="text-2xl">🤝</span>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-bold truncate">{a.title}</p>
									<p class="text-xs text-[var(--color-text-muted)]">
										{a.startDate}{' '}{ACHIEVEMENT_DATE_SEP}{' '}{a.endDate}
									</p>
								</div>
								<div class="text-right shrink-0">
									<p
										class="text-xs font-bold"
										class:text-success={a.completed}
										class:text-muted={!a.completed}
									>
										{a.completed ? t.historyAchievementCompleted : t.historyAchievementOngoing}
									</p>
									<p class="text-xs text-[var(--color-text-muted)]">{a.currentValue}/{a.targetValue}</p>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else if kindValue === 'purchases'}
				<!-- 交換タブ: ごほうびショップ申請履歴 -->
				{#if data.purchases.length === 0}
					<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]" data-testid="history-empty-purchases">
						<span class="text-4xl mb-[var(--sp-sm)]">🎁</span>
						<p class="font-bold">{t.historyEmptyPurchases}</p>
					</div>
				{:else}
					<div class="flex flex-col gap-[var(--sp-sm)]" data-testid="history-list-purchases">
						{#each data.purchases as p (p.id)}
							<!-- #4632: 申請時点 snapshot でごほうびを特定できるようにする
							     (旧実装は日付をタイトル代わりに出し、アイコンは 🎁 固定だった) -->
							<div
								class="flex items-center gap-[var(--sp-sm)] bg-white rounded-[var(--radius-sm)] px-[var(--sp-sm)] py-[var(--sp-sm)] shadow-sm"
								data-testid="history-purchase-{p.id}"
							>
								<span class="text-2xl">{p.rewardIcon ?? '🎁'}</span>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-bold truncate" data-testid="history-purchase-title-{p.id}">
										{p.rewardTitle ?? t.historyPurchaseUnknownReward}{p.quantity > 1
											? ` ×${p.quantity}`
											: ''}
									</p>
									<p class="text-xs text-[var(--color-text-muted)]">
										{formatEpochSecondsDate(p.requestedAt)}
									</p>
									{#if p.parentNote}
										<p class="text-xs text-[var(--color-text-muted)] truncate">{p.parentNote}</p>
									{/if}
								</div>
								<div class="text-right shrink-0">
									<!-- #4632: ポイントが実際に引かれたのは **承認されたときだけ**
									     (控除は finalizeApproval の spendPointsAtomic 1 箇所)。
									     却下 / 期限切れ / 承認待ちの行に「-100P」を出すと、引かれていない
									     ポイントが引かれたように読め、台帳と食い違う -->
									{#if p.status === 'approved' && p.rewardPoints !== null}
										<p class="text-sm font-bold" data-testid="history-purchase-points-{p.id}">
											{fmtPts(-p.rewardPoints * p.quantity)}
										</p>
									{/if}
									<span
										class="inline-block text-xs px-2 py-1 rounded-[var(--radius-full)] font-bold"
										data-status-tone={purchaseStatusTone(p.status)}
									>
										{purchaseStatusLabel(p.status)}
									</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else if kindValue === 'milestones'}
				<!-- 記念タブ: マイルストーン達成履歴 (#2169 年齢別 variant) -->
				{#if data.milestones.length === 0}
					<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]" data-testid="history-empty-milestones">
						<span class="text-4xl mb-[var(--sp-sm)]">🌟</span>
						<p class="font-bold">{t.historyEmptyMilestones}</p>
					</div>
				{:else}
					<div class="flex flex-col gap-[var(--sp-sm)]" data-testid="history-list-milestones">
						{#each data.milestones as m (m.id)}
							{@const entry = getMilestoneLabel(m.id, { ageTier: uiMode })}
							<div class="flex items-center gap-[var(--sp-sm)] bg-white rounded-[var(--radius-sm)] px-[var(--sp-sm)] py-[var(--sp-sm)] shadow-sm">
								<span class="text-2xl">🌟</span>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-bold truncate">{entry.title}</p>
									<p class="text-xs text-[var(--color-text-muted)] truncate">{entry.description}</p>
								</div>
								{#if m.achievedAt}
									<div class="text-right shrink-0">
										<p class="text-xs text-[var(--color-text-muted)]">{m.achievedAt}</p>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		{/snippet}
	</Tabs>
</div>

<style>
	.text-success {
		color: var(--color-feedback-success-text);
	}
	.text-muted {
		color: var(--color-text-muted);
	}
	[data-status-tone='feedback-success'] {
		background: var(--color-feedback-success-bg);
		color: var(--color-feedback-success-text);
	}
	[data-status-tone='feedback-error'] {
		background: var(--color-feedback-error-bg);
		color: var(--color-feedback-error-text);
	}
	[data-status-tone='feedback-warning'] {
		background: var(--color-feedback-warning-bg);
		color: var(--color-feedback-warning-text);
	}
	[data-status-tone='text-muted'] {
		background: var(--color-surface-muted);
		color: var(--color-text-muted);
	}
</style>
