<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { CATEGORIES } from '$lib/domain/validation/activity';
import AchievementUnlockOverlay from '$lib/ui/components/AchievementUnlockOverlay.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import OmikujiOverlay from '$lib/ui/components/OmikujiOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

// Error state
let errorMessage = $state('');

// Submitting state (多重送信防止)
let submitting = $state(false);

// Record result overlay
let resultOpen = $state(false);
let resultName = $state('');
let resultIcon = $state('');
let resultPoints = $state(0);
let resultLogId = $state(0);
let cancelCountdown = $state(0);
let cancelTimerId = $state<ReturnType<typeof setInterval> | null>(null);
let cancelledMessage = $state(false);

// Achievement unlock overlay
let achievementOpen = $state(false);
let unlockedAchievements = $state<
	{ name: string; icon: string; bonusPoints: number; rarity: string }[]
>([]);

// Special reward overlay
let rewardOpen = $state(false);
let seenRewardId = $state<number | null>(null);

// Login bonus state
let omikujiOpen = $state(false);
let bonusData = $state<{
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
} | null>(null);
let bonusClaiming = $state(false);

// Build recorded counts map: activityId → count
const recordedMap = $derived(
	new Map(data.todayRecorded.map((r) => [r.activityId, r.count])),
);

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false; // unlimited
	return getCount(activity.id) >= limit;
}

// Group activities by category (same as kinder)
const activitiesByCategory = $derived(
	CATEGORIES.map((cat) => ({
		category: cat,
		items: data.activities.filter((a) => a.category === cat),
	})).filter((g) => g.items.length > 0),
);

function startCancelCountdown(until: string) {
	const remaining = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
	cancelCountdown = remaining;

	if (cancelTimerId) clearInterval(cancelTimerId);
	cancelTimerId = setInterval(() => {
		cancelCountdown--;
		if (cancelCountdown <= 0) {
			if (cancelTimerId) clearInterval(cancelTimerId);
			cancelTimerId = null;
		}
	}, 1000);
}

function handleResultClose() {
	if (cancelTimerId) clearInterval(cancelTimerId);
	cancelTimerId = null;
	resultOpen = false;

	if (unlockedAchievements.length > 0) {
		achievementOpen = true;
	} else {
		invalidateAll();
	}
}

function handleAchievementClose() {
	achievementOpen = false;
	unlockedAchievements = [];
	invalidateAll();
}

function handleOmikujiClose() {
	omikujiOpen = false;
	checkSpecialReward();
	invalidateAll();
}

function checkSpecialReward() {
	if (data.latestReward && data.latestReward.id !== seenRewardId) {
		const lastSeenKey = 'ganbari-last-seen-reward';
		const lastSeen = typeof window !== 'undefined' ? localStorage.getItem(lastSeenKey) : null;
		if (lastSeen !== String(data.latestReward.id)) {
			rewardOpen = true;
		}
	}
}

function handleRewardClose() {
	if (data.latestReward) {
		seenRewardId = data.latestReward.id;
		try {
			localStorage.setItem('ganbari-last-seen-reward', String(data.latestReward.id));
		} catch {
			// localStorage unavailable
		}
	}
	rewardOpen = false;
}

// Auto-show login bonus
$effect(() => {
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		bonusClaiming = true;
	}
});

// Check special reward on mount
$effect(() => {
	if (data.latestReward && !bonusClaiming && !omikujiOpen) {
		checkSpecialReward();
	}
});

const categoryColors: Record<string, string> = {
	うんどう: 'var(--color-cat-undou)',
	べんきょう: 'var(--color-cat-benkyou)',
	せいかつ: 'var(--color-cat-seikatsu)',
	こうりゅう: 'var(--color-cat-kouryuu)',
	そうぞう: 'var(--color-cat-souzou)',
};
</script>

<svelte:head>
	<title>ホーム - がんばりクエスト</title>
</svelte:head>

