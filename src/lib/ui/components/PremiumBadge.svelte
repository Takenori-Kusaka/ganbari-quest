<script lang="ts">
interface Props {
	/** バッジのサイズ */
	size?: 'sm' | 'md';
	/** タップ時にモーダルを表示するか */
	interactive?: boolean;
	/** ラベルテキスト（省略時はアイコンのみ） */
	label?: string;
	/** ロックアイコンを表示（制限UI用） */
	showLock?: boolean;
}

let { size = 'sm', interactive = true, label = '', showLock = false }: Props = $props();
const icon = $derived(showLock ? '🔒' : '⭐');
let showModal = $state(false);
</script>

{#if interactive}
	<button
		type="button"
		class="premium-badge premium-badge--{size}"
		title="スタンダードプラン以上で利用可能"
		onclick={() => (showModal = true)}
	>
		<span class="premium-badge__icon">{icon}</span>
		{#if label}
			<span class="premium-badge__label">{label}</span>
		{/if}
	</button>
{:else}
	<span
		class="premium-badge premium-badge--{size}"
		title="スタンダードプラン以上で利用可能"
	>
		<span class="premium-badge__icon">{icon}</span>
		{#if label}
			<span class="premium-badge__label">{label}</span>
		{/if}
	</span>
{/if}

{#if showModal}
	{#await import('./PremiumDialog.svelte') then { default: PremiumDialog }}
		<PremiumDialog onclose={() => (showModal = false)} />
	{/await}
{/if}

<style>
	.premium-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--color-premium-bg);
		border-radius: var(--radius-full);
		background: linear-gradient(135deg, var(--color-premium-bg), var(--color-surface-card, white));
		color: var(--color-premium);
		font-weight: 700;
		cursor: pointer;
		transition: all 0.2s ease;
		white-space: nowrap;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.premium-badge:hover {
		background: var(--color-premium);
		color: white;
		border-color: var(--color-premium);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
	}

	.premium-badge--sm {
		padding: 3px 10px;
		font-size: 0.72rem;
	}

	.premium-badge--sm .premium-badge__icon {
		font-size: 0.72rem;
	}

	.premium-badge--md {
		padding: 5px 14px;
		font-size: 0.82rem;
	}

	.premium-badge--md .premium-badge__icon {
		font-size: 0.88rem;
	}

	.premium-badge__label {
		letter-spacing: 0.03em;
	}
</style>
