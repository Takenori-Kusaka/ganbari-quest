<script lang="ts">
interface Props {
	/** バッジのサイズ */
	size?: 'sm' | 'md';
	/** タップ時にモーダルを表示するか */
	interactive?: boolean;
	/** ラベルテキスト（省略時はアイコンのみ） */
	label?: string;
}

let { size = 'sm', interactive = true, label = '' }: Props = $props();
let showModal = $state(false);
</script>

{#if interactive}
	<button
		type="button"
		class="premium-badge premium-badge--{size}"
		title="スタンダードプラン以上で利用可能"
		onclick={() => (showModal = true)}
	>
		<span class="premium-badge__icon">⭐</span>
		{#if label}
			<span class="premium-badge__label">{label}</span>
		{/if}
	</button>
{:else}
	<span
		class="premium-badge premium-badge--{size}"
		title="スタンダードプラン以上で利用可能"
	>
		<span class="premium-badge__icon">⭐</span>
		{#if label}
			<span class="premium-badge__label">{label}</span>
		{/if}
	</span>
{/if}

{#if showModal}
	{#await import('./PremiumModal.svelte') then { default: PremiumModal }}
		<PremiumModal onclose={() => (showModal = false)} />
	{/await}
{/if}

<style>
	.premium-badge {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		border: none;
		border-radius: var(--radius-full);
		background: var(--color-premium-bg);
		color: var(--color-premium);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.premium-badge:hover {
		background: var(--color-premium);
		color: white;
	}

	.premium-badge--sm {
		padding: 2px 8px;
		font-size: 0.7rem;
	}

	.premium-badge--sm .premium-badge__icon {
		font-size: 0.7rem;
	}

	.premium-badge--md {
		padding: 4px 12px;
		font-size: 0.8rem;
	}

	.premium-badge--md .premium-badge__icon {
		font-size: 0.85rem;
	}

	.premium-badge__label {
		letter-spacing: 0.02em;
	}
</style>
