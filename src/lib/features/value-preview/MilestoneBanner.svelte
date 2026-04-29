<!--
  MilestoneBanner.svelte — ADR-0023 I9 (#1600) 子供 UI マイルストーン演出

  ADR-0012 (Anti-engagement) 準拠:
  - 過剰な祝福を行わない（紙吹雪・連続演出・自動再生 BGM 等は禁止）
  - 3 秒以内に閉じられる UI（明示的な × ボタン）
  - 滞在時間延伸 UI ではなく純粋なフィードバック

  最も新しい未達成→達成済みのマイルストーン 1 件のみ表示する。
  localStorage で「閲覧済み」を記録して再表示しない。
-->
<script lang="ts">
import { browser } from '$app/environment';
import { MILESTONE_LABELS } from '$lib/domain/labels';
import type { MilestoneId } from '$lib/server/services/value-preview-service';
import IconButton from '$lib/ui/primitives/IconButton.svelte';

interface MilestoneAchievement {
	id: MilestoneId;
	threshold: number;
	achieved: boolean;
	achievedAt: string | null;
}

interface Props {
	milestones: MilestoneAchievement[];
	childId: number;
}

let { milestones, childId }: Props = $props();

const STORAGE_KEY_PREFIX = 'gq:milestone-seen:';

function buildStorageKey(id: MilestoneId): string {
	return `${STORAGE_KEY_PREFIX}${childId}:${id}`;
}

function readSeen(id: MilestoneId): boolean {
	if (!browser) return false;
	try {
		return window.localStorage.getItem(buildStorageKey(id)) === '1';
	} catch {
		return false;
	}
}

function writeSeen(id: MilestoneId): void {
	if (!browser) return;
	try {
		window.localStorage.setItem(buildStorageKey(id), '1');
	} catch {
		// localStorage 利用不可（プライベートブラウジング等）はサイレントに無視
	}
}

// 未閲覧かつ達成済みのマイルストーンを 1 件だけ表示
const pendingMilestone = $derived.by(() => {
	for (const m of milestones) {
		if (!m.achieved) continue;
		if (readSeen(m.id)) continue;
		return m;
	}
	return null;
});

let dismissed = $state(false);

function getLabelEntry(id: MilestoneId): { title: string; description: string } | null {
	const map: Record<MilestoneId, { title: string; description: string }> = {
		first_record: MILESTONE_LABELS.first_record,
		records_5: MILESTONE_LABELS.records_5,
		records_10: MILESTONE_LABELS.records_10,
		streak_7: MILESTONE_LABELS.streak_7,
		streak_14: MILESTONE_LABELS.streak_14,
		streak_30: MILESTONE_LABELS.streak_30,
	};
	return map[id] ?? null;
}

function handleDismiss() {
	if (pendingMilestone) {
		writeSeen(pendingMilestone.id);
	}
	dismissed = true;
}
</script>

{#if pendingMilestone && !dismissed}
	{@const entry = getLabelEntry(pendingMilestone.id)}
	{#if entry}
		<div
			class="milestone-banner"
			role="status"
			aria-live="polite"
			data-testid="milestone-banner"
			data-milestone-id={pendingMilestone.id}
		>
			<div class="milestone-banner__content">
				<p class="milestone-banner__heading">{MILESTONE_LABELS.bannerTitle}</p>
				<p class="milestone-banner__title">{entry.title}</p>
				<p class="milestone-banner__description">{entry.description}</p>
			</div>
			<IconButton
				size="sm"
				label={MILESTONE_LABELS.bannerCloseLabel}
				onclick={handleDismiss}
			>
				<span aria-hidden="true">×</span>
			</IconButton>
		</div>
	{/if}
{/if}

<style>
	.milestone-banner {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		margin: 0.5rem 0;
		background: var(--color-feedback-success-bg);
		border: 1px solid var(--color-feedback-success-border);
		border-radius: 12px;
		color: var(--color-feedback-success-text);
		/* Anti-engagement (ADR-0012): minimal fade-in only, no auto-dismiss */
		animation: milestone-fade-in 0.2s ease-out;
	}

	.milestone-banner__content {
		flex: 1;
		min-width: 0;
	}

	.milestone-banner__heading {
		font-size: 0.7rem;
		font-weight: 600;
		opacity: 0.75;
		margin: 0 0 0.15rem;
		letter-spacing: 0.05em;
	}

	.milestone-banner__title {
		font-size: 1rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.milestone-banner__description {
		font-size: 0.8rem;
		margin: 0;
		opacity: 0.85;
	}

	@keyframes milestone-fade-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.milestone-banner {
			animation: none;
		}
	}
</style>
