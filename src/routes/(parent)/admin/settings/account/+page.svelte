<script lang="ts">
// #2321 (EPIC #2319 ②): account グループ — OYAKAGI / logout / accountDelete (Danger Zone)
//
// 旧 /admin/settings/+page.svelte 行 682 (OYAKAGI) / 1908 (accountDelete) / 2047 (logout) を移行。
// GitHub Danger Zone パターン (赤枠 + ページ最下部 + 3-step 確認) を `accountDelete` に適用。

import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { DELETION_GRACE_PERIOD_DAYS } from '$lib/domain/constants/deletion-grace';
import { PIN_LENGTH } from '$lib/domain/constants/oyakagi';
import type { PlanTier } from '$lib/domain/constants/plan-tier';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { getErrorMessage } from '$lib/domain/errors';
import { APP_LABELS, OYAKAGI_LABELS, PAGE_TITLES, SETTINGS_LABELS } from '$lib/domain/labels';
import AccountDeletionExportPanel from '$lib/features/admin/components/AccountDeletionExportPanel.svelte';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { form } = $props();
const errorMessage = $derived(getErrorMessage(form?.error));

// #4698: JS 未 hydrate の native POST (SSR 再描画) でも成功表示が出るよう form prop を初期値にする
let success = $state(false);
const changeSucceeded = $derived(success || form?.success === true);
let submitting = $state(false);

// アカウント削除関連
let deleteConfirmText = $state('');
let deleteAgreeChecked = $state(false);
let deleteSubmitting = $state(false);
let deleteError = $state('');
let showTransferDialog = $state(false);
let transferTargetId = $state('');
let deletionInfo = $state<{
	isOnlyMember: boolean;
	otherMembers: Array<{
		userId: string;
		role: string;
		email?: string;
		displayName?: string;
	}>;
} | null>(null);
let deletionInfoLoading = $state(false);

// #1781: 削除後グレースピリオド復元
let restoreSubmitting = $state(false);
let restoreError = $state('');

const gracePeriodStatus = $derived(
	$page.data.gracePeriodStatus as
		| {
				isSoftDeleted: boolean;
				softDeletedAt: string | null;
				gracePeriodDays: number;
				physicalDeletionDate: string | null;
				daysRemaining: number;
				isExpired: boolean;
				planTier: string | null;
		  }
		| undefined,
);

const gracePeriodDeletionDateLabel = $derived.by(() => {
	const iso = gracePeriodStatus?.physicalDeletionDate;
	if (!iso) return '';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
});

async function handleRestoreAccount() {
	if (restoreSubmitting) return;
	restoreSubmitting = true;
	restoreError = '';
	try {
		const res = await fetch('/api/v1/admin/account/restore', { method: 'POST' });
		const d = await res.json();
		if (!res.ok) {
			throw new Error(d.message ?? d.error ?? SETTINGS_LABELS.deletionGraceRestoreError);
		}
		window.location.reload();
	} catch (err) {
		restoreError = err instanceof Error ? err.message : SETTINGS_LABELS.deletionGraceRestoreError;
	} finally {
		restoreSubmitting = false;
	}
}

async function fetchDeletionInfo() {
	if (deletionInfoLoading) return;
	deletionInfoLoading = true;
	try {
		const res = await fetch('/api/v1/admin/account/deletion-info');
		const d = await res.json();
		if (!res.ok) throw new Error(d.error ?? '情報取得に失敗しました');
		deletionInfo = d;
	} catch (err) {
		deleteError = err instanceof Error ? err.message : '情報取得に失敗しました';
	} finally {
		deletionInfoLoading = false;
	}
}

