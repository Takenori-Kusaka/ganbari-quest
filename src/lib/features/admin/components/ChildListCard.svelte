<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

interface Props {
	child: {
		id: number;
		nickname: string;
		age: number;
		uiMode: string;
		theme: string;
		avatarUrl?: string | null;
		birthDate?: string | null;
		balance: number;
		level: number;
	};
	isSelected: boolean;
	href: string;
	dataTutorial?: string;
	formatBalance: (pts: number) => string;
}

let { child, isSelected, href, dataTutorial, formatBalance }: Props = $props();

const themeEmojis: Record<string, string> = {
	pink: '🩷',
	blue: '💙',
	green: '💚',
	orange: '🧡',
	purple: '💜',
};

function formatBirthday(dateStr: string): string {
	const d = new Date(dateStr);
	return `${d.getMonth() + 1}月${d.getDate()}日`;
}
</script>

<a {href} class="block" data-tutorial={dataTutorial}>
	<Card class="child-list-card {isSelected ? 'child-list-card--selected' : ''}">
		<div class="child-list-card__content">
			<div class="child-list-card__avatar">
				{#if child.avatarUrl}
					<img src={child.avatarUrl} alt={child.nickname} class="child-list-card__avatar-img" loading="lazy" />
				{:else}
					<span class="child-list-card__avatar-placeholder">👤</span>
				{/if}
			</div>
			<div class="child-list-card__info">
				<p class="child-list-card__name">{child.nickname}</p>
				<p class="child-list-card__meta">
					{child.age}歳 / {child.uiMode} / {themeEmojis[child.theme] ?? '🩷'}
				</p>
				{#if child.birthDate}
					<p class="child-list-card__birthday">🎂 {formatBirthday(child.birthDate)}</p>
				{/if}
			</div>
			<div class="child-list-card__balance">
				<p class="child-list-card__balance-value">{formatBalance(child.balance)}</p>
			</div>
			<span class="child-list-card__chevron {isSelected ? 'child-list-card__chevron--open' : ''}">▸</span>
		</div>
	</Card>
</a>

<style>
	.child-list-card {
		transition: box-shadow 0.2s, border-color 0.2s;
		cursor: pointer;
	}
	.child-list-card:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}
	:global(.child-list-card--selected) {
		border-color: var(--color-action-primary, #3b82f6);
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}
	.child-list-card__content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.child-list-card__avatar {
		flex-shrink: 0;
	}
	.child-list-card__avatar-img {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.child-list-card__avatar-placeholder {
		font-size: 2rem;
	}
	.child-list-card__info {
		flex: 1;
		min-width: 0;
	}
	.child-list-card__name {
		font-weight: 700;
		color: var(--color-text-primary, #374151);
		font-size: 0.95rem;
	}
	.child-list-card__meta {
		font-size: 0.8rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.child-list-card__birthday {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.child-list-card__balance {
		text-align: right;
		flex-shrink: 0;
	}
	.child-list-card__balance-value {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--color-gold-500, #f59e0b);
	}
	.child-list-card__chevron {
		flex-shrink: 0;
		font-size: 0.9rem;
		color: var(--color-text-tertiary, #9ca3af);
		transition: transform 0.2s;
	}
	.child-list-card__chevron--open {
		transform: rotate(90deg);
	}
</style>
