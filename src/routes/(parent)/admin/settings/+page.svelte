<script lang="ts">
import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { getErrorMessage } from '$lib/domain/errors';
import { IMPORT_LABELS, type ImportSkipReason } from '$lib/domain/labels';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { CURRENCY_CODES, CURRENCY_DEFS, formatPointValue } from '$lib/domain/point-display';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import PremiumBadge from '$lib/ui/components/PremiumBadge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';
import { APP_VERSION } from '$lib/version';

type DuplicateEntry = { label: string; reason: ImportSkipReason };

let { data, form } = $props();
// #787: form.error / form.siblingError が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));
const siblingErrorMessage = $derived(getErrorMessage(form?.siblingError));

let success = $state(false);
let submitting = $state(false);

// エクスポート
let exportLoading = $state(false);
let exportError = $state('');
let compactFormat = $state(false);
let includeFiles = $state(false);

// インポート
let importFile = $state<File | null>(null);
let importLoading = $state(false);
let importError = $state('');
let importPreview = $state<
	| (Record<string, number> & {
			duplicates?: {
				activities: DuplicateEntry[];
				specialRewards: DuplicateEntry[];
				checklistTemplates: DuplicateEntry[];
				activityLogs: DuplicateEntry[];
				loginBonuses: DuplicateEntry[];
			};
	  })
	| null
>(null);
let importResult = $state<{
	childrenImported: number;
	activitiesCreated: number;
	activityLogsImported: number;
	activityLogsSkipped: number;
	pointLedgerImported: number;
	pointLedgerSkipped: number;
	errors: string[];
	warnings: string[];
} | null>(null);
let importStep = $state<'select' | 'preview' | 'done'>('select');

async function handleImportFileChange(e: Event) {
	if (anyFormBusy) return;
	const input = e.target as HTMLInputElement;
	importFile = input.files?.[0] ?? null;
	importError = '';
	importPreview = null;
	importResult = null;
	importStep = 'select';

	if (!importFile) return;
	if (!importFile.name.endsWith('.json')) {
		importError = 'JSONファイルを選択してください';
		importFile = null;
		return;
	}
	if (importFile.size > 10 * 1024 * 1024) {
		importError = 'ファイルサイズが大きすぎます（最大10MB）';
		importFile = null;
		return;
	}

	importLoading = true;
	try {
		const text = await importFile.text();
		const json = JSON.parse(text);
		const res = await fetch('/api/v1/import?mode=preview', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(json),
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data?.error?.message ?? 'プレビューに失敗しました');
		}
		importPreview = data.preview;
		importStep = 'preview';
	} catch (err) {
		importError = err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました';
		importFile = null;
	} finally {
		importLoading = false;
	}
}

async function handleImportExecute() {
	if (anyFormBusy || !importFile) return;
	importLoading = true;
	importError = '';
	try {
		const text = await importFile.text();
		const json = JSON.parse(text);
		const mode = importMode === 'replace' ? 'replace' : 'execute';
		const res = await fetch(`/api/v1/import?mode=${mode}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(json),
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data?.error?.message ?? 'インポートに失敗しました');
		}
		importResult = data.result;
		importStep = 'done';
	} catch (err) {
		importError = err instanceof Error ? err.message : 'インポートに失敗しました';
	} finally {
		importLoading = false;
	}
}

function resetImport() {
	importFile = null;
	importPreview = null;
	importResult = null;
	importError = '';
	importStep = 'select';
}

async function handleExport() {
	if (anyFormBusy) return;
	exportLoading = true;
	exportError = '';
	try {
		const params = new URLSearchParams();
		if (compactFormat) params.set('compact', '1');
		if (includeFiles) params.set('format', 'zip');
		const qs = params.toString() ? `?${params.toString()}` : '';
		const res = await fetch(`/api/v1/export${qs}`);
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			throw new Error(data?.error?.message ?? `エクスポートに失敗しました (${res.status})`);
		}
		const blob = await res.blob();
		const disposition = res.headers.get('Content-Disposition') ?? '';
		const filenameMatch = disposition.match(/filename="(.+)"/);
		const filename =
			filenameMatch?.[1] ?? `ganbari-quest-backup-${new Date().toISOString().split('T')[0]}.json`;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	} catch (err) {
		exportError = err instanceof Error ? err.message : 'エクスポートに失敗しました';
	} finally {
		exportLoading = false;
	}
}

// クラウドエクスポート
let cloudExports = $state<
	Array<{
		id: number;
		exportType: string;
		pinCode: string;
		expiresAt: string;
		fileSizeBytes: number;
		description: string | null;
		downloadCount: number;
		maxDownloads: number;
		createdAt: string;
	}>
>([]);
let cloudLoading = $state(false);
let cloudError = $state('');
let cloudSuccess = $state('');
let cloudExportType = $state<'template' | 'full'>('template');
let cloudImportPin = $state('');
let cloudImportLoading = $state(false);
let cloudImportError = $state('');
let cloudImportPreview = $state<Record<string, unknown> | null>(null);
let cloudImportResult = $state<Record<string, unknown> | null>(null);
let cloudImportStep = $state<'input' | 'preview' | 'done'>('input');

async function loadCloudExports() {
	try {
		const res = await fetch('/api/v1/export/cloud');
		if (res.ok) {
			const d = await res.json();
			cloudExports = d.exports ?? [];
		}
	} catch {
		/* ignore */
	}
}

async function handleCloudExport() {
	if (anyFormBusy) return;
	cloudLoading = true;
	cloudError = '';
	cloudSuccess = '';
	try {
		const res = await fetch('/api/v1/export/cloud', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ exportType: cloudExportType }),
		});
		const d = await res.json();
		if (!res.ok) {
			throw new Error(d?.error?.message ?? 'クラウドエクスポートに失敗しました');
		}
		cloudSuccess = `PINコード: ${d.pinCode}（有効期限: ${new Date(d.expiresAt).toLocaleDateString('ja-JP')}）`;
		await loadCloudExports();
	} catch (err) {
		cloudError = err instanceof Error ? err.message : 'クラウドエクスポートに失敗しました';
	} finally {
		cloudLoading = false;
	}
}

async function handleDeleteCloudExport(id: number) {
	try {
		const res = await fetch(`/api/v1/export/cloud/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const d = await res.json();
			throw new Error(d?.error?.message ?? '削除に失敗しました');
		}
		await loadCloudExports();
	} catch (err) {
		cloudError = err instanceof Error ? err.message : '削除に失敗しました';
	}
}

async function handleCloudImportPreview() {
	if (anyFormBusy || !cloudImportPin.trim()) return;
	cloudImportLoading = true;
	cloudImportError = '';
	try {
		const res = await fetch('/api/v1/import/cloud?mode=preview', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pinCode: cloudImportPin.trim() }),
		});
		const d = await res.json();
		if (!res.ok) {
			throw new Error(d?.error?.message ?? 'PINコードが無効です');
		}
		cloudImportPreview = d.preview;
		cloudImportStep = 'preview';
	} catch (err) {
		cloudImportError = err instanceof Error ? err.message : 'PINコードが無効です';
	} finally {
		cloudImportLoading = false;
	}
}

async function handleCloudImportExecute() {
	if (anyFormBusy) return;
	cloudImportLoading = true;
	cloudImportError = '';
	try {
		const res = await fetch('/api/v1/import/cloud?mode=execute', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pinCode: cloudImportPin.trim() }),
		});
		const d = await res.json();
		if (!res.ok) {
			throw new Error(d?.error?.message ?? 'インポートに失敗しました');
		}
		cloudImportResult = d.result;
		cloudImportStep = 'done';
	} catch (err) {
		cloudImportError = err instanceof Error ? err.message : 'インポートに失敗しました';
	} finally {
		cloudImportLoading = false;
	}
}

