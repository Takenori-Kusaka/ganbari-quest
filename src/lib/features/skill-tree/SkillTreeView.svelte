<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface SkillNodeView {
	id: number;
	categoryId: number | null;
	name: string;
	description: string | null;
	icon: string;
	sortOrder: number;
	spCost: number;
	requiredNodeId: number | null;
	requiredCategoryLevel: number;
	effectType: string;
	effectValue: number;
	unlocked: boolean;
	canUnlock: boolean;
	unlockReason?: string;
}

interface Props {
	nodes: SkillNodeView[];
	spBalance: number;
	spTotalEarned: number;
	childId: number;
	detailed?: boolean;
}

let { nodes, spBalance = $bindable(), spTotalEarned, childId, detailed = false }: Props = $props();

let confirmOpen = $state(false);
let selectedNode = $state<SkillNodeView | null>(null);
let unlocking = $state(false);
let justUnlocked = $state<number | null>(null);

// Group nodes by category
const categoryGroups = $derived(() => {
	const groups: {
		categoryId: number | null;
		name: string;
		icon: string;
		color: string;
		nodes: SkillNodeView[];
	}[] = [];

	for (const cat of CATEGORY_DEFS) {
		const catNodes = nodes
			.filter((n) => n.categoryId === cat.id)
			.sort((a, b) => a.sortOrder - b.sortOrder);
		if (catNodes.length > 0) {
			groups.push({
				categoryId: cat.id,
				name: cat.name,
				icon: cat.icon,
				color: cat.color,
				nodes: catNodes,
			});
		}
	}

	// Balance nodes (categoryId === null)
	const balanceNodes = nodes
		.filter((n) => n.categoryId === null)
		.sort((a, b) => a.sortOrder - b.sortOrder);
	if (balanceNodes.length > 0) {
		groups.push({
			categoryId: null,
			name: 'バランス',
			icon: '🌈',
			color: '#8B5CF6',
			nodes: balanceNodes,
		});
	}

	return groups;
});

function openConfirm(node: SkillNodeView) {
	if (!node.canUnlock) return;
	selectedNode = node;
	confirmOpen = true;
}

async function handleUnlock() {
	if (!selectedNode || unlocking) return;
	unlocking = true;

	try {
		const res = await fetch(`/api/v1/skill-nodes/${selectedNode.id}/unlock`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ childId }),
		});

		if (res.ok) {
			const data = await res.json();
			justUnlocked = selectedNode.id;
			spBalance -= selectedNode.spCost;
			soundService.play('level-up');

			// Update node state locally
			const unlockId = selectedNode.id;
			const idx = nodes.findIndex((n) => n.id === unlockId);
			const existing = idx >= 0 ? nodes[idx] : undefined;
			if (existing) {
				nodes[idx] = { ...existing, unlocked: true, canUnlock: false };
			}

			// Re-evaluate canUnlock for dependent nodes
			for (const node of nodes) {
				if (node.requiredNodeId === selectedNode.id && !node.unlocked) {
					// Simplified: just mark the prerequisite as potentially met
					// Full re-evaluation would need server round-trip
				}
			}

			setTimeout(() => {
				justUnlocked = null;
			}, 1500);
		}
	} finally {
		unlocking = false;
		confirmOpen = false;
		selectedNode = null;
	}
}

function getReasonText(reason?: string): string {
	switch (reason) {
		case 'PREREQUISITE_NOT_MET':
			return 'まえのスキルをさきにかいほうしてね';
		case 'INSUFFICIENT_SP':
			return 'SPがたりないよ';
		case 'CATEGORY_LEVEL_NOT_MET':
			return 'カテゴリレベルがたりないよ';
		case 'ALREADY_UNLOCKED':
			return '';
		default:
			return '';
	}
}

