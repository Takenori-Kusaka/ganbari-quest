<script lang="ts">
// #2775 (Issue #2774 Phase 2): rule-preset exchange の `<a href>` 統一移行に伴い
// `enhance` / `invalidateAll` / `NativeSelect` は本ファイルで未使用となったため import 撤去。
// 5 type 全てが `<a href="/admin/<page>?import=">` に統一され server action 経由 form 取込は消滅。
import { APP_LABELS, formatAgeRange, MARKETPLACE_LABELS } from '$lib/domain/labels';
import type {
	ActivityPackPayload,
	ChallengeSetPayload,
	ChecklistPayload,
	MarketplaceItem,
	PersonaTag,
	RewardSetPayload,
	RulePresetPayload,
} from '$lib/domain/marketplace-item';
import {
	MARKETPLACE_TYPE_ICONS,
	MARKETPLACE_TYPE_LABELS,
	PERSONA_LABELS,
} from '$lib/domain/marketplace-item';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

// #2775: rule-preset exchange を `<a href>` 統一形式に移行したため form prop は撤去
// (5 type 完全統一 — server action 経由の form result を marketplace 詳細で扱う経路は消滅)
let { data } = $props();
// svelte-ignore state_referenced_locally
const item: MarketplaceItem = data.item;

const isActivityPack = $derived(item.type === 'activity-pack');
const isRewardSet = $derived(item.type === 'reward-set');
const isChecklist = $derived(item.type === 'checklist');
const isRulePreset = $derived(item.type === 'rule-preset');
// #2297 (EPIC #2294 ③): challenge-set 表示判定
const isChallengeSet = $derived(item.type === 'challenge-set');
const challengeSetPayload = $derived(isChallengeSet ? (item.payload as ChallengeSetPayload) : null);
const challengeCount = $derived(challengeSetPayload?.challenges.length ?? 0);
// #2297: カテゴリ ID → 名称マッピング (sibling-challenge 5 軸と同一)
const CATEGORY_LABELS: Record<number, string> = {
	1: 'うんどう',
	2: 'べんきょう',
	3: 'せいかつ',
	4: 'こうりゅう',
	5: 'そうぞう',
};

// #2362 PR-4 (ADR-0055 / CWE-598): reward-set 一括追加 UI は admin/rewards 側 ChildSelectionDialog
// に集約。marketplace 詳細では item count のみ表示。selectedChildId / rewardImport state は撤去。
const rewardCount = $derived(isRewardSet ? (item.payload as RewardSetPayload).rewards.length : 0);

// #2138 (MP-3): rule-preset 件数 + ruleType 別 CTA 分岐
const rulePayload = $derived(isRulePreset ? (item.payload as RulePresetPayload) : null);
const ruleCount = $derived(rulePayload ? rulePayload.rules.length : 0);
const ruleType = $derived(rulePayload?.ruleType ?? null);
const isRuleExchange = $derived(isRulePreset && ruleType === 'exchange');
const isRuleBonus = $derived(isRulePreset && ruleType === 'bonus');
const isRulePenalty = $derived(isRulePreset && ruleType === 'penalty');
const isRuleSpecial = $derived(isRulePreset && ruleType === 'special');

// #2775 (Issue #2774 Phase 2): rule-preset exchange を `<a href>` 統一形式に移行したため、
// 旧 in-page form 経由の `ruleImport` form state / `selectedChildIdForRule` / `importingRule` は撤去。
// 取込結果表示は admin/rewards 側 toast / banner に移行。
// #2774 PR #2776 で checklist も `<a href>` 化済のため `selectedChildIdStr` / `importing` も併せて撤去。

const childOptions = $derived(
	(data.children ?? []).map((c) => ({ value: String(c.id), label: c.nickname })),
);

