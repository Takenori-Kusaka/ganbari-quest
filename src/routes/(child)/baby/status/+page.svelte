<script lang="ts">
import { CATEGORIES } from '$lib/domain/validation/activity';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Progress from '$lib/ui/primitives/Progress.svelte';

let { data } = $props();

/** レベル別アイコン */
const levelEmojis: Record<number, string> = {
	1: '🌱', 2: '💪', 3: '⚡', 4: '🔥', 5: '⭐',
	6: '🗡️', 7: '🏆', 8: '✨', 9: '👑', 10: '🌟',
};

/** レベル別はげましメッセージ */
const levelMessages: Record<number, string> = {
	1: 'まだまだこれから！どんどんつよくなろう！',
	2: 'がんばってるね！このちょうしでいこう！',
	3: 'わくわくしてきた！どんどんいこう！',
	4: 'つよくなってきた！もっといけるよ！',
	5: 'すごい！ヒーローになったよ！',
	6: 'とてもすごい！ぼうけんのたつじんだ！',
	7: 'チャンピオンだ！みんなのあこがれだよ！',
	8: 'きせきをおこしているよ！すばらしい！',
	9: 'せかいいちつよい！でんせつだ！',
	10: 'かみさまレベル！これいじょうはない！',
};

const trendIcons: Record<string, string> = {
	up: '📈',
	down: '📉',
	stable: '➡️',
};

const expBarValue = $derived(() => {
	if (!data.status) return 0;
	const level = data.status.level;
	if (level >= 10) return 100;
	const maxValue = data.status.maxValue;
	const totalExp = Object.values(data.status.statuses).reduce((sum, s) => sum + s.value, 0);
	const avgStatus = totalExp / CATEGORIES.length;
	// 年齢別max値で正規化してからレベル内の進捗を計算
	const normalizedAvg = maxValue > 0 ? (avgStatus / maxValue) * 100 : 0;
	const levelMinAvg = (level - 1) * 10;
	return Math.min(100, Math.max(0, ((normalizedAvg - levelMinAvg) / 10) * 100));
});
</script>

<svelte:head>
	<title>つよさ - がんばりクエスト</title>
</svelte:head>

<div class="status-page">
	{#if data.status}
		<!-- Level + title (unified) -->
		<div class="status-level">
			<div class="status-level__center">
				<span class="status-level__emoji">
					{levelEmojis[data.status.level] ?? '⭐'}
				</span>
				<p class="status-level__num">Lv.{data.status.level}</p>
				<p class="status-level__title">
					{data.status.levelTitle}
				</p>
				<p class="status-level__message">
					{levelMessages[data.status.level] ?? ''}
				</p>
			</div>
			<div style="margin-bottom: 4px;">
				<Progress value={expBarValue()} max={100} color="var(--color-point)" size="md" />
			</div>
			{#if data.status.level < 10}
				<p class="status-level__next">
					つぎのレベルまで あと {data.status.expToNextLevel}
				</p>
			{:else}
				<p class="status-level__max">
					さいこうレベル！
				</p>
			{/if}
		</div>

		<!-- Status bars -->
		<div class="status-bars">
			<h2 class="status-bars__title">ステータス</h2>
			<div class="status-bars__list">
				{#each CATEGORIES as cat (cat)}
					{@const status = data.status.statuses[cat]}
					{#if status}
						<div>
							<StatusBar
								category={cat}
								value={status.value}
								maxValue={data.status.maxValue}
								stars={status.stars}
							/>
							<div class="status-bars__trend">
								<span class="status-bars__trend-icon">
									{trendIcons[status.trend] ?? '➡️'}
								</span>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{:else}
		<div class="status-empty">
			<span class="status-empty__icon">⭐</span>
			<p class="status-empty__text">ステータスがまだないよ</p>
		</div>
	{/if}
</div>

<style>
	.status-page {
		padding: 4px 16px;
	}

	/* Level (unified) */
	.status-level {
		background: white;
		border-radius: 16px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		margin-bottom: 24px;
	}

	.status-level__center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		margin-bottom: 16px;
	}

	.status-level__emoji {
		font-size: 3rem;
	}

	.status-level__num {
		font-size: 1.5rem;
		font-weight: 700;
	}

	.status-level__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--theme-accent);
	}

	.status-level__message {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	.status-level__next {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-align: right;
	}

	.status-level__max {
		font-size: 0.75rem;
		color: var(--color-point);
		text-align: right;
		font-weight: 700;
	}

	/* Status bars */
	.status-bars {
		background: white;
		border-radius: 16px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.status-bars__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-muted);
		margin-bottom: 16px;
	}

	.status-bars__list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.status-bars__trend {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 4px;
		padding: 0 4px;
	}

	.status-bars__trend-icon {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Empty */
	.status-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 0;
		color: var(--color-text-muted);
	}

	.status-empty__icon {
		font-size: 2.5rem;
		margin-bottom: 8px;
	}

	.status-empty__text {
		font-weight: 700;
	}
</style>