async function handleDeleteAccount() {
	if (deleteSubmitting) return;
	if (deleteConfirmText !== 'アカウントを削除します' || !deleteAgreeChecked) return;
	deleteSubmitting = true;
	deleteError = '';

	const role = $page.data.userRole;
	let pattern: string;

	if (role === 'owner') {
		if (deletionInfo?.isOnlyMember) {
			pattern = 'owner-only';
		} else {
			showTransferDialog = true;
			deleteSubmitting = false;
			return;
		}
	} else if (role === 'child') {
		pattern = 'child';
	} else {
		pattern = 'member';
	}

	try {
		const res = await fetch('/api/v1/admin/account/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pattern }),
		});
		const d = await res.json();
		if (!res.ok) throw new Error(d.error ?? 'アカウント削除に失敗しました');
		window.location.href = '/auth/signout';
	} catch (err) {
		deleteError = err instanceof Error ? err.message : 'アカウント削除に失敗しました';
	} finally {
		deleteSubmitting = false;
	}
}

async function handleTransferAndDelete() {
	if (deleteSubmitting || !transferTargetId) return;
	deleteSubmitting = true;
	deleteError = '';

	try {
		const res = await fetch('/api/v1/admin/account/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				pattern: 'owner-with-transfer',
				newOwnerId: transferTargetId,
			}),
		});
		const d = await res.json();
		if (!res.ok) throw new Error(d.error ?? 'アカウント削除に失敗しました');
		window.location.href = '/auth/signout';
	} catch (err) {
		deleteError = err instanceof Error ? err.message : 'アカウント削除に失敗しました';
	} finally {
		deleteSubmitting = false;
	}
}

async function handleFullDelete() {
	if (deleteSubmitting) return;
	deleteSubmitting = true;
	deleteError = '';

	try {
		const res = await fetch('/api/v1/admin/account/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pattern: 'owner-full-delete' }),
		});
		const d = await res.json();
		if (!res.ok) throw new Error(d.error ?? 'アカウント削除に失敗しました');
		window.location.href = '/auth/signout';
	} catch (err) {
		deleteError = err instanceof Error ? err.message : 'アカウント削除に失敗しました';
	} finally {
		deleteSubmitting = false;
	}
}

// #4472: 退会前エクスポートのスコープ表示に使う (未解決時は最小スコープ扱い)
const exportPlanTier = $derived(($page.data.planTier as PlanTier | null) ?? 'free');

// #4496: 退会 (アカウント削除) の猶予はプラン別で、無料プランは 0 日 = 申請と同時に物理削除。
// 手続き前にこれを述べないと、無料プランの顧客は取り消せないことを知らないまま申し込む。
//
// exportPlanTier の `?? 'free'` フォールバックをここに流用しない: プランが未解決のときに
// 「猶予なし・取り消し不可」という最も強い警告を有料プランの親に見せると、事実と異なる
// 誤誘導になる。未解決時は猶予の断定を出さない (持ち出し導線は従来どおり出す)。
const deletionGracePlanTier = $derived($page.data.planTier as PlanTier | null);
const deletionGraceDays = $derived(
	deletionGracePlanTier === null ? null : DELETION_GRACE_PERIOD_DAYS[deletionGracePlanTier],
);

const canConfirmDelete = $derived(
	deleteConfirmText === 'アカウントを削除します' && deleteAgreeChecked,
);
</script>