// Round 18 Cluster H (#13/#16/#20/#25/#28): activity-pack subset 選択 UI state
// 既存活動 name と一致するものは default unchecked (重複取込で hidden delete 発生回避)
// それ以外は default checked (現状の 30 件一括取込 UX を後方互換維持)
const activityPackActivities = $derived(
	isActivityPack ? (item.payload as ActivityPackPayload).activities : [],
);
const existingNameSet = $derived(new Set(data.existingActivityNames ?? []));
// svelte-ignore state_referenced_locally
let activitySelections = $state<boolean[]>(
	isActivityPack
		? (item.payload as ActivityPackPayload).activities.map(
				(a) => !(data.existingActivityNames ?? []).includes(a.name),
			)
		: [],
);
const selectedCount = $derived(activitySelections.filter((b) => b).length);
const totalCount = $derived(activityPackActivities.length);
const importUrlWithSubset = $derived.by(() => {
	if (!isActivityPack) return '';
	const indexes = activitySelections
		.map((selected, i) => (selected ? i : -1))
		.filter((i) => i >= 0);
	// 全件選択 (既定 = 既存重複除く全て) は indexes 省略 (後方互換)、subset は CSV で URL に乗せる。
	// CWE-598: childId は乗せない。activity index は機微情報ではない (公開 marketplace SSOT の index)。
	const params = new URLSearchParams({ import: item.itemId });
	if (indexes.length !== totalCount) {
		params.set('indexes', indexes.join(','));
	}
	return `/admin/activities?${params.toString()}`;
});
function selectAllActivities() {
	activitySelections = activitySelections.map(() => true);
}
function deselectAllActivities() {
	activitySelections = activitySelections.map(() => false);
}
</script>

<svelte:head>
	<title>{item.name} - {MARKETPLACE_LABELS.pageTitle}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="description" content={item.description} />
	<!-- OGP for SNS sharing -->
	<meta property="og:title" content="{item.name} - {APP_LABELS.name} {MARKETPLACE_LABELS.pageTitle}" />
	<meta property="og:description" content={item.description} />
	<meta property="og:type" content="website" />
</svelte:head>

