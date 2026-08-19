<script lang="ts">
import type { CategoryId } from '$lib/domain/ids';
import { getCategoryById } from '$lib/domain/validation/activity';
import Progress from '$lib/ui/primitives/Progress.svelte';

interface Props {
	categoryId: CategoryId;
	value: number;
	maxValue?: number;
	level?: number;
	progressPct?: number;
	/**
	 * #4688 (F3): 親が「レベル称号カスタマイズ」で設定した称号。
	 * レベルアップの一瞬の演出だけでなく、つよさ画面に常設表示する (FAQ / 06-UI設計書 §「称号表示あり」)。
	 */
	levelTitle?: string;
}

let { categoryId, value, maxValue = 100, level, progressPct, levelTitle }: Props = $props();

const catDef = $derived(getCategoryById(categoryId));
const color = $derived(catDef?.color ?? 'var(--theme-primary)');
const categoryName = $derived(catDef?.name ?? '');
const displayPct = $derived(progressPct ?? (maxValue > 0 ? (value / maxValue) * 100 : 0));
</script>

<div class="flex items-center gap-[var(--sp-sm)]">
	<span class="w-24 shrink-0 truncate">
		<span class="block text-sm font-bold">{categoryName}</span>
		{#if levelTitle}
			<span class="block text-xs text-[var(--color-text-muted)] truncate" data-testid="status-level-title-{categoryId}">{levelTitle}</span>
		{/if}
	</span>
	<div class="flex-1">
		<Progress value={displayPct} max={100} {color} size="md" />
	</div>
	{#if level !== undefined}
		<span class="text-sm font-bold w-10 text-right">Lv.{level}</span>
	{:else}
		<span class="text-sm font-bold w-8 text-right">{Math.round(value)}</span>
	{/if}
</div>