<svelte:head>
	<title>{SETTINGS_LABELS.groupAccountTitle} | {PAGE_TITLES.settings}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- #1781: 削除グレースピリオド (soft-delete) バナー -->
	{#if gracePeriodStatus?.isSoftDeleted && !gracePeriodStatus.isExpired}
		<div
			data-testid="deletion-grace-banner"
			class="bg-[var(--color-feedback-warning-bg)] border-2 border-[var(--color-feedback-warning-border)] rounded-xl p-6"
		>
			<h3 class="text-lg font-bold text-[var(--color-feedback-warning-text)] mb-2">
				{SETTINGS_LABELS.deletionGraceTitle}
			</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)] mb-4">
				{SETTINGS_LABELS.deletionGraceDesc(
					gracePeriodStatus.daysRemaining,
					gracePeriodDeletionDateLabel,
				)}
			</p>
			{#if restoreError}
				<ErrorAlert message={restoreError} severity="error" action="retry" />
			{/if}
			<Button
				type="button"
				variant="success"
				size="md"
				disabled={restoreSubmitting}
				onclick={handleRestoreAccount}
				data-testid="deletion-grace-restore-button"
			>
				{restoreSubmitting
					? SETTINGS_LABELS.deletionGraceRestoreSubmitting
					: SETTINGS_LABELS.deletionGraceRestoreAction}
			</Button>
		</div>
	{/if}

	<!-- おやカギコード変更 -->
	<Card padding="lg" data-tutorial="pin-settings">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
			{OYAKAGI_LABELS.sectionTitle}
		</h3>
		<p class="text-sm text-[var(--color-text-muted)] mb-4" data-testid="oyakagi-forgot-hint">
			{OYAKAGI_LABELS.forgotHint}
		</p>

		{#if changeSucceeded}
			<div data-testid="oyakagi-change-success"><SuccessAlert message={OYAKAGI_LABELS.changeSuccess} /></div>
		{/if}

		{#if errorMessage}
			<ErrorAlert message={errorMessage} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/changePin"
			use:enhance={() => {
				submitting = true;
				success = false;
				return async ({ result, update }) => {
					submitting = false;
					if (result.type === 'success') {
						success = true;
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<FormField
				label={OYAKAGI_LABELS.currentInputLabel}
				type="password"
				id="currentPin"
				name="currentPin"
				required
			/>

			<!-- #4661: 桁数は OYAKAGI_TERMS.digitRange (= PIN_MIN_LENGTH〜PIN_MAX_LENGTH) 由来。
			     直書きしていた頃はエラー文の「4〜6桁」と同じ画面で矛盾していた。 -->
			<FormField
				label={OYAKAGI_LABELS.newInputLabel}
				type="password"
				id="newPin"
				name="newPin"
				inputmode="numeric"
				maxlength={PIN_LENGTH}
				required
			/>

			<FormField
				label={OYAKAGI_LABELS.confirmInputLabel}
				type="password"
				id="confirmPin"
				name="confirmPin"
				inputmode="numeric"
				maxlength={PIN_LENGTH}
				required
			/>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={submitting}
				data-testid="oyakagi-change-submit"
			>
				{submitting ? '変更中...' : OYAKAGI_LABELS.changeAction}
			</Button>
		</form>
	</Card>

	<!-- ログアウト (cognito モードのみ) -->
	{#if $page.data.authMode === 'cognito'}
		<!-- #4662: ページガイド ③ の anchor。カード自体が cognito 限定描画なので、
		     ガイド側は requiredRuntime='saas' + optional で「出ているときだけ」案内する -->
		<Card padding="lg" data-tutorial="account-logout">
			<h3 class="text-lg font-bold text-[var(--color-text)] mb-2">
				{SETTINGS_LABELS.logoutSectionTitle}
			</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				{SETTINGS_LABELS.logoutDesc}
			</p>
			<a
				href="/auth/signout"
				class="inline-block px-4 py-2 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm font-medium rounded-lg border border-[var(--color-feedback-error-border)] hover:bg-[var(--color-feedback-error-bg-strong)] transition-colors no-underline"
				data-testid="account-logout-link"
			>
				{SETTINGS_LABELS.logoutAction}
			</a>
		</Card>
	{/if}

	<!-- Danger Zone: アカウント削除 (#2321 GitHub Danger Zone パターン) -->
	{#if $page.data.authMode === 'cognito' && $page.data.tenantStatus !== SUBSCRIPTION_STATUS.GRACE_PERIOD}
		<!-- #4662: ページガイド ④ の anchor (同上、cognito 限定描画) -->
		<section
			class="danger-zone"
			data-testid="account-danger-zone"
			data-tutorial="account-danger-zone"
		>
			<header class="danger-zone__header">
				<h3 class="danger-zone__title">
					⚠️ {SETTINGS_LABELS.dangerZoneTitle}
				</h3>
				<p class="danger-zone__desc">{SETTINGS_LABELS.dangerZoneDesc}</p>
			</header>

			<div class="danger-zone__body">
				<h4 class="text-base font-bold text-[var(--color-feedback-error-text)] mb-2">
					{SETTINGS_LABELS.accountDeleteSectionTitle}
				</h4>

				{#if $page.data.userRole === 'owner'}
					<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
						<p>{SETTINGS_LABELS.accountDeleteOwnerDesc}</p>
						<ul class="list-disc ml-5 text-[var(--color-text-muted)] space-y-1">
							<li>{SETTINGS_LABELS.accountDeleteOwnerItem1}</li>
							<li>{SETTINGS_LABELS.accountDeleteOwnerItem2}</li>
							<li>{SETTINGS_LABELS.accountDeleteOwnerItem3}</li>
							<li>{SETTINGS_LABELS.accountDeleteOwnerItem4}</li>
						</ul>
						<!-- #4545: 不可逆 (復旧不能) の告知は色文字ではなく Alert primitive で出す。
						     danger variant が枠線 + 背景 + アイコン + role="alert" を担保する。 -->
						<Alert
							variant="danger"
							message={SETTINGS_LABELS.accountDeleteOwnerWarning}
							data-testid="account-delete-owner-warning"
						/>
					</div>
				{:else if $page.data.userRole === 'child'}
					<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
						<p>{SETTINGS_LABELS.accountDeleteChildDesc}</p>
						<p>{SETTINGS_LABELS.accountDeleteChildDesc2}</p>
						<!-- #4545: 同上 (子供アカウント自身の削除も復旧不能) -->
						<Alert
							variant="danger"
							message={SETTINGS_LABELS.accountDeleteChildWarning}
							data-testid="account-delete-child-warning"
						/>
					</div>
				{:else}
					<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
						<p>{SETTINGS_LABELS.accountDeleteMemberDesc}</p>
						<p>{SETTINGS_LABELS.accountDeleteMemberDesc2}</p>
						<!-- #4545: 同上 (メンバー離脱もログイン情報は復旧不能) -->
						<Alert
							variant="danger"
							message={SETTINGS_LABELS.accountDeleteMemberWarning}
							data-testid="account-delete-member-warning"
						/>
					</div>
				{/if}

				{#if $page.data.userRole === 'owner'}
					<!-- #4496: プラン別の猶予期間を手続き **前** に述べる (無料プランは猶予なし) -->
					{#if deletionGraceDays !== null}
						<!-- #4545: 猶予 0 日 (無料プラン) は申込と同時に物理削除され取り消せないため
						     danger (role="alert") で出す。猶予がある有料プランは期間内なら取り消せる
						     ので warning (role="status") に留め、不可逆でないものを同じ強さで叫ばない。 -->
						<Alert
							variant={deletionGraceDays === 0 ? 'danger' : 'warning'}
							message={SETTINGS_LABELS.accountDeleteGraceNotice(deletionGraceDays)}
							class="mb-4"
							data-testid="account-delete-grace-notice"
						/>
					{/if}

					<!-- #4472: 退会を実行する前にデータを持ち出せるようにする (無料プランを含む全プラン) -->
					<AccountDeletionExportPanel planTier={exportPlanTier} />
				{/if}

				{#if deleteError}
					<ErrorAlert message={deleteError} severity="error" action="retry" />
				{/if}

				{#if showTransferDialog && deletionInfo && !deletionInfo.isOnlyMember}
					<div
						class="mt-4 p-4 rounded-lg border-2 border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
					>
						<h4 class="font-bold text-[var(--color-text-primary)] mb-3">
							{SETTINGS_LABELS.accountDeleteTransferTitle}
						</h4>
						<p class="text-sm text-[var(--color-text-secondary)] mb-4">
							{SETTINGS_LABELS.accountDeleteTransferDesc}
						</p>

						<div class="space-y-4">
							<div class="p-3 rounded-lg bg-[var(--color-surface-card)]">
								<p
									class="text-sm font-medium text-[var(--color-text-primary)] mb-2"
								>
									{SETTINGS_LABELS.accountDeleteTransferOption}
								</p>
								<div class="flex items-center gap-2 mb-2">
									<div class="flex-1">
										<NativeSelect
											bind:value={transferTargetId}
											options={[
												{ value: '', label: '移譲先を選択...' },
												...deletionInfo.otherMembers
													.filter((m) => m.role !== 'child')
													.map((member) => ({
														value: member.userId,
														label: `${member.displayName ?? member.email ?? member.userId}（${member.role}）`,
													})),
											]}
										/>
									</div>
									<Button
										type="button"
										variant="danger"
										size="sm"
										disabled={deleteSubmitting || !transferTargetId}
										onclick={handleTransferAndDelete}
									>
										{deleteSubmitting ? '処理中...' : '移譲して退会'}
									</Button>
								</div>
							</div>

							<div class="p-3 rounded-lg bg-[var(--color-surface-card)]">
								<p
									class="text-sm font-medium text-[var(--color-feedback-error-text)] mb-2"
								>
									{SETTINGS_LABELS.accountDeleteFullOption}
								</p>
								<p class="text-xs text-[var(--color-text-muted)] mb-2">
									{SETTINGS_LABELS.accountDeleteFullOptionDesc}
								</p>
								<Button
									type="button"
									variant="danger"
									size="sm"
									disabled={deleteSubmitting}
									onclick={handleFullDelete}
								>
									{deleteSubmitting ? '処理中...' : '全て削除する'}
								</Button>
							</div>

							<Button
								type="button"
								variant="ghost"
								size="sm"
								onclick={() => {
									showTransferDialog = false;
								}}
							>
								{SETTINGS_LABELS.accountDeleteCancelAction}
							</Button>
						</div>
					</div>
				{:else}
					<!-- Step 1: 確認テキスト入力 -->
					<div class="danger-zone__step">
						<p class="danger-zone__step-label">
							{SETTINGS_LABELS.dangerStep1Label}
						</p>
						<FormField
							label="確認のため「アカウントを削除します」と入力してください"
							type="text"
							id="deleteConfirm"
							bind:value={deleteConfirmText}
							placeholder="アカウントを削除します"
						/>
					</div>

					<!-- Step 2: 同意チェック -->
					<div class="danger-zone__step">
						<p class="danger-zone__step-label">
							{SETTINGS_LABELS.dangerStep2Label}
						</p>
						<label class="flex items-start gap-2 cursor-pointer">
							<input
								type="checkbox"
								bind:checked={deleteAgreeChecked}
								class="mt-1 h-4 w-4 rounded border-[var(--color-border-strong)]"
								data-testid="account-danger-agree-checkbox"
							/>
							<span class="text-sm text-[var(--color-text)]">
								{SETTINGS_LABELS.accountDeleteDangerConsentLabel}
							</span>
						</label>
					</div>

					<!-- Step 3: 実行ボタン -->
					<div class="danger-zone__step">
						<p class="danger-zone__step-label">
							{SETTINGS_LABELS.dangerStep3Label}
						</p>
						<Button
							type="button"
							variant="danger"
							size="md"
							class="w-full"
							disabled={deleteSubmitting || deletionInfoLoading || !canConfirmDelete}
							onclick={async () => {
								if ($page.data.userRole === 'owner' && !deletionInfo) {
									await fetchDeletionInfo();
								}
								handleDeleteAccount();
							}}
							data-testid="account-danger-execute-button"
						>
							{deleteSubmitting || deletionInfoLoading
								? '処理中...'
								: 'アカウントを削除する'}
						</Button>
					</div>
				{/if}
			</div>
		</section>
	{/if}
</div>

<style>
	.danger-zone {
		border: 2px solid var(--color-action-danger);
		border-radius: 0.75rem;
		background: var(--color-surface-card);
		overflow: hidden;
	}

	.danger-zone__header {
		background: var(--color-feedback-error-bg);
		padding: 1rem;
		border-bottom: 1px solid var(--color-action-danger);
	}

	.danger-zone__title {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-feedback-error-text);
		margin: 0 0 0.25rem 0;
	}

	.danger-zone__desc {
		font-size: 0.8125rem;
		color: var(--color-feedback-error-text);
		margin: 0;
	}

	.danger-zone__body {
		padding: 1rem;
	}

	.danger-zone__step {
		margin-top: 1rem;
	}

	.danger-zone__step-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-secondary);
		margin: 0 0 0.5rem 0;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
