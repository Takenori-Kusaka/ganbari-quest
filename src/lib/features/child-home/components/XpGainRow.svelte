<script lang="ts">
/**
 * 記録結果ダイアログの「けいけんち」行。
 *
 * #4509 ①: 以前は増分を `+0.3` の固定リテラルで描画しており、実際に増えた経験値
 * (= 獲得ポイント、整数) と一致しない虚偽の数値を子供に見せていた。
 * 増分は必ず xpAfter - xpBefore から導出する。表示の唯一の出所を本 component に集約し、
 * 呼び出し側 (home/+page.svelte) が数値を組み立て直せないようにする。
 */
import { getCategoryDisplayName, getChildHomeLabels } from '$lib/domain/labels';
import { getCategoryById } from '$lib/domain/validation/activity';
import type { XpGainInfo } from '$lib/server/services/activity-log-service';

interface Props {
	xp: XpGainInfo;
	/** #4690 F6: 年齢モード。「けいけんち」/「経験値」の出し分けに使う (docs/DESIGN.md §8)。 */
	uiMode?: string;
}

let { xp, uiMode = 'preschool' }: Props = $props();

const HL = $derived(getChildHomeLabels(uiMode));

const catDef = $derived(getCategoryById(xp.categoryId));
const delta = $derived(xp.xpAfter - xp.xpBefore);
const deltaText = $derived(`${delta >= 0 ? '+' : '-'}${Math.abs(delta).toLocaleString('ja-JP')}`);
const leveledUp = $derived(xp.levelAfter > xp.levelBefore);
</script>

<div
	class="mt-1 text-center text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border-light)] pt-2 w-full"
	data-testid="result-xp-row"
>
	<span style:color={catDef?.color ?? 'inherit'}>{getCategoryDisplayName(xp.categoryId, uiMode) || xp.categoryName}</span>
	{HL.resultXpLabel}
	<span class="font-bold text-[var(--color-text)]" data-testid="result-xp-delta">{deltaText}</span>
	{#if leveledUp}
		<span
			class="font-bold text-[var(--color-feedback-warning-text)]"
			data-testid="result-xp-levelup">{HL.resultXpLevelUp(xp.levelAfter)}</span
		>
	{/if}
</div>
