<script lang="ts">
import type { CategoryId } from '$lib/domain/ids';
import { getCategoryDisplayName } from '$lib/domain/labels';
import { getCategoryById } from '$lib/domain/validation/activity';
import Progress from '$lib/ui/primitives/Progress.svelte';

interface Props {
	categoryId: CategoryId;
	value: number;
	maxValue?: number;
	level?: number;
	progressPct?: number;
	/** #4690 F5: 年齢モード。カテゴリ名の表記（ひらがな / 漢字）を決める。 */
	uiMode?: string;
}

let {
	categoryId,
	value,
	maxValue = 100,
	level,
	progressPct,
	uiMode = 'preschool',
}: Props = $props();

const catDef = $derived(getCategoryById(categoryId));
const color = $derived(catDef?.color ?? 'var(--theme-primary)');
// #4690 F5: レーダー直下の一覧だけひらがな固定にすると同一画面で文体が割れる (docs/DESIGN.md §8)。
const categoryName = $derived(getCategoryDisplayName(categoryId, uiMode) || (catDef?.name ?? ''));
const displayPct = $derived(progressPct ?? (maxValue > 0 ? (value / maxValue) * 100 : 0));
</script>

<div class="flex items-center gap-[var(--sp-sm)]">
	<span class="w-24 text-sm font-bold shrink-0 truncate">{categoryName}</span>
	<div class="flex-1">
		<Progress value={displayPct} max={100} {color} size="md" />
	</div>
	{#if level !== undefined}
		<span class="text-sm font-bold w-10 text-right">Lv.{level}</span>
	{:else}
		<span class="text-sm font-bold w-8 text-right">{Math.round(value)}</span>
	{/if}
</div>