function getEffectText(node: SkillNodeView): string {
	if (!detailed) return '';
	switch (node.effectType) {
		case 'xp_multiplier':
			return `XP +${Math.round(node.effectValue * 100)}%`;
		case 'point_bonus':
			return `ポイント +${node.effectValue}`;
		case 'streak_shield':
			return 'ストリーク保護';
		case 'combo_bonus':
			return `コンボ +${Math.round(node.effectValue * 100)}%`;
		case 'login_bonus':
			return `ログインボーナス +${node.effectValue}pt`;
		case 'global_xp_multiplier':
			return `全XP +${Math.round(node.effectValue * 100)}%`;
		default:
			return '';
	}
}
</script>

<div class="skill-tree">
	<div class="sp-header">
		<span class="sp-icon">💎</span>
		<span class="sp-label">スキルポイント</span>
		<span class="sp-value">{spBalance} SP</span>
		{#if detailed}
			<span class="sp-total">（合計 {spTotalEarned} SP獲得済み）</span>
		{/if}
	</div>

	{#each categoryGroups() as group}
		<div class="category-section" style="--cat-color: {group.color}">
			<h3 class="category-title">
				<span class="category-icon">{group.icon}</span>
				{group.name}のスキル
			</h3>

			<div class="node-chain">
				{#each group.nodes as node, i}
					{#if i > 0}
						<div class="chain-arrow" class:unlocked={node.unlocked || group.nodes[i - 1]?.unlocked}>→</div>
					{/if}
					<button
						class="skill-node"
						class:unlocked={node.unlocked}
						class:can-unlock={node.canUnlock}
						class:locked={!node.unlocked && !node.canUnlock}
						class:just-unlocked={justUnlocked === node.id}
						onclick={() => openConfirm(node)}
						disabled={!node.canUnlock}
						data-testid="skill-node-{node.id}"
					>
						<span class="node-icon">{node.unlocked ? node.icon : node.canUnlock ? node.icon : '🔒'}</span>
						<span class="node-name">{node.name}</span>
						{#if node.unlocked}
							<span class="node-badge unlocked-badge">✅</span>
						{:else}
							<span class="node-cost">{node.spCost} SP</span>
						{/if}
						{#if detailed && node.unlocked}
							<span class="node-effect">{getEffectText(node)}</span>
						{/if}
						{#if !node.unlocked && !node.canUnlock}
							<span class="node-reason">{getReasonText(node.unlockReason)}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>

<Dialog bind:open={confirmOpen} title="スキルかいほう" closable>
	{#if selectedNode}
		<div class="confirm-content">
			<div class="confirm-icon">{selectedNode.icon}</div>
			<p class="confirm-name">{selectedNode.name}</p>
			{#if selectedNode.description}
				<p class="confirm-desc">{selectedNode.description}</p>
			{/if}
			{#if detailed}
				<p class="confirm-effect">{getEffectText(selectedNode)}</p>
			{/if}
			<p class="confirm-cost">
				💎 {selectedNode.spCost} SP つかうよ
				<span class="confirm-remaining">（のこり {spBalance - selectedNode.spCost} SP）</span>
			</p>
			<div class="confirm-actions">
				<button class="tap-target btn-cancel" onclick={() => { confirmOpen = false; }}>やめる</button>
				<button class="tap-target btn-confirm" onclick={handleUnlock} disabled={unlocking}>
					{unlocking ? 'かいほう中...' : 'かいほうする！'}
				</button>
			</div>
		</div>
	{/if}
</Dialog>

<style>
	.skill-tree {
		display: flex;
		flex-direction: column;
		gap: var(--sp-lg);
		padding: var(--sp-md);
	}

	.sp-header {
		display: flex;
		align-items: center;
		gap: var(--sp-sm);
		padding: var(--sp-md);
		background: linear-gradient(135deg, #ede9fe, #ddd6fe);
		border-radius: var(--radius-md);
		flex-wrap: wrap;
	}

	.sp-icon { font-size: 1.5rem; }
	.sp-label { font-weight: 600; color: var(--color-text-muted); }
	.sp-value { font-size: 1.5rem; font-weight: 800; color: #7c3aed; }
	.sp-total { font-size: 0.75rem; color: var(--color-text-muted); }

	.category-section {
		background: var(--color-surface);
		border-radius: var(--radius-md);
		padding: var(--sp-md);
		border-left: 4px solid var(--cat-color, var(--color-border));
	}

	.category-title {
		font-size: 1rem;
		font-weight: 700;
		margin-bottom: var(--sp-sm);
		display: flex;
		align-items: center;
		gap: var(--sp-xs);
	}

	.category-icon { font-size: 1.25rem; }

	.node-chain {
		display: flex;
		align-items: center;
		gap: var(--sp-xs);
		overflow-x: auto;
		padding: var(--sp-sm) 0;
	}

	.chain-arrow {
		color: var(--color-text-muted);
		font-size: 1.25rem;
		flex-shrink: 0;
		opacity: 0.4;
	}
	.chain-arrow.unlocked { opacity: 1; color: var(--cat-color); }

	.skill-node {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--sp-sm) var(--sp-md);
		border-radius: var(--radius-md);
		border: 2px solid var(--color-border);
		background: var(--color-bg);
		min-width: 5.5rem;
		flex-shrink: 0;
		cursor: default;
		transition: all 0.2s ease;
		position: relative;
	}

	.skill-node.unlocked {
		border-color: var(--cat-color);
		background: linear-gradient(135deg, rgba(var(--cat-color), 0.05), rgba(var(--cat-color), 0.1));
		box-shadow: 0 0 8px rgba(0, 0, 0, 0.05);
	}

	.skill-node.can-unlock {
		border-color: #a78bfa;
		cursor: pointer;
		animation: pulse-border 2s ease-in-out infinite;
	}

	.skill-node.can-unlock:active {
		transform: scale(0.95);
	}

	.skill-node.locked {
		opacity: 0.5;
	}

	.skill-node.just-unlocked {
		animation: unlock-pop 0.6s ease-out;
		border-color: #fbbf24;
		box-shadow: 0 0 20px rgba(251, 191, 36, 0.4);
	}

	@keyframes pulse-border {
		0%, 100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.4); }
		50% { box-shadow: 0 0 0 4px rgba(167, 139, 250, 0.2); }
	}

	@keyframes unlock-pop {
		0% { transform: scale(1); }
		30% { transform: scale(1.15); }
		60% { transform: scale(0.95); }
		100% { transform: scale(1); }
	}

	.node-icon { font-size: 1.75rem; }
	.node-name { font-size: 0.75rem; font-weight: 600; text-align: center; line-height: 1.2; }
	.node-badge { font-size: 0.875rem; }
	.node-cost { font-size: 0.625rem; color: #7c3aed; font-weight: 700; }
	.node-effect { font-size: 0.625rem; color: var(--color-text-muted); }
	.node-reason { font-size: 0.5rem; color: var(--color-text-muted); text-align: center; line-height: 1.2; }

	/* Confirm dialog */
	.confirm-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-sm);
		padding: var(--sp-md);
		text-align: center;
	}

	.confirm-icon { font-size: 3rem; }
	.confirm-name { font-size: 1.25rem; font-weight: 700; }
	.confirm-desc { font-size: 0.875rem; color: var(--color-text-muted); }
	.confirm-effect { font-size: 0.875rem; color: #7c3aed; font-weight: 600; }
	.confirm-cost { font-size: 1rem; font-weight: 600; color: #7c3aed; }
	.confirm-remaining { font-size: 0.75rem; color: var(--color-text-muted); }

	.confirm-actions {
		display: flex;
		gap: var(--sp-sm);
		width: 100%;
		margin-top: var(--sp-sm);
	}

	.btn-cancel {
		flex: 1;
		padding: 0.75rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		font-weight: 600;
		cursor: pointer;
	}

	.btn-confirm {
		flex: 1;
		padding: 0.75rem;
		border-radius: var(--radius-md);
		border: none;
		background: linear-gradient(135deg, #8b5cf6, #7c3aed);
		color: white;
		font-weight: 700;
		cursor: pointer;
	}

	.btn-confirm:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-confirm:not(:disabled):active {
		transform: scale(0.97);
	}
</style>
