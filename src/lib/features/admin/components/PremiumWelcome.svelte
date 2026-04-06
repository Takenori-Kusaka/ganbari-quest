<script lang="ts">
import { PLAN_SHORT_LABELS } from '$lib/domain/labels';

interface Props {
	planTier: 'standard' | 'family';
	onDismiss: () => void;
}

let { planTier, onDismiss }: Props = $props();

const isFamily = $derived(planTier === 'family');

const planLabel = $derived(isFamily ? PLAN_SHORT_LABELS.family : PLAN_SHORT_LABELS.standard);
const planIcon = $derived(isFamily ? '⭐⭐' : '⭐');

const features = $derived(
	isFamily
		? [
				{ text: 'オリジナル活動の追加（無制限）', icon: '✅' },
				{ text: 'チェックリストの自由作成', icon: '✅' },
				{ text: 'ごほうびのカスタマイズ', icon: '✅' },
				{ text: '詳細な月次レポート', icon: '✅' },
				{ text: 'データの永久保持', icon: '✅' },
				{ text: 'こどもの登録（無制限）', icon: '✅' },
			]
		: [
				{ text: 'オリジナル活動の追加（無制限）', icon: '✅' },
				{ text: 'チェックリストの自由作成', icon: '✅' },
				{ text: 'ごほうびのカスタマイズ', icon: '✅' },
				{ text: '詳細な月次レポート', icon: '✅' },
				{ text: '1年間のデータ保持', icon: '✅' },
			],
);
</script>

<div class="welcome-overlay" role="dialog" aria-modal="true" aria-label="{planLabel}へようこそ">
	<div class="welcome-card welcome-card--{planTier}">
		<!-- Confetti particles -->
		<div class="confetti" aria-hidden="true">
			{#each Array(12) as _, i}
				<span class="confetti-piece" style="--i:{i}"></span>
			{/each}
		</div>

		<div class="welcome-content">
			<span class="welcome-emoji">🎉</span>

			<h2 class="welcome-title">
				がんばりクエスト {planIcon} {planLabel} へ<br />ようこそ！
			</h2>

			<div class="welcome-divider">
				<span>解放された機能</span>
			</div>

			<ul class="welcome-features">
				{#each features as feat}
					<li class="welcome-feature">
						<span class="welcome-feature-icon">{feat.icon}</span>
						<span>{feat.text}</span>
					</li>
				{/each}
			</ul>

			<p class="welcome-message">
				お子さまの「がんばり」を<br />もっと楽しく応援しましょう！
			</p>

			<button type="button" class="welcome-cta" onclick={onDismiss}>
				さっそく始める →
			</button>
		</div>
	</div>
</div>

<style>
	.welcome-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		animation: fadeIn 0.3s ease;
		padding: 1rem;
	}

	.welcome-card {
		position: relative;
		overflow: hidden;
		width: 100%;
		max-width: 400px;
		border-radius: 1.25rem;
		background: white;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		animation: slideUp 0.4s ease;
	}

	.welcome-card--standard {
		border: 2px solid var(--color-rarity-epic, #e9d5ff);
	}

	.welcome-card--family {
		border: 2px solid var(--color-gold-300, #fde68a);
	}

	.welcome-content {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem 1.5rem;
		text-align: center;
	}

	.welcome-emoji {
		font-size: 3rem;
		display: block;
		margin-bottom: 0.75rem;
		animation: bounce 0.6s ease 0.3s both;
	}

	.welcome-title {
		font-size: 1.2rem;
		font-weight: 800;
		color: var(--color-text-primary, #1f2937);
		line-height: 1.6;
		margin: 0 0 1rem;
	}

	.welcome-divider {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.welcome-divider::before,
	.welcome-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-neutral-200, #e5e7eb);
	}

	.welcome-divider span {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-tertiary, #9ca3af);
		white-space: nowrap;
	}

	.welcome-features {
		list-style: none;
		padding: 0;
		margin: 0 0 1.25rem;
		width: 100%;
		text-align: left;
	}

	.welcome-feature {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0;
		font-size: 0.875rem;
		color: var(--color-text-primary, #374151);
	}

	.welcome-feature-icon {
		flex-shrink: 0;
		font-size: 0.875rem;
	}

	.welcome-message {
		font-size: 0.85rem;
		color: var(--color-text-secondary, #6b7280);
		line-height: 1.6;
		margin: 0 0 1.25rem;
	}

	.welcome-card--standard .welcome-cta {
		background: var(--gradient-premium, linear-gradient(135deg, #7c3aed, #a78bfa));
	}

	.welcome-card--family .welcome-cta {
		background: linear-gradient(135deg, var(--color-premium, #7c3aed), var(--color-gold-500, #f59e0b));
	}

	.welcome-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 0.75rem;
		color: white;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.welcome-cta:hover {
		opacity: 0.9;
	}

	/* Confetti animation */
	.confetti {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.confetti-piece {
		position: absolute;
		width: 8px;
		height: 8px;
		top: -10px;
		left: calc(var(--i) * 8.33%);
		border-radius: 2px;
		animation: confettiFall 2s ease-out calc(var(--i) * 0.1s) both;
	}

	.confetti-piece:nth-child(odd) {
		background: var(--color-premium, #7c3aed);
		width: 6px;
		height: 10px;
	}

	.confetti-piece:nth-child(even) {
		background: var(--color-gold-500, #f59e0b);
		width: 10px;
		height: 6px;
	}

	.confetti-piece:nth-child(3n) {
		background: var(--color-cat-souzou, #ec4899);
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slideUp {
		from { opacity: 0; transform: translateY(20px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes bounce {
		0% { transform: scale(0.3); opacity: 0; }
		50% { transform: scale(1.1); }
		70% { transform: scale(0.95); }
		100% { transform: scale(1); opacity: 1; }
	}

	@keyframes confettiFall {
		0% {
			transform: translateY(0) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(400px) rotate(calc(var(--i) * 60deg + 180deg));
			opacity: 0;
		}
	}
</style>
