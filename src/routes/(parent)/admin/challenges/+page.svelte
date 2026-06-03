<script lang="ts">
import { deserialize, enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { todayDateJST } from '$lib/domain/date-utils';
import {
	ADMIN_CHALLENGES_PAGE_LABELS,
	APP_LABELS,
	CHALLENGES_LABELS,
	PAGE_TITLES,
} from '$lib/domain/labels';
import { TEMPLATE_TERMS } from '$lib/domain/terms';
// CX-DoR #9・#11 横展開 (Round 18): empty state を共通 SSOT に統一 (NN/G #4 consistency)
import UnifiedEmptyState from '$lib/marketplace/ui/UnifiedEmptyState.svelte';
import type { ChildChallenge, ChildChallengeGroup } from '$lib/server/db/types';
import SiblingChallengeComparison from '$lib/ui/features/admin/SiblingChallengeComparison.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import ChildSelectionDialog, {
	type ChildOption,
} from '$lib/ui/primitives/ChildSelectionDialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();

const isFamily = $derived(data.planTier === 'family');
let creating = $state(false);

let marketplaceImportMessage = $state('');

// #2554 follow-up CUJ-CH2 完全化: ChildSelectionDialog state (per-child 取込時 auto-open)
// admin-rewards / admin-activities と同型 pattern (ADR-0055 per-child fan-out + CWE-598)。
let showChildSelectionDialog = $state(false);
let pendingImportPresetId = $state<string | null>(null);
// #2632 CX-DoR #9 NN/G #1: 取込実行中フラグ (confirm ボタン loading 表示)
let isImporting = $state(false);

// ChildSelectionDialog 用の ChildOption 配列
const childOptions = $derived<ChildOption[]>(
	data.children.map((c) => ({
		id: c.id,
		nickname: c.nickname,
		age: c.age,
		icon: undefined,
	})),
);

// #2774: `?import=<presetId>` で auto-open (5 type 統一)。presetId 単位の one-shot guard で、
// 確定後に effect が再走しても (data.importPresetId が残存) 再 open しないようにする。
let consumedImportPresetId = $state<string | null>(null);
$effect(() => {
	const pid = data.importPresetId;
	if (pid && pid !== consumedImportPresetId) {
		consumedImportPresetId = pid;
		pendingImportPresetId = pid;
		showChildSelectionDialog = true;
	} else if (!pid) {
		consumedImportPresetId = null;
	}
});

// 取込失敗 / invalid preset の guidance
$effect(() => {
	if (data.importPresetInvalid) {
		marketplaceImportMessage = ADMIN_CHALLENGES_PAGE_LABELS.importInvalidPreset;
	}
});

// #2474 must-2 (admin-rewards 同型 CWE-598 fetch wiring):
// `x-sveltekit-action: true` + `accept: application/json` header が無いと 303 redirect で
// JSON parse 常時 fail。公式 enhance と同じ header を付与 + `deserialize()` で正しい
// ActionResult を取得する。dead-end (無反応 / 件数誤表示) を構造的に防ぐ。
async function handleChildSelectionConfirm(result: 'all' | number[]) {
	if (!pendingImportPresetId) {
		showChildSelectionDialog = false;
		return;
	}
	const childIdsValue = result === 'all' ? 'all' : result.join(',');
	const formData = new FormData();
	formData.append('presetId', pendingImportPresetId);
	formData.append('childIds', childIdsValue);

	// #2632 CX-DoR #9 NN/G #1: 取込実行中は confirm ボタンを loading 表示する。
	isImporting = true;

	try {
		const resp = await fetch('?/importMarketplaceChallengeSet', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
			body: formData,
		});
		const actionResult = deserialize(await resp.text()) as
			| {
					type: 'success';
					data?: { imported?: number; skipped?: number; total?: number; demo?: boolean };
			  }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			// #2558 bug-1 整合: デモ環境 no-op (data.demo === true) は成功偽装せず明示。
			if ((actionResult.data as Record<string, unknown> | undefined)?.demo === true) {
				marketplaceImportMessage = ADMIN_CHALLENGES_PAGE_LABELS.importDemo;
			} else {
				const imp = Number(actionResult.data?.imported ?? 0);
				marketplaceImportMessage =
					imp === 0
						? ADMIN_CHALLENGES_PAGE_LABELS.importAllDuplicates
						: ADMIN_CHALLENGES_PAGE_LABELS.importSuccess(imp);
				await invalidateAll();
			}
		} else if (actionResult.type === 'failure') {
			marketplaceImportMessage = String(
				actionResult.data?.error ?? ADMIN_CHALLENGES_PAGE_LABELS.importFailed,
			);
		} else {
			marketplaceImportMessage = ADMIN_CHALLENGES_PAGE_LABELS.importFailed;
		}
	} catch {
		marketplaceImportMessage = ADMIN_CHALLENGES_PAGE_LABELS.importFailed;
	} finally {
		isImporting = false;
	}
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
	// URL から marketplace-import param を除去 (戻り遷移時に再 open しない、admin-rewards 同型)
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