function resetCloudImport() {
	cloudImportPin = '';
	cloudImportPreview = null;
	cloudImportResult = null;
	cloudImportError = '';
	cloudImportStep = 'input';
}

// 初回ロード時にクラウドエクスポート一覧を取得（#773: maxCloudExports > 0 の有料プランのみ）
$effect(() => {
	if ($page.data.authMode === 'cognito' && data.maxCloudExports > 0) {
		loadCloudExports();
	}
});

// ステータス減少設定
let decayIntensity = $state<string>('normal');
let decaySaving = $state(false);
let decaySuccess = $state(false);
// サーバーデータから減少設定を同期
$effect(() => {
	decayIntensity = data.decayIntensity ?? 'normal';
});

const DECAY_OPTIONS = [
	{ value: 'none', label: 'なし', desc: '減少しません（練習や導入期間向け）' },
	{ value: 'gentle', label: 'ゆるやか', desc: '通常の半分の速度で減少します' },
	{ value: 'normal', label: 'ふつう', desc: '猶予2日後にゆるやかに減少します' },
	{ value: 'strict', label: 'きびしめ', desc: '上級者向け。1.5倍の速度で減少します' },
] as const;

async function saveDecayIntensity() {
	if (anyFormBusy) return;
	decaySaving = true;
	decaySuccess = false;
	try {
		const res = await fetch('/api/v1/settings/decay', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ intensity: decayIntensity }),
		});
		if (!res.ok) throw new Error('Failed to save');
		decaySuccess = true;
		setTimeout(() => {
			decaySuccess = false;
		}, 3000);
	} finally {
		decaySaving = false;
	}
}

// ポイント表示設定
let pointSuccess = $state(false);
let pointSubmitting = $state(false);
let pointMode = $state<PointUnitMode>('point');
let pointCurrency = $state<CurrencyCode>('JPY');
let pointRate = $state('1');
// サーバーデータからポイント設定を同期
$effect(() => {
	pointMode = data.pointSettings.mode;
	pointCurrency = data.pointSettings.currency;
	pointRate = String(data.pointSettings.rate);
});

// フィードバック
let feedbackSuccess = $state(false);
let feedbackSubmitting = $state(false);
let feedbackCategory = $state('feature');
let feedbackText = $state('');
let feedbackEmail = $state('');
let feedbackInquiryId = $state('');

// データクリア
let clearConfirmText = $state('');
let clearSubmitting = $state(false);
let clearError = $state('');
let clearSuccess = $state(false);

// インポートモード
let importMode = $state<'add' | 'replace'>('replace');

// アカウント削除
let cancelConfirmText = $state('');
let cancelSubmitting = $state(false);
let cancelError = $state('');
let reactivateSubmitting = $state(false);

// アカウント削除（ロールベース）
let deleteConfirmText = $state('');
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