<div class="min-h-dvh bg-[var(--color-surface-base)]">
	<div class="max-w-2xl mx-auto px-4 py-8">
		<!-- #2900: 認証済みの親向け header 戻り導線 (browse-first journey の dead-end 解消)。
			未認証 (公開閲覧) では非表示にして marketplace の公開ページ性を維持。 -->
		{#if data.isAuthenticated}
			<div class="mb-4">
				<a
					href="/admin"
					data-testid="marketplace-back-to-admin"
					class="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-action-primary)] hover:underline"
				>
					{MARKETPLACE_LABELS.backToAdmin}
				</a>
			</div>
		{/if}

		<!-- Breadcrumb -->
		<nav class="text-xs text-[var(--color-text-tertiary)] mb-6">
			<a href="/marketplace" class="hover:text-[var(--color-action-primary)]">{MARKETPLACE_LABELS.breadcrumbRoot}</a>
			<span class="mx-1">/</span>
			<a
				href="/marketplace?type={item.type}"
				class="hover:text-[var(--color-action-primary)]"
			>
				{MARKETPLACE_TYPE_LABELS[item.type]}
			</a>
			<span class="mx-1">/</span>
			<span class="text-[var(--color-text-secondary)]">{item.name}</span>
		</nav>

		<!-- Header -->
		<div class="flex items-start gap-4 mb-6">
			<span class="text-5xl">{item.icon}</span>
			<div class="flex-1">
				<div class="flex items-center gap-2 mb-1">
					<Badge variant="info" size="sm">
						{MARKETPLACE_TYPE_ICONS[item.type]} {MARKETPLACE_TYPE_LABELS[item.type]}
					</Badge>
					<Badge variant="info" size="sm">
						{formatAgeRange(item.targetAgeMin, item.targetAgeMax)}
					</Badge>
				</div>
				<h1 class="text-xl font-bold text-[var(--color-text-primary)]">
					{item.name}
				</h1>
				<p class="text-sm text-[var(--color-text-secondary)] mt-1">
					{item.description}
				</p>
			</div>
		</div>

		<!-- Tags -->
		<div class="flex flex-wrap gap-1 mb-4">
			{#each item.tags as tag}
				<a
					href="/marketplace?tag={tag}"
					class="text-xs bg-[var(--color-surface-muted)] text-[var(--color-text-tertiary)] px-2.5 py-1.5 rounded-full hover:text-[var(--color-text-secondary)]"
				>
					{tag}
				</a>
			{/each}
		</div>

		<!-- Persona tags -->
		{#if item.personas.length > 0}
			<div class="flex flex-wrap gap-1 mb-6">
				{#each item.personas as persona}
					<span
						class="text-[10px] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] px-2 py-0.5 rounded-full"
					>
						{PERSONA_LABELS[persona as PersonaTag] ?? persona}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Content preview -->
		<Card padding="lg">
			{#snippet children()}
			<h2 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">
				{#if isActivityPack}
					{MARKETPLACE_LABELS.detailIncludedActivities}
				{:else if isRewardSet}
					{MARKETPLACE_LABELS.detailIncludedRewards}
				{:else if isChecklist}
					{MARKETPLACE_LABELS.detailChecklistItems}
				{:else if isRulePreset}
					{MARKETPLACE_LABELS.detailRuleContent}
				{:else if isChallengeSet}
					{MARKETPLACE_LABELS.detailIncludedChallenges}
				{/if}
			</h2>

			{#if isActivityPack}
				{@const payload = item.payload as ActivityPackPayload}
				<!-- Round 18 Cluster H (#13/#16/#20/#25/#28): subset 選択 UI
					ADR-0012 Anti-engagement: 既定で「既存と重複しないもののみ checked」、preschool 親が
					「30 件は多すぎる、歯磨きとお片付けだけ欲しい」「既存と重複する activity の事前説明なし」
					不満に直接回答する。「すべて選ぶ / すべて外す」で 0 摩擦の subset 編集を提供。 -->
				{#if data.isAuthenticated && data.children.length > 0}
					<div
						class="flex items-center justify-between mb-3 pb-2 border-b border-[var(--color-border-default)]"
					>
						<p
							class="text-xs font-bold text-[var(--color-text-secondary)]"
							data-testid="activity-pack-selected-count"
						>
							{MARKETPLACE_LABELS.detailActivityPackSelectedCount(selectedCount, totalCount)}
						</p>
						<div class="flex gap-2">
							<button
								type="button"
								class="text-xs text-[var(--color-action-primary)] underline hover:no-underline"
								onclick={selectAllActivities}
								data-testid="activity-pack-select-all"
							>
								{MARKETPLACE_LABELS.detailActivityPackSelectAll}
							</button>
							<button
								type="button"
								class="text-xs text-[var(--color-action-primary)] underline hover:no-underline"
								onclick={deselectAllActivities}
								data-testid="activity-pack-deselect-all"
							>
								{MARKETPLACE_LABELS.detailActivityPackDeselectAll}
							</button>
						</div>
					</div>
					<p class="text-xs text-[var(--color-text-tertiary)] mb-3">
						{MARKETPLACE_LABELS.detailActivityPackSelectHint}
					</p>
				{/if}
				<div class="space-y-2">
					{#each payload.activities as act, i}
						{@const isExisting = existingNameSet.has(act.name)}
						<label
							class="flex items-center gap-2 py-1 border-b border-[var(--color-border-subtle)] last:border-0 cursor-pointer"
							data-testid="activity-pack-row"
							data-existing={isExisting ? 'true' : 'false'}
						>
							{#if data.isAuthenticated && data.children.length > 0}
								<input
									type="checkbox"
									bind:checked={activitySelections[i]}
									class="w-4 h-4 accent-[var(--color-action-primary)]"
									data-testid="activity-pack-checkbox-{i}"
									aria-label={act.name}
								/>
							{/if}
							<span class="text-lg">{act.icon}</span>
							<div class="flex-1">
								<span class="text-sm font-medium text-[var(--color-text-primary)]">{act.name}</span>
								{#if isExisting}
									<span
										class="ml-2 text-[10px] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] px-2 py-0.5 rounded-full"
										data-testid="activity-pack-existing-badge"
									>
										{MARKETPLACE_LABELS.detailActivityPackAlreadyExistsBadge}
									</span>
								{/if}
								{#if act.triggerHint}
									<p class="text-xs text-[var(--color-text-tertiary)]">{act.triggerHint}</p>
								{/if}
							</div>
							<span class="text-xs text-[var(--color-text-tertiary)]">+{act.basePoints}P</span>
						</label>
					{/each}
				</div>
			{:else if isRewardSet}
				{@const payload = item.payload as RewardSetPayload}
				<div class="space-y-2">
					{#each payload.rewards as reward}
						<div class="flex items-center gap-2 py-1 border-b border-[var(--color-border-subtle)] last:border-0">
							<span class="text-lg">{reward.icon}</span>
							<div class="flex-1">
								<span class="text-sm font-medium text-[var(--color-text-primary)]">{reward.title}</span>
								{#if reward.description}
									<p class="text-xs text-[var(--color-text-tertiary)]">{reward.description}</p>
								{/if}
							</div>
							<span class="text-xs text-[var(--color-text-tertiary)]">{reward.points}P</span>
						</div>
					{/each}
				</div>
			{:else if isChecklist}
				{@const payload = item.payload as ChecklistPayload}
				<div class="space-y-1">
					{#each payload.items as checkItem}
						<div class="flex items-center gap-2 py-1">
							<span class="text-base">{checkItem.icon}</span>
							<span class="text-sm text-[var(--color-text-primary)]">{checkItem.label}</span>
						</div>
					{/each}
				</div>
			{:else if isRulePreset}
				{@const payload = item.payload as RulePresetPayload}
				<div class="space-y-3">
					{#each payload.rules as rule}
						<div class="p-3 rounded-lg bg-[var(--color-surface-muted)]">
							<div class="flex items-center gap-2 mb-1">
								<span class="text-lg">{rule.icon}</span>
								<span class="text-sm font-bold text-[var(--color-text-primary)]">{rule.title}</span>
							</div>
							<p class="text-xs text-[var(--color-text-secondary)] ml-8">{rule.description}</p>
							{#if rule.pointCost}
								<p class="text-xs text-[var(--color-status-error)] ml-8 mt-1">
									{MARKETPLACE_LABELS.detailRulePointCost}: {rule.pointCost}P
								</p>
							{/if}
							{#if rule.pointBonus}
								<p class="text-xs text-[var(--color-status-success)] ml-8 mt-1">
									{MARKETPLACE_LABELS.detailRulePointBonus}: +{rule.pointBonus}P
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else if isChallengeSet && challengeSetPayload}
				<!-- #2297 (EPIC #2294 ③): challenge-set 内容プレビュー -->
				<div class="space-y-2" data-testid="challenge-set-preview">
					{#each challengeSetPayload.challenges as ch (ch.title)}
						<div class="p-3 rounded-lg bg-[var(--color-surface-muted)]">
							<div class="flex items-center gap-2 mb-1">
								<span class="text-lg">{ch.icon}</span>
								<span class="text-sm font-bold text-[var(--color-text-primary)]">{ch.title}</span>
								<span class="text-[10px] text-[var(--color-text-tertiary)] ml-auto">
									{MARKETPLACE_LABELS.detailChallengePeriod(ch.monthDay, ch.durationDays)}
								</span>
							</div>
							<p class="text-xs text-[var(--color-text-secondary)] ml-8">{ch.description}</p>
							<p class="text-xs text-[var(--color-text-tertiary)] ml-8 mt-1">
								{MARKETPLACE_LABELS.detailChallengeMeta(
									CATEGORY_LABELS[ch.categoryId] ?? '',
									ch.baseTarget,
									ch.rewardPoints,
								)}
							</p>
						</div>
					{/each}
				</div>
			{/if}
			{/snippet}
		</Card>

		<!-- CTA -->
		<div
			class="mt-6 space-y-3 marketplace-cta-sticky"
			data-testid="marketplace-detail-cta"
		>
			{#if isRewardSet && data.isAuthenticated && data.children.length > 0}
				<!-- #2774 (Issue #2774 / User 指摘 #2 #4): 5 type 取込 CTA 統一 — `<a>` 形式 +
				     `?import=` query 一本化。reward-set は admin/rewards 側で
				     ChildSelectionDialog auto-open する mechanism が既存 (#2362 PR-4)、
				     marketplace 側は <a href> 1 行に簡素化。CWE-598 整合維持
				     (URL/body どこにも childId / nickname を露出しない)。 -->
				<a
					href="/admin/rewards?import={item.itemId}"
					class="block"
					data-testid="reward-set-import-cta"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportRewardWithCount(rewardCount)}
					</Button>
				</a>
				<p class="text-xs text-center text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailRewardImportPerChildHint}
				</p>
			{:else if isRewardSet && data.isAuthenticated && data.children.length === 0}
				<!-- #2136 MP-1: ログイン済みだが子供未登録 -->
				<div
					class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)] rounded-xl p-3 text-sm text-center"
					data-testid="reward-import-no-children"
				>
					{MARKETPLACE_LABELS.detailRewardImportNoChildren}
				</div>
				<a href="/setup/children" class="block">
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailRewardImportNoChildren}
					</Button>
				</a>
			{:else if isRewardSet}
				<!-- #2136 MP-1: 未ログイン -> login へ誘導 (#2303: data integrity 保護のため signup ではなく login)。
					login 画面内「新規アカウント作成」リンクで signup へ到達可能。
					redirect query は将来 login が post-login redirect に対応した時のため保持 -->
				<a
					href="/auth/login?redirect=/marketplace/{item.type}/{item.itemId}"
					class="block"
					data-testid="reward-import-signup-cta"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportReward}
					</Button>
				</a>
				<p class="text-xs text-center text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportRewardSignedOut}
				</p>
			{:else if isChecklist && data.isLoggedIn && data.children && data.children.length > 0}
				<!-- #2774 (Issue #2774 / User 指摘 #2 #4): 5 type 取込 CTA 統一 — `<a>` 形式 +
				     `?import=` query 一本化。checklist は admin/checklists 側で
				     ChecklistDistributionDialog auto-open する mechanism が既存 (#2362 PR-5)、
				     marketplace 側は <a href> 1 行に簡素化。CWE-598 整合維持。 -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportChecklistDesc}
				</p>

				<a
					href="/admin/checklists?import={item.itemId}"
					class="block"
					data-testid="checklist-import-cta"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportChecklist}
					</Button>
				</a>
			{:else if isChecklist && data.isLoggedIn && data.children && data.children.length === 0}
				<!-- ログイン済だが子供未登録 -->
				<div
					class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)] rounded-xl p-3 text-sm text-center"
					data-testid="checklist-import-no-children"
				>
					{MARKETPLACE_LABELS.detailRewardImportNoChildren}
				</div>
				<a href="/setup/children" class="block">
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailRewardImportNoChildren}
					</Button>
				</a>
			{:else if isChecklist && !data.isLoggedIn}
				<!-- #2137 (MP-2) / #2303: 未ログイン → login へ誘導 (誤新規登録防止 / data integrity 保護)。
					login 画面内「新規アカウント作成」リンクで signup へ到達可能 -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportChecklistDesc}
				</p>
				<a
					href="/auth/login?next=/marketplace/{item.type}/{item.itemId}"
					class="block"
					data-testid="marketplace-signup-redirect"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaSignupToImport}
					</Button>
				</a>
			{:else if isRulePreset && data.isAuthenticated && isRuleBonus}
				<!-- #2362 PR-6: rule-preset bonus は family scope (tenant 全体に 1 件、childId 不要)。
				     in-page form を撤去し、CWE-598 整合 (childId URL/body 排除) のため
				     /admin/settings/rules?import=<itemId> へ link 遷移 (admin 側で auto-import + toast)。
				     旧 in-page action `?/importRulePreset` (bonus) は廃止。 -->
				<Card padding="md">
					{#snippet children()}
					<p class="text-xs text-[var(--color-text-tertiary)]">
						{MARKETPLACE_LABELS.detailCtaImportRuleDescBonus}
					</p>
					<a
						href="/admin/settings/rules?import={item.itemId}"
						class="block mt-3"
						data-testid="rule-preset-import-bonus-cta"
					>
						<Button variant="primary" size="lg" class="w-full">
							{MARKETPLACE_LABELS.detailCtaImportRuleWithCount(ruleCount)}
						</Button>
					</a>
					{/snippet}
				</Card>
			{:else if isRulePreset && data.isAuthenticated && isRuleExchange && data.children.length > 0}
				<!-- #2775 (Issue #2774 Phase 2): rule-preset exchange CTA を `<a href>` 統一形式に移行。
				     旧 in-page form + NativeSelect childId 選択 UI は撤去し (旧 server action 名称は
				     marketplace-import-flow.md §3.5 を参照、本コメント内では `action=` literal を
				     再記しないことで unit test の grep 偽陽性を回避)、
				     admin/rewards 側 `?import=<presetId>` mechanism (PR #2474 / #2773 整備済) に統合。
				     ChildSelectionDialog auto-open + per-child fan-out で CWE-598 整合
				     (childId URL/body 露出ゼロ) + 5 type 統一形式完成 (docs/design/marketplace-import-flow.md §3.5)。 -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportRuleDescExchange}
				</p>
				<a
					href="/admin/rewards?import={item.itemId}"
					class="block"
					data-testid="rule-preset-import-cta"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportRuleWithCount(ruleCount)}
					</Button>
				</a>
			{:else if isRulePreset && data.isAuthenticated && isRuleExchange && data.children.length === 0}
				<!-- #2138 (MP-3): exchange ruleType だがお子さま未登録 -->
				<div
					class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)] rounded-xl p-3 text-sm text-center"
					data-testid="rule-import-no-children"
				>
					{MARKETPLACE_LABELS.detailRuleImportNoChildrenExchange}
				</div>
				<a href="/setup/children" class="block">
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailRuleImportNoChildrenExchange}
					</Button>
				</a>
			{:else if isRulePreset && data.isAuthenticated && (isRulePenalty || isRuleSpecial)}
				<!-- #2138 (MP-3): penalty / special は ADR-0012 細則により取込試行を warning 表示のみ -->
				<div
					class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)] rounded-xl p-3 text-sm"
					data-testid="rule-import-penalty-warning"
				>
					{#if isRulePenalty}
						{MARKETPLACE_LABELS.detailCtaImportRuleDescPenalty}
					{:else}
						{MARKETPLACE_LABELS.detailCtaImportRuleDescSpecial}
					{/if}
				</div>
			{:else if isRulePreset && !data.isAuthenticated}
				<!-- #2138 (MP-3) / #2303: 未ログイン → login へ誘導 (誤新規登録防止 / data integrity 保護)。
					login 画面内「新規アカウント作成」リンクで signup へ到達可能 -->
				<a
					href="/auth/login?next=/marketplace/rule-preset/{item.itemId}"
					class="block"
					data-testid="rule-import-signup-redirect"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportRule}
					</Button>
				</a>
				<p class="text-xs text-center text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportRuleSignedOut}
				</p>
			{:else if isChallengeSet && data.isAuthenticated}
				<!-- #2297 (EPIC #2294 ③): challenge-set ログイン済 → /admin/challenges に遷移してフォーム pre-fill -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportChallengeSetDesc}
				</p>
				<a
					href="/admin/challenges?import={item.itemId}"
					class="block"
					data-testid="challenge-set-import-cta"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportChallengeSetWithCount(challengeCount)}
					</Button>
				</a>
			{:else if isChallengeSet}
				<!-- #2297 / #2303: challenge-set 未ログイン → login へ誘導 (誤新規登録防止 / data integrity 保護)。
					login 画面内「新規アカウント作成」リンクで signup へ到達可能 -->
				<a
					href="/auth/login?next=/marketplace/challenge-set/{item.itemId}"
					class="block"
					data-testid="challenge-set-signup-redirect"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportChallengeSet}
					</Button>
				</a>
				<p class="text-xs text-center text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportChallengeSetSignedOut}
				</p>
			{:else if isActivityPack && data.isAuthenticated && data.children.length > 0}
				<!-- #2362 PR-3 Phase 5 (CWE-598): activity-pack ログイン済 + 子供登録済
					→ 親管理画面に遷移して ChildSelectionDialog を auto-open (Phase 4 admin の mechanism と接続)。
					URL に childId を渡さず itemId のみ。child binding は admin 側ダイアログで決定する。
					(docs/design/marketplace-import-flow.md §3.1 取込フロー sequence 整合)
					Round 18 Cluster H: subset 選択 (indexes CSV) を URL に追加。
					selectedCount === 0 のときは CTA を disable (誤遷移防止)。 -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportActivityPackDesc}
				</p>
				<!-- Round 18 Cluster H: CTA <a> は常時 render (CWE-598 spec count >= 1 担保)。
					 selectedCount === 0 時は aria-disabled + preventDefault で nav 無効化、視覚的にも disabled 表現。
					 既存 marketplace-activity-pack-no-childid.spec.ts (AC1/AC2) との互換維持。 -->
				<a
					href={selectedCount > 0 ? importUrlWithSubset : `/admin/activities?import=${item.itemId}`}
					class="block"
					class:opacity-50={selectedCount === 0}
					class:cursor-not-allowed={selectedCount === 0}
					aria-disabled={selectedCount === 0}
					data-testid="activity-pack-import-cta"
					onclick={(e) => {
						if (selectedCount === 0) e.preventDefault();
					}}
				>
					<Button variant="primary" size="lg" class="w-full" disabled={selectedCount === 0}>
						{selectedCount > 0
							? MARKETPLACE_LABELS.detailCtaImportActivityPackSelected(selectedCount)
							: MARKETPLACE_LABELS.detailActivityPackSelectedZero}
					</Button>
				</a>
			{:else if isActivityPack && data.isAuthenticated && data.children.length === 0}
				<!-- #2362 PR-3 Phase 5: activity-pack ログイン済 + 子供未登録 → setup 誘導 -->
				<div
					class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)] rounded-xl p-3 text-sm text-center"
					data-testid="activity-pack-import-no-children"
				>
					{MARKETPLACE_LABELS.detailCtaImportActivityPackNoChildren}
				</div>
				<a href="/setup/children" class="block">
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportActivityPackNoChildren}
					</Button>
				</a>
			{:else if isActivityPack}
				<!-- #2362 PR-3 Phase 5 / #2303: activity-pack 未ログイン → /auth/login (誤新規登録防止 / data integrity 保護)。
					next query で取込再開動線を維持 (login 後 admin/activities?import=<itemId> へ遷移して auto-open) -->
				<a
					href="/auth/login?next=/admin/activities?import={item.itemId}"
					class="block"
					data-testid="activity-pack-signup-redirect"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportActivityPack}
					</Button>
				</a>
				<p class="text-xs text-center text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportActivityPackSignedOut}
				</p>
			{:else}
				<!-- fallback: 想定外の type (将来追加 type) は signup 一般動線 -->
				<a href="/auth/login" class="block">
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaSignup}
					</Button>
				</a>
			{/if}
		</div>

		<!-- Back -->
		<div class="text-center mt-6">
			<a
				href="/marketplace?type={item.type}"
				class="text-sm text-[var(--color-action-primary)] hover:underline"
			>
				{MARKETPLACE_TYPE_LABELS[item.type]}{MARKETPLACE_LABELS.backToTypeListSuffix}
			</a>
		</div>
	</div>
</div>

<style>
	/* Round 18 Cluster F: mobile sticky CTA for fold visibility
	 * DESIGN.md §10 --z-banner token (below modal, above normal flow)
	 * desktop (>= 768px) keeps normal flow (wider viewport, low scroll cost)
	 * ADR-0012 Anti-engagement: visibility purpose only, not session extension */
	.marketplace-cta-sticky {
		position: sticky;
		bottom: 0;
		z-index: var(--z-banner);
		background: var(--color-surface);
		padding-top: 0.75rem;
		padding-bottom: env(safe-area-inset-bottom, 0);
		margin-left: -1rem;
		margin-right: -1rem;
		padding-left: 1rem;
		padding-right: 1rem;
		box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
	}

	@media (min-width: 768px) {
		/* desktop: normal flow restore (wider viewport, low scroll cost) */
		.marketplace-cta-sticky {
			position: static;
			box-shadow: none;
			background: transparent;
			padding-top: 0;
			padding-bottom: 0;
			padding-left: 0;
			padding-right: 0;
			margin-left: 0;
			margin-right: 0;
		}
	}
</style>
