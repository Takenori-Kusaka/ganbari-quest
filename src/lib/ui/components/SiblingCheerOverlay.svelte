<script lang="ts">
import { enhance } from '$app/forms';

interface CheerData {
	id: number;
	stampLabel: string;
	stampEmoji: string;
	fromName: string;
}

interface Props {
	cheers: CheerData[];
	onDismiss: () => void;
}

let { cheers, onDismiss }: Props = $props();

const cheerIds = $derived(cheers.map((c) => c.id).join(','));
</script>

{#if cheers.length > 0}
	<div class="cheer-overlay" data-testid="cheer-overlay">
		<div class="cheer-overlay__backdrop" onclick={onDismiss} role="presentation"></div>
		<div class="cheer-overlay__card">
			<p class="cheer-overlay__title">💌 おうえんがとどいたよ！</p>
			<div class="cheer-overlay__list">
				{#each cheers as cheer}
					<div class="cheer-overlay__item">
						<span class="cheer-overlay__emoji">{cheer.stampEmoji}</span>
						<div>
							<span class="cheer-overlay__from">{cheer.fromName}から</span>
							<span class="cheer-overlay__label">{cheer.stampLabel}</span>
						</div>
					</div>
				{/each}
			</div>
			<form method="POST" action="?/markCheersShown" use:enhance={() => {
				return async ({ update }) => {
					await update();
					onDismiss();
				};
			}}>
				<input type="hidden" name="cheerIds" value={cheerIds} />
				<button type="submit" class="cheer-overlay__btn">ありがとう！</button>
			</form>
		</div>
	</div>
{/if}

<style>
	.cheer-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cheer-overlay__backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
	}

	.cheer-overlay__card {
		position: relative;
		background: white;
		border-radius: var(--radius-lg, 16px);
		padding: 24px;
		max-width: 300px;
		width: 90%;
		text-align: center;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
		animation: cheer-slide-up 0.3s ease-out;
	}

	.cheer-overlay__title {
		font-size: 1rem;
		font-weight: 700;
		color: #7c3aed;
		margin-bottom: 12px;
	}

	.cheer-overlay__list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 16px;
	}

	.cheer-overlay__item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: #f5f3ff;
		border-radius: 8px;
	}

	.cheer-overlay__emoji {
		font-size: 1.5rem;
	}

	.cheer-overlay__from {
		font-size: 0.6875rem;
		font-weight: 600;
		color: #6b7280;
		display: block;
	}

	.cheer-overlay__label {
		font-size: 0.8125rem;
		font-weight: 700;
		color: #5b21b6;
	}

	.cheer-overlay__btn {
		width: 100%;
		padding: 10px;
		border: none;
		border-radius: 10px;
		background: linear-gradient(135deg, #8b5cf6, #7c3aed);
		color: white;
		font-size: 0.875rem;
		font-weight: 700;
		cursor: pointer;
	}

	.cheer-overlay__btn:hover {
		background: linear-gradient(135deg, #7c3aed, #6d28d9);
	}

	@keyframes cheer-slide-up {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
