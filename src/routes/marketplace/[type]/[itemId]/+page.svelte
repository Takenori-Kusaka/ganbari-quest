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

// #2136 MP-1: reward-set 一括追加 UI 状態
let selectedChildId = $state<number>(0);

$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

const rewardImport = $derived(
	(
		form as {
			rewardImport?: {
				imported?: number;
				skipped?: number;
				allDuplicates?: boolean;
				errors?: string[];
			};
		} | null
	)?.rewardImport,
);

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
									{ch.monthDay}・{ch.durationDays + '日間'}
								</span>
							</div>
							<p class="text-xs text-[var(--color-text-secondary)] ml-8">{ch.description}</p>
							<p class="text-xs text-[var(--color-text-tertiary)] ml-8 mt-1">
								{CATEGORY_LABELS[ch.categoryId] ?? ''} ・ 目標 {ch.baseTarget + '回'}
								・ ごほうび +{ch.rewardPoints}P
							</p>
						</div>
					{/each}
				</div>
			{/if}
			{/snippet}
		</Card>

		<!-- CTA -->
		<div class="mt-6 space-y-3" data-testid="marketplace-detail-cta">
			{#if isRewardSet && data.isAuthenticated && data.children.length > 0}
				<!-- #2136 MP-1: reward-set 一括追加 CTA（ログイン済み + 子供登録済み） -->
				<Card padding="md">
					{#snippet children()}
					<form
						method="POST"
						action="?/importRewardSet"
						use:enhance
						class="space-y-3"
						data-testid="reward-import-form"
					>
						<label class="block">
							<span class="text-xs font-bold text-[var(--color-text-secondary)] block mb-1">
								{MARKETPLACE_LABELS.detailCtaSelectChild}
							</span>
							<NativeSelect
								name="childId"
								bind:value={selectedChildId}
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
							data-testid="reward-import-submit"
						>
							{MARKETPLACE_LABELS.detailCtaImportRewardWithCount(rewardCount)}
						</Button>
					</form>
					{/snippet}
				</Card>

				{#if rewardImport}
					{#if rewardImport.allDuplicates}
						<div
							class="bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)] rounded-xl p-3 text-sm text-center"
							data-testid="reward-import-result"
						>
							{MARKETPLACE_LABELS.detailRewardImportAllDuplicates}
						</div>
					{:else if (rewardImport.imported ?? 0) > 0}
						<div
							class="bg-[var(--color-feedback-success-bg)] border border-[var(--color-feedback-success-border)] text-[var(--color-feedback-success-text)] rounded-xl p-3 text-sm text-center"
							data-testid="reward-import-result"
						>
							{MARKETPLACE_LABELS.detailRewardImportSuccess(rewardImport.imported ?? 0)}
							<div class="text-xs mt-1">
								<a href="/admin/rewards" class="underline">{MARKETPLACE_LABELS.detailCtaSignup}</a>
							</div>
						</div>
					{/if}
				{/if}
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
				<!-- #2136 MP-1: 未ログイン -> signup へ誘導（redirect で同じページに戻す） -->
				<a
					href="/auth/signup?redirect=/marketplace/{item.type}/{item.itemId}"
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
				<!-- #2137 (MP-2): ログイン済 → 直接「一括追加」 -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportChecklistDesc}
				</p>

				{#if form?.importResult}
					{#if form.alreadyImported}
						<div
							class="px-3 py-2 rounded-md text-sm bg-[var(--color-feedback-warning-bg)] text-[var(--color-feedback-warning-text)]"
							data-testid="marketplace-import-result-duplicate"
						>
							{MARKETPLACE_LABELS.detailImportDuplicate(form.existingTemplateName ?? form.presetName)}
						</div>
					{:else}
						<div
							class="px-3 py-2 rounded-md text-sm bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)]"
							data-testid="marketplace-import-result-success"
						>
							{MARKETPLACE_LABELS.detailImportSuccess(form.importedItems ?? 0)}
						</div>
					{/if}
				{:else if form?.error}
					<div
						class="px-3 py-2 rounded-md text-sm bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)]"
						data-testid="marketplace-import-result-error"
					>
						{form.error}
					</div>
				{/if}

				<form
					method="POST"
					action="?/importChecklist"
					use:enhance={() => {
						importing = true;
						return async ({ update }) => {
							await update();
							importing = false;
							await invalidateAll();
						};
					}}
					class="space-y-3"
					data-testid="marketplace-import-form"
				>
					{#if data.children.length > 1}
						<label class="block text-xs font-medium text-[var(--color-text-secondary)]">
							{MARKETPLACE_LABELS.detailChildSelectLabel}
							<NativeSelect
								name="childId"
								bind:value={selectedChildIdStr}
								options={childOptions}
							/>
						</label>
					{:else}
						<input type="hidden" name="childId" value={selectedChildIdStr} />
					{/if}

					<Button
						type="submit"
						variant="primary"
						size="lg"
						class="w-full"
						disabled={importing || !selectedChildIdStr}
						data-testid="marketplace-import-button"
					>
						{MARKETPLACE_LABELS.detailCtaImportChecklist}
					</Button>
				</form>
			{:else if isChecklist && !data.isLoggedIn}
				<!-- #2137 (MP-2): 未ログイン → signup 経由 redirect -->
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{MARKETPLACE_LABELS.detailCtaImportChecklistDesc}
				</p>
				<a
					href="/auth/signup?next=/marketplace/{item.type}/{item.itemId}"
					class="block"
					data-testid="marketplace-signup-redirect"
				>
					<Button variant="primary" size="lg" class="w-full">
						{MARKETPLACE_LABELS.detailCtaSignupToImport}
					</Button>
				</a>
			{:else if isRulePreset && data.isAuthenticated && (isRuleBonus || (isRuleExchange && data.children.length > 0))}
				<!-- #2138 (MP-3): rule-preset 一括追加 CTA -->
				<!-- bonus は childId 不要 (tenant スコープ)、exchange は childId 必須 -->
				<Card padding="md">
					{#snippet children()}
					<p class="text-xs text-[var(--color-text-tertiary)]">
						{#if isRuleBonus}
							{MARKETPLACE_LABELS.detailCtaImportRuleDescBonus}
						{:else if isRuleExchange}
							{MARKETPLACE_LABELS.detailCtaImportRuleDescExchange}
						{/if}
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
								{#if ruleImport.ruleType === 'bonus'}
									{MARKETPLACE_LABELS.detailRuleImportSuccessBonus(ruleImport.presetName ?? '')}
								{:else if ruleImport.ruleType === 'exchange'}
									{MARKETPLACE_LABELS.detailRuleImportSuccessExchange(
										ruleImport.presetName ?? '',
										ruleImport.imported ?? 0,
									)}
								{/if}
								{#if isRuleBonus}
									<div class="text-xs mt-1">
										<a href="/admin/settings/rules" class="underline">
											{MARKETPLACE_LABELS.detailRuleImportLinkToBonusList}
										</a>
									</div>
								{:else if isRuleExchange}
									<div class="text-xs mt-1">
										<a href="/admin/rewards" class="underline">
											{MARKETPLACE_LABELS.detailRuleImportLinkToRewardsList}
										</a>
									</div>
								{/if}
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
						{#if isRuleExchange}
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
						{/if}
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
				<!-- #2138 (MP-3): 未ログイン → signup 経由 redirect -->
				<a
					href="/auth/signup?next=/marketplace/rule-preset/{item.itemId}"
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
				<!-- #2297: challenge-set 未ログイン → signup 経由 -->
				<a
					href="/auth/signup?next=/marketplace/challenge-set/{item.itemId}"
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
			{:else}
				<!-- 残りの type (activity-pack) は従来通り signup 動線 -->
				<a href="/auth/signup" class="block">
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
