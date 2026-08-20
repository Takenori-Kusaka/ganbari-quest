<script lang="ts">
import { page } from '$app/state';
import { APP_LABELS, getChildShopLabels } from '$lib/domain/labels';
import { formatPointDisplayText, splitPointDisplay } from '$lib/domain/point-display';
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
let selectedRewardId = $state<string | null>(null);
let selectedRewardTitle = $state('');
let selectedRewardPoints = $state(0);
let selectedRewardIcon = $state<string | null>(null);

// #2157: ショップ 3 系統タブ (実物 / お小遣い / 特権)
// 'all' = すべて, 'physical' / 'money' / 'privilege' は ShopCategory key 整合
type TabValue = 'all' | ShopCategory;
// Tabs primitive は value: string で bind するため、`string` 型で保持。
// snippet 引数で各 panel に tabValue が渡されるので、active 判定は不要。
let activeTabRaw = $state<string>('all');

// #2160: フィルタ (ポイント範囲 + 交換可能)
type PointsRange = 'all' | 'low' | 'mid' | 'high';
let pointsRangeFilter = $state<PointsRange>('all');
let availableOnlyFilter = $state(false);

// #4417 (CSS 側の意図。lint がスタイルブロック内の日本語コメントを許さないためここに置く):
// `.reward-list` の grid track 下限は `minmax(min(var(--reward-grid-min), 100%), 1fr)` で指定する。
// 年齢別の最小カラム幅 (下記 gridMin、baby / preschool = 320px) が viewport 幅を上回る端末では
// トラックが必ずあふれるため、min() で「器の幅」を上限にして頭打ちにする。
// #2156: 年齢別 Grid カラム数 (uiMode に基づき min カラム幅を切替)
const uiMode = $derived((page.params.uiMode ?? 'elementary') as UiMode);
// #4690 F4: 表示文言は年齢帯で文体が変わる (docs/DESIGN.md §8)。
// junior / senior は漢字変種を使うため、CHILD_SHOP_LABELS を直参照しない。
const L = $derived(getChildShopLabels(uiMode));
const tabItems = $derived([
	{ value: 'all', label: L.tabAll },
	{ value: 'physical', label: L.tabPhysical },
	{ value: 'money', label: L.tabAllowance },
	{ value: 'privilege', label: L.tabPrivilege },
] satisfies Array<{ value: TabValue; label: string }>);
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

// タブ別の reward 配列を返す関数（#2157 AC2）
// Ark UI Tabs.Content は非アクティブタブも DOM に並列マウントされる (display: none 隠蔽) ため、
// snippet 引数 `tabValue` で各 panel を独立 filter し、reward の DOM 重複を避ける。
function rewardsForTab(tabValue: string) {
	if (tabValue === 'physical' || tabValue === 'money' || tabValue === 'privilege') {
		return data.rewards.filter((r) => r.shopCategory === tabValue);
	}
	return data.rewards;
}

// フィルタ適用後の reward 配列（#2160 AC1 / AC2）
function applyFilters(rewards: typeof data.rewards) {
	let list = rewards;
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
}

// バッジ表示制御（#2160 AC3） — snippet 内で各 panel ごとに件数を計算するので
// グローバル derived は表示判定のみ
const isFilterActive = $derived(pointsRangeFilter !== 'all' || availableOnlyFilter);

// タブラベル取得 (tab-empty alert 用)
function tabLabelFor(tabValue: string) {
	return tabItems.find((t) => t.value === tabValue)?.label ?? '';
}

