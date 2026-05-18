<!--
  MilestoneBellButton.svelte — #2168
  Header に配置する bell icon + dot badge。
  - 旧 MilestoneBanner.svelte の横長 alert を撤去し、Material 3 / NN/g / ABCmouse HUD 型の
    bell + dot badge に再構成 (画面占拠回避、Anti-engagement ADR-0012 整合)。
  - 未閲覧かつ達成済みのマイルストーン件数を badge 表示。0 件時は badge 非表示。
  - クリックで `/{uiMode}/challenges` に遷移し、その時点で全件「閲覧済み」を localStorage に記録。
  - localStorage パターン: `gq:milestone-seen:<childId>:<milestoneId>` (#1600 既存パターン継承)。
-->
<script lang="ts">
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { MILESTONE_LABELS } from '$lib/domain/labels';
import type { MilestoneId } from '$lib/server/services/value-preview-service';

interface MilestoneAchievement {
	id: MilestoneId;
	threshold: number;
	achieved: boolean;
	achievedAt: string | null;
}

interface Props {
	milestones: MilestoneAchievement[];
	childId: number;
	uiMode: string;
	/**
	 * #1893: LP screenshot 撮影時に強制表示 (1 件以上を未閲覧扱いに見せる)。通常運用では false。
	 */
	bypassSeenCheck?: boolean;
}

let { milestones, childId, uiMode, bypassSeenCheck = false }: Props = $props();

const STORAGE_KEY_PREFIX = 'gq:milestone-seen:';

function buildStorageKey(id: MilestoneId): string {
	return `${STORAGE_KEY_PREFIX}${childId}:${id}`;
}

function readSeen(id: MilestoneId): boolean {
	if (bypassSeenCheck) return false;
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
		// localStorage 利用不可 (プライベートブラウジング等) はサイレントに無視
	}
}

// 未閲覧かつ達成済みのマイルストーン件数 (badge 表示用)
// $derived は browser 起動後の localStorage 変化を再評価しないため、初回 mount 時の値で十分。
// (閉じる動作後は state を直接更新する)
let dismissedIds = $state<Set<MilestoneId>>(new Set());

const pendingCount = $derived.by(() => {
	let n = 0;
	for (const m of milestones) {
		if (!m.achieved) continue;
		if (dismissedIds.has(m.id)) continue;
		if (readSeen(m.id)) continue;
		n++;
	}
	return n;
});

function handleClick() {
	// 全ての未閲覧マイルストーンを「閲覧済み」として localStorage に記録
	for (const m of milestones) {
		if (!m.achieved) continue;
		if (readSeen(m.id)) continue;
		writeSeen(m.id);
	}
	// dismissedIds を local state にも反映 (即座に badge を消すため)
	const next = new Set(dismissedIds);
	for (const m of milestones) {
		if (m.achieved) next.add(m.id);
	}
	dismissedIds = next;
	// チャレンジ画面 (= 新着マイルストーンが累積する画面、MN-3 で履歴 tab 化予定) に遷移
	goto(`/${uiMode}/challenges`);
}
</script>

{#if pendingCount > 0}
	<button
		type="button"
		class="milestone-bell"
		data-testid="milestone-bell"
		data-pending-count={pendingCount}
		onclick={handleClick}
		aria-label={MILESTONE_LABELS.bellAriaLabel(pendingCount)}
	>
		<span class="milestone-bell__icon" aria-hidden="true">🔔</span>
		<span class="milestone-bell__badge" aria-hidden="true">{pendingCount}</span>
	</button>
{/if}

<style>
	.milestone-bell {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: rgba(255, 255, 255, 0.25);
		border: none;
		border-radius: 50%;
		color: white;
		cursor: pointer;
		transition: background 0.2s;
	}

	.milestone-bell:hover {
		background: rgba(255, 255, 255, 0.4);
	}

	.milestone-bell__icon {
		font-size: 0.95rem;
		line-height: 1;
	}

	.milestone-bell__badge {
		position: absolute;
		top: -2px;
		right: -2px;
		min-width: 16px;
		height: 16px;
		padding: 0 3px;
		background: var(--color-feedback-error-text, #dc2626);
		color: white;
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 16px;
		border-radius: 8px;
		border: 1.5px solid var(--theme-primary, #5ba3e6);
		text-align: center;
		box-sizing: border-box;
	}
</style>
