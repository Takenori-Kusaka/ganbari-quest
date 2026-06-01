<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
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
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();
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

const ruleImport = $derived(
	(
		form as {
			ruleImport?: {
				alreadyImported?: boolean;
				presetName?: string;
				ruleType?: string;
				imported?: number;
				skipped?: number;
				warnings?: string[];
				errors?: string[];
			};
		} | null
	)?.ruleImport,
);

// #2137 (MP-2): checklist 一括追加用 state
//   selectedChildIdStr は NativeSelect bind:value 互換のため string 保持。
//   form 送信時は string → number 変換せず name="childId" の value 文字列を直接送る。
// svelte-ignore state_referenced_locally
let selectedChildIdStr = $state<string>(
	// svelte-ignore state_referenced_locally
	data.children && data.children.length > 0 ? String(data.children[0]?.id ?? '') : '',
);
let importing = $state(false);

// #2138 (MP-3): rule-preset 一括追加用 state (childId は exchange のみ必須)
// svelte-ignore state_referenced_locally
let selectedChildIdForRule = $state<number>(
	// svelte-ignore state_referenced_locally
	data.children && data.children.length > 0 ? (data.children[0]?.id ?? 0) : 0,
);
let importingRule = $state(false);

const childOptions = $derived(
	(data.children ?? []).map((c) => ({ value: String(c.id), label: c.nickname })),
);
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
					class="text-[10px] bg-[var(--color-surface-muted)] text-[var(--color-text-tertiary)] px-2 py-0.5 rounded-full hover:text-[var(--color-text-secondary)]"
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
				<div class="space-y-2">
					{#each payload.activities as act}
						<div class="flex items-center gap-2 py-1 border-b border-[var(--color-border-subtle)] last:border-0">
							<span class="text-lg">{act.icon}</span>
							<div class="flex-1">
								<span class="text-sm font-medium text-[var(--color-text-primary)]">{act.name}</span>
								{#if act.triggerHint}
									<p class="text-xs text-[var(--color-text-tertiary)]">{act.triggerHint}</p>
								{/if}
							</div>
							<span class="text-xs text-[var(--color-text-tertiary)]">+{act.basePoints}P</span>
						</div>
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
				<!-- #2362 PR-4 (ADR-0055 / CWE-598): child 選択 UI を marketplace 側から削除。
				     「取込」 button のみ表示し、押下後は admin/rewards へ `?import=<itemId>`
				     遷移、admin 側で ChildSelectionDialog auto-open する。
				     URL/body どこにも childId / nickname を露出しない。 -->
				<form
					method="POST"
					action="?/importRewardSet"
					use:enhance
					data-testid="reward-import-form"
				>
					<Button
						type="submit"
						variant="primary"
						size="lg"
						class="w-full"
						data-testid="reward-import-submit"
					>
						{MARKETPLACE_LABELS.detailCtaImportRewardWithCount(rewardCount)}
					</Button>
				</form>
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
				<!-- #2362 PR-5 Phase 2 (ADR-0055 / CWE-598): family scope のため child 選択 UI を
				     marketplace 側から削除。「取込」 button のみ表示し、押下後は admin/checklists へ
				     `?import=<itemId>` 遷移、admin 側で ChecklistDistributionDialog auto-open する。
				     URL/body どこにも childId / nickname を露出しない (PR-4 reward-set と同型)。 -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportChecklistDesc}
				</p>

				<form
					method="POST"
					action="?/importChecklist"
					use:enhance
					data-testid="checklist-import-form"
				>
					<Button
						type="submit"
						variant="primary"
						size="lg"
						class="w-full"
						data-testid="checklist-import-submit"
					>
						{MARKETPLACE_LABELS.detailCtaImportChecklist}
					</Button>
				</form>
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
						data-testid="rule-import-bonus-redirect"
					>
						<Button variant="primary" size="lg" class="w-full">
							{MARKETPLACE_LABELS.detailCtaImportRuleWithCount(ruleCount)}
						</Button>
					</a>
					{/snippet}
				</Card>
			{:else if isRulePreset && data.isAuthenticated && isRuleExchange && data.children.length > 0}
				<!-- #2138 (MP-3): rule-preset exchange 一括追加 CTA (childId 必須、per-child)。
				     exchange は marketplace 削除予定 (#2445 / I1) のため、暫定的に従来通り維持。 -->
				<Card padding="md">
					{#snippet children()}
					<p class="text-xs text-[var(--color-text-tertiary)]">
						{MARKETPLACE_LABELS.detailCtaImportRuleDescExchange}
					</p>

					{#if ruleImport}
						{#if ruleImport.alreadyImported}
							<div
								class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)] rounded-xl p-3 text-sm text-center mt-3"
								data-testid="rule-import-result-duplicate"
							>
								{MARKETPLACE_LABELS.detailRuleImportDuplicate(ruleImport.presetName ?? '')}
							</div>
						{:else if (ruleImport.imported ?? 0) > 0}
							<div
								class="bg-[var(--color-feedback-success-bg)] border border-[var(--color-feedback-success-border)] text-[var(--color-feedback-success-text)] rounded-xl p-3 text-sm text-center mt-3"
								data-testid="rule-import-result-success"
							>
								{#if ruleImport.ruleType === 'exchange'}
									{MARKETPLACE_LABELS.detailRuleImportSuccessExchange(
										ruleImport.presetName ?? '',
										ruleImport.imported ?? 0,
									)}
								{/if}
								<div class="text-xs mt-1">
									<a href="/admin/rewards" class="underline">
										{MARKETPLACE_LABELS.detailRuleImportLinkToRewardsList}
									</a>
								</div>
							</div>
						{/if}
					{/if}

					<form
						method="POST"
						action="?/importRulePreset"
						use:enhance={() => {
							importingRule = true;
							return async ({ update }) => {
								await update();
								importingRule = false;
								await invalidateAll();
							};
						}}
						class="space-y-3 mt-3"
						data-testid="rule-import-form"
					>
						<label class="block">
							<span class="text-xs font-bold text-[var(--color-text-secondary)] block mb-1">
								{MARKETPLACE_LABELS.detailCtaSelectChild}
							</span>
							<NativeSelect
								name="childId"
								bind:value={selectedChildIdForRule}
								options={data.children.map((c) => ({
									value: c.id,
									label: c.nickname,
								}))}
							/>
						</label>
						<Button
							type="submit"
							variant="primary"
							size="lg"
							class="w-full"
							disabled={importingRule}
							data-testid="rule-import-submit"
						>
							{MARKETPLACE_LABELS.detailCtaImportRuleWithCount(ruleCount)}
						</Button>
					</form>
					{/snippet}
				</Card>
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
					href="/admin/challenges?marketplace-import={item.itemId}"
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
					(docs/design/marketplace-import-flow.md §3.1 取込フロー sequence 整合) -->
				{@const activityPackPayload = item.payload as ActivityPackPayload}
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportActivityPackDesc}
				</p>
				<a
					href="/admin/activities?import={item.itemId}"
					class="block"
					data-testid="activity-pack-import-cta"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaImportActivityPackWithCount(
							activityPackPayload.activities.length,
						)}
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
	/* #2744 Cluster F: mobile sticky CTA で fold 外発見性問題を解消
	 * DESIGN.md §10 z-index banner トークン使用 (modal より下、normal より上)
	 * desktop (≥ 768px) では normal flow 維持 (画面幅広く scroll cost 低)
	 * ADR-0012 Anti-engagement: visibility 改善目的、滞在時間延伸目的でない */
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
		/* desktop: normal flow 復帰 (画面幅広く scroll cost 低) */
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
