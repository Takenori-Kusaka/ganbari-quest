<!--
  MonthlyValuePreview.svelte — ADR-0023 I9 (#1600) 親 dashboard 30 日プレビュー

  初月（30日以内）は「あと N 日後にこう見える」プレビュー、30 日以降は
  「1 か月の歩み」レポートとして同じコンポーネントで表示する。
  既存集計（value-preview-service）を流用、新規 DB スキーマ追加なし。

  Anti-engagement (ADR-0012) 準拠:
  - 過剰な祝福演出禁止、純粋な進捗の可視化のみ
  - インフィニットスクロール / 自動再生 / 通知連打禁止
-->
<script lang="ts">
import { MILESTONE_LABELS, VALUE_PREVIEW_LABELS } from '$lib/domain/labels';
import { getCategoryById } from '$lib/domain/validation/activity';
import type {
	ChildValuePreview,
	MilestoneId,
	TenantValuePreview,
} from '$lib/server/services/value-preview-service';
import Card from '$lib/ui/primitives/Card.svelte';

interface Props {
	preview: TenantValuePreview;
}

let { preview }: Props = $props();

const isFirstMonth = $derived(preview.isInFirstMonth);
const sectionTitle = $derived(
	isFirstMonth
		? VALUE_PREVIEW_LABELS.sectionTitleFirstMonth
		: VALUE_PREVIEW_LABELS.sectionTitle30DayPreview,
);
const sectionHint = $derived(
	isFirstMonth && preview.daysSinceTenantSignup !== null
		? VALUE_PREVIEW_LABELS.sectionHintFirstMonth(preview.daysSinceTenantSignup)
		: VALUE_PREVIEW_LABELS.sectionHint30DayPreview,
);

function getMilestoneTitle(id: MilestoneId): string {
	const map: Record<MilestoneId, { title: string }> = {
		first_record: MILESTONE_LABELS.first_record,
		records_5: MILESTONE_LABELS.records_5,
		records_10: MILESTONE_LABELS.records_10,
		streak_7: MILESTONE_LABELS.streak_7,
		streak_14: MILESTONE_LABELS.streak_14,
		streak_30: MILESTONE_LABELS.streak_30,
	};
	return map[id]?.title ?? id;
}

function getCategoryName(categoryId: number): string {
	return getCategoryById(categoryId)?.name ?? `#${categoryId}`;
}

function maxCategoryCount(child: ChildValuePreview): number {
	let max = 0;
	for (const c of child.categoryBreakdown) {
		if (c.count > max) max = c.count;
	}
	return Math.max(1, max);
}
</script>

{#if preview.previewEligible && preview.children.length > 0}
	<section data-testid="value-preview-section" class="value-preview">
		<div class="value-preview__header">
			<h2 class="value-preview__title">{sectionTitle}</h2>
			<p class="value-preview__hint">{sectionHint}</p>
		</div>

		<div class="value-preview__children">
			{#each preview.children as child (child.childId)}
				<Card variant="elevated" class="p-4">
					<p class="value-preview__child-name">{child.nickname}</p>

					<!-- KPI grid -->
					<div class="kpi-grid" role="group" aria-label={child.nickname}>
						<div class="kpi" data-testid="kpi-total-activities">
							<p class="kpi__label">{VALUE_PREVIEW_LABELS.totalActivitiesLabel}</p>
							<p class="kpi__value">{child.totalActivities}</p>
							<p class="kpi__unit">{VALUE_PREVIEW_LABELS.totalActivitiesUnit}</p>
						</div>
						<div class="kpi" data-testid="kpi-current-streak">
							<p class="kpi__label">{VALUE_PREVIEW_LABELS.currentStreakLabel}</p>
							<p class="kpi__value">{child.currentStreak}</p>
							<p class="kpi__unit">{VALUE_PREVIEW_LABELS.currentStreakUnit}</p>
						</div>
						<div class="kpi" data-testid="kpi-longest-streak">
							<p class="kpi__label">{VALUE_PREVIEW_LABELS.longestStreakLabel}</p>
							<p class="kpi__value">{child.longestStreak}</p>
							<p class="kpi__unit">{VALUE_PREVIEW_LABELS.currentStreakUnit}</p>
						</div>
						<div class="kpi" data-testid="kpi-total-points">
							<p class="kpi__label">{VALUE_PREVIEW_LABELS.totalPointsLabel}</p>
							<p class="kpi__value">{child.totalPoints}</p>
							<p class="kpi__unit">{VALUE_PREVIEW_LABELS.totalPointsUnit}</p>
						</div>
					</div>

					<!-- Achieved milestones -->
					<div class="milestones">
						<h3 class="milestones__heading">{VALUE_PREVIEW_LABELS.achievedMilestonesHeading}</h3>
						{#if child.milestones.some((m) => m.achieved)}
							<ul class="milestones__list" data-testid="achieved-milestones">
								{#each child.milestones.filter((m) => m.achieved) as ms (ms.id)}
									<li class="milestones__item">
										<span class="milestones__check" aria-hidden="true">✓</span>
										<span>{getMilestoneTitle(ms.id)}</span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="milestones__empty">{VALUE_PREVIEW_LABELS.noMilestonesYet}</p>
						{/if}
					</div>

					<!-- Category breakdown bar chart -->
					<div class="categories">
						<h3 class="categories__heading">{VALUE_PREVIEW_LABELS.categoryBreakdownHeading}</h3>
						{#if child.categoryBreakdown.length > 0}
							{@const maxCount = maxCategoryCount(child)}
							<ul class="categories__list" data-testid="category-breakdown">
								{#each child.categoryBreakdown as cat}
									<li class="categories__item">
										<span class="categories__name">{getCategoryName(cat.categoryId)}</span>
										<span class="categories__bar-wrap" aria-hidden="true">
											<span
												class="categories__bar"
												style:width="{(cat.count / maxCount) * 100}%"
											></span>
										</span>
										<span
											class="categories__count"
											aria-label={VALUE_PREVIEW_LABELS.categoryCountAria(
												getCategoryName(cat.categoryId),
												cat.count,
											)}
										>
											{cat.count} {VALUE_PREVIEW_LABELS.totalActivitiesUnit}
										</span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="categories__empty">{VALUE_PREVIEW_LABELS.noCategoryData}</p>
						{/if}
					</div>

					{#if isFirstMonth}
						<p class="value-preview__hint-row">{VALUE_PREVIEW_LABELS.previewBannerHint}</p>
					{/if}
				</Card>
			{/each}
		</div>
	</section>
{/if}

<style>
	.value-preview {
		display: block;
	}

	.value-preview__header {
		margin-bottom: 0.75rem;
	}

	.value-preview__title {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0 0 0.2rem;
	}

	.value-preview__hint {
		font-size: 0.8rem;
		color: var(--color-text-tertiary);
		margin: 0;
	}

	.value-preview__children {
		display: grid;
		gap: 0.75rem;
	}

	.value-preview__child-name {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0 0 0.65rem;
	}

	.kpi-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
		margin-bottom: 0.85rem;
	}

	@media (min-width: 480px) {
		.kpi-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.kpi {
		background: var(--color-surface-muted);
		border-radius: 8px;
		padding: 0.5rem;
		text-align: center;
	}

	.kpi__label {
		font-size: 0.65rem;
		color: var(--color-text-tertiary);
		margin: 0 0 0.1rem;
	}

	.kpi__value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0;
	}

	.kpi__unit {
		font-size: 0.65rem;
		color: var(--color-text-tertiary);
		margin: 0;
	}

	.milestones {
		margin-bottom: 0.85rem;
	}

	.milestones__heading,
	.categories__heading {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-text-secondary);
		margin: 0 0 0.4rem;
	}

	.milestones__list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.milestones__item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.55rem;
		background: var(--color-feedback-success-bg);
		color: var(--color-feedback-success-text);
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.milestones__check {
		font-weight: 700;
	}

	.milestones__empty,
	.categories__empty {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		margin: 0;
	}

	.categories__list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}

	.categories__item {
		display: grid;
		grid-template-columns: 5rem 1fr 3.5rem;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}

	.categories__name {
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.categories__bar-wrap {
		display: block;
		height: 8px;
		background: var(--color-surface-muted);
		border-radius: 9999px;
		overflow: hidden;
	}

	.categories__bar {
		display: block;
		height: 100%;
		background: var(--color-action-primary);
		border-radius: 9999px;
		min-width: 4px;
		transition: width 0.4s ease;
	}

	.categories__count {
		font-weight: 600;
		color: var(--color-text-primary);
		text-align: right;
	}

	.value-preview__hint-row {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
		margin: 0.5rem 0 0;
		text-align: right;
	}
</style>
