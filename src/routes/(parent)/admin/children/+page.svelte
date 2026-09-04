<script lang="ts">
import { enhance } from '$app/forms';
import { calculateAgeFromBirthDate } from '$lib/domain/date-utils';
import { getErrorMessage } from '$lib/domain/errors';
import {
	ADMIN_CHILDREN_PAGE_LABELS,
	APP_LABELS,
	getThemeOptions,
	PAGE_TITLES,
} from '$lib/domain/labels';
import { formatPointValue } from '$lib/domain/point-display';
import ArchivedChildrenSection from '$lib/features/admin/components/ArchivedChildrenSection.svelte';
import ChildListCard from '$lib/features/admin/components/ChildListCard.svelte';
import ChildProfileCard from '$lib/features/admin/components/ChildProfileCard.svelte';
import Alert from '$lib/ui/primitives/Alert.svelte';
import BirthdayInput from '$lib/ui/primitives/BirthdayInput.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import Select from '$lib/ui/primitives/Select.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

let { data, form } = $props();
const childLimit = $derived(
	(data as Record<string, unknown>).childLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));

// #4546 ③: 仮アバターの作り直しをレースで見送ったことを保護者に伝える。
// warn ログだけだと「名前を直したのにアバターが古いまま」が黙って起きる (ADR-0062 §1)。
// 失敗ではなく「写真を優先した」正常な結果なので info (role="status" + 自動消滅) を使う。
// 同じ action 結果で effect が再実行されても 1 回だけ出す (結果オブジェクトは送信ごとに新しくなる
// ので、同じ子供を続けて編集して 2 回とも見送られた場合は 2 回とも出る)。
let notifiedAvatarSkipResult: unknown = null;
$effect(() => {
	const f = form as { placeholderAvatarSkipped?: boolean } | null;
	if (!f?.placeholderAvatarSkipped) return;
	if (notifiedAvatarSkipResult === f) return;
	notifiedAvatarSkipResult = f;
	showToast(
		ADMIN_CHILDREN_PAGE_LABELS.placeholderAvatarSkippedTitle,
		ADMIN_CHILDREN_PAGE_LABELS.placeholderAvatarSkippedDesc,
		'info',
	);
});

// #4729 PO 回答 (2026-09-03): 誕生日を消すと推定誕生日に戻り誕生日ボーナスの対象外になる (降格は維持)。
// 黙って降格せず、直前の編集で降格が起きたことを保護者に見せる。Toast (自動消滅) ではなく
// Alert (`role="status"`、次の操作まで残る) で出す — 見落とすと「祝われなかった理由」を知る場が無い。
//
// **現状この画面から降格は起こせない (QM レビューで確認)**: `BirthdayInput` の年 / 月 / 日 select は
// placeholder option が disabled で、一度入れた誕生日を空に戻せない。「誕生日を消す」導線を
// 用意するかは PO 判断 (本 PR の scope 外) で、その答えが出るまで本 Alert は表示されない。
const birthdayCleared = $derived(!!(form as { birthdayCleared?: boolean } | null)?.birthdayCleared);

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

let showAddForm = $state(false);
let themeValue = $state('blue');
let addBirthDate = $state<string | undefined>(undefined);
const addCalculatedAge = $derived(
	addBirthDate ? calculateAgeFromBirthDate(addBirthDate) : undefined,
);
</script>