<div class="baby-page">
	<!-- Error toast -->
	{#if errorMessage}
		<div class="baby-error-toast animate-bounce-in">
			{errorMessage}
		</div>
	{/if}

	<!-- Login bonus auto-claim (hidden) -->
	{#if bonusClaiming && !omikujiOpen}
		<form
			method="POST"
			action="?/claimBonus"
			use:enhance={() => {
				return async ({ result }) => {
					if (result.type === 'success' && result.data && 'bonusClaimed' in result.data) {
						const d = result.data as { rank: string; basePoints: number; multiplier: number; totalPoints: number; consecutiveLoginDays: number };
						bonusData = {
							rank: d.rank,
							basePoints: d.basePoints,
							multiplier: d.multiplier,
							totalPoints: d.totalPoints,
							consecutiveDays: d.consecutiveLoginDays,
						};
						omikujiOpen = true;
					}
					bonusClaiming = false;
				};
			}}
			class="hidden"
		>
			<button type="submit" id="claim-bonus-btn">claim</button>
		</form>
		{(() => { if (typeof document !== 'undefined') { document.getElementById('claim-bonus-btn')?.click(); } return ''; })()}
	{/if}

	<!-- Activity grid by category (same layout as kinder, but 1-tap instant record) -->
	{#each activitiesByCategory as group (group.category)}
		<CategorySection category={group.category}>
			{#each group.items as activity (activity.id)}
				{@const completed = isCompleted(activity)}
				{@const borderColor = categoryColors[activity.category] ?? 'var(--theme-primary)'}
				{@const actCount = getCount(activity.id)}
				{#if completed}
					<div
						class="baby-card baby-card--done tap-target"
						aria-label="{activity.name}（きろくずみ）"
					>
						<span class="baby-card__done-badge animate-bounce-in">💮</span>
						<CompoundIcon icon={activity.icon} size="lg" faded={true} />
						<span class="baby-card__name baby-card__name--faded">{activity.name}</span>
					</div>
				{:else}
					<form
						method="POST"
						action="?/record"
						use:enhance={() => {
							if (submitting) return ({ update }) => update();
							submitting = true;
							soundService.ensureContext();
							soundService.play('tap');
							return async ({ result }) => {
								submitting = false;
								if (result.type === 'success' && result.data && 'success' in result.data) {
									const d = result.data as {
										logId: number;
										activityName: string;
										totalPoints: number;
										streakDays: number;
										streakBonus: number;
										cancelableUntil: string;
										unlockedAchievements: { name: string; icon: string; bonusPoints: number; rarity: string }[];
									};
									resultIcon = activity.icon;
									resultName = d.activityName;
									resultPoints = d.totalPoints;
									resultLogId = d.logId;
									unlockedAchievements = d.unlockedAchievements ?? [];
									startCancelCountdown(d.cancelableUntil);
									soundService.play('record-complete');
									resultOpen = true;
								} else if (result.type === 'failure' && result.data && 'error' in result.data) {
									errorMessage = String(result.data.error);
									soundService.play('error');
									setTimeout(() => { errorMessage = ''; }, 3000);
									invalidateAll();
								} else {
									invalidateAll();
								}
							};
						}}
					>
						<input type="hidden" name="activityId" value={activity.id} />
						<button
							type="submit"
							disabled={submitting}
							class="baby-card baby-card--active tap-target"
							style="border-color: {borderColor};"
							aria-label="{activity.name}をきろくする"
						>
							{#if actCount > 0}
								<span class="baby-card__count-badge">{actCount}</span>
							{/if}
							<CompoundIcon icon={activity.icon} size="lg" />
							<span class="baby-card__name">{activity.name}</span>
						</button>
					</form>
				{/if}
			{/each}
		</CategorySection>
	{/each}

	{#if data.activities.length === 0}
		<div class="baby-empty">
			<span class="baby-empty__icon">📋</span>
			<p class="baby-empty__text">かつどうがまだないよ</p>
			<p class="baby-empty__sub">おやにおねがいしてね</p>
		</div>
	{/if}
</div>

<!-- Record result overlay -->
<Dialog bind:open={resultOpen} closable={false} title="">
	<div class="baby-result">
		{#if cancelledMessage}
			<span class="baby-result__emoji">↩️</span>
			<p class="baby-result__text">とりけしました</p>
			<button
				type="button"
				class="tap-target baby-result__btn baby-result__btn--close"
				onclick={() => {
					cancelledMessage = false;
					resultOpen = false;
					invalidateAll();
				}}
			>
				とじる
			</button>
		{:else}
			<span class="animate-bounce-in"><CompoundIcon icon={resultIcon} size="xl" /></span>
			<p class="baby-result__text">{resultName}をきろくしたよ！</p>
			<div class="animate-point-pop">
				<p class="baby-result__points">+{resultPoints} ポイント！</p>
			</div>

			<div class="baby-result__actions">
				{#if cancelCountdown > 0}
					<form
						method="POST"
						action="?/cancelRecord"
						class="baby-result__cancel-form"
						use:enhance={() => {
							return async ({ result }) => {
								if (result.type === 'success' && result.data && 'cancelled' in result.data) {
									if (cancelTimerId) clearInterval(cancelTimerId);
									cancelTimerId = null;
									cancelledMessage = true;
								}
							};
						}}
					>
						<input type="hidden" name="logId" value={resultLogId} />
						<button
							type="submit"
							class="tap-target baby-result__btn baby-result__btn--cancel"
						>
							とりけし ({cancelCountdown}s)
						</button>
					</form>
				{/if}
				<button
					type="button"
					class="tap-target baby-result__btn baby-result__btn--ok"
					onclick={handleResultClose}
				>
					やったね！
				</button>
			</div>
		{/if}
	</div>
</Dialog>

<!-- Achievement unlock overlay -->
{#if unlockedAchievements.length > 0}
	<AchievementUnlockOverlay
		bind:open={achievementOpen}
		achievements={unlockedAchievements}
		onClose={handleAchievementClose}
	/>
{/if}

<!-- Special reward overlay -->
{#if data.latestReward}
	<SpecialRewardOverlay
		bind:open={rewardOpen}
		title={data.latestReward.title}
		points={data.latestReward.points}
		icon={data.latestReward.icon}
		onClose={handleRewardClose}
	/>
{/if}

<!-- Omikuji overlay -->
{#if bonusData}
	<OmikujiOverlay
		bind:open={omikujiOpen}
		rank={bonusData.rank}
		basePoints={bonusData.basePoints}
		multiplier={bonusData.multiplier}
		totalPoints={bonusData.totalPoints}
		consecutiveDays={bonusData.consecutiveDays}
		onClose={handleOmikujiClose}
	/>
{/if}

<style>
	.baby-page {
		padding: 4px 8px;
	}

	/* Activity card - matches ActivityCard component style */
	.baby-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 100%;
		aspect-ratio: 4 / 5;
		min-height: 60px;
		border-radius: 16px;
		border: 2px solid;
		transition: all 0.15s ease;
	}

	.baby-card--active {
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		cursor: pointer;
	}

	.baby-card--active:hover {
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	.baby-card--active:active {
		transform: scale(0.95);
	}

	.baby-card--done {
		background: #fffbeb;
		border-color: #fbbf24;
		box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.3);
	}

	.baby-card__icon {
		font-size: 1.875rem; /* text-3xl */
		line-height: 1;
	}

	.baby-card__icon--faded {
		opacity: 0.4;
	}

	.baby-card__name {
		font-size: 10px;
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.baby-card__name--faded {
		opacity: 0.4;
	}

	.baby-card__done-badge {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.875rem;
		opacity: 0.8;
		z-index: 1;
	}

	.baby-card__count-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #3b82f6;
		color: white;
		font-size: 10px;
		font-weight: 700;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
	}

	/* Empty state */
	.baby-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 0;
		color: var(--color-text-muted);
	}

	.baby-empty__icon {
		font-size: 2.5rem;
		margin-bottom: 16px;
	}

	.baby-empty__text {
		font-size: 1.125rem;
		font-weight: 700;
	}

	.baby-empty__sub {
		font-size: 0.875rem;
	}

	/* Result overlay */
	.baby-result {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		text-align: center;
		padding: 16px 0;
	}

	.baby-result__emoji {
		font-size: 3.5rem;
	}

	.baby-result__text {
		font-size: 1.125rem;
		font-weight: 700;
	}

	.baby-result__points {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-point);
	}

	.baby-result__actions {
		display: flex;
		gap: 8px;
		width: 100%;
	}

	.baby-result__cancel-form {
		flex: 1;
	}

	.baby-result__btn {
		width: 100%;
		padding: 14px 12px;
		border-radius: 12px;
		font-weight: 700;
		font-size: 1.125rem;
		border: none;
		cursor: pointer;
	}

	.baby-result__btn--ok {
		flex: 1;
		background: var(--theme-primary);
		color: white;
	}

	.baby-result__btn--cancel {
		background: #e5e7eb;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.baby-result__btn--close {
		background: #e5e7eb;
	}

	/* Error toast */
	.baby-error-toast {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		background: #ef4444;
		color: white;
		padding: 8px 16px;
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		font-size: 0.875rem;
		font-weight: 700;
	}
</style>
