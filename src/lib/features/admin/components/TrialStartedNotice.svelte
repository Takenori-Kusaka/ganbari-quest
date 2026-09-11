<script lang="ts">
// src/lib/features/admin/components/TrialStartedNotice.svelte
//
// 申込経路から**自動で開始した**無料体験を、着地した直後に 1 度だけ告げる
// (PO 決裁 2026-09-10 決定 3(a))。
//
// 告げない状態が何を起こすか: 顧客は自分で開始した覚えが無いまま体験が進み、
// あとで「無料体験を始める」を押して「すでに使用済みです」に当たる。
// 1 世帯 1 回きりの体験なので、これは取り返しがつかない。
//
// 終了日は **その日いっぱい使える最後の日**を出す
// (有効判定は `isTrialEndDateActiveJST` の `trialEndDate >= 今日` = 当日を含む)。

import { TRIAL_LABELS } from '$lib/domain/labels';

interface Props {
	/** 表示用に整形済みの終了日 (例: 2026年9月17日)。null なら何も描かない */
	endDate: string | null;
}

let { endDate }: Props = $props();
</script>

{#if endDate}
	<div
		class="mb-4 rounded-[var(--radius-lg)] border border-[var(--color-feedback-success-border)] bg-[var(--color-feedback-success-bg)] px-4 py-3"
		role="status"
		data-testid="trial-started-notice"
	>
		<p class="m-0 text-sm font-bold text-[var(--color-feedback-success-text)]">
			{TRIAL_LABELS.startedNotice(endDate)}
		</p>
	</div>
{/if}
