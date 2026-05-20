<script lang="ts">
// #2321 (EPIC #2319 ②): account グループ — OYAKAGI / logout / accountDelete (Danger Zone)
//
// 旧 /admin/settings/+page.svelte 行 682 (OYAKAGI) / 1908 (accountDelete) / 2047 (logout) を移行。
// GitHub Danger Zone パターン (赤枠 + ページ最下部 + 3-step 確認) を `accountDelete` に適用。

import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { getErrorMessage } from '$lib/domain/errors';
import { APP_LABELS, OYAKAGI_LABELS, PAGE_TITLES, SETTINGS_LABELS } from '$lib/domain/labels';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { form } = $props();
const errorMessage = $derived(getErrorMessage(form?.error));

let success = $state(false);
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
		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			{OYAKAGI_LABELS.defaultValueHint}
		</p>

		{#if success}
			<SuccessAlert message={OYAKAGI_LABELS.changeSuccess} />
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
				label={`現在の${OYAKAGI_LABELS.name}`}
				type="password"
				id="currentPin"
				name="currentPin"
				required
			/>

			<FormField
				label={`新しい${OYAKAGI_LABELS.name}（4〜8桁）`}
				type="password"
				id="newPin"
				name="newPin"
				required
			/>

			<FormField
				label={`新しい${OYAKAGI_LABELS.name}（確認）`}
				type="password"
				id="confirmPin"
				name="confirmPin"
				required
			/>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={submitting}
			>
				{submitting ? '変更中...' : OYAKAGI_LABELS.changeAction}
			</Button>
		</form>
	</Card>

	<!-- ログアウト (cognito モードのみ) -->
	{#if $page.data.authMode === 'cognito'}
		<Card padding="lg">
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
		<section class="danger-zone" data-testid="account-danger-zone">
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
						<p class="text-[var(--color-feedback-error-text)] font-medium">
							{SETTINGS_LABELS.accountDeleteOwnerWarning}
						</p>
					</div>
				{:else if $page.data.userRole === 'child'}
					<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
						<p>{SETTINGS_LABELS.accountDeleteChildDesc}</p>
						<p>{SETTINGS_LABELS.accountDeleteChildDesc2}</p>
						<p class="text-[var(--color-feedback-error-text)] font-medium">
							{SETTINGS_LABELS.accountDeleteChildWarning}
						</p>
					</div>
				{:else}
					<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
						<p>{SETTINGS_LABELS.accountDeleteMemberDesc}</p>
						<p>{SETTINGS_LABELS.accountDeleteMemberDesc2}</p>
						<p class="text-[var(--color-feedback-error-text)] font-medium">
							{SETTINGS_LABELS.accountDeleteMemberWarning}
						</p>
					</div>
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