/** Owner 削除時: 他メンバー情報を取得 */
async function fetchDeletionInfo() {
	if (anyFormBusy) return;
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

/** ロールに応じたアカウント削除 */
async function handleDeleteAccount() {
	if (anyFormBusy || deleteConfirmText !== 'アカウントを削除します') return;
	deleteSubmitting = true;
	deleteError = '';

	const role = $page.data.userRole;
	let pattern: string;

	if (role === 'owner') {
		if (deletionInfo?.isOnlyMember) {
			pattern = 'owner-only';
		} else {
			// Show transfer dialog instead
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

/** Owner: 権限移譲して退会 */
async function handleTransferAndDelete() {
	if (anyFormBusy || !transferTargetId) return;
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

/** Owner: 移譲なしで全削除 */
async function handleFullDelete() {
	if (anyFormBusy) return;
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

async function handleCancelAccount() {
	if (anyFormBusy || cancelConfirmText !== 'アカウントを削除します') return;
	cancelSubmitting = true;
	cancelError = '';
	try {
		const res = await fetch('/api/v1/admin/tenant/cancel', { method: 'POST' });
		const d = await res.json();
		if (!res.ok) throw new Error(d.error ?? '解約申請に失敗しました');
		window.location.reload();
	} catch (err) {
		cancelError = err instanceof Error ? err.message : '解約申請に失敗しました';
	} finally {
		cancelSubmitting = false;
	}
}

async function handleReactivate() {
	if (anyFormBusy) return;
	reactivateSubmitting = true;
	cancelError = '';
	try {
		const res = await fetch('/api/v1/admin/tenant/reactivate', { method: 'POST' });
		const d = await res.json();
		// #784: Stripe Subscription が既にキャンセル済みの場合、サーバは 409 と
		// redirectTo を返す。再購読のため /pricing へ誘導する。
		if (res.status === 409 && d?.reason === 'subscription_cancelled' && d?.redirectTo) {
			window.location.href = d.redirectTo;
			return;
		}
		if (!res.ok) throw new Error(d.error ?? '解約キャンセルに失敗しました');
		window.location.reload();
	} catch (err) {
		cancelError = err instanceof Error ? err.message : '解約キャンセルに失敗しました';
	} finally {
		reactivateSubmitting = false;
	}
}

const previewPoints = 100;
const previewFormatted = $derived(
	formatPointValue(previewPoints, pointMode, pointCurrency, Number.parseFloat(pointRate) || 1),
);

// Form exclusion: prevent concurrent form operations
const anyFormBusy = $derived(
	submitting ||
		exportLoading ||
		importLoading ||
		cloudLoading ||
		cloudImportLoading ||
		decaySaving ||
		pointSubmitting ||
		feedbackSubmitting ||
		clearSubmitting ||
		cancelSubmitting ||
		reactivateSubmitting ||
		deleteSubmitting ||
		deletionInfoLoading,
);
</script>

<svelte:head>
	<title>設定 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- grace_period バナー -->
	{#if $page.data.tenantStatus === SUBSCRIPTION_STATUS.GRACE_PERIOD}
		<div class="bg-[var(--color-feedback-error-bg)] border-2 border-[var(--color-feedback-error-border)] rounded-xl p-6">
			<h3 class="text-lg font-bold text-[var(--color-feedback-error-text)] mb-2">解約手続き中です</h3>
			<p class="text-sm text-[var(--color-feedback-error-text)] mb-4">
				現在、アカウントは解約手続き中で読み取り専用モードです。
				期限までにキャンセルしないとデータが完全に削除されます。
			</p>
			{#if cancelError}
				<ErrorAlert message={cancelError} severity="error" action="retry" />
			{/if}
			<Button
				type="button"
				variant="success"
				size="md"
				disabled={reactivateSubmitting}
				onclick={handleReactivate}
			>
				{reactivateSubmitting ? 'キャンセル中...' : '解約をキャンセルして通常利用に戻る'}
			</Button>
		</div>
	{/if}

	<!-- おやカギコード変更 -->
	<Card padding="lg" data-tutorial="pin-settings">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-1">🔒 おやカギコード変更</h3>
		<p class="text-sm text-[var(--color-text-muted)] mb-4">初期値は 5086（がんばり）です</p>

		{#if success}
			<SuccessAlert message="おやカギコードを変更しました" />
		{/if}

		{#if errorMessage}
			<ErrorAlert message={errorMessage} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/changePin"
			use:enhance={({ cancel }) => {
				if (anyFormBusy) { cancel(); return; }
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
			<FormField label="現在のおやカギコード">
				{#snippet children()}
					<input
						type="password"
						id="currentPin"
						name="currentPin"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength="8"
						required
						class="w-full px-3 py-2 border border-[var(--input-border)] rounded-[var(--input-radius)] bg-[var(--input-bg)] focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-[var(--input-border-focus)] text-center text-lg tracking-widest transition-colors"
					/>
				{/snippet}
			</FormField>

			<FormField label="新しいおやカギコード（4〜8桁）">
				{#snippet children()}
					<input
						type="password"
						id="newPin"
						name="newPin"
						inputmode="numeric"
						pattern="[0-9]*"
						minlength="4"
						maxlength="8"
						required
						class="w-full px-3 py-2 border border-[var(--input-border)] rounded-[var(--input-radius)] bg-[var(--input-bg)] focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-[var(--input-border-focus)] text-center text-lg tracking-widest transition-colors"
					/>
				{/snippet}
			</FormField>

			<FormField label="新しいおやカギコード（確認）">
				{#snippet children()}
					<input
						type="password"
						id="confirmPin"
						name="confirmPin"
						inputmode="numeric"
						pattern="[0-9]*"
						minlength="4"
						maxlength="8"
						required
						class="w-full px-3 py-2 border border-[var(--input-border)] rounded-[var(--input-radius)] bg-[var(--input-bg)] focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-[var(--input-border-focus)] text-center text-lg tracking-widest transition-colors"
					/>
				{/snippet}
			</FormField>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={submitting}
			>
				{submitting ? '変更中...' : 'おやカギコードを変更'}
			</Button>
		</form>
	</Card>

	<!-- ステータス減少設定 -->
	<Card padding="lg">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">📊 ステータス減少設定</h3>
		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			活動をお休みした日のステータス減少の強さを設定できます。どの設定でも最初の2日間は減少しません。
		</p>

		{#if decaySuccess}
			<SuccessAlert message="ステータス減少設定を保存しました" />
		{/if}

		<div class="space-y-3 mb-4">
			{#each DECAY_OPTIONS as opt}
				<label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors {decayIntensity === opt.value ? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]' : 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}">
					<input
						type="radio"
						name="decayIntensity"
						value={opt.value}
						bind:group={decayIntensity}
						class="mt-0.5 accent-[var(--color-brand-500)]"
					/>
					<div>
						<span class="font-semibold text-[var(--color-text)]">{opt.label}</span>
						<p class="text-xs text-[var(--color-text-muted)] mt-0.5">{opt.desc}</p>
					</div>
				</label>
			{/each}
		</div>

		<Button
			type="button"
			variant="primary"
			size="md"
			class="w-full"
			onclick={saveDecayIntensity}
			disabled={decaySaving}
		>
			{decaySaving ? '保存中...' : '設定を保存'}
		</Button>
	</Card>

	<!-- 既定の子供（#576） -->
	{#if data.children.length >= 2}
		<Card padding="lg">
			<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">🏠 既定の子供</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				ホーム画面（/）を開いたときに自動で表示する子供を選べます。<br />
				これは<strong>この端末ではなく、アカウント全体の既定</strong>です。
				未設定のときは選択画面が表示されます。
			</p>

			{#if form?.defaultChildUpdated}
				<div
					class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)] mb-4"
				>
					既定の子供を更新しました
				</div>
			{/if}
			{#if form?.defaultChildError}
				<div
					class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)] mb-4"
				>
					{form.defaultChildError}
				</div>
			{/if}

			<form method="POST" action="?/updateDefaultChild" use:enhance class="space-y-3">
				<div class="space-y-2">
					<label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors {data.defaultChildId === null ? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]' : 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}">
						<input
							type="radio"
							name="defaultChildId"
							value="none"
							checked={data.defaultChildId === null}
						/>
						<span class="text-sm font-medium text-[var(--color-text)]">未設定（毎回選択画面を表示）</span>
					</label>
					{#each data.children as child (child.id)}
						<label
							class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors {data.defaultChildId === child.id ? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]' : 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}"
						>
							<input
								type="radio"
								name="defaultChildId"
								value={child.id}
								checked={data.defaultChildId === child.id}
							/>
							<span class="text-sm font-medium text-[var(--color-text)]">
								{child.nickname}
							</span>
						</label>
					{/each}
				</div>
				<Button type="submit" variant="primary" size="md" class="w-full">既定を保存</Button>
			</form>
		</Card>
	{/if}

	<!-- きょうだいチャレンジ設定 -->
	<Card padding="lg">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">👥 きょうだいチャレンジ設定</h3>

		{#if form?.siblingSuccess}
			<div class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)] mb-4">きょうだい設定を保存しました</div>
		{/if}
		{#if siblingErrorMessage}
			<div class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)] mb-4">{siblingErrorMessage}</div>
		{/if}

		<form method="POST" action="?/updateSiblingSettings" use:enhance class="space-y-4">
			<div>
				<label class="block text-sm font-semibold text-[var(--color-text)] mb-2">チャレンジモード</label>
				<div class="space-y-2">
					{#each [
						{ value: 'both', label: '協力＆競争（両方）', desc: '協力チャレンジと競争チャレンジの両方を利用' },
						{ value: 'cooperative', label: '協力のみ', desc: 'きょうだいで協力するチャレンジのみ' },
						{ value: 'competitive', label: '競争のみ', desc: 'きょうだい間の競争チャレンジのみ' },
					] as opt}
						<label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors {data.siblingMode === opt.value ? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]' : 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}">
							<input type="radio" name="siblingMode" value={opt.value} checked={data.siblingMode === opt.value} class="mt-0.5" />
							<div>
								<span class="text-sm font-medium text-[var(--color-text)]">{opt.label}</span>
								<p class="text-xs text-[var(--color-text-muted)]">{opt.desc}</p>
							</div>
						</label>
					{/each}
				</div>
			</div>
			{#if data.canSiblingRanking}
				<label class="flex items-center gap-2">
					<input type="checkbox" name="siblingRankingEnabled" checked={data.siblingRankingEnabled === 'true'} class="h-4 w-4 rounded border-[var(--color-border-strong)]" />
					<span class="text-sm text-[var(--color-text)]">きょうだいランキングを表示する</span>
				</label>
			{:else}
				<div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-muted)] p-3">
					<label class="flex items-center gap-2 cursor-not-allowed" aria-describedby="sibling-ranking-disabled-reason">
						<input
							type="checkbox"
							disabled
							aria-disabled="true"
							checked={false}
							class="h-4 w-4 rounded border-[var(--color-border-strong)]"
						/>
						<span class="text-sm text-[var(--color-text-muted)]">
							きょうだいランキングを表示する
							<span class="text-xs font-bold text-[var(--color-point)]">⭐⭐</span>
						</span>
					</label>
					<p id="sibling-ranking-disabled-reason" class="mt-2 text-xs text-[var(--color-text-muted)]">
						きょうだいランキングはファミリープラン限定の機能です。<a href="/pricing" class="underline text-[var(--color-text-link)]">プランのアップグレード</a>で利用できます。
					</p>
				</div>
			{/if}
			<Button type="submit" variant="primary" size="md" class="w-full">
				設定を保存
			</Button>
		</form>
	</Card>

	<!-- 通知設定 -->
	<Card padding="lg">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">🔔 通知設定</h3>

		{#if form?.notificationSuccess}
			<div class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)] mb-4">通知設定を保存しました</div>
		{/if}
		{#if form?.notificationError}
			<div class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)] mb-4">{form.notificationError}</div>
		{/if}

		<!-- ブラウザ通知ステータス -->
		<div class="mb-4 p-3 rounded-lg bg-[var(--color-surface-muted)] border border-[var(--color-border-default)]">
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium text-[var(--color-text)]">ブラウザ通知</span>
				<span class="text-xs px-2 py-1 rounded-full" id="notification-status">確認中...</span>
			</div>
			<div id="notification-action" class="mt-2 hidden">
				<Button
					type="button"
					variant="primary"
					size="sm"
					id="notification-subscribe-btn"
				>
					通知を有効にする
				</Button>
			</div>
			<div id="notification-subscribed" class="mt-2 hidden">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="bg-[var(--color-neutral-200)] text-[var(--color-text)] hover:bg-[var(--color-neutral-300)]"
					id="notification-unsubscribe-btn"
				>
					通知を無効にする
				</Button>
			</div>
		</div>

		<form method="POST" action="?/updateNotificationSettings" use:enhance class="space-y-4">
			<label class="flex items-center gap-2">
				<input type="checkbox" name="remindersEnabled" checked={data.notificationSettings.remindersEnabled} class="h-4 w-4 rounded border-[var(--color-border-strong)]" />
				<span class="text-sm text-[var(--color-text)]">リマインダー通知（毎日の記録を促す）</span>
			</label>
			{#if data.notificationSettings.remindersEnabled}
				<div class="ml-6">
					<FormField
						label="リマインダー時刻"
						type="time"
						name="reminderTime"
						value={data.notificationSettings.reminderTime}
					/>
				</div>
			{/if}
			<label class="flex items-center gap-2">
				<input type="checkbox" name="streakEnabled" checked={data.notificationSettings.streakEnabled} class="h-4 w-4 rounded border-[var(--color-border-strong)]" />
				<span class="text-sm text-[var(--color-text)]">ストリーク警告（連続記録が途切れそうな時）</span>
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="achievementsEnabled" checked={data.notificationSettings.achievementsEnabled} class="h-4 w-4 rounded border-[var(--color-border-strong)]" />
				<span class="text-sm text-[var(--color-text)]">達成通知（記録完了・レベルアップ時）</span>
			</label>
			<div class="border-t border-[var(--color-border-default)] pt-4 mt-4">
				<FormField label="サイレント時間帯" hint="この時間帯は通知を送信しません">
					{#snippet children()}
						<div class="flex items-center gap-2">
							<input type="time" name="quietStart" value={data.notificationSettings.quietStart} class="text-sm border border-[var(--input-border)] rounded-[var(--input-radius)] bg-[var(--input-bg)] px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-[var(--input-border-focus)] transition-colors" />
							<span class="text-sm text-[var(--color-text-muted)]">〜</span>
							<input type="time" name="quietEnd" value={data.notificationSettings.quietEnd} class="text-sm border border-[var(--input-border)] rounded-[var(--input-radius)] bg-[var(--input-bg)] px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-[var(--input-border-focus)] transition-colors" />
						</div>
					{/snippet}
				</FormField>
			</div>
			<Button type="submit" variant="primary" size="md" class="w-full">
				通知設定を保存
			</Button>
		</form>
	</Card>

	<script>
		// Client-side notification status check
		(async function() {
			const statusEl = document.getElementById('notification-status');
			const actionEl = document.getElementById('notification-action');
			const subscribedEl = document.getElementById('notification-subscribed');
			const subscribeBtn = document.getElementById('notification-subscribe-btn');
			const unsubscribeBtn = document.getElementById('notification-unsubscribe-btn');

			if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
				if (statusEl) { statusEl.textContent = 'この端末は通知に対応していません'; statusEl.className = 'text-xs px-2 py-1 rounded-full bg-[var(--color-neutral-200)] text-[var(--color-text)]'; }
				return;
			}

			const permission = Notification.permission;
			if (permission === 'denied') {
				if (statusEl) { statusEl.textContent = 'ブロック中（ブラウザ設定で変更）'; statusEl.className = 'text-xs px-2 py-1 rounded-full bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]'; }
				return;
			}

			if (permission === 'default') {
				if (statusEl) { statusEl.textContent = '未設定'; statusEl.className = 'text-xs px-2 py-1 rounded-full bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]'; }
				if (actionEl) actionEl.classList.remove('hidden');
			} else {
				const reg = await navigator.serviceWorker.ready;
				const sub = await reg.pushManager.getSubscription();
				if (sub) {
					if (statusEl) { statusEl.textContent = '有効'; statusEl.className = 'text-xs px-2 py-1 rounded-full bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]'; }
					if (subscribedEl) subscribedEl.classList.remove('hidden');
				} else {
					if (statusEl) { statusEl.textContent = '許可済み（未登録）'; statusEl.className = 'text-xs px-2 py-1 rounded-full bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]'; }
					if (actionEl) actionEl.classList.remove('hidden');
				}
			}

			if (subscribeBtn) {
				subscribeBtn.addEventListener('click', async () => {
					const { subscribeToPush } = await import('$lib/features/admin/push-subscription');
					const sub = await subscribeToPush();
					if (sub) {
						if (statusEl) { statusEl.textContent = '有効'; statusEl.className = 'text-xs px-2 py-1 rounded-full bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]'; }
						if (actionEl) actionEl.classList.add('hidden');
						if (subscribedEl) subscribedEl.classList.remove('hidden');
					}
				});
			}
			if (unsubscribeBtn) {
				unsubscribeBtn.addEventListener('click', async () => {
					const { unsubscribeFromPush } = await import('$lib/features/admin/push-subscription');
					await unsubscribeFromPush();
					if (statusEl) { statusEl.textContent = '無効'; statusEl.className = 'text-xs px-2 py-1 rounded-full bg-[var(--color-neutral-200)] text-[var(--color-text)]'; }
					if (subscribedEl) subscribedEl.classList.add('hidden');
					if (actionEl) actionEl.classList.remove('hidden');
				});
			}
		})();
	</script>

	<!-- ポイント表示設定 -->
	<Card padding="lg" id="point-settings">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">💰 ポイント表示設定</h3>

		{#if pointSuccess}
			<SuccessAlert message="ポイント表示設定を保存しました" />
		{/if}

		{#if form?.pointError}
			<ErrorAlert message={form.pointError} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/updatePointSettings"
			use:enhance={({ cancel }) => {
				if (anyFormBusy) { cancel(); return; }
				pointSubmitting = true;
				pointSuccess = false;
				return async ({ result, update }) => {
					pointSubmitting = false;
					if (result.type === 'success') {
						pointSuccess = true;
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<div>
				<span class="block text-sm font-medium text-[var(--color-text)] mb-2">表示モード</span>
				<div class="flex gap-3">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="point_unit_mode"
							value="point"
							bind:group={pointMode}
							class="w-4 h-4 text-[var(--color-brand-500)]"
						/>
						<span class="text-sm">ポイント（P）</span>
					</label>
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="point_unit_mode"
							value="currency"
							bind:group={pointMode}
							class="w-4 h-4 text-[var(--color-brand-500)]"
						/>
						<span class="text-sm">通貨で表示</span>
					</label>
				</div>
			</div>

			{#if pointMode === 'currency'}
				<NativeSelect
					id="pointCurrency"
					name="point_currency"
					label="通貨"
					bind:value={pointCurrency}
					options={CURRENCY_CODES.map((code) => ({
						value: code,
						label: `${CURRENCY_DEFS[code].flag} ${code} (${CURRENCY_DEFS[code].symbol})`,
					}))}
				/>

				<FormField
					label="レート（1P = ？{CURRENCY_DEFS[pointCurrency].symbol}）"
					type="number"
					id="pointRate"
					name="point_rate"
					bind:value={pointRate}
					min="0.001"
					max="10000"
					step="any"
					required
					hint="例: 1P = 1円なら「1」、1P = 0.01ドルなら「0.01」"
				/>
			{/if}

			<!-- プレビュー -->
			<div class="bg-[var(--color-surface-muted)] rounded-lg p-4">
				<p class="text-sm text-[var(--color-text-muted)] mb-1">プレビュー（{previewPoints}P の場合）</p>
				<p class="text-2xl font-bold text-[var(--color-point)]">
					{previewFormatted}
				</p>
			</div>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={pointSubmitting}
			>
				{pointSubmitting ? '保存中...' : 'ポイント設定を保存'}
			</Button>
		</form>
	</Card>

	<!-- データ管理 -->
	<Card padding="lg" data-tutorial="data-management">
		<div class="flex items-center gap-2 mb-4">
			<h3 class="text-lg font-bold text-[var(--color-text)]">💾 データ管理</h3>
			{#if !data.canExport}
				<PremiumBadge size="sm" label="スタンダード以上" showLock />
			{/if}
		</div>

		{#if exportError}
			<ErrorAlert message={exportError} severity="error" action="retry" />
		{/if}

		<div class="space-y-4">
			<div data-testid="data-export-section">
				<p class="text-sm text-[var(--color-text)] mb-3">
					家族のデータをJSONファイルとしてダウンロードできます。バックアップや別環境への移行に使用できます。
				</p>
				<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 mb-3">
					<p class="text-xs text-[var(--color-text-muted)]">エクスポート対象:</p>
					<ul class="text-xs text-[var(--color-text-muted)] mt-1 space-y-0.5">
						<li>子供プロフィール・活動記録・ポイント履歴</li>
						<li>ステータス・実績・称号・ログインボーナス</li>
						<li>チェックリスト・誕生日振り返り</li>
						<li>活動マスタ・きせかえアイテム</li>
					</ul>
				</div>
				{#if !data.canExport}
					<!-- #773: free プランは事前にアップセルして 403 を防ぐ -->
					<div
						class="bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg p-3 mb-3"
						data-testid="export-upsell"
					>
						<p class="text-sm text-[var(--color-text)] mb-2">
							🔒 データエクスポートは <strong>スタンダードプラン</strong> 以上でご利用いただけます。
						</p>
						<p class="text-xs text-[var(--color-text-muted)] mb-3">
							家族のデータをJSON/ZIP形式でダウンロードして、バックアップや引っ越しに利用できます。
						</p>
						<a
							href="/pricing"
							class="inline-block px-4 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] text-sm font-semibold rounded-lg no-underline hover:brightness-110 transition-all"
							data-testid="export-upsell-cta"
						>
							プランを見る
						</a>
					</div>
					<Button
						type="button"
						variant="success"
						size="md"
						class="w-full flex items-center justify-center gap-2 opacity-60 cursor-not-allowed"
						disabled={true}
						data-testid="data-export-button"
					>
						🔒 データをエクスポート（有料プラン限定）
					</Button>
				{:else}
					<label class="flex items-center gap-2 mb-2 text-sm text-[var(--color-text)] cursor-pointer">
						<input type="checkbox" bind:checked={includeFiles} class="w-4 h-4 text-[var(--color-brand-500)] rounded" />
						画像・音声ファイルも含める（ZIP形式）
					</label>
					{#if !includeFiles}
						<div class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-3 mb-3">
							<p class="text-xs text-[var(--color-feedback-warning-text)]">画像・音声を含める場合は上のチェックをオンにしてください。ファイルサイズが大きくなる場合があります（最大100MB）。</p>
						</div>
					{/if}
					<label class="flex items-center gap-2 mb-3 text-sm text-[var(--color-text)] cursor-pointer">
						<input type="checkbox" bind:checked={compactFormat} class="w-4 h-4 text-[var(--color-brand-500)] rounded" />
						圧縮形式でエクスポート（ファイルサイズを削減）
					</label>
					<Button
						type="button"
						variant="success"
						size="md"
						class="w-full flex items-center justify-center gap-2"
						disabled={exportLoading}
						onclick={handleExport}
						data-testid="data-export-button"
					>
						{#if exportLoading}
							<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
							エクスポート中...
						{:else}
							データをエクスポート
						{/if}
					</Button>
				{/if}
			</div>

			<hr class="my-4 border-[var(--color-border-default)]" />

			<!-- インポート -->
			<div>
				<h4 class="text-sm font-bold text-[var(--color-text)] mb-2">データのインポート</h4>

				{#if importError}
					<ErrorAlert message={importError} severity="warning" action="fix_input" />
				{/if}

				{#if importStep === 'select'}
					<p class="text-sm text-[var(--color-text)] mb-3">
						エクスポートしたJSONファイルからデータを復元できます。
					</p>
					<div class="mb-3">
						<span class="block text-sm font-medium text-[var(--color-text)] mb-2">インポートモード</span>
						<div class="flex gap-3">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" value="replace" bind:group={importMode} class="w-4 h-4 text-[var(--color-warning)]" />
								<span class="text-sm">置換（既存データを削除してインポート）</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" value="add" bind:group={importMode} class="w-4 h-4 text-[var(--color-warning)]" />
								<span class="text-sm">追加（既存データを残して追加）</span>
							</label>
						</div>
						{#if importMode === 'replace'}
							<p class="text-xs text-[var(--color-feedback-error-text)] mt-1">既存の子供・活動ログ・ポイント等のデータをすべて削除してからインポートします。</p>
						{:else}
							<p class="text-xs text-[var(--color-text-muted)] mt-1">新しい子供データとして追加されます（既存データは上書きされません）。</p>
						{/if}
					</div>
					<label class="block w-full py-2 bg-[var(--color-warning)] text-white font-bold rounded-lg hover:brightness-110 transition-all text-center cursor-pointer {importLoading ? 'opacity-50 pointer-events-none' : ''}">
						{#if importLoading}
							<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
							読み込み中...
						{:else}
							JSONファイルを選択
						{/if}
						<input
							type="file"
							accept=".json"
							onchange={handleImportFileChange}
							class="hidden"
							data-testid="import-file-input"
						/>
					</label>
				{:else if importStep === 'preview' && importPreview}
					<div class="bg-[var(--color-feedback-warning-bg)] rounded-lg p-4 mb-3" data-testid="import-preview-summary">
						<p class="text-sm font-bold text-[var(--color-feedback-warning-text)] mb-2">{IMPORT_LABELS.previewDialogTitle}</p>
						<p class="text-xs text-[var(--color-feedback-success-text)] mb-2" data-testid="import-preview-checksum-ok">
							✓ ファイルの整合性を確認しました
						</p>
						<ul class="text-xs text-[var(--color-feedback-warning-text)] space-y-1">
							<li>子供: {importPreview.children}人</li>
							<li>活動ログ: {importPreview.activityLogs}件</li>
							<li>ポイント履歴: {importPreview.pointLedger}件</li>
							<li>ステータス: {importPreview.statuses}件</li>
							<li>実績: {importPreview.achievements}件</li>
							{#if (importPreview.loginBonuses ?? 0) > 0}
								<li>ログインボーナス: {importPreview.loginBonuses}件</li>
							{/if}
							{#if (importPreview.checklistTemplates ?? 0) > 0}
								<li>チェックリスト: {importPreview.checklistTemplates}件</li>
							{/if}
						</ul>
					</div>
					{#if importPreview.duplicates && (importPreview.duplicates.activities.length + importPreview.duplicates.specialRewards.length + importPreview.duplicates.checklistTemplates.length) > 0}
						<div
							class="bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg p-4 mb-3"
							data-testid="import-preview-duplicates"
						>
							<p class="text-sm font-bold text-[var(--color-text)] mb-2">
								{IMPORT_LABELS.previewDialogDuplicatesHeading}
							</p>
							{#each [
								{ title: '活動マスタ', items: importPreview.duplicates.activities, testid: 'duplicates-activities' },
								{ title: 'ごほうび', items: importPreview.duplicates.specialRewards, testid: 'duplicates-rewards' },
								{ title: '持ち物・ルーティン', items: importPreview.duplicates.checklistTemplates, testid: 'duplicates-templates' },
							] as group (group.title)}
								{#if group.items.length > 0}
									<div class="mt-2" data-testid={group.testid}>
										<p class="text-xs font-semibold text-[var(--color-text-secondary)]">
											{group.title} ({group.items.length}件)
										</p>
										<ul class="text-xs text-[var(--color-text-secondary)] ml-3 mt-1 space-y-0.5">
											{#each group.items.slice(0, 5) as entry}
												<li>
													<span class="font-medium">{entry.label}</span>
													<span class="text-[var(--color-text-tertiary)]">
														— {entry.reason === 'preset_duplicate'
															? IMPORT_LABELS.previewDialogPresetDuplicate
															: IMPORT_LABELS.previewDialogNameDuplicate}
													</span>
												</li>
											{/each}
											{#if group.items.length > 5}
												<li class="text-[var(--color-text-tertiary)]">...他 {group.items.length - 5}件</li>
											{/if}
										</ul>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
					<div class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-3 mb-3">
						{#if importMode === 'replace'}
							<p class="text-xs text-[var(--color-feedback-error-text)] font-bold">
								既存データをすべて削除してからインポートします。この操作は取り消せません。
							</p>
						{:else}
							<p class="text-xs text-[var(--color-feedback-warning-text)]">
								インポートすると新しい子供データとして追加されます。この操作は取り消せません。
							</p>
						{/if}
					</div>
					<div class="flex gap-2">
						<Button
							type="button"
							variant="ghost"
							size="md"
							class="flex-1 bg-[var(--color-neutral-300)] text-[var(--color-text)] hover:brightness-95"
							onclick={resetImport}
						>
							キャンセル
						</Button>
						<Button
							type="button"
							variant="warning"
							size="md"
							class="flex-1 flex items-center justify-center gap-2 bg-[var(--color-warning)] hover:brightness-110"
							disabled={importLoading}
							onclick={handleImportExecute}
						>
							{#if importLoading}
								<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
								インポート中...
							{:else}
								インポートを実行
							{/if}
						</Button>
					</div>
				{:else if importStep === 'done' && importResult}
					<div class="bg-[var(--color-feedback-success-bg)] rounded-lg p-4 mb-3">
						<p class="text-sm font-bold text-[var(--color-feedback-success-text)] mb-2">インポート完了</p>
						<ul class="text-xs text-[var(--color-feedback-success-text)] space-y-1">
							<li>子供: {importResult.childrenImported}人 作成</li>
							{#if importResult.activitiesCreated > 0}
								<li>活動マスタ: {importResult.activitiesCreated}件 新規作成</li>
							{/if}
							<li>活動ログ: {importResult.activityLogsImported}件{importResult.activityLogsSkipped > 0 ? `（${importResult.activityLogsSkipped}件スキップ）` : ''}</li>
							<li>ポイント: {importResult.pointLedgerImported}件{importResult.pointLedgerSkipped > 0 ? `（${importResult.pointLedgerSkipped}件スキップ）` : ''}</li>
							{#if (importResult.warnings?.length ?? 0) > 0}
								<li class="text-[var(--color-feedback-warning-text)] mt-2">
									警告 ({importResult.warnings.length}件):
									<ul class="ml-3 mt-1">
										{#each importResult.warnings.slice(0, 5) as warn}
											<li>{warn}</li>
										{/each}
										{#if importResult.warnings.length > 5}
											<li>...他 {importResult.warnings.length - 5}件</li>
										{/if}
									</ul>
								</li>
							{/if}
							{#if importResult.errors.length > 0}
								<li class="text-[var(--color-feedback-warning-text)] mt-2">
									エラー ({importResult.errors.length}件):
									<ul class="ml-3 mt-1">
										{#each importResult.errors.slice(0, 5) as err}
											<li>{err}</li>
										{/each}
										{#if importResult.errors.length > 5}
											<li>...他 {importResult.errors.length - 5}件</li>
										{/if}
									</ul>
								</li>
							{/if}
						</ul>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="md"
						class="w-full bg-[var(--color-neutral-300)] text-[var(--color-text)] hover:brightness-95"
						onclick={resetImport}
					>
						閉じる
					</Button>
				{/if}
			</div>
		</div>
	</Card>

	<!-- クラウドエクスポート共有（SaaSモード専用・free はアップセル表示） -->
	{#if $page.data.authMode === 'cognito'}
		<Card padding="lg" data-testid="cloud-export-card">
			<div class="flex items-center gap-2 mb-4">
				<h3 class="text-lg font-bold text-[var(--color-text)]">☁️ クラウド共有</h3>
				{#if data.maxCloudExports === 0}
					<PremiumBadge size="sm" label="スタンダード以上" showLock />
				{:else}
					<span
						class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] rounded-full"
						data-testid="cloud-export-slot-counter"
					>
						保管枠 {cloudExports.length} / {data.maxCloudExports}
					</span>
				{/if}
			</div>

			{#if cloudError}
				<ErrorAlert message={cloudError} severity="error" action="retry" />
			{/if}
			{#if cloudSuccess}
				<SuccessAlert message={cloudSuccess} />
			{/if}

			{#if data.maxCloudExports === 0}
				<!-- #773: free プランはアップセル表示 -->
				<div
					class="bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg p-4"
					data-testid="cloud-export-upsell"
				>
					<p class="text-sm text-[var(--color-text)] mb-2">
						🔒 クラウド共有は <strong>スタンダードプラン</strong> 以上でご利用いただけます。
					</p>
					<p class="text-xs text-[var(--color-text-muted)] mb-3">
						家族のデータをクラウドに保管して、PINコードで別端末や他のアカウントと共有できます（スタンダード: 3枠 / ファミリー: 10枠）。
					</p>
					<a
						href="/pricing"
						class="inline-block px-4 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] text-sm font-semibold rounded-lg no-underline hover:brightness-110 transition-all"
						data-testid="cloud-export-upsell-cta"
					>
						プランを見る
					</a>
				</div>
			{:else}
			<div class="space-y-4">
				<!-- エクスポート作成 -->
				<div>
					<p class="text-sm text-[var(--color-text)] mb-3">
						設定やデータをクラウドに保管してPINコードで他のアカウントと共有できます。
					</p>
					<div class="mb-3">
						<span class="block text-sm font-medium text-[var(--color-text)] mb-2">エクスポートタイプ</span>
						<div class="flex gap-3">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" value="template" bind:group={cloudExportType} class="w-4 h-4 text-[var(--color-brand-500)]" />
								<span class="text-sm">テンプレート（活動・チェックリスト）</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" value="full" bind:group={cloudExportType} class="w-4 h-4 text-[var(--color-brand-500)]" />
								<span class="text-sm">フルバックアップ</span>
							</label>
						</div>
						{#if cloudExportType === 'template'}
							<p class="text-xs text-[var(--color-text-muted)] mt-1">活動設定やチェックリストのみ共有します（個人データは含みません）。</p>
						{:else}
							<p class="text-xs text-[var(--color-text-muted)] mt-1">子供データ・活動ログ等すべてのデータを含みます。環境移行用です。</p>
						{/if}
					</div>
					<Button
						type="button"
						variant="primary"
						size="md"
						class="w-full"
						disabled={cloudLoading}
						onclick={handleCloudExport}
					>
						{#if cloudLoading}
							<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
							保管中...
						{:else}
							クラウドに保管
						{/if}
					</Button>
				</div>

				<!-- 保管済み一覧 -->
				{#if cloudExports.length > 0}
					<hr class="my-4 border-[var(--color-border-default)]" />
					<div>
						<h4 class="text-sm font-bold text-[var(--color-text)] mb-2">保管済みデータ</h4>
						<div class="space-y-2">
							{#each cloudExports as exp}
								<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 flex items-center justify-between">
									<div>
										<p class="text-sm font-mono font-bold text-[var(--color-brand-600)]">{exp.pinCode}</p>
										<p class="text-xs text-[var(--color-text-muted)]">
											{exp.exportType === 'template' ? 'テンプレート' : 'フルバックアップ'}
											{#if exp.description}· {exp.description}{/if}
										</p>
										<p class="text-xs text-[var(--color-text-muted)]">
											期限: {new Date(exp.expiresAt).toLocaleDateString('ja-JP')}
											· DL: {exp.downloadCount}/{exp.maxDownloads}回
										</p>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										class="text-[var(--color-feedback-error-text)] hover:brightness-75"
										onclick={() => handleDeleteCloudExport(exp.id)}
									>
										削除
									</Button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- PINインポート -->
				<hr class="my-4 border-[var(--color-border-default)]" />
				<div>
					<h4 class="text-sm font-bold text-[var(--color-text)] mb-2">PINコードでインポート</h4>

					{#if cloudImportError}
						<ErrorAlert message={cloudImportError} severity="warning" action="fix_input" />
					{/if}

					{#if cloudImportStep === 'input'}
						<p class="text-sm text-[var(--color-text)] mb-3">
							共有されたPINコードを入力してデータを取り込みます。
						</p>
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={cloudImportPin}
								placeholder="PINコード（6桁）"
								maxlength="6"
								class="flex-1 px-3 py-2 border border-[var(--color-border-strong)] rounded-lg text-center font-mono text-lg uppercase tracking-widest"
							/>
							<Button
								type="button"
								variant="primary"
								size="md"
								disabled={cloudImportLoading || cloudImportPin.trim().length < 4}
								onclick={handleCloudImportPreview}
							>
								{#if cloudImportLoading}
									確認中...
								{:else}
									確認
								{/if}
							</Button>
						</div>
					{:else if cloudImportStep === 'preview' && cloudImportPreview}
						<div class="bg-[var(--color-feedback-info-bg)] rounded-lg p-4 mb-3">
							<p class="text-sm font-bold text-[var(--color-feedback-info-text)] mb-2">インポート内容の確認</p>
							{#if cloudImportPreview.exportType === 'template'}
								<ul class="text-xs text-[var(--color-feedback-info-text)] space-y-1">
									{#if cloudImportPreview.activities}<li>活動マスタ: {cloudImportPreview.activities}件</li>{/if}
									{#if cloudImportPreview.checklistTemplates}<li>チェックリスト: {cloudImportPreview.checklistTemplates}件</li>{/if}
								</ul>
								<p class="text-xs text-[var(--color-text-muted)] mt-2">既存の設定に追加されます（重複はスキップ）。</p>
							{:else}
								<p class="text-xs text-[var(--color-feedback-info-text)]">フルバックアップデータです。追加インポートされます。</p>
							{/if}
						</div>
						<div class="flex gap-2">
							<Button
								type="button"
								variant="ghost"
								size="md"
								class="flex-1 bg-[var(--color-neutral-300)] text-[var(--color-text)] hover:brightness-95"
								onclick={resetCloudImport}
							>
								キャンセル
							</Button>
							<Button
								type="button"
								variant="primary"
								size="md"
								class="flex-1"
								disabled={cloudImportLoading}
								onclick={handleCloudImportExecute}
							>
								{#if cloudImportLoading}
									インポート中...
								{:else}
									インポート実行
								{/if}
							</Button>
						</div>
					{:else if cloudImportStep === 'done' && cloudImportResult}
						<div class="bg-[var(--color-feedback-success-bg)] rounded-lg p-4 mb-3">
							<p class="text-sm font-bold text-[var(--color-feedback-success-text)] mb-2">インポート完了</p>
							<ul class="text-xs text-[var(--color-feedback-success-text)] space-y-1">
								{#if cloudImportResult.activitiesCreated}
									<li>活動マスタ: {cloudImportResult.activitiesCreated}件 追加</li>
								{/if}
								{#if cloudImportResult.checklistsCreated}
									<li>チェックリスト: {cloudImportResult.checklistsCreated}件 追加</li>
								{/if}
								{#if cloudImportResult.childrenImported}
									<li>子供データ: {cloudImportResult.childrenImported}人 追加</li>
								{/if}
							</ul>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="md"
							class="w-full bg-[var(--color-neutral-300)] text-[var(--color-text)] hover:brightness-95"
							onclick={resetCloudImport}
						>
							閉じる
						</Button>
					{/if}
				</div>
			</div>
			{/if}
		</Card>
	{/if}

	<!-- データクリア -->
	<Card padding="lg" class="border-2 border-[var(--color-feedback-error-border)]">
		<h3 class="text-lg font-bold text-[var(--color-feedback-error-text)] mb-4">🗑️ データクリア</h3>

		{#if clearSuccess}
			<SuccessAlert message="データクリアが完了しました。ページを再読み込みしてください。" />
		{/if}

		{#if clearError}
			<ErrorAlert message={clearError} severity="error" action="retry" />
		{/if}

		{#if form?.clearError}
			<ErrorAlert message={form.clearError} severity="warning" action="fix_input" />
		{/if}

		<p class="text-sm text-[var(--color-text)] mb-3">
			すべての家族データ（子供・活動ログ・ポイント・ステータス等）を一括削除します。
			活動マスタ・カテゴリなどのシステムデータは保持されます。
		</p>

		{#if data.dataSummary}
			<div class="bg-[var(--color-feedback-error-bg)] rounded-lg p-4 mb-4">
				<p class="text-sm font-bold text-[var(--color-feedback-error-text)] mb-2">現在のデータ件数</p>
				<ul class="text-xs text-[var(--color-feedback-error-text)] space-y-1 columns-2">
					<li>子供: {data.dataSummary.children}人</li>
					<li>活動ログ: {data.dataSummary.activityLogs}件</li>
					<li>ポイント履歴: {data.dataSummary.pointLedger}件</li>
					<li>ステータス: {data.dataSummary.statuses}件</li>
					<li>実績: {data.dataSummary.achievements}件</li>
					<li>ログインボーナス: {data.dataSummary.loginBonuses}件</li>
					<li>チェックリスト: {data.dataSummary.checklistTemplates}件</li>
				</ul>
			</div>
		{/if}

		<div class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-3 mb-4">
			<p class="text-xs text-[var(--color-feedback-error-text)] font-bold">
				この操作は取り消せません。事前にデータをエクスポートすることをお勧めします。
			</p>
		</div>

		<form
			method="POST"
			action="?/clearData"
			use:enhance={({ cancel }) => {
				if (anyFormBusy) { cancel(); return; }
				clearSubmitting = true;
				clearSuccess = false;
				clearError = '';
				return async ({ result, update }) => {
					clearSubmitting = false;
					if (result.type === 'success') {
						clearSuccess = true;
						clearConfirmText = '';
					}
					await update();
				};
			}}
		>
			<div class="space-y-3">
				<FormField
					label="確認のため「削除」と入力してください"
					type="text"
					id="clearConfirm"
					name="confirm"
					bind:value={clearConfirmText}
					placeholder="削除"
				/>
				<Button
					type="submit"
					variant="danger"
					size="md"
					class="w-full"
					disabled={clearSubmitting || clearConfirmText !== '削除'}
				>
					{clearSubmitting ? 'データクリア中...' : 'すべてのデータを削除'}
				</Button>
			</div>
		</form>
	</Card>

	<!-- フィードバック -->
	<Card padding="lg" data-tutorial="feedback-section">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">💬 フィードバック・ご意見</h3>

		{#if feedbackSuccess}
			<SuccessAlert message={feedbackInquiryId
				? `お問い合わせを受け付けました。受付番号: ${feedbackInquiryId}\n${feedbackEmail ? '入力いただいたメールアドレスに確認メールをお送りしました。' : ''}`
				: 'お問い合わせありがとうございます。今後の参考とさせていただきます。'} />
		{/if}

		{#if form?.feedbackError}
			<ErrorAlert message={form.feedbackError} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/sendFeedback"
			use:enhance={({ cancel }) => {
				if (anyFormBusy) { cancel(); return; }
				feedbackSubmitting = true;
				feedbackSuccess = false;
				feedbackInquiryId = '';
				return async ({ result, update }) => {
					feedbackSubmitting = false;
					if (result.type === 'success') {
						feedbackSuccess = true;
						feedbackInquiryId = (result.data as { inquiryId?: string })?.inquiryId ?? '';
						feedbackText = '';
						feedbackCategory = 'feature';
						feedbackEmail = '';
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<NativeSelect
				id="feedbackCategory"
				name="category"
				label="カテゴリ"
				bind:value={feedbackCategory}
				options={[
					{ value: 'feature', label: '機能要望' },
					{ value: 'bug', label: 'バグ報告' },
					{ value: 'other', label: 'その他' },
				]}
			/>

			<div>
				<label for="feedbackText" class="block text-sm font-medium text-[var(--color-text)] mb-1">
					内容
				</label>
				<textarea
					id="feedbackText"
					name="text"
					bind:value={feedbackText}
					rows="4"
					maxlength="1000"
					required
					placeholder="ご意見・ご要望をお聞かせください..."
					class="w-full px-3 py-2 border border-[var(--color-border-strong)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] resize-y"
				></textarea>
				<p class="text-xs text-[var(--color-text-muted)] mt-1 text-right">{feedbackText.length}/1000</p>
			</div>

			<FormField
				label="返信先メールアドレス（任意）"
				type="email"
				id="feedbackEmail"
				name="email"
				bind:value={feedbackEmail}
				placeholder="reply@example.com"
				maxlength={254}
				hint="ご入力いただいた場合、内容によってはメールでご返信する場合があります"
			/>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={feedbackSubmitting || feedbackText.length === 0}
			>
				{feedbackSubmitting ? '送信中...' : 'フィードバックを送信'}
			</Button>
		</form>
		<p class="text-xs text-[var(--color-text-muted)] mt-3 text-center">
			技術的なご質問・使い方の相談は
			<a href="mailto:ganbari.quest.support@gmail.com" class="text-[var(--color-brand-500)] hover:underline">メール</a>
			でも受け付けています
		</p>
	</Card>

	<!-- アプリ情報・リンク -->
	<Card padding="lg">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">ℹ️ アプリ情報</h3>
		<ul class="space-y-3 text-sm">
			<li>
				<a href="https://www.ganbari-quest.com/terms.html" target="_blank" rel="noopener" class="text-[var(--color-brand-500)] hover:underline">📄 利用規約</a>
			</li>
			<li>
				<a href="https://www.ganbari-quest.com/privacy.html" target="_blank" rel="noopener" class="text-[var(--color-brand-500)] hover:underline">🔒 プライバシーポリシー</a>
			</li>
			<li>
				<a href="mailto:ganbari.quest.support@gmail.com" class="text-[var(--color-brand-500)] hover:underline">💬 お問い合わせ</a>
			</li>
			<li>
				<a href="https://github.com/Takenori-Kusaka/ganbari-quest" target="_blank" rel="noopener noreferrer" class="text-[var(--color-brand-500)] hover:underline">🐙 GitHub</a>
			</li>
			<li>
				<span class="text-[var(--color-text-muted)]">バージョン: {APP_VERSION}</span>
			</li>
		</ul>
	</Card>

	<!-- アカウント削除（cognito モードの全ロール） -->
	{#if $page.data.authMode === 'cognito' && $page.data.tenantStatus !== SUBSCRIPTION_STATUS.GRACE_PERIOD}
		<Card padding="lg" class="border-2 border-[var(--color-feedback-error-border)]">
			<h3 class="text-lg font-bold text-[var(--color-feedback-error-text)] mb-2">アカウント削除</h3>
			{#if $page.data.userRole === 'owner'}
				<!-- Owner: 家族グループ全体に影響 -->
				<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
					<p>オーナーとしてアカウントを削除すると、家族グループ全体のデータが影響を受けます。</p>
					<ul class="list-disc ml-5 text-[var(--color-text-muted)] space-y-1">
						<li>子供のプロフィール・活動記録・ポイント履歴</li>
						<li>アバター画像・音声ファイル</li>
						<li>設定・チェックリスト・キャリアプラン</li>
						<li>メンバーシップ・招待情報</li>
					</ul>
					<p class="text-[var(--color-feedback-error-text)] font-medium">
						削除後のデータ復旧はできません。事前にデータをエクスポートすることを強くお勧めします。
					</p>
				</div>
			{:else if $page.data.userRole === 'child'}
				<!-- Child -->
				<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
					<p>アカウントを削除すると、あなたのログイン情報が削除されます。</p>
					<p>活動記録やポイントは家族グループに残りますが、このアカウントでのログインはできなくなります。</p>
					<p class="text-[var(--color-feedback-error-text)] font-medium">削除後の復旧はできません。</p>
				</div>
			{:else}
				<!-- Parent (non-owner) -->
				<div class="text-sm text-[var(--color-text-secondary)] space-y-2 mb-4">
					<p>アカウントを削除すると、家族グループから離脱し、ログイン情報が削除されます。</p>
					<p>家族グループのデータは引き続き保持されます。</p>
					<p class="text-[var(--color-feedback-error-text)] font-medium">削除後の復旧はできません。</p>
				</div>
			{/if}

			{#if deleteError}
				<ErrorAlert message={deleteError} severity="error" action="retry" />
			{/if}

			<!-- 移譲ダイアログ（Owner かつ他メンバーがいる場合） -->
			{#if showTransferDialog && deletionInfo && !deletionInfo.isOnlyMember}
				<div class="mt-4 p-4 rounded-lg border-2" style:border-color="var(--color-border-default)" style:background-color="var(--color-surface-card)">
					<h4 class="font-bold text-[var(--color-text-primary)] mb-3">家族グループに他のメンバーがいます</h4>
					<p class="text-sm text-[var(--color-text-secondary)] mb-4">
						オーナー権限を別のメンバーに移譲するか、家族グループを全て削除するか選択してください。
					</p>

					<div class="space-y-4">
						<!-- Option A: Transfer -->
						<div class="p-3 rounded-lg" style:background-color="var(--color-surface-card)">
							<p class="text-sm font-medium text-[var(--color-text-primary)] mb-2">
								オーナー権限を移譲して退会する
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

						<!-- Option B: Full delete -->
						<div class="p-3 rounded-lg" style:background-color="var(--color-surface-card)">
							<p class="text-sm font-medium text-[var(--color-feedback-error-text)] mb-2">
								家族グループを全て削除する
							</p>
							<p class="text-xs text-[var(--color-text-muted)] mb-2">
								全メンバーの所属が解除され、全データが削除されます。
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

						<!-- Cancel -->
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => { showTransferDialog = false; }}
						>
							キャンセル
						</Button>
					</div>
				</div>
			{:else}
				<!-- 通常の削除フロー -->
				<div class="mt-4 space-y-3">
					<FormField
						label="確認のため「アカウントを削除します」と入力してください"
						type="text"
						id="deleteConfirm"
						bind:value={deleteConfirmText}
						placeholder="アカウントを削除します"
					/>
					<Button
						type="button"
						variant="danger"
						size="md"
						class="w-full"
						disabled={deleteSubmitting || deletionInfoLoading || deleteConfirmText !== 'アカウントを削除します'}
						onclick={async () => {
							if ($page.data.userRole === 'owner' && !deletionInfo) {
								await fetchDeletionInfo();
							}
							handleDeleteAccount();
						}}
					>
						{deleteSubmitting || deletionInfoLoading ? '処理中...' : 'アカウントを削除する'}
					</Button>
				</div>
			{/if}
		</Card>
	{/if}

	<!-- ログアウト（cognito モードのみ） -->
	{#if $page.data.authMode === 'cognito'}
		<Card padding="lg" class="border border-[var(--color-feedback-error-bg-strong)]">
			<h3 class="text-lg font-bold text-[var(--color-text)] mb-2">ログアウト</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				このデバイスからがんばりクエストのアカウントからログアウトします。再度ログインするにはメールアドレスとパスワードが必要です。
			</p>
			<a
				href="/auth/signout"
				class="inline-block px-4 py-2 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] text-sm font-medium rounded-lg border border-[var(--color-feedback-error-border)] hover:bg-[var(--color-feedback-error-bg-strong)] transition-colors"
			>
				アカウントからログアウト
			</a>
		</Card>
	{/if}
</div>