function openConfirmDialog(id: string, title: string, points: number, icon: string | null) {
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

const pageTitle = $derived(`${L.pageTitle}${APP_LABELS.pageTitleSuffix}`);

// #4509 ②: 残高 / 価格 / 不足分は必ずポイント表示設定 (point / currency + rate) を通す。
// 通さないと、同じ画面のヘッダー (円換算) と桁の違う数字が並び、子供には
// 「買えるのかどうか」が読めなくなる。
const ps = $derived(data.pointSettings);
const ptsParts = (points: number) => splitPointDisplay(points, ps, L.pointUnit);
// #4556: 文中に埋め込む連結は必ず formatPointDisplayText を通す (連結を画面ごとに書くと
// 「あと 250 ポイント」→「のこり: 250ポイント」のように同一 CUJ 内で表記が割れる)。
const ptsText = (points: number) => formatPointDisplayText(points, ps, L.pointUnit);
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="shop-page" data-testid="shop-page">
	<div class="balance-banner">
		<span class="balance-label">{L.pointBalanceLabel}</span>
		<span class="balance-value" data-testid="point-balance">
			{ptsParts(data.balance).amount}
			{#if ptsParts(data.balance).unit}
				<span class="balance-unit">{ptsParts(data.balance).unit}</span>
			{/if}
		</span>
	</div>

	{#if form?.error}
		<Alert variant="danger" message={form.error} />
	{/if}

	{#if data.rewards.length === 0}
		<div class="empty-state">
			<Alert variant="info" message={L.emptyMessage} />
		</div>
	{:else}
		<!-- #2157 3 系統タブ (Ark UI Tabs primitive) -->
		<div class="shop-tabs" aria-label={L.tabsAriaLabel}>
			<!-- lazyMount + unmountOnExit: 非アクティブ panel を DOM から外し、
			     同一 reward が全タブで多重 match する Playwright strict mode 違反を防ぐ。 -->
			<Tabs items={tabItems} bind:value={activeTabRaw} lazyMount unmountOnExit>
				{#snippet children(tabValue: string)}
					{@const panelRewards = rewardsForTab(tabValue)}
					{@const panelFiltered = applyFilters(panelRewards)}
					{@const panelTabLabel = tabLabelFor(tabValue)}
					<!-- #2160 フィルタ UI -->
					<div
						class="shop-filters"
						data-testid="shop-filters"
					>
						<fieldset
							class="filter-points-range"
							aria-label={L.filterPointsRangeAriaLabel}
						>
							<legend class="filter-legend">
								{L.filterPointsRangeLabel}
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
									{L.filterPointsRangeAll}
								</Button>
								<Button
									variant={pointsRangeFilter === 'low' ? 'primary' : 'ghost'}
									size="sm"
									onclick={() => {
										pointsRangeFilter = 'low';
									}}
									data-testid="filter-points-range-low"
								>
									{L.filterPointsRangeLow}
								</Button>
								<Button
									variant={pointsRangeFilter === 'mid' ? 'primary' : 'ghost'}
									size="sm"
									onclick={() => {
										pointsRangeFilter = 'mid';
									}}
									data-testid="filter-points-range-mid"
								>
									{L.filterPointsRangeMid}
								</Button>
								<Button
									variant={pointsRangeFilter === 'high' ? 'primary' : 'ghost'}
									size="sm"
									onclick={() => {
										pointsRangeFilter = 'high';
									}}
									data-testid="filter-points-range-high"
								>
									{L.filterPointsRangeHigh}
								</Button>
							</div>
						</fieldset>

						<label class="filter-available">
							<input
								type="checkbox"
								bind:checked={availableOnlyFilter}
								aria-label={L.filterAvailableAriaLabel}
								data-testid="filter-available"
							/>
							<span>{L.filterAvailable}</span>
						</label>

						{#if isFilterActive}
							<div class="filter-badge-row">
								<Badge variant="info" data-testid="filter-badge">
									{L.filterBadge(panelRewards.length, panelFiltered.length)}
								</Badge>
								<Button
									variant="ghost"
									size="sm"
									onclick={resetFilters}
									data-testid="filter-reset"
								>
									{L.filterReset}
								</Button>
							</div>
						{/if}
					</div>

					{#if panelRewards.length === 0}
						<div class="empty-state" data-testid="tab-empty-{tabValue}">
							<Alert variant="info" message={L.tabEmpty(panelTabLabel)} />
						</div>
					{:else if panelFiltered.length === 0}
						<div class="empty-state" data-testid="filter-empty">
							<Alert variant="info" message={L.filterEmptyMessage} />
						</div>
					{:else}
						<ul
							class="reward-list"
							aria-label={L.rewardListAriaLabel}
							data-testid="reward-grid"
							style:--reward-grid-min={gridMin}
						>
							{#each panelFiltered as reward (reward.id)}
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
													<span class="reward-points-num">{ptsParts(reward.points).amount}</span>
													{#if ptsParts(reward.points).unit}
														<span class="reward-points-unit">{ptsParts(reward.points).unit}</span>
													{/if}
												</p>

												{#if reward.latestRequestStatus === 'pending_parent_approval'}
													<Badge variant="warning">{L.statusPending}</Badge>
												{:else if reward.latestRequestStatus === 'approved'}
													<Badge variant="success">{L.statusApproved}</Badge>
												{:else if reward.latestRequestStatus === 'rejected'}
													<Badge variant="neutral">{L.statusRejected}</Badge>
												{/if}

												{#if data.balance < reward.points && reward.latestRequestStatus !== 'pending_parent_approval'}
													<div
														class="progress-wrap"
														aria-label={L.pointProgressAriaLabel}
													>
														<progress
															max={reward.points}
															value={data.balance}
															class="progress-bar"
														></progress>
														<span class="progress-hint">
															{L.insufficientPointsHint(ptsText(remaining))}
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
														{L.exchangeButton}
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
	balance={data.balance}
	pointSettings={data.pointSettings}
	{uiMode}
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
		grid-template-columns: repeat(auto-fill, minmax(min(var(--reward-grid-min, 280px), 100%), 1fr));
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