function handleChildSelectionCancel() {
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

interface RewardConfig {
	points: number;
	message?: string;
}

function parseJSON<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json);
	} catch {
		return fallback;
	}
}

function formatDate(d: string): string {
	return d.replace(/-/g, '/');
}

function isCurrentlyActive(instance: ChildChallenge): boolean {
	const today = todayDateJST();
	return (
		instance.isActive === 1 &&
		instance.status === 'active' &&
		instance.startDate <= today &&
		instance.endDate >= today
	);
}

const periodLabel = (t: string) => {
	switch (t) {
		case 'weekly':
			return CHALLENGES_LABELS.periodLabelWeekly;
		case 'monthly':
			return CHALLENGES_LABELS.periodLabelMonthly;
		default:
			return CHALLENGES_LABELS.periodLabelCustom;
	}
};

const categories: Record<number, string> = {
	1: CHALLENGES_LABELS.categoryUndou,
	2: CHALLENGES_LABELS.categoryBenkyou,
	3: CHALLENGES_LABELS.categorySeikatsu,
	4: CHALLENGES_LABELS.categoryKouryuu,
	5: CHALLENGES_LABELS.categorySouzou,
};

// 子供別タブ filtering
const selectedChildId = $derived(data.selectedChildId);
const filteredGroups = $derived.by((): ChildChallengeGroup[] => {
	if (selectedChildId === 'all') return data.challengeGroups;
	return data.challengeGroups
		.map((g) => ({
			...g,
			instances: g.instances.filter((i) => i.childId === selectedChildId),
		}))
		.filter((g) => g.instances.length > 0);
});

