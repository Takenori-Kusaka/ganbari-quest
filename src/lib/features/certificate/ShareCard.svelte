<script lang="ts">
// HTML-based shareable achievement card
// Renders as a visually appealing card that can be screenshot/downloaded
interface ShareCardData {
	childName: string;
	title: string;
	icon: string;
	stats: { label: string; value: string }[];
}

interface Props {
	card: ShareCardData;
}

let { card }: Props = $props();
</script>

<div class="share-card" id="share-card">
	<div class="share-card-inner">
		<div class="share-card-header">
			<span class="share-card-icon">{card.icon}</span>
			<p class="share-card-name">{card.childName}</p>
		</div>

		<h2 class="share-card-title">{card.title}</h2>

		{#if card.stats.length > 0}
			<div class="share-card-stats">
				{#each card.stats as stat}
					<div class="share-card-stat">
						<span class="share-card-stat-value">{stat.value}</span>
						<span class="share-card-stat-label">{stat.label}</span>
					</div>
				{/each}
			</div>
		{/if}

		<p class="share-card-branding">がんばりクエスト</p>
	</div>
</div>

<style>
	.share-card {
		width: 320px;
		margin: 0 auto;
		border-radius: 16px;
		overflow: hidden;
		background: linear-gradient(135deg, var(--color-brand-500, #3b82f6), var(--color-violet-500, #8b5cf6));
		padding: 3px;
	}
	.share-card-inner {
		background: white;
		border-radius: 14px;
		padding: 24px 20px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}
	.share-card-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.share-card-icon {
		font-size: 3rem;
		line-height: 1;
	}
	.share-card-name {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
		margin: 0;
	}
	.share-card-title {
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--color-brand-600, #2563eb);
		margin: 0;
		line-height: 1.3;
	}
	.share-card-stats {
		display: flex;
		gap: 16px;
		justify-content: center;
		flex-wrap: wrap;
	}
	.share-card-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.share-card-stat-value {
		font-size: 1.125rem;
		font-weight: 800;
		color: var(--color-brand-700, #1d4ed8);
	}
	.share-card-stat-label {
		font-size: 0.625rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.share-card-branding {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-tertiary, #9ca3af);
		margin: 4px 0 0;
	}
</style>
