<script lang="ts">
import { formatPointValueWithSign } from '$lib/domain/point-display';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

let detailOpen = $state(false);
let selectedAchievement = $state<(typeof data.achievements)[number] | null>(null);

const unlockedCount = $derived(
	data.achievements.filter((a) => a.unlockedAt !== null || a.highestUnlockedMilestone !== null)
		.length,
);

const rarityLabel: Record<string, string> = {
	common: 'ふつう',
	rare: 'レア',
	epic: 'スーパーレア',
	legendary: 'でんせつ',
};

function handleTap(achievement: (typeof data.achievements)[number]) {
	soundService.play('tap');
	selectedAchievement = achievement;
	detailOpen = true;
}

function isUnlocked(achievement: (typeof data.achievements)[number]): boolean {
	if (achievement.repeatable) {
		return (achievement.highestUnlockedMilestone ?? null) !== null;
	}
	return achievement.unlockedAt !== null;
}

function progressPercent(achievement: (typeof data.achievements)[number]): number {
	if (!achievement.repeatable && achievement.unlockedAt) return 100;
	if (achievement.conditionValue <= 0) return 0;
	return Math.min(
		100,
		Math.round((achievement.currentProgress / achievement.conditionValue) * 100),
	);
}

function progressText(achievement: (typeof data.achievements)[number]): string {
	if (achievement.conditionType === 'all_categories') {
		return `${achievement.currentProgress}/5カテゴリ`;
	}
	if (achievement.conditionType === 'milestone_event') {
		return '';
	}
	return `${achievement.currentProgress}/${achievement.conditionValue}`;
}

function streakStatusText(achievement: (typeof data.achievements)[number]): string | null {
	if (achievement.conditionType !== 'streak_days') return null;
	if (achievement.liveStreak == null || achievement.liveStreak === 0) return null;
	return `いま${achievement.liveStreak}にちれんぞく中`;
}

function milestoneDisplayText(achievement: (typeof data.achievements)[number]): string | null {
	if (!achievement.repeatable || !achievement.highestUnlockedMilestone) return null;
	return `${achievement.highestUnlockedMilestone}たっせい！`;
}

function currentRarity(achievement: (typeof data.achievements)[number]): string {
	if (!achievement.repeatable || achievement.milestones.length === 0) {
		return achievement.rarity;
	}
	const unlockedMilestones = achievement.milestones.filter((m) => m.unlocked);
	if (unlockedMilestones.length === 0) return 'common';
	const ratio = unlockedMilestones.length / achievement.milestones.length;
	if (ratio >= 0.9) return 'legendary';
	if (ratio >= 0.6) return 'epic';
	if (ratio >= 0.3) return 'rare';
	return 'common';
}
</script>

<svelte:head>
	<title>じっせき - がんばりクエスト</title>
</svelte:head>