// child 別タブ URL
function tabHref(childId: number | 'all'): string {
	return childId === 'all' ? '/admin/challenges' : `/admin/challenges?childId=${childId}`;
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.challenges}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4">
	{#if data.familyStreak && data.familyStreak.currentStreak > 0}
		<div class="rounded-xl border bg-white p-4">
			<div class="flex items-center gap-2 mb-2">
				<span class="text-xl">🔥</span>
				<h3 class="font-bold text-sm">{CHALLENGES_LABELS.familyStreakTitle(data.familyStreak.currentStreak)}</h3>
			</div>
			<p class="text-xs text-[var(--color-text-muted)]">
				{data.familyStreak.hasRecordedToday
					? `今日は${data.familyStreak.todayRecorders.length + '人'}が記録済み`
					: '今日はまだ誰も記録していません'}
			</p>
		</div>
	{/if}

	{#if !isFamily}
		<div class="rounded-xl border border-[var(--color-feedback-warning-border)] bg-[var(--color-feedback-warning-bg)] p-4 text-center">
			<p class="text-sm font-bold text-[var(--color-feedback-warning-text)]">{CHALLENGES_LABELS.familyPlanTitle}</p>
			<p class="text-xs text-[var(--color-feedback-warning-text)] mt-1">{CHALLENGES_LABELS.familyPlanDesc}</p>
			<a href="/admin/subscription" class="inline-block mt-2 px-3 py-1 text-xs font-bold rounded-lg bg-[var(--color-stat-amber)] text-white">
				{CHALLENGES_LABELS.familyPlanButton}
			</a>
		</div>
	{:else}

	<div class="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-info)] p-3 text-xs text-[var(--color-text-primary)]">
		<p>{CHALLENGES_LABELS.headerDesc}</p>
	</div>

	<!-- 子供別タブ -->
	{#if data.children.length > 1}
		<nav
			class="flex gap-1 overflow-x-auto"
			aria-label={ADMIN_CHALLENGES_PAGE_LABELS.childTabAllAriaLabel}
			data-testid="admin-challenges-child-tabs"
		>
			<a
				href={tabHref('all')}
				class="px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap {selectedChildId === 'all' ? 'bg-[var(--color-action-primary)] text-[var(--color-text-inverse)]' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]'}"
				data-testid="admin-challenges-child-tab-all"
			>
				{ADMIN_CHALLENGES_PAGE_LABELS.childTabAllLabel}
			</a>
			{#each data.children as child (child.id)}
				<a
					href={tabHref(child.id)}
					class="px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap {selectedChildId === child.id ? 'bg-[var(--color-action-primary)] text-[var(--color-text-inverse)]' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]'}"
					data-testid="admin-challenges-child-tab-{child.id}"
				>
					{child.nickname}
				</a>
			{/each}
		</nav>
	{/if}

	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold">{CHALLENGES_LABELS.sectionTitle}</h2>
		<Button
			variant={creating ? 'ghost' : 'primary'}
			size="sm"
			onclick={() => { creating = !creating; }}
		>
			{creating ? CHALLENGES_LABELS.cancelButton : CHALLENGES_LABELS.createButton}
		</Button>
	</div>

	<!--
		#2558 段階2 横展開: in-page UnifiedImportHub (admin 内 marketplace 風 browse UI、二重管理)
		を撤去 (DESIGN.md §10 構造的ルール「marketplace 取込はマーケットプレイス画面に一本化」)。
		marketplace 詳細 → `?import=<presetId>` → ChildSelectionDialog auto-open の
		正規経路 (marketplace-import-flow.md §3.1、#2774 で 5 type 統一) に合流させる。

		marketplace 取込メッセージ + secondary link「みんなのテンプレートを見る」(empty state /
		運用期到達性、DESIGN.md §10「bulk import bridge ルール」整合) は保持。
	-->
	<section data-testid="challenges-marketplace-import-section">
		{#if marketplaceImportMessage}
			<div
				class="mb-2 px-3 py-2 rounded-md text-sm bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)]"
				data-testid="challenges-marketplace-import-result"
			>
				{marketplaceImportMessage}
			</div>
		{/if}
		<a
			href="/marketplace?type=challenge-set"
			class="inline-flex items-center gap-1 text-xs text-[var(--color-action-primary)] hover:underline"
			data-testid="challenges-marketplace-browse-link"
		>
			📦 {TEMPLATE_TERMS.browse}
		</a>
	</section>

	{#if form?.error}
		<div class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)]">{form.error}</div>
	{/if}
	{#if form?.created}
		<div class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)]">{CHALLENGES_LABELS.createdNotice}</div>
	{/if}
	{#if form?.bulkCreated}
		<div class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)]" data-testid="admin-challenges-bulk-created-notice">
			{ADMIN_CHALLENGES_PAGE_LABELS.bulkCreatedMessage(form.bulkCreated)}
		</div>
	{/if}
	{#if form?.deleted}
		<div class="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-primary)]">{CHALLENGES_LABELS.deletedNotice}</div>
	{/if}
	{#if form?.copyResult}
		<div class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)]" data-testid="admin-challenges-copy-result">
			{ADMIN_CHALLENGES_PAGE_LABELS.copyCompletedMessage(form.copyResult.totalCopied)}
		</div>
	{/if}

	<!-- 作成フォーム (per-child 1 件 / 全員一括 切替可能) -->
	{#if creating}
		<form method="POST" action="?/bulkCreate" use:enhance class="rounded-xl border bg-white p-4 space-y-3" data-testid="admin-challenges-create-form">
			<h3 class="font-bold text-sm">{CHALLENGES_LABELS.formTitle}</h3>
			<div class="grid grid-cols-2 gap-3">
				<FormField label={CHALLENGES_LABELS.titleLabel} type="text" name="title" placeholder={CHALLENGES_LABELS.titlePlaceholder} required class="col-span-2" />
				<FormField label={CHALLENGES_LABELS.descLabel} type="text" name="description" placeholder={CHALLENGES_LABELS.descPlaceholder} class="col-span-2" />
			</div>

			<!-- 対象お子さま (cooperative 設計 + 兄弟連動表示) -->
			<fieldset class="space-y-1">
				<legend class="text-xs font-semibold text-[var(--color-text-secondary)]">{ADMIN_CHALLENGES_PAGE_LABELS.bulkAddAction}</legend>
				<div class="flex flex-wrap gap-2">
					{#each data.children as child (child.id)}
						<label class="inline-flex items-center gap-1 text-xs">
							<input
								type="checkbox"
								name="childIds"
								value={child.id}
								checked={selectedChildId === 'all' || selectedChildId === child.id}
								data-testid="admin-challenges-child-checkbox-{child.id}"
							/>
							{child.nickname}
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="grid grid-cols-3 gap-3">
				<input type="hidden" name="challengeType" value="cooperative" />
				<FormField label={CHALLENGES_LABELS.typeLabel}>
					{#snippet children()}
						<div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
							{CHALLENGES_LABELS.typeLabelCooperative}
						</div>
					{/snippet}
				</FormField>
				<FormField label={CHALLENGES_LABELS.periodLabel}>
					{#snippet children()}
						<NativeSelect
							name="periodType"
							options={[
								{ value: 'weekly', label: '週間' },
								{ value: 'monthly', label: '月間' },
								{ value: 'custom', label: 'カスタム' },
							]}
						/>
					{/snippet}
				</FormField>
				<FormField label={CHALLENGES_LABELS.categoryLabel}>
					{#snippet children()}
						<NativeSelect
							name="categoryId"
							options={[
								{ value: '', label: CHALLENGES_LABELS.categoryAll },
								...Object.entries(categories).map(([id, name]) => ({ value: id, label: name })),
							]}
						/>
					{/snippet}
				</FormField>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label={CHALLENGES_LABELS.startDateLabel} type="date" name="startDate" required />
				<FormField label={CHALLENGES_LABELS.endDateLabel} type="date" name="endDate" required />
			</div>
			<div class="grid grid-cols-3 gap-3">
				<FormField label={CHALLENGES_LABELS.targetLabel} type="number" name="baseTarget" value={3} min={1} required />
				<FormField label={CHALLENGES_LABELS.rewardPointsLabel} type="number" name="rewardPoints" value={50} min={1} required />
				<FormField label={CHALLENGES_LABELS.rewardMessageLabel} type="text" name="rewardMessage" placeholder={CHALLENGES_LABELS.rewardMessagePlaceholder} />
			</div>
			<input type="hidden" name="metric" value="count" />
			<Button type="submit" variant="primary" size="sm" class="w-full">
				{CHALLENGES_LABELS.submitButton}
			</Button>
		</form>
	{/if}

	<!-- チャレンジ group 一覧 (per-child instance + 兄弟連動表示) -->
	<!-- CX-DoR #9・#11 横展開 (Round 18): 独自 empty markup を UnifiedEmptyState SSOT に統一。
	     icon / filter-aware title (noItemsText) / desc (descText) / marketplace CTA (link mode) を
	     override props で渡し文言不変。selectedChildId='all' / per-child の文言分岐を維持。 -->
	{#if filteredGroups.length === 0}
		<UnifiedEmptyState
			testid="admin-challenges-empty-state"
			icon={CHALLENGES_LABELS.noChallengeTitleIcon}
			noItemsText={selectedChildId === 'all'
				? CHALLENGES_LABELS.noChallengeTitle
				: ADMIN_CHALLENGES_PAGE_LABELS.perChildEmptyTitle}
			descText={selectedChildId === 'all'
				? CHALLENGES_LABELS.emptyStateDesc
				: ADMIN_CHALLENGES_PAGE_LABELS.perChildEmptyDesc}
			showPrimary={false}
			secondaryMode="link"
			browseHref="/marketplace?type=challenge-set"
			importLinkLabel={CHALLENGES_LABELS.templateCta}
		/>
	{:else}
		<div class="space-y-3">
			{#each filteredGroups as group (group.groupKey)}
				{@const firstInstance = group.instances[0]}
				{@const active = firstInstance ? isCurrentlyActive(firstInstance) : false}
				{@const reward = firstInstance ? parseJSON<RewardConfig>(firstInstance.rewardConfig, { points: 0 }) : { points: 0 }}
				<div
					class="rounded-xl border bg-white p-4 space-y-3"
					class:border-[var(--color-feedback-info-border)]={active}
					data-testid="admin-challenges-group"
					data-group-key={group.groupKey}
				>
					<div class="flex items-start justify-between gap-2">
						<div class="flex-1">
							<h3 class="font-bold text-sm">
								{group.title}
								{#if group.allCompleted}
									<span class="ml-1 rounded bg-[var(--color-feedback-success-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-success-text)]">{CHALLENGES_LABELS.badgeAllCompleted}</span>
								{/if}
								{#if active}
									<span class="ml-1 rounded bg-[var(--color-feedback-info-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-info-text)]">{CHALLENGES_LABELS.badgeActive}</span>
								{/if}
							</h3>
							<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
								{periodLabel(group.periodType)}
								· {formatDate(group.startDate)}{CHALLENGES_LABELS.dateSeparator}{formatDate(group.endDate)}
								· {CHALLENGES_LABELS.rewardLabel(reward.points)}
							</p>
							{#if group.description}
								<p class="text-xs text-[var(--color-text-secondary)] mt-1">{group.description}</p>
							{/if}
						</div>
					</div>

					<!-- 兄弟連動表示 (instance 数 ≥ 2 で展開) -->
					{#if group.instances.length >= 2}
						<SiblingChallengeComparison {group} children={data.children} />
					{:else if group.instances.length === 1 && firstInstance}
						<!-- 1 instance (個別) のときは簡易進捗バーのみ -->
						{@const child = data.children.find((c) => c.id === firstInstance.childId)}
						{@const pct = Math.min(100, Math.round((firstInstance.currentValue / firstInstance.targetValue) * 100))}
						<div class="flex items-center gap-2" data-testid="admin-challenges-single-progress">
							<span class="text-xs font-medium text-[var(--color-text-primary)] w-20 truncate">
								{child?.nickname ?? `#${firstInstance.childId}`}
							</span>
							<div class="flex-1 h-2 bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
								<div
									class="h-full rounded-full {firstInstance.completed === 1 ? 'bg-[var(--color-feedback-success-border)]' : 'bg-[var(--color-feedback-info-border)]'}"
									style:width="{pct}%"
								></div>
							</div>
							<span class="text-[10px] text-[var(--color-text-muted)] w-14 text-right">
								{firstInstance.currentValue}/{firstInstance.targetValue}
								{#if firstInstance.completed === 1}✅{/if}
							</span>
						</div>
					{/if}

					<!-- 削除アクション (group 内 全 instance に対して 1 件ずつ) -->
					<div class="flex justify-end gap-1 flex-wrap">
						{#each group.instances as instance (instance.id)}
							{@const child = data.children.find((c) => c.id === instance.childId)}
							<form method="POST" action="?/delete" use:enhance
								onsubmit={(e) => { if (!confirm(`「${group.title}」(${child?.nickname ?? '#' + instance.childId}) を削除しますか？`)) e.preventDefault(); }}
							>
								<input type="hidden" name="id" value={instance.id} />
								<Button type="submit" variant="ghost" size="sm">
									{group.instances.length >= 2 ? `${child?.nickname ?? '#' + instance.childId} を削除` : CHALLENGES_LABELS.deleteButton}
								</Button>
							</form>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{/if}<!-- /isFamily -->

	<!-- #2554 follow-up CUJ-CH2 完全化 + #2774 (5 type 統一): ChildSelectionDialog
	     (`?import=<presetId>` auto-open) admin-rewards / admin-activities と同型
	     (ADR-0055 per-child fan-out + CWE-598 guard) -->
	<ChildSelectionDialog
		bind:open={showChildSelectionDialog}
		children={childOptions}
		allowMultiple={true}
		onConfirm={handleChildSelectionConfirm}
		onCancel={handleChildSelectionCancel}
		confirmLoading={isImporting}
		closeOnConfirm={false}
		testid="challenge-import-child-selection-dialog"
	/>
</div>
