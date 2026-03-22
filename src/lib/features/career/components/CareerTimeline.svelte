<script lang="ts">
let {
	timeline3y = $bindable(''),
	timeline5y = $bindable(''),
	timeline10y = $bindable(''),
	readonly = false,
}: {
	timeline3y: string;
	timeline5y: string;
	timeline10y: string;
	readonly: boolean;
} = $props();

const milestones = [
	{
		label: '3ねんご',
		emoji: '🌱',
		bind: () => timeline3y,
		set: (v: string) => {
			timeline3y = v;
		},
	},
	{
		label: '5ねんご',
		emoji: '🌿',
		bind: () => timeline5y,
		set: (v: string) => {
			timeline5y = v;
		},
	},
	{
		label: '10ねんご',
		emoji: '🌳',
		bind: () => timeline10y,
		set: (v: string) => {
			timeline10y = v;
		},
	},
];
</script>

<div class="timeline-container">
	<div class="timeline-line"></div>
	{#each milestones as ms, i}
		<div class="timeline-node">
			<div class="timeline-dot">
				<span class="dot-emoji">{ms.emoji}</span>
			</div>
			<div class="timeline-content">
				<span class="timeline-label">{ms.label}</span>
				{#if readonly}
					<p class="timeline-text">{ms.bind() || 'まだきめてないよ'}</p>
				{:else}
					<input
						class="timeline-input"
						type="text"
						placeholder="どんなじぶんになりたい？"
						maxlength="200"
						value={ms.bind()}
						oninput={(e) => ms.set((e.target as HTMLInputElement).value)}
					/>
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.timeline-container {
		position: relative;
		padding-left: 2rem;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
	}
	.timeline-line {
		position: absolute;
		left: 0.9rem;
		top: 1rem;
		bottom: 1rem;
		width: 3px;
		background: linear-gradient(to bottom, #86efac, #22c55e, #15803d);
		border-radius: 2px;
	}
	.timeline-node {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-sm);
		position: relative;
	}
	.timeline-dot {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: white;
		border: 3px solid #22c55e;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-left: -1rem;
		z-index: 1;
	}
	.dot-emoji {
		font-size: 0.8rem;
	}
	.timeline-content {
		flex: 1;
		background: white;
		border-radius: var(--radius-md);
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid #e5e7eb;
	}
	.timeline-label {
		font-size: var(--font-xs);
		font-weight: 700;
		color: #16a34a;
		display: block;
		margin-bottom: var(--spacing-xs);
	}
	.timeline-text {
		margin: 0;
		font-size: var(--font-sm);
		color: #374151;
	}
	.timeline-input {
		width: 100%;
		padding: var(--spacing-xs);
		border: 1px solid #d1d5db;
		border-radius: var(--radius-sm);
		font-size: var(--font-sm);
	}
</style>