<div class="ach-page">
	<!-- Summary -->
	<div class="ach-summary">
		<span class="ach-summary__icon">🏆</span>
		<p class="ach-summary__text">
			{unlockedCount} / {data.achievements.length} たっせい
		</p>
	</div>

	<!-- Achievement grid -->
	{#if data.achievements.length > 0}
		<div class="ach-grid">
			{#each data.achievements as achievement (achievement.id)}
				{@const unlocked = isUnlocked(achievement)}
				{@const rarity = currentRarity(achievement)}
				{@const pct = progressPercent(achievement)}
				<button
					class="tap-target ach-card {unlocked ? 'ach-card--unlocked ach-card--' + rarity : 'ach-card--locked'}"
					onclick={() => handleTap(achievement)}
				>
					<span class="ach-card__icon {unlocked ? '' : 'ach-card__icon--dim'}">
						{achievement.icon}
					</span>
					<span class="ach-card__name {unlocked ? '' : 'ach-card__name--muted'}">
						{achievement.name}
					</span>
					{#if achievement.repeatable && unlocked && achievement.highestUnlockedMilestone}
						<span class="ach-card__milestone">
							{achievement.highestUnlockedMilestone}{achievement.conditionType === 'streak_days' ? 'にち' : ''}
						</span>
					{/if}
					{#if !unlocked || achievement.nextMilestone}
						<div class="ach-card__progress-bar">
							<div class="ach-card__progress-fill" style="width: {pct}%"></div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div class="ach-empty">
			<span class="ach-empty__icon">🏆</span>
			<p class="ach-empty__text">じっせきがまだないよ</p>
		</div>
	{/if}
</div>

<!-- Achievement detail dialog -->
<Dialog bind:open={detailOpen} title="">
	{#if selectedAchievement}
		{@const unlocked = isUnlocked(selectedAchievement)}
		{@const rarity = currentRarity(selectedAchievement)}
		{@const pct = progressPercent(selectedAchievement)}
		{@const streakText = streakStatusText(selectedAchievement)}
		{@const milestoneText = milestoneDisplayText(selectedAchievement)}
		<div class="ach-detail">
			<div class="ach-detail__icon-wrap {unlocked ? 'ach-detail__icon-wrap--' + rarity : 'ach-detail__icon-wrap--locked'}">
				<span class="ach-detail__icon {unlocked ? '' : 'ach-card__icon--dim'}">
					{selectedAchievement.icon}
				</span>
			</div>

			<div>
				<p class="ach-detail__name">{selectedAchievement.name}</p>
				{#if selectedAchievement.description}
					<p class="ach-detail__desc">{selectedAchievement.description}</p>
				{/if}
			</div>

			<!-- Milestone chips (repeatable) -->
			{#if selectedAchievement.repeatable && selectedAchievement.milestones.length > 0}
				<div class="ach-detail__milestones">
					{#each selectedAchievement.milestones as m}
						<span class="ach-detail__milestone-chip {m.unlocked ? 'ach-detail__milestone-chip--done' : ''}">
							{m.value}
						</span>
					{/each}
				</div>
				{#if milestoneText}
					<p class="ach-detail__milestone-text">{milestoneText}</p>
				{/if}
			{/if}

			<!-- Condition -->
			{#if selectedAchievement.conditionLabel && selectedAchievement.conditionType !== 'milestone_event'}
				<div class="ach-detail__condition">
					<p class="ach-detail__condition-text">
						{unlocked && !selectedAchievement.nextMilestone ? '✅' : '🎯'} {selectedAchievement.conditionLabel}
					</p>
					{#if selectedAchievement.nextMilestone || !unlocked}
						<div class="ach-detail__progress">
							<div class="ach-detail__progress-bar">
								<div class="ach-detail__progress-fill" style="width: {pct}%"></div>
							</div>
							<span class="ach-detail__progress-text">
								{progressText(selectedAchievement)}
							</span>
						</div>
						{#if streakText}
							<p class="ach-detail__streak-text">({streakText})</p>
						{/if}
					{:else}
						<p class="ach-detail__achieved">ぜんぶたっせい！</p>
						{#if streakText}
							<p class="ach-detail__streak-info">({streakText})</p>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- Life milestone -->
			{#if selectedAchievement.conditionType === 'milestone_event'}
				<div class="ach-detail__condition">
					{#if unlocked}
						<p class="ach-detail__achieved">✅ たっせい！おめでとう！</p>
					{:else}
						<p class="ach-detail__condition-text">おやがきろくしてくれるよ</p>
					{/if}
				</div>
			{/if}

			<div class="ach-detail__meta">
				<div class="ach-detail__meta-item">
					<span class="ach-detail__meta-value ach-detail__meta-value--point">{fmtPts(selectedAchievement.bonusPoints)}</span>
					<span class="ach-detail__meta-label">ボーナス</span>
				</div>
				<div class="ach-detail__meta-item">
					<span class="ach-detail__meta-value">{rarityLabel[rarity] ?? 'ふつう'}</span>
					<span class="ach-detail__meta-label">レアリティ</span>
				</div>
			</div>

			{#if unlocked && selectedAchievement.unlockedAt}
				<p class="ach-detail__date">
					{new Date(selectedAchievement.unlockedAt).toLocaleDateString('ja-JP')} にたっせい
				</p>
			{/if}
		</div>
	{/if}
</Dialog>

<style>
	.ach-page {
		padding: 4px 16px;
	}

	.ach-summary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-bottom: 24px;
	}

	.ach-summary__icon {
		font-size: 1.875rem;
	}

	.ach-summary__text {
		font-size: 1.125rem;
		font-weight: 700;
	}

	.ach-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.ach-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px;
		border-radius: 16px;
		border: 2px solid;
		transition: all 0.15s ease;
		position: relative;
		overflow: hidden;
		cursor: pointer;
		background: none;
	}

	.ach-card--locked {
		border-color: var(--color-neutral-200);
		background: var(--color-neutral-100);
	}

	.ach-card--unlocked.ach-card--common { border-color: var(--color-rarity-common); background: var(--color-rarity-common-bg); }
	.ach-card--unlocked.ach-card--rare { border-color: var(--color-rarity-rare); background: var(--color-rarity-rare-bg); }
	.ach-card--unlocked.ach-card--epic { border-color: var(--color-rarity-epic); background: var(--color-rarity-epic-bg); }
	.ach-card--unlocked.ach-card--legendary { border-color: var(--color-rarity-legendary); background: var(--color-rarity-legendary-bg); }

	.ach-card__icon {
		font-size: 1.875rem;
	}

	.ach-card__icon--dim {
		filter: grayscale(1);
		opacity: 0.5;
	}

	.ach-card__name {
		font-size: 0.75rem;
		font-weight: 700;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		width: 100%;
	}

	.ach-card__name--muted {
		color: var(--color-text-muted);
	}

	.ach-card__milestone {
		font-size: 10px;
		font-weight: 700;
		color: var(--theme-accent);
	}

	.ach-card__progress-bar {
		width: 100%;
		height: 4px;
		border-radius: 9999px;
		background: var(--color-neutral-200);
		margin-top: 2px;
	}

	.ach-card__progress-fill {
		height: 100%;
		border-radius: 9999px;
		background: var(--theme-primary);
		transition: width 0.3s ease;
	}

	.ach-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 0;
		color: var(--color-text-muted);
	}

	.ach-empty__icon {
		font-size: 2.5rem;
		margin-bottom: 8px;
	}

	.ach-empty__text {
		font-weight: 700;
	}

	.ach-detail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		text-align: center;
	}

	.ach-detail__icon-wrap {
		width: 96px;
		height: 96px;
		border-radius: 24px;
		border: 4px solid;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.ach-detail__icon-wrap--locked { border-color: var(--color-neutral-200); background: var(--color-neutral-100); }
	.ach-detail__icon-wrap--common { border-color: var(--color-rarity-common); background: var(--color-rarity-common-bg); }
	.ach-detail__icon-wrap--rare { border-color: var(--color-rarity-rare); background: var(--color-rarity-rare-bg); }
	.ach-detail__icon-wrap--epic { border-color: var(--color-rarity-epic); background: var(--color-rarity-epic-bg); }
	.ach-detail__icon-wrap--legendary { border-color: var(--color-rarity-legendary); background: var(--color-rarity-legendary-bg); }

	.ach-detail__icon {
		font-size: 3rem;
	}

	.ach-detail__name {
		font-size: 1.25rem;
		font-weight: 700;
	}

	.ach-detail__desc {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-top: 4px;
	}

	.ach-detail__milestones {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		justify-content: center;
	}

	.ach-detail__milestone-chip {
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 9999px;
		font-weight: 700;
		background: var(--color-neutral-200);
		color: var(--color-text-muted);
	}

	.ach-detail__milestone-chip--done {
		background: var(--theme-primary);
		color: white;
	}

	.ach-detail__milestone-text {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--theme-accent);
	}

	.ach-detail__condition {
		padding: 8px 12px;
		border-radius: 12px;
		background: var(--color-neutral-50);
		width: 100%;
	}

	.ach-detail__condition-text {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}

	.ach-detail__progress {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}

	.ach-detail__progress-bar {
		flex: 1;
		height: 8px;
		border-radius: 9999px;
		background: var(--color-neutral-200);
	}

	.ach-detail__progress-fill {
		height: 100%;
		border-radius: 9999px;
		background: var(--theme-primary);
		transition: width 0.3s ease;
	}

	.ach-detail__progress-text {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.ach-detail__streak-text {
		font-size: 0.75rem;
		color: var(--theme-accent);
		margin-top: 4px;
	}

	.ach-detail__streak-info {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 4px;
	}

	.ach-detail__achieved {
		font-size: 0.75rem;
		color: var(--theme-accent);
		font-weight: 700;
		margin-top: 4px;
	}

	.ach-detail__meta {
		display: flex;
		gap: 16px;
		font-size: 0.875rem;
	}

	.ach-detail__meta-item {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.ach-detail__meta-value {
		font-weight: 700;
	}

	.ach-detail__meta-value--point {
		color: var(--color-point);
	}

	.ach-detail__meta-label {
		color: var(--color-text-muted);
	}

	.ach-detail__date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
