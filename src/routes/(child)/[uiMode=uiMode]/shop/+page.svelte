<script lang="ts">
import { page } from '$app/state';
import { APP_LABELS, CHILD_SHOP_LABELS } from '$lib/domain/labels';
import type { ShopCategory } from '$lib/domain/shop-category';
import type { UiMode } from '$lib/domain/validation/age-tier';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Tabs from '$lib/ui/primitives/Tabs.svelte';
import ConfirmExchangeDialog from './ConfirmExchangeDialog.svelte';

let { data, form } = $props();

let confirmDialogOpen = $state(false);
let selectedRewardId = $state<number | null>(null);
let selectedRewardTitle = $state('');
let selectedRewardPoints = $state(0);
let selectedRewardIcon = $state<string | null>(null);

// #2157: ショップ 3 系統タブ (実物 / お小遣い / 特権)
// 'all' = すべて, 'physical' / 'money' / 'privilege' は ShopCategory key 整合
type TabValue = 'all' | ShopCategory;
// Tabs primitive は value: string で bind するため、`string` 型で保持し
// 利用箇所では derived で TabValue に narrow する。
let activeTabRaw = $state<string>('all');
const activeTab = $derived<TabValue>(
	activeTabRaw === 'physical' || activeTabRaw === 'money' || activeTabRaw === 'privilege'
		? activeTabRaw
		: 'all',
);

// #2160: フィルタ (ポイント範囲 + 交換可能)
type PointsRange = 'all' | 'low' | 'mid' | 'high';
let pointsRangeFilter = $state<PointsRange>('all');
let availableOnlyFilter = $state(false);

const tabItems = [
	{ value: 'all', label: CHILD_SHOP_LABELS.tabAll },
	{ value: 'physical', label: CHILD_SHOP_LABELS.tabPhysical },
	{ value: 'money', label: CHILD_SHOP_LABELS.tabAllowance },
	{ value: 'privilege', label: CHILD_SHOP_LABELS.tabPrivilege },
] satisfies Array<{ value: TabValue; label: string }>;

// #2156: 年齢別 Grid カラム数 (uiMode に基づき min カラム幅を切替)
const uiMode = $derived((page.params.uiMode ?? 'elementary') as UiMode);
const gridMin = $derived.by(() => {
	switch (uiMode) {
		case 'baby':
		case 'preschool':
			return '320px';
		case 'elementary':
			return '280px';
		case 'junior':
		case 'senior':
			return '240px';
		default:
			return '280px';
	}
});

// タブ別の reward 配列（#2157 AC2）
const rewardsByTab = $derived.by(() => {
	if (activeTab === 'all') return data.rewards;
	return data.rewards.filter((r) => r.shopCategory === activeTab);
});

// フィルタ適用後の reward 配列（#2160 AC1 / AC2）
const filteredRewards = $derived.by(() => {
	let list = rewardsByTab;
	if (pointsRangeFilter === 'low') {
		list = list.filter((r) => r.points <= 100);
	} else if (pointsRangeFilter === 'mid') {
		list = list.filter((r) => r.points > 100 && r.points < 500);
	} else if (pointsRangeFilter === 'high') {
		list = list.filter((r) => r.points >= 500);
	}
	if (availableOnlyFilter) {
		list = list.filter((r) => data.balance >= r.points);
	}
	return list;
});

// バッジ表示用（#2160 AC3）
const isFilterActive = $derived(pointsRangeFilter !== 'all' || availableOnlyFilter);
const filterBadgeText = $derived(
	CHILD_SHOP_LABELS.filterBadge(rewardsByTab.length, filteredRewards.length),
);

// タブ別 empty 文言
const activeTabLabel = $derived(tabItems.find((t) => t.value === activeTab)?.label ?? '');

function openConfirmDialog(id: number, title: string, points: number, icon: string | null) {
	selectedRewardId = id;
	selectedRewardTitle = title;
	selectedRewardPoints = points;
	selectedRewardIcon = icon;
	confirmDialogOpen = true;
}

function closeConfirmDialog() {
	confirmDialogOpen = false;
	selectedRewardId = null;
}

function resetFilters() {
	pointsRangeFilter = 'all';
	availableOnlyFilter = false;
}