<svelte:head>
	<title>{PAGE_TITLES.children}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="children-page">
	<div class="flex items-center gap-2 mb-3">
		<h2 class="text-lg font-bold">{ADMIN_CHILDREN_PAGE_LABELS.pageTitle}</h2>
	</div>
	{#if childLimit && !childLimit.allowed}
		<div class="children-page__limit-banner">
			<span class="children-page__limit-icon">⚠️</span>
			<div>
				<p class="children-page__limit-title">{ADMIN_CHILDREN_PAGE_LABELS.limitBannerTitle}</p>
				<p class="children-page__limit-desc">
					{ADMIN_CHILDREN_PAGE_LABELS.limitBannerDesc(childLimit.current, childLimit.max ?? 0)}
				</p>
				<a href="/admin/subscription" class="children-page__limit-link">
					{ADMIN_CHILDREN_PAGE_LABELS.limitUpgradeLink}
				</a>
			</div>
		</div>
	{/if}

	<!-- #4660 F1: children-list anchor は「追加する」ボタン行ではなく下のカード一覧に付ける
	     (旧: 本 toolbar に付いており、「カードが並ぶ」という文言と光る場所が食い違っていた) -->
	<div class="children-page__toolbar">
		{#if !childLimit || childLimit.allowed}
			<Button
				variant="primary"
				size="sm"
				onclick={() => showAddForm = !showAddForm}
				data-tutorial="add-child-btn"
			>
				{showAddForm ? ADMIN_CHILDREN_PAGE_LABELS.cancelButton : ADMIN_CHILDREN_PAGE_LABELS.addButton}
			</Button>
		{:else}
			<Button
				variant="ghost"
				size="sm"
				class="bg-[var(--color-border-strong)] text-[var(--color-text-muted)] cursor-not-allowed"
				disabled
			>
				{ADMIN_CHILDREN_PAGE_LABELS.limitReachedButton}
			</Button>
		{/if}
	</div>

	<!-- Add child form -->
	{#if showAddForm}
		<Card>
			<form
				method="POST"
				action="?/addChild"
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success') {
							showAddForm = false;
							addBirthDate = undefined;
						}
						await update();
					};
				}}
				class="children-page__add-form"
			>
				<h3 class="children-page__add-title">{ADMIN_CHILDREN_PAGE_LABELS.addFormTitle}</h3>
				<div class="children-page__add-grid">
					<FormField
						label={ADMIN_CHILDREN_PAGE_LABELS.nicknameLabel}
						type="text"
						id="add-nickname"
						name="nickname"
						required
						placeholder={ADMIN_CHILDREN_PAGE_LABELS.nicknamePlaceholder}
					/>
					<BirthdayInput
						name="birthDate"
						id="add-birthDate"
						bind:value={addBirthDate}
						hint={ADMIN_CHILDREN_PAGE_LABELS.birthdayHint}
					/>
					<FormField
						label={addBirthDate ? ADMIN_CHILDREN_PAGE_LABELS.ageLabelAutoCalc : ADMIN_CHILDREN_PAGE_LABELS.ageLabel}
						type="number"
						id="add-age"
						name="age"
						min="0"
						max="18"
						disabled={!!addBirthDate}
						value={addCalculatedAge}
						placeholder={addBirthDate ? '' : ADMIN_CHILDREN_PAGE_LABELS.agePlaceholder}
					/>
					<Select
						label={ADMIN_CHILDREN_PAGE_LABELS.themeColorLabel}
						items={getThemeOptions().map((opt) => ({
							value: opt.value,
							label: `${opt.emoji} ${opt.label}`
						}))}
						value={[themeValue]}
						onValueChange={(d) => (themeValue = d.value[0] ?? 'blue')}
					/>
					<input type="hidden" name="theme" value={themeValue} />
				</div>
				<Button type="submit" variant="success" size="sm">{ADMIN_CHILDREN_PAGE_LABELS.addButton}</Button>
			</form>
		</Card>
	{/if}

	<!-- Error display -->
	{#if errorMessage}
		<div class="children-page__error">{errorMessage}</div>
	{/if}

	<!-- Children list -->
	<div class="children-page__list" data-tutorial="children-list">
		{#each data.children as child, i}
			<ChildListCard
				{child}
				isSelected={data.selectedChild?.id === child.id}
				href="/admin/children?id={child.id}"
				dataTutorial={i === 0 ? 'child-card' : undefined}
				formatBalance={fmtBal}
			/>
		{/each}
	</div>

	<!-- #4708: 無料プランの上限で非表示 (archive) 中のお子さま — 読み取り専用一覧 -->
	<ArchivedChildrenSection children={data.archivedChildren} basePath="/admin" />

	<!-- Selected child detail -->
	{#if data.selectedChild}
		<!-- data-tutorial: ページガイド (#4660) の詳細カード step の spotlight anchor (未選択時は出ない) -->
		<div class="children-page__detail" data-tutorial="child-detail">
			{#if birthdayCleared}
				<Alert
					variant="warning"
					message={ADMIN_CHILDREN_PAGE_LABELS.birthdayClearedNotice}
					data-testid="child-birthday-cleared-notice"
				/>
			{/if}
			{#key data.selectedChild.id}
				<ChildProfileCard
					child={data.selectedChild}
					categoryDefs={data.categoryDefs}
					pointSettings={ps}
				/>
			{/key}
		</div>
	{/if}
</div>

<style>
	.children-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.children-page__limit-banner {
		background: var(--color-surface-warning, #fffbeb);
		border: 1px solid var(--color-border-warning, #fde68a);
		border-radius: 0.75rem;
		padding: 1rem;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.children-page__limit-icon {
		font-size: 1.5rem;
	}
	.children-page__limit-title {
		font-weight: 700;
		color: var(--color-warning-text, #92400e);
	}
	.children-page__limit-desc {
		font-size: 0.875rem;
		color: var(--color-warning-text, #a16207);
		margin-top: 0.25rem;
	}
	.children-page__limit-link {
		display: inline-flex;
		align-items: center;
		margin-top: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-action-primary, #2563eb);
	}
	.children-page__limit-link:hover {
		color: var(--color-action-primary-hover, #1d4ed8);
	}
	.children-page__toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.children-page__add-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.children-page__add-title {
		font-weight: 700;
		color: var(--color-text-secondary, #4b5563);
	}
	.children-page__add-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 480px) {
		.children-page__add-grid {
			grid-template-columns: 1fr;
		}
	}
	.children-page__error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: var(--color-danger, #dc2626);
		padding: 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}
	.children-page__list {
		display: grid;
		gap: 0.75rem;
	}
	.children-page__detail {
		animation: slide-in 0.2s ease-out;
	}
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
