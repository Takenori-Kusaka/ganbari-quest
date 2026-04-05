<script lang="ts">
import { formatChildName } from '$lib/domain/child-display';

interface Props {
	nickname: string;
	newAge: number;
	totalPoints: number;
	onclick: () => void;
}

let { nickname, newAge, totalPoints, onclick }: Props = $props();
</script>

<button
	type="button"
	class="birthday-banner"
	data-testid="birthday-banner"
	onclick={onclick}
>
	<span class="birthday-banner__icon">🎂</span>
	<div class="birthday-banner__content">
		<p class="birthday-banner__title">
			おたんじょうびボーナスがとどいているよ！
		</p>
		<p class="birthday-banner__sub">
			{formatChildName(nickname, 'vocative')}{newAge}さいおめでとう！ タップしてうけとろう
		</p>
	</div>
	<span class="birthday-banner__points">⭐{totalPoints}pt</span>
</button>

<style>
	.birthday-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		margin-bottom: 8px;
		border-radius: var(--radius-md, 12px);
		border: 2px solid var(--color-gold-400);
		background: linear-gradient(135deg, var(--color-feedback-warning-bg), var(--color-feedback-warning-bg-strong));
		cursor: pointer;
		animation: birthday-glow 2s ease-in-out infinite;
	}

	@keyframes birthday-glow {
		0%, 100% { box-shadow: 0 0 8px rgba(251, 191, 36, 0.3); }
		50% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.6); }
	}

	.birthday-banner__icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.birthday-banner__content {
		flex: 1;
		text-align: left;
	}

	.birthday-banner__title {
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--color-feedback-warning-text);
		margin: 0;
	}

	.birthday-banner__sub {
		font-size: 0.625rem;
		color: var(--color-feedback-warning-text);
		margin: 2px 0 0;
	}

	.birthday-banner__points {
		font-size: 0.875rem;
		font-weight: 800;
		color: var(--color-stat-amber);
		flex-shrink: 0;
	}
</style>