const pageTitle = $derived(`${CHILD_SHOP_LABELS.pageTitle}${APP_LABELS.pageTitleSuffix}`);
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="shop-page" data-testid="shop-page">
	<div class="balance-banner">
		<span class="balance-label">{CHILD_SHOP_LABELS.pointBalanceLabel}</span>
		<span class="balance-value" data-testid="point-balance">
			{data.balance}
			<span class="balance-unit">{CHILD_SHOP_LABELS.pointUnit}</span>
		</span>
	</div>

	{#if form?.error}
		<Alert variant="danger" message={form.error} />
	{/if}

	{#if data.rewards.length === 0}
		<div class="empty-state">
			<Alert variant="info" message={CHILD_SHOP_LABELS.emptyMessage} />
		</div>
	{:else}
		<!-- #2157 3 系統タブ (Ark UI Tabs primitive) -->
		<div class="shop-tabs" aria-label={CHILD_SHOP_LABELS.tabsAriaLabel}>
			<Tabs items={tabItems} bind:value={activeTabRaw}>
				{#snippet children(_tabValue: string)}
					<!-- #2160 フィルタ UI -->
					<div
						class="shop-filters"
						data-testid="shop-filters"
					>
						<fieldset
							class="filter-points-range"
							aria-label={CHILD_SHOP_LABELS.filterPointsRangeAriaLabel}
						>
							<legend class="filter-legend">
								{CHILD_SHOP_LABELS.filterPointsRangeLabel}
							</legend>
							<div class="filter-buttons">
								<Button
									variant={pointsRangeFilter === 'all' ? 'primary' : 'ghost'}
									size="sm"
									onclick={() => {
										pointsRangeFilter = 'all';
									}}
									data-testid="filter-points-range-all"
								>
									{CHILD_SHOP_LABELS.filterPointsRangeAll}
								</Button>
								<Button
									variant={pointsRangeFilter === 'low' ? 'primary' : 'ghost'}
									size="sm"
									onclick={() => {
										pointsRangeFilter = 'low';
									}}
									data-testid="filter-points-range-low"
								>
									{CHILD_SHOP_LABELS.filterPointsRangeLow}
								</Button>
								<Button
									variant={pointsRangeFilter === 'mid' ? 'primary' : 'ghost'}
									size="sm"
									onclick={() => {
										pointsRangeFilter = 'mid';
									}}
									data-testid="filter-points-range-mid"
								>
									{CHILD_SHOP_LABELS.filterPointsRangeMid}
								</Button>
								<Button
									variant={pointsRangeFilter === 'high' ? 'primary' : 'ghost'}
									size="sm"
									onclick={() => {
										pointsRangeFilter = 'high';
									}}
									data-testid="filter-points-range-high"
								>
									{CHILD_SHOP_LABELS.filterPointsRangeHigh}
								</Button>
							</div>
						</fieldset>

						<label class="filter-available">
							<input
								type="checkbox"
								bind:checked={availableOnlyFilter}
								aria-label={CHILD_SHOP_LABELS.filterAvailableAriaLabel}
								data-testid="filter-available"
							/>
							<span>{CHILD_SHOP_LABELS.filterAvailable}</span>
						</label>

						{#if isFilterActive}
							<div class="filter-badge-row">
								<Badge variant="info" data-testid="filter-badge">
									{filterBadgeText}
								</Badge>
								<Button
									variant="ghost"
									size="sm"
									onclick={resetFilters}
									data-testid="filter-reset"
								>
									{CHILD_SHOP_LABELS.filterReset}
								</Button>
							</div>
						{/if}
					</div>

					{#if rewardsByTab.length === 0}
						<div class="empty-state" data-testid="tab-empty-{activeTab}">
							<Alert variant="info" message={CHILD_SHOP_LABELS.tabEmpty(activeTabLabel)} />
						</div>
					{:else if filteredRewards.length === 0}
						<div class="empty-state" data-testid="filter-empty">
							<Alert variant="info" message={CHILD_SHOP_LABELS.filterEmptyMessage} />
						</div>
					{:else}
						<ul
							class="reward-list"
							aria-label={CHILD_SHOP_LABELS.rewardListAriaLabel}
							data-testid="reward-grid"
							style:--reward-grid-min={gridMin}
						>
							{#each filteredRewards as reward (reward.id)}
								{@const canExchange =
									data.balance >= reward.points &&
									reward.latestRequestStatus !== 'pending_parent_approval'}
								{@const remaining = reward.points - data.balance}

								<li>
									<Card>
										<div
											class="reward-card"
											data-testid="reward-card-{reward.id}"
											data-shop-category={reward.shopCategory}
										>
											<div class="reward-icon-wrap">
												<span class="reward-icon" aria-hidden="true">{reward.icon ?? '🎁'}</span>
											</div>
											<div class="reward-info">
												<p class="reward-title">{reward.title}</p>
												<p class="reward-points">
													<span class="reward-points-num">{reward.points}</span>
													<span class="reward-points-unit">{CHILD_SHOP_LABELS.pointUnit}</span>
												</p>

												{#if reward.latestRequestStatus === 'pending_parent_approval'}
													<Badge variant="warning">{CHILD_SHOP_LABELS.statusPending}</Badge>
												{:else if reward.latestRequestStatus === 'approved'}
													<Badge variant="success">{CHILD_SHOP_LABELS.statusApproved}</Badge>
												{:else if reward.latestRequestStatus === 'rejected'}
													<Badge variant="neutral">{CHILD_SHOP_LABELS.statusRejected}</Badge>
												{/if}

												{#if data.balance < reward.points && reward.latestRequestStatus !== 'pending_parent_approval'}
													<div
														class="progress-wrap"
														aria-label={CHILD_SHOP_LABELS.pointProgressAriaLabel}
													>
														<progress
															max={reward.points}
															value={data.balance}
															class="progress-bar"
														></progress>
														<span class="progress-hint">
															{CHILD_SHOP_LABELS.insufficientPointsHint(remaining)}
														</span>
													</div>
												{/if}
											</div>

											{#if reward.latestRequestStatus !== 'pending_parent_approval'}
												<div class="reward-action">
													<Button
														variant={canExchange ? 'primary' : 'ghost'}
														disabled={!canExchange}
														onclick={() =>
															openConfirmDialog(
																reward.id,
																reward.title,
																reward.points,
																reward.icon ?? null,
															)}
														data-testid="exchange-btn-{reward.id}"
													>
														{CHILD_SHOP_LABELS.exchangeButton}
													</Button>
												</div>
											{/if}
										</div>
									</Card>
								</li>
							{/each}
						</ul>
					{/if}
				{/snippet}
			</Tabs>
		</div>
	{/if}
</div>

<ConfirmExchangeDialog
	bind:open={confirmDialogOpen}
	rewardId={selectedRewardId}
	rewardTitle={selectedRewardTitle}
	rewardPoints={selectedRewardPoints}
	rewardIcon={selectedRewardIcon}
	onClose={closeConfirmDialog}
/>

<style>
	.shop-page { padding: var(--sp-md); max-width: 1440px; margin: 0 auto; }
	.balance-banner {
		display: flex; align-items: center; justify-content: space-between;
		background-color: var(--color-surface-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--sp-md) var(--sp-lg);
		margin-bottom: var(--sp-md);
		gap: var(--sp-sm);
	}
	.balance-label { font-size: 0.9rem; color: var(--color-text-secondary); }
	.balance-value { font-size: 1.5rem; font-weight: bold; color: var(--color-action-accent); }
	.balance-unit { font-size: 0.85rem; font-weight: normal; margin-left: 2px; }
	.shop-tabs { margin-bottom: var(--sp-md); }
	.shop-filters {
		display: flex; flex-direction: column; gap: var(--sp-sm);
		background-color: var(--color-surface-muted);
		border-radius: var(--radius-md);
		padding: var(--sp-sm) var(--sp-md);
		margin-bottom: var(--sp-md);
	}
	.filter-points-range { border: 0; padding: 0; margin: 0; }
	.filter-legend {
		font-size: 0.8rem; color: var(--color-text-secondary);
		padding: 0 0 4px 0;
	}
	.filter-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
	.filter-available {
		display: inline-flex; align-items: center; gap: 6px;
		font-size: 0.9rem; color: var(--color-text); cursor: pointer;
		padding: 4px 0;
	}
	.filter-badge-row {
		display: flex; align-items: center; gap: var(--sp-sm);
		flex-wrap: wrap;
	}
	.empty-state { margin-top: var(--sp-md); }
	.reward-list {
		list-style: none; padding: 0; margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(var(--reward-grid-min, 280px), 1fr));
		gap: var(--sp-md);
	}
	.reward-card { display: flex; align-items: center; gap: var(--sp-sm); }
	.reward-icon-wrap { flex-shrink: 0; }
	.reward-icon { font-size: 2.5rem; line-height: 1; }
	.reward-info {
		flex: 1; min-width: 0;
		display: flex; flex-direction: column; gap: 2px;
	}
	.reward-title {
		font-weight: bold; font-size: 1rem; margin: 0;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.reward-points { font-size: 0.9rem; color: var(--color-text-secondary); margin: 0; }
	.reward-points-num { font-weight: bold; color: var(--color-action-accent); }
	.reward-points-unit { font-size: 0.8rem; }
	.progress-wrap { margin-top: 4px; }
	.progress-bar {
		width: 100%; height: 6px; border-radius: 3px;
		appearance: none; background-color: var(--color-surface-secondary);
	}
	.progress-bar::-webkit-progress-bar { background-color: var(--color-surface-secondary); border-radius: 3px; }
	.progress-bar::-webkit-progress-value { background-color: var(--color-action-primary); border-radius: 3px; }
	.progress-hint { font-size: 0.75rem; color: var(--color-text-muted); }
	.reward-action { flex-shrink: 0; }
</style>
