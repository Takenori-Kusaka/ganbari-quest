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
import { computeOptimisticChildLimit } from '$lib/features/admin/child-limit-optimistic';
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

// #4729 PO 決定 (2026-09-04): 誕生日を消すと誕生日ボーナス / 🎂 表示の対象外になる
// (保存では実誕生日が破棄され、その年齢の推定誕生日に置き換わる)。
// 黙って消さず、直前の編集で消えたことを保護者に見せる。Toast (自動消滅) ではなく
// Alert (`role="status"`、次の操作まで残る) で出す — 見落とすと「祝われなかった理由」を知る場が無い。
//
// 誕生日は任意入力なので消せる。`BirthdayInput` の未設定 option を選べるようにし、
// `ChildProfileCard` が保存前に確認ダイアログを挟む。本 Alert はその保存後の告知で、
// 「確認 → 保存 → Alert」の 3 点セットの最後にあたる。
const birthdayCleared = $derived(!!(form as { birthdayCleared?: boolean } | null)?.birthdayCleared);

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

let showAddForm = $state(false);
let themeValue = $state('blue');
let addBirthDate = $state<string | undefined>(undefined);
const addCalculatedAge = $derived(
	addBirthDate ? calculateAgeFromBirthDate(addBirthDate) : undefined,
);

// #4919: 追加成功直後に一覧へ反映されない不具合の恒久対策。
//
// `use:enhance` の既定 `update()` は `invalidateAll()` を呼び、load() の再実行結果が
// 届いてはじめて一覧が更新される。本番 (DSQL) では `addChild` action の直後にこの
// 再読込が実行されても新しい子供が含まれない事例が確認された
// (`getAllChildren` 呼び出しがプールから別の接続を引き、直前の書き込みをまだ
// 観測していない可能性がある — ローカル SQLite / PGlite では再現しない)。
// invalidateAll の鮮度に依存せず、action が返す `addedChild` を直接一覧へ楽観追加する。
//
// 一覧描画は `data.children` 単独ではなく `displayChildren` (= サーバー確定分 + 楽観追加分)
// を使う。サーバー側データが追いついた (同 id が data.children に現れた) 楽観エントリは
// $effect で間引き、二重表示を防ぐ。
type DisplayChild = (typeof data.children)[number];
let optimisticChildren = $state<DisplayChild[]>([]);
$effect(() => {
	if (optimisticChildren.length === 0) return;
	const confirmedIds = new Set(data.children.map((c) => c.id));
	const stillPending = optimisticChildren.filter((c) => !confirmedIds.has(c.id));
	if (stillPending.length !== optimisticChildren.length) {
		optimisticChildren = stillPending;
	}
});
const displayChildren = $derived([...data.children, ...optimisticChildren]);
// 上限バナー/ボタンも楽観追加分だけその場で加算する (サーバー確定後は data.childLimit
// 自体が追いつき、同時に optimisticChildren も間引かれるため二重加算しない)。
// 算出ロジックは `computeOptimisticChildLimit` (境界値を unit test で固定、#4919 AC1)。
const displayChildLimit = $derived(
	computeOptimisticChildLimit(childLimit, optimisticChildren.length),
);

// #4919 AC2: 成功時に role="status" の確認文言を出す (admin/activities の 2 層 feedback
// パターン。Toast は `role="alert"` の一時通知、banner は `role="status"` で次操作まで残る)。
let actionMessage = $state<string | null>(null);
</script>

<svelte:head>
	<title>{PAGE_TITLES.children}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="children-page">
	<div class="flex items-center gap-2 mb-3">
		<h2 class="text-lg font-bold">{ADMIN_CHILDREN_PAGE_LABELS.pageTitle}</h2>
	</div>
	{#if displayChildLimit && !displayChildLimit.allowed}
		<div class="children-page__limit-banner">
			<span class="children-page__limit-icon">⚠️</span>
			<div>
				<p class="children-page__limit-title">{ADMIN_CHILDREN_PAGE_LABELS.limitBannerTitle}</p>
				<p class="children-page__limit-desc">
					{ADMIN_CHILDREN_PAGE_LABELS.limitBannerDesc(displayChildLimit.current, displayChildLimit.max ?? 0)}
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
		{#if !displayChildLimit || displayChildLimit.allowed}
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
							// #4919: invalidateAll の再読込を待たず、action が返した addedChild を
							// 楽観的に一覧へ足す (根本原因は script 冒頭のコメント参照)。
							const addedChild = (
								result.data as { addedChild?: Omit<DisplayChild, 'balance' | 'level' | 'levelTitle'> } | undefined
							)?.addedChild;
							if (addedChild) {
								optimisticChildren = [
									...optimisticChildren,
									{ ...addedChild, balance: 0, level: 1, levelTitle: '' },
								];
								actionMessage = ADMIN_CHILDREN_PAGE_LABELS.addedSuccess(addedChild.nickname);
								showToast(actionMessage, undefined, 'success');
							}
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

	<!-- #4919 AC2: 成功メッセージ (role="status"、admin/activities の action-message と同型) -->
	{#if actionMessage}
		<div class="action-message" role="status" data-testid="admin-children-action-message">
			<span>{actionMessage}</span>
		</div>
	{/if}

	<!-- Children list -->
	<div class="children-page__list" data-tutorial="children-list">
		{#each displayChildren as child, i}
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
	/* #4919: same shape as admin/activities .action-message (success role="status" banner) */
	.action-message {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md, 0.5rem);
		background: var(--color-feedback-success-bg);
		border: 1px solid var(--color-feedback-success-border);
		color: var(--color-feedback-success-text);
		font-size: 0.85rem;
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
