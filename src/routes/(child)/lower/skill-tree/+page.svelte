<script lang="ts">
import SkillTreeView from '$lib/features/skill-tree/SkillTreeView.svelte';

let { data } = $props();

const child = $derived(data.child);
const skillTree = $derived(data.skillTree);
</script>

<div class="skill-tree-page">
	<h2 class="page-title">⚔️ スキルツリー</h2>
	<p class="page-desc">カテゴリレベルが上がるとSPがもらえるよ！SPをつかってスキルをかいほうしよう！</p>

	{#if skillTree && child}
		<SkillTreeView
			nodes={skillTree.nodes}
			bind:spBalance={skillTree.spBalance}
			spTotalEarned={skillTree.spTotalEarned}
			childId={child.id}
		/>
	{:else}
		<p class="no-data">スキルデータがありません</p>
	{/if}
</div>

<style>
	.skill-tree-page {
		padding: 0 var(--sp-md);
	}

	.page-title {
		font-size: 1.25rem;
		font-weight: 800;
		text-align: center;
		margin-bottom: var(--sp-xs);
	}

	.page-desc {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		text-align: center;
		margin-bottom: var(--sp-md);
	}

	.no-data {
		text-align: center;
		color: var(--color-text-muted);
		padding: var(--sp-xl);
	}
</style>
