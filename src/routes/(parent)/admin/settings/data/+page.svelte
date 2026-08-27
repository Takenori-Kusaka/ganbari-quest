<script lang="ts">
// #2323 (EPIC #2319 ④): data グループ — data / cloud / clear (Danger Zone)
// 旧 /admin/settings/+page.svelte 行 1188 (data) / 1473 (cloud) / 1695 (clear) を移行。

import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { todayDateJST } from '$lib/domain/date-utils';
import type { ChildId } from '$lib/domain/ids';
import {
	APP_LABELS,
	ERROR_NOTIFY_LABELS,
	IMPORT_LABELS,
	type ImportSkipReason,
	PAGE_TITLES,
	PAID_PLAN_LABEL,
	SETTINGS_LABELS,
} from '$lib/domain/labels';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import PremiumBadge from '$lib/ui/components/PremiumBadge.svelte';
// #3285 uiux-1: 生 err.message 露出を撤去し error-notify SSOT (500=汎用 / 4xx=sanitize) 経由に統一
import { resolveApiErrorMessage } from '$lib/ui/error-notify';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import ChildSelectionDialog from '$lib/ui/primitives/ChildSelectionDialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

type DuplicateEntry = { label: string; reason: ImportSkipReason };

let { data, form } = $props();

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
	// #3095: silent-skip 可視化のため server ImportResult の skip/restore 件数を取り込む
	specialRewardsImported: number;
	specialRewardsSkipped: number;
	checklistLogsImported: number;
	checklistLogsSkipped: number;
	staticFilesRestored: number;
	staticFilesSkipped: number;
	// #3490: childVoices (お子さまの音声) / 各種設定の復元・skip 件数を summary に surface
	childVoicesImported: number;
	childVoicesSkipped: number;
	settingsImported: number;
	settingsSkipped: number;
	errors: string[];
	warnings: string[];
} | null>(null);
// #3095: errors があれば partial-restore (置換時は家族データ半損)。「完了」でなく警告として surface する。
const importHadErrors = $derived((importResult?.errors.length ?? 0) > 0);
let importStep = $state<'select' | 'preview' | 'done'>('select');
let importMode = $state<'add' | 'replace'>('replace');

// クラウドエクスポート
let cloudExports = $state<
	Array<{
		id: string;
		exportType: string;
		pinCode: string;
		expiresAt: string;
		fileSizeBytes: number;
		description: string | null;
		downloadCount: number;
		maxDownloads: number;
		createdAt: string;
		// #3324 / #3509: 非同期 build 状態。旧レコードは server 側で 'ready' に backfill 済。
		status: 'pending' | 'building' | 'ready' | 'failed';
		failureReason: string | null;
	}>
>([]);
let cloudLoading = $state(false);
let cloudError = $state('');
let cloudSuccess = $state('');
let cloudExportType = $state<'template' | 'full'>('template');
let cloudImportPin = $state('');
let cloudImportLoading = $state(false);
let cloudImportError = $state('');
// #4717: server の error 種別 (ADR-0062 severity × action) をそのまま案内に反映する。
// 「準備中 (待てば解決)」を warning + 「入力を直して」と表示すると、待つべき場面で
// 顧客が PIN を疑って入力し直す (誤った回復行動を促す)。
type CloudImportErrorKind = {
	severity: 'info' | 'warning' | 'error';
	action: 'retry' | 'fix_input' | 'contact_admin' | 'none';
};
const DEFAULT_CLOUD_IMPORT_ERROR_KIND: CloudImportErrorKind = {
	severity: 'warning',
	action: 'fix_input',
};
let cloudImportErrorKind = $state<CloudImportErrorKind>(DEFAULT_CLOUD_IMPORT_ERROR_KIND);

/** server の error body から severity / action を取り出す (無ければ既定)。 */
function resolveCloudImportErrorKind(errorBody: unknown): CloudImportErrorKind {
	const e = errorBody as { severity?: unknown; action?: unknown } | null | undefined;
	const severity = e?.severity;
	const action = e?.action;
	return {
		severity:
			severity === 'info' || severity === 'warning' || severity === 'error'
				? severity
				: DEFAULT_CLOUD_IMPORT_ERROR_KIND.severity,
		action:
			action === 'retry' ||
			action === 'fix_input' ||
			action === 'contact_admin' ||
			action === 'none'
				? action
				: DEFAULT_CLOUD_IMPORT_ERROR_KIND.action,
	};
}
let cloudImportPreview = $state<Record<string, unknown> | null>(null);
let cloudImportResult = $state<Record<string, unknown> | null>(null);
let cloudImportStep = $state<'input' | 'preview' | 'done'>('input');

// #2362 PR-3 Phase 7b-2: ChildSelectionDialog 統合
// template (v2.0.0) 取込時のみ「誰に追加するか」を選択
let childSelectionOpen = $state(false);
const importTargetChildren = $derived(
	(data.children ?? []).map((c) => ({ id: c.id, nickname: c.nickname, age: c.age })),
);
const isCloudImportTemplate = $derived(
	cloudImportPreview != null &&
		(cloudImportPreview as { exportType?: string }).exportType === 'template',
);

// データクリア
let clearConfirmText = $state('');
let clearAgreeChecked = $state(false);
let clearSubmitting = $state(false);
let clearError = $state('');
let clearSuccess = $state(false);

const anyFormBusy = $derived(
	exportLoading || importLoading || cloudLoading || cloudImportLoading || clearSubmitting,
);

// #3077: JSON は 10MB、ZIP (静的ファイル同梱) は export ZIP と整合する 100MB を許容。
// #3325 AC3: さらに実行環境の実効上限 (data.maxImportBytes、AWS = Function URL 6MB 弱) で下方制限する。
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;

// #3324: import fetch の client timeout。サーバ側は Lambda/CloudFront 30 秒で必ず決着するため、
// NUC の大きめ import (制約なし) も考慮した安全上限として 120 秒で打ち切り、無限ハングを防止する。
const IMPORT_FETCH_TIMEOUT_MS = 120_000;

/**
 * #3077: 選択ファイルが ZIP なら raw bytes を application/zip で、JSON なら従来通り JSON で送る。
 * #3324: AbortController + timeout で応答が返らない場合の client 無限ハングを防止する
 * (サーバが edge で kill された場合など、`finally` の importLoading=false に到達させる)。
 */
async function postImport(mode: string): Promise<Response> {
	if (!importFile) throw new Error(SETTINGS_LABELS.dataImportNoFile);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS);
	try {
		if (importFile.name.endsWith('.zip')) {
			return await fetch(`/api/v1/import?mode=${mode}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/zip' },
				body: importFile,
				signal: controller.signal,
			});
		}
		const text = await importFile.text();
		const json = JSON.parse(text);
		// fetch-error-exempt (#3324): 失敗は呼び出し側 (handleImportPreview / executeImport) が
		// res.ok チェック + catch → importError で可視化する (ADR-0062 の可視フィードバック要件は
		// caller が充足)。helper は Response を返すのみでエラー処理を co-locate しない。
		return await fetch(`/api/v1/import?mode=${mode}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(json),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

/** #3324: AbortController による timeout 中断かを判定する (明示エラー文言の出し分け用)。 */
function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * #3324 (cloud 経路横展開): cloud import fetch も AbortController + timeout で包み、
 * 応答が返らない場合の client 無限ハングを防止する (直接 import 経路 postImport と同型)。
 * サーバが edge で kill された場合などに catch/finally へ到達させ cloudImportLoading を必ず戻す。
 */
async function postCloudImport(
	mode: string,
	body: { pinCode: string; targetChildIds?: ChildId[] },
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS);
	try {
		// fetch-error-exempt (#3324): 失敗は呼び出し側 (handleCloudImportPreview / executeCloudImport)
		// が res.ok チェック + catch → cloudImportError で可視化する (ADR-0062 の可視フィードバック要件は
		// caller が充足)。helper は Response を返すのみでエラー処理を co-locate しない。
		return await fetch(`/api/v1/import/cloud?mode=${mode}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

async function handleImportFileChange(e: Event) {
	if (anyFormBusy) return;
	const input = e.target as HTMLInputElement;
	importFile = input.files?.[0] ?? null;
	importError = '';
	importPreview = null;
	importResult = null;
	importStep = 'select';

	if (!importFile) return;
	const isZip = importFile.name.endsWith('.zip');
	if (!importFile.name.endsWith('.json') && !isZip) {
		importError = SETTINGS_LABELS.dataImportInvalidFile;
		importFile = null;
		return;
	}
	// #3325 AC3: 実行環境の実効上限 (AWS = 6MB 弱) で下方制限。超過は送信前にクラウド導線案内付きで弾く。
	const staticMaxBytes = isZip ? MAX_ZIP_BYTES : MAX_JSON_BYTES;
	const maxBytes = Math.min(staticMaxBytes, data.maxImportBytes);
	if (importFile.size > maxBytes) {
		importError =
			maxBytes < staticMaxBytes
				? IMPORT_LABELS.errorFileTooLargeCloudGuide(
						Math.round((maxBytes / (1024 * 1024)) * 10) / 10,
					)
				: SETTINGS_LABELS.dataImportFileTooLarge(isZip ? '100' : '10');
		importFile = null;
		return;
	}

	importLoading = true;
	try {
		const res = await postImport('preview');
		const d = await res.json().catch(() => null);
		if (!res.ok) {
			// #3285 uiux-1: 生サーバ message を露出せず error-notify SSOT で無害化
			importError = resolveApiErrorMessage(res.status, d?.error?.message ?? '');
			importFile = null;
			return;
		}
		importPreview = d.preview;
		importStep = 'preview';
	} catch (err) {
		// #3324: timeout 中断は明示文言、それ以外は generic
		importError = isAbortError(err)
			? SETTINGS_LABELS.dataImportTimeoutError
			: ERROR_NOTIFY_LABELS.generic;
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
		const mode = importMode === 'replace' ? 'replace' : 'execute';
		const res = await postImport(mode);
		const d = await res.json().catch(() => null);
		if (!res.ok) {
			importError = resolveApiErrorMessage(res.status, d?.error?.message ?? '');
			return;
		}
		importResult = d.result;
		importStep = 'done';
	} catch (err) {
		// #3324: timeout 中断は明示文言、それ以外は generic
		importError = isAbortError(err)
			? SETTINGS_LABELS.dataImportTimeoutError
			: ERROR_NOTIFY_LABELS.generic;
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
			const d = await res.json().catch(() => null);
			exportError = resolveApiErrorMessage(res.status, d?.error?.message ?? '');
			return;
		}
		const blob = await res.blob();
		const disposition = res.headers.get('Content-Disposition') ?? '';
		const filenameMatch = disposition.match(/filename="(.+)"/);
		const filename = filenameMatch?.[1] ?? `ganbari-quest-backup-${todayDateJST()}.json`;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	} catch {
		exportError = ERROR_NOTIFY_LABELS.generic;
	} finally {
		exportLoading = false;
	}
}

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
		const d = await res.json().catch(() => null);
		if (!res.ok) {
			cloudError = resolveApiErrorMessage(res.status, d?.error?.message ?? '');
			return;
		}
		cloudSuccess = SETTINGS_LABELS.cloudExportPinIssued(
			d.pinCode,
			new Date(d.expiresAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }),
		);
		await loadCloudExports();
	} catch {
		cloudError = ERROR_NOTIFY_LABELS.generic;
	} finally {
		cloudLoading = false;
	}
}

async function handleDeleteCloudExport(id: string) {
	try {
		const res = await fetch(`/api/v1/export/cloud/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const d = await res.json().catch(() => null);
			cloudError = resolveApiErrorMessage(res.status, d?.error?.message ?? '');
			return;
		}
		await loadCloudExports();
	} catch {
		cloudError = ERROR_NOTIFY_LABELS.generic;
	}
}

async function handleCloudImportPreview() {
	if (anyFormBusy || !cloudImportPin.trim()) return;
	cloudImportLoading = true;
	cloudImportError = '';
	try {
		const res = await postCloudImport('preview', { pinCode: cloudImportPin.trim() });
		const d = await res.json().catch(() => null);
		if (!res.ok) {
			cloudImportError = resolveApiErrorMessage(res.status, d?.error?.message ?? '');
			cloudImportErrorKind = resolveCloudImportErrorKind(d?.error);
			return;
		}
		cloudImportPreview = d.preview;
		cloudImportStep = 'preview';
	} catch (err) {
		// #3324: timeout 中断は明示文言、それ以外は generic (直接 import 経路と同型)
		cloudImportError = isAbortError(err)
			? SETTINGS_LABELS.dataImportTimeoutError
			: ERROR_NOTIFY_LABELS.generic;
	} finally {
		cloudImportLoading = false;
	}
}

async function handleCloudImportExecute() {
	if (anyFormBusy) return;
	// #2362 PR-3 Phase 7b-2: template (v2.0.0) は targetChildIds 必須化 (CWE-639 IDOR 排除)。
	// ChildSelectionDialog で取込先 child を選択させてから execute する。
	if (isCloudImportTemplate) {
		if (importTargetChildren.length === 0) {
			cloudImportError = SETTINGS_LABELS.cloudImportNoChildren;
			return;
		}
		childSelectionOpen = true;
		return;
	}
	// full export はそのまま execute (PR-3 scope 外、family-wide 復元)
	await executeCloudImport(null);
}

async function executeCloudImport(targetChildIds: ChildId[] | null) {
	cloudImportLoading = true;
	cloudImportError = '';
	try {
		const body: { pinCode: string; targetChildIds?: ChildId[] } = {
			pinCode: cloudImportPin.trim(),
		};
		if (targetChildIds && targetChildIds.length > 0) {
			body.targetChildIds = targetChildIds;
		}
		const res = await postCloudImport('execute', body);
		const d = await res.json().catch(() => null);
		if (!res.ok) {
			cloudImportError = resolveApiErrorMessage(res.status, d?.error?.message ?? '');
			cloudImportErrorKind = resolveCloudImportErrorKind(d?.error);
			return;
		}
		cloudImportResult = d.result;
		cloudImportStep = 'done';
	} catch (err) {
		// #3324: timeout 中断は明示文言、それ以外は generic (直接 import 経路と同型)
		cloudImportError = isAbortError(err)
			? SETTINGS_LABELS.dataImportTimeoutError
			: ERROR_NOTIFY_LABELS.generic;
	} finally {
		cloudImportLoading = false;
	}
}

function handleChildSelectionConfirm(result: 'all' | ChildId[]) {
	childSelectionOpen = false;
	const ids = result === 'all' ? importTargetChildren.map((c) => c.id) : result;
	void executeCloudImport(ids);
}

function handleChildSelectionCancel() {
	childSelectionOpen = false;
}

function resetCloudImport() {
	cloudImportPin = '';
	cloudImportPreview = null;
	cloudImportResult = null;
	cloudImportError = '';
	cloudImportErrorKind = DEFAULT_CLOUD_IMPORT_ERROR_KIND;
	cloudImportStep = 'input';
	childSelectionOpen = false;
}

// #3867: クラウドエクスポート (クラウドバックアップ) セクションは SaaS モード (authMode==='cognito') 専用。
// hint 文言とセクション本体を同一条件でガードし、NUC (self-host) で「下のクラウドバックアップ」が
// dangling する（誘導先セクションが描画されないのに推奨文言だけ出る）状態を防ぐ (AC1)。
const cloudExportAvailable = $derived($page.data.authMode === 'cognito');

$effect(() => {
	if (cloudExportAvailable && data.maxCloudExports > 0) {
		loadCloudExports();
	}
});

// #3324: 非同期 build (pending/building) が残っている間のみ一覧を polling し、
// 「受付 → 生成中 → 完了 (DL 可)」の進捗を可視化する。全件決着 (ready/failed) で自動停止
// (ADR-0012: 常時 polling や過剰演出はしない)。
const CLOUD_EXPORT_POLL_MS = 5_000;
const hasInFlightCloudExports = $derived(
	cloudExports.some((e) => e.status === 'pending' || e.status === 'building'),
);
$effect(() => {
	if (!hasInFlightCloudExports) return;
	const timer = setInterval(() => {
		void loadCloudExports();
	}, CLOUD_EXPORT_POLL_MS);
	return () => clearInterval(timer);
});

const canConfirmClear = $derived(
	clearConfirmText === SETTINGS_LABELS.clearConfirmKeyword && clearAgreeChecked,
);
</script>

<svelte:head>
	<title>{SETTINGS_LABELS.groupDataTitle} | {PAGE_TITLES.settings}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- データ管理 -->
	<Card padding="lg" data-tutorial="data-management">
		<div class="flex items-center gap-2 mb-4">
			<h3 class="text-lg font-bold text-[var(--color-text)]">
				{SETTINGS_LABELS.dataSectionTitle}
			</h3>
			{#if !data.canExport}
				<!-- #4665 F6: プラン表記は PAID_PLAN_LABEL が SSOT (「スタンダード以上」直書きは表記ゆれ) -->
				<PremiumBadge size="sm" label={PAID_PLAN_LABEL} showLock />
			{/if}
		</div>

		{#if exportError}
			<ErrorAlert message={exportError} severity="error" action="retry" />
		{/if}

		<div class="space-y-4">
			<!-- #4665: ページガイド「バックアップをダウンロード」step の anchor -->
			<div data-testid="data-export-section" data-tutorial="data-export-section">
				<p class="text-sm text-[var(--color-text)] mb-3">
					{SETTINGS_LABELS.dataExportDesc}
				</p>
				<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 mb-3">
					<p class="text-xs text-[var(--color-text-muted)]">
						{SETTINGS_LABELS.dataExportTarget}
					</p>
					<ul class="text-xs text-[var(--color-text-muted)] mt-1 space-y-0.5">
						<li>{SETTINGS_LABELS.dataExportItem1}</li>
						<li>{SETTINGS_LABELS.dataExportItem2}</li>
						<li>{SETTINGS_LABELS.dataExportItem3}</li>
						<li>{SETTINGS_LABELS.dataExportItem4}</li>
					</ul>
				</div>
				{#if !data.canExport}
					<div
						class="bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg p-3 mb-3"
						data-testid="export-upsell"
					>
						<p class="text-sm text-[var(--color-text)] mb-2">
							{SETTINGS_LABELS.dataExportUpsellTitle}<strong
								>{SETTINGS_LABELS.dataExportUpsellPlan}</strong
							>{SETTINGS_LABELS.dataExportUpsellSuffix}
						</p>
						<p class="text-xs text-[var(--color-text-muted)] mb-3">
							{SETTINGS_LABELS.dataExportUpsellDesc}
						</p>
						<a
							href="/pricing"
							class="inline-block px-4 py-2 bg-[var(--color-premium)] text-[var(--color-text-inverse)] text-sm font-semibold rounded-lg no-underline hover:opacity-90 transition-all"
							data-testid="export-upsell-cta"
						>
							{SETTINGS_LABELS.dataExportUpsellCta}
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
						{SETTINGS_LABELS.dataExportLockedButton}
					</Button>
				{:else}
					<label
						class="flex items-center gap-2 mb-2 text-sm text-[var(--color-text)] cursor-pointer"
					>
						<input
							type="checkbox"
							bind:checked={includeFiles}
							class="w-4 h-4 text-[var(--color-brand-500)] rounded"
						/>
						{SETTINGS_LABELS.dataExportIncludeFiles}
					</label>
					{#if !includeFiles}
						<div
							class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-3 mb-3"
						>
							<p class="text-xs text-[var(--color-feedback-warning-text)]">
								{SETTINGS_LABELS.dataExportIncludeFilesHint}
							</p>
						</div>
					{:else if cloudExportAvailable}
						<div
							class="bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] rounded-lg p-3 mb-3"
							data-testid="data-export-zip-cloud-hint"
						>
							<p class="text-xs text-[var(--color-feedback-info-text)]">
								{SETTINGS_LABELS.dataExportZipCloudHint}
							</p>
						</div>
					{:else}
						<!-- #3867: NUC (self-host) はクラウドバックアップ導線が無いため代替文言 (AC2) -->
						<div
							class="bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] rounded-lg p-3 mb-3"
							data-testid="data-export-zip-local-hint"
						>
							<p class="text-xs text-[var(--color-feedback-info-text)]">
								{SETTINGS_LABELS.dataExportZipLocalHint}
							</p>
						</div>
					{/if}
					<label
						class="flex items-center gap-2 mb-3 text-sm text-[var(--color-text)] cursor-pointer"
					>
						<input
							type="checkbox"
							bind:checked={compactFormat}
							class="w-4 h-4 text-[var(--color-brand-500)] rounded"
						/>
						{SETTINGS_LABELS.dataExportCompact}
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
							<span
								class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
								aria-hidden="true"
							></span>
							{SETTINGS_LABELS.dataExporting}
						{:else}
							{SETTINGS_LABELS.dataExportAction}
						{/if}
					</Button>
				{/if}
			</div>

			<hr class="my-4 border-[var(--color-border-default)]" />

			<!-- インポート -->
			<div>
				<!-- #4665: ページガイド「復元 (インポート)」step の anchor -->
				<h4
					class="text-sm font-bold text-[var(--color-text)] mb-2"
					data-tutorial="data-import-section"
				>
					{SETTINGS_LABELS.dataImportTitle}
				</h4>

				<!-- #3372: partial-backup 警告 (registry 駆動)。未 export の source 実体が
				     存在するときのみ表示し、export 実装が進むと自動で消える (NN/G visibility)。 -->
				{#if data.notYetExportedLabels.length > 0}
					<div
						class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-3 mb-3"
						role="status"
						data-testid="import-partial-backup-warning"
					>
						<p class="text-xs text-[var(--color-feedback-warning-text)]">
							{SETTINGS_LABELS.dataImportPartialBackupWarning(
								data.notYetExportedLabels.join('、'),
							)}
						</p>
					</div>
				{/if}

				{#if importError}
					<ErrorAlert message={importError} severity="warning" action="fix_input" />
				{/if}

				{#if importStep === 'select'}
					<p class="text-sm text-[var(--color-text)] mb-3">
						{SETTINGS_LABELS.dataImportDesc}
					</p>
					<div class="mb-3">
						<span class="block text-sm font-medium text-[var(--color-text)] mb-2">
							{SETTINGS_LABELS.dataImportMode}
						</span>
						<div class="flex gap-3">
							<label class="flex items-center gap-2 cursor-pointer">
								<input
									type="radio"
									value="replace"
									bind:group={importMode}
									class="w-4 h-4 text-[var(--color-warning)]"
								/>
								<span class="text-sm">{SETTINGS_LABELS.dataImportModeReplace}</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input
									type="radio"
									value="add"
									bind:group={importMode}
									class="w-4 h-4 text-[var(--color-warning)]"
								/>
								<span class="text-sm">{SETTINGS_LABELS.dataImportModeAdd}</span>
							</label>
						</div>
						{#if importMode === 'replace'}
							<p class="text-xs text-[var(--color-feedback-error-text)] mt-1">
								{SETTINGS_LABELS.dataImportModeReplaceWarning}
							</p>
						{:else}
							<p class="text-xs text-[var(--color-text-muted)] mt-1">
								{SETTINGS_LABELS.dataImportModeAddNote}
							</p>
						{/if}
					</div>
					<label
						class="block w-full py-2 bg-[var(--color-warning)] text-white font-bold rounded-lg hover:brightness-110 transition-all text-center cursor-pointer {importLoading
							? 'opacity-50 pointer-events-none'
							: ''}"
					>
						{#if importLoading}
							<span
								class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
								aria-hidden="true"
							></span>
							{SETTINGS_LABELS.dataImportLoading}
						{:else}
							{SETTINGS_LABELS.dataImportSelectFile}
						{/if}
						<input
							type="file"
							accept=".json,.zip"
							onchange={handleImportFileChange}
							class="hidden"
							data-testid="import-file-input"
						/>
					</label>
				{:else if importStep === 'preview' && importPreview}
					<div
						class="bg-[var(--color-feedback-warning-bg)] rounded-lg p-4 mb-3"
						data-testid="import-preview-summary"
					>
						<p class="text-sm font-bold text-[var(--color-feedback-warning-text)] mb-2">
							{IMPORT_LABELS.previewDialogTitle}
						</p>
						<p
							class="text-xs text-[var(--color-feedback-success-text)] mb-2"
							data-testid="import-preview-checksum-ok"
						>
							{SETTINGS_LABELS.dataImportChecksumOk}
						</p>
						<ul class="text-xs text-[var(--color-feedback-warning-text)] space-y-1">
							<li>{SETTINGS_LABELS.dataImportPreviewChildren(importPreview.children)}</li>
							<li>
								{SETTINGS_LABELS.dataImportPreviewActivityLogs(importPreview.activityLogs)}
							</li>
							<li>
								{SETTINGS_LABELS.dataImportPreviewPointLedger(importPreview.pointLedger)}
							</li>
							<li>{SETTINGS_LABELS.dataImportPreviewStatuses(importPreview.statuses)}</li>
							<li>
								{SETTINGS_LABELS.dataImportPreviewAchievements(importPreview.achievements)}
							</li>
							{#if (importPreview.loginBonuses ?? 0) > 0}
								<li>
									{SETTINGS_LABELS.dataImportPreviewLoginBonuses(importPreview.loginBonuses)}
								</li>
							{/if}
							{#if (importPreview.checklistTemplates ?? 0) > 0}
								<li>
									{SETTINGS_LABELS.dataImportPreviewChecklists(
										importPreview.checklistTemplates,
									)}
								</li>
							{/if}
						</ul>
					</div>
					<div
						class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-3 mb-3"
					>
						{#if importMode === 'replace'}
							<p class="text-xs text-[var(--color-feedback-error-text)] font-bold">
								{SETTINGS_LABELS.dataImportReplaceConfirm}
							</p>
						{:else}
							<p class="text-xs text-[var(--color-feedback-warning-text)]">
								{SETTINGS_LABELS.dataImportAddConfirm}
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
							{SETTINGS_LABELS.dataImportCancel}
						</Button>
						<Button
							type="button"
							variant="warning"
							size="md"
							class="flex-1 flex items-center justify-center gap-2 bg-[var(--color-warning)] hover:brightness-110"
							disabled={importLoading}
							onclick={handleImportExecute}
							data-testid="import-execute-button"
						>
							{#if importLoading}
								<span
									class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
									aria-hidden="true"
								></span>
								{SETTINGS_LABELS.dataImporting}
							{:else}
								{SETTINGS_LABELS.dataImportAction}
							{/if}
						</Button>
					</div>
				{:else if importStep === 'done' && importResult}
					<!-- #3095: errors があれば partial-restore として警告表示。置換時は既存データ
					     クリア済のため部分失敗 = 家族データ半損であり「完了」と誤認させない。 -->
					{#if importHadErrors}
						<div
							class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-4 mb-3"
							role="alert"
							data-testid="data-import-partial-warning"
						>
							<p class="text-sm font-bold text-[var(--color-feedback-warning-text)] mb-1">
								⚠️ {SETTINGS_LABELS.dataImportPartialTitle}
							</p>
							<p class="text-xs text-[var(--color-feedback-warning-text)]">
								{importMode === 'replace'
									? SETTINGS_LABELS.dataImportPartialBodyReplace
									: SETTINGS_LABELS.dataImportPartialBodyAdd}
							</p>
						</div>
					{/if}
					<div
						class="rounded-lg p-4 mb-3 {importHadErrors
							? 'bg-[var(--color-feedback-warning-bg)]'
							: 'bg-[var(--color-feedback-success-bg)]'}"
						data-testid="data-import-result"
					>
						<p
							class="text-sm font-bold mb-2 {importHadErrors
								? 'text-[var(--color-feedback-warning-text)]'
								: 'text-[var(--color-feedback-success-text)]'}"
						>
							{SETTINGS_LABELS.dataImportComplete}
						</p>
						<ul
							class="text-xs space-y-1 {importHadErrors
								? 'text-[var(--color-feedback-warning-text)]'
								: 'text-[var(--color-feedback-success-text)]'}"
						>
							<li>
								{SETTINGS_LABELS.dataImportResultChildren(importResult.childrenImported)}
							</li>
							{#if importResult.activitiesCreated > 0}
								<li>
									{SETTINGS_LABELS.dataImportResultActivities(importResult.activitiesCreated)}
								</li>
							{/if}
							<li>
								{SETTINGS_LABELS.dataImportResultActivityLogs(
									importResult.activityLogsImported,
									importResult.activityLogsSkipped,
								)}
							</li>
							<li>
								{SETTINGS_LABELS.dataImportResultPointLedger(
									importResult.pointLedgerImported,
									importResult.pointLedgerSkipped,
								)}
							</li>
							<li>
								{SETTINGS_LABELS.dataImportResultSpecialRewards(
									importResult.specialRewardsImported,
									importResult.specialRewardsSkipped,
								)}
							</li>
							{#if importResult.checklistLogsImported > 0 || importResult.checklistLogsSkipped > 0}
								<li>
									{SETTINGS_LABELS.dataImportResultChecklistLogs(
										importResult.checklistLogsImported,
										importResult.checklistLogsSkipped,
									)}
								</li>
							{/if}
							{#if importResult.staticFilesRestored > 0 || importResult.staticFilesSkipped > 0}
								<li>
									{SETTINGS_LABELS.dataImportResultStaticFiles(
										importResult.staticFilesRestored,
										importResult.staticFilesSkipped,
									)}
								</li>
							{/if}
							{#if importResult.childVoicesImported > 0 || importResult.childVoicesSkipped > 0}
								<li data-testid="data-import-result-child-voices">
									{SETTINGS_LABELS.dataImportResultChildVoices(
										importResult.childVoicesImported,
										importResult.childVoicesSkipped,
									)}
								</li>
							{/if}
							{#if importResult.settingsImported > 0 || importResult.settingsSkipped > 0}
								<li data-testid="data-import-result-settings">
									{SETTINGS_LABELS.dataImportResultSettings(
										importResult.settingsImported,
										importResult.settingsSkipped,
									)}
								</li>
							{/if}
						</ul>
					</div>
					<!-- #3095: errors 内訳を surface (silent-skip 禁止)。再実行判断の材料にする。 -->
					{#if importResult.errors.length > 0}
						<div
							class="bg-[var(--color-feedback-error-bg)] rounded-lg p-4 mb-3"
							data-testid="data-import-errors"
						>
							<p class="text-sm font-bold text-[var(--color-feedback-error-text)] mb-2">
								{SETTINGS_LABELS.dataImportErrorsTitle(importResult.errors.length)}
							</p>
							<ul
								class="text-xs text-[var(--color-feedback-error-text)] space-y-1 list-disc pl-4"
							>
								{#each importResult.errors as err (err)}
									<li>{err}</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if importResult.warnings.length > 0}
						<div
							class="bg-[var(--color-feedback-warning-bg)] rounded-lg p-4 mb-3"
							data-testid="data-import-warnings"
						>
							<p class="text-sm font-bold text-[var(--color-feedback-warning-text)] mb-2">
								{SETTINGS_LABELS.dataImportWarningsTitle(importResult.warnings.length)}
							</p>
							<ul
								class="text-xs text-[var(--color-feedback-warning-text)] space-y-1 list-disc pl-4"
							>
								{#each importResult.warnings as warn (warn)}
									<li>{warn}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<Button
						type="button"
						variant="ghost"
						size="md"
						class="w-full bg-[var(--color-neutral-300)] text-[var(--color-text)] hover:brightness-95"
						onclick={resetImport}
					>
						{SETTINGS_LABELS.dataImportClose}
					</Button>
				{/if}
			</div>
		</div>
	</Card>

	<!-- クラウドエクスポート (SaaS モード専用) — #3867: ZIP hint と同一条件 (cloudExportAvailable) でガード -->
	{#if cloudExportAvailable}
		<!-- #4665: ページガイド「クラウド共有」step の anchor (SaaS のみ描画) -->
		<Card padding="lg" data-testid="cloud-export-card" data-tutorial="cloud-export-card">
			<div class="flex items-center gap-2 mb-4">
				<h3 class="text-lg font-bold text-[var(--color-text)]">
					{SETTINGS_LABELS.cloudSectionTitle}
				</h3>
				{#if data.maxCloudExports === 0}
					<PremiumBadge size="sm" label={PAID_PLAN_LABEL} showLock />
				{:else}
					<span
						class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] rounded-full"
						data-testid="cloud-export-slot-counter"
					>
						{SETTINGS_LABELS.cloudSlotCounter(cloudExports.length, data.maxCloudExports)}
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
				<div
					class="bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg p-4"
					data-testid="cloud-export-upsell"
				>
					<p class="text-sm text-[var(--color-text)] mb-2">
						{SETTINGS_LABELS.cloudUpsellTitle}<strong
							>{SETTINGS_LABELS.cloudUpsellPlan}</strong
						>{SETTINGS_LABELS.cloudUpsellSuffix}
					</p>
					<p class="text-xs text-[var(--color-text-muted)] mb-3">
						{SETTINGS_LABELS.cloudUpsellDesc}
					</p>
					<a
						href="/pricing"
						class="inline-block px-4 py-2 bg-[var(--color-premium)] text-[var(--color-text-inverse)] text-sm font-semibold rounded-lg no-underline hover:opacity-90 transition-all"
						data-testid="cloud-export-upsell-cta"
					>
						{SETTINGS_LABELS.cloudUpsellCta}
					</a>
				</div>
			{:else}
				<div class="space-y-4">
					<!-- エクスポート作成 -->
					<div>
						<p class="text-sm text-[var(--color-text)] mb-3">
							{SETTINGS_LABELS.cloudExportDesc}
						</p>
						<div class="mb-3">
							<span class="block text-sm font-medium text-[var(--color-text)] mb-2">
								{SETTINGS_LABELS.cloudExportType}
							</span>
							<div class="flex gap-3">
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="radio"
										value="template"
										bind:group={cloudExportType}
										class="w-4 h-4 text-[var(--color-brand-500)]"
									/>
									<span class="text-sm">{SETTINGS_LABELS.cloudExportTypeTemplate}</span>
								</label>
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="radio"
										value="full"
										bind:group={cloudExportType}
										class="w-4 h-4 text-[var(--color-brand-500)]"
									/>
									<span class="text-sm">{SETTINGS_LABELS.cloudExportTypeFull}</span>
								</label>
							</div>
							{#if cloudExportType === 'template'}
								<p class="text-xs text-[var(--color-text-muted)] mt-1">
									{SETTINGS_LABELS.cloudExportTypeTemplateDesc}
								</p>
							{:else}
								<p class="text-xs text-[var(--color-text-muted)] mt-1">
									{SETTINGS_LABELS.cloudExportTypeFullDesc}
								</p>
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
								<span
									class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
									aria-hidden="true"
								></span>
								{SETTINGS_LABELS.cloudSaving}
							{:else}
								{SETTINGS_LABELS.cloudSaveAction}
							{/if}
						</Button>
					</div>

					<!-- 保管済み一覧 -->
					{#if cloudExports.length > 0}
						<hr class="my-4 border-[var(--color-border-default)]" />
						<div>
							<h4 class="text-sm font-bold text-[var(--color-text)] mb-2">
								{SETTINGS_LABELS.cloudStoredTitle}
							</h4>
							<div class="space-y-2">
								{#each cloudExports as exp}
									<div
										class="bg-[var(--color-surface-muted)] rounded-lg p-3 flex items-center justify-between"
									>
										<div>
											<p class="text-sm font-mono font-bold text-[var(--color-brand-600)]">
												{exp.pinCode}
											</p>
											<p class="text-xs text-[var(--color-text-muted)]">
												{exp.exportType === 'template'
													? SETTINGS_LABELS.cloudExportTypeTemplate
													: SETTINGS_LABELS.cloudExportTypeFull}
												{#if exp.description}· {exp.description}{/if}
											</p>
											<p class="text-xs text-[var(--color-text-muted)]">
												{SETTINGS_LABELS.cloudStoredExpiry(
													new Date(exp.expiresAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }),
												)}
												· {SETTINGS_LABELS.cloudStoredDownloads(
													exp.downloadCount,
													exp.maxDownloads,
												)}
											</p>
											<!-- #3324: 非同期 build の進捗フィードバック (受付/生成中/失敗)。 -->
											{#if exp.status === 'pending' || exp.status === 'building'}
												<p
													class="text-xs text-[var(--color-feedback-info-text)] flex items-center gap-1"
													role="status"
													data-testid="cloud-export-status-{exp.id}"
												>
													<span
														class="inline-block w-3 h-3 border-2 border-[var(--color-feedback-info-text)] border-t-transparent rounded-full animate-spin"
														aria-hidden="true"
													></span>
													{exp.status === 'pending'
														? SETTINGS_LABELS.cloudStatusPending
														: SETTINGS_LABELS.cloudStatusBuilding}
												</p>
											{:else if exp.status === 'failed'}
												<p
													class="text-xs text-[var(--color-feedback-error-text)]"
													role="status"
													data-testid="cloud-export-status-{exp.id}"
												>
													{SETTINGS_LABELS.cloudStatusFailed(exp.failureReason ?? '')}
												</p>
											{/if}
										</div>
										<div class="flex items-center gap-2">
											<!-- #3324: ready 時のみ DL 導線を出す (#3509 の一時 DL 経路へ)。 -->
											{#if exp.status === 'ready'}
												<Button
													href="/api/v1/export/cloud/{exp.id}/download"
													variant="ghost"
													size="sm"
													class="text-[var(--color-text-link)] hover:brightness-75"
													data-testid="cloud-export-download-link"
												>
													{SETTINGS_LABELS.cloudDownloadAction}
												</Button>
											{/if}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class="text-[var(--color-feedback-error-text)] hover:brightness-75"
												onclick={() => handleDeleteCloudExport(exp.id)}
											>
												{SETTINGS_LABELS.cloudStoredDelete}
											</Button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- PIN インポート -->
					<hr class="my-4 border-[var(--color-border-default)]" />
					<div>
						<h4 class="text-sm font-bold text-[var(--color-text)] mb-2">
							{SETTINGS_LABELS.cloudImportTitle}
						</h4>

						{#if cloudImportError}
							<ErrorAlert
								message={cloudImportError}
								severity={cloudImportErrorKind.severity}
								action={cloudImportErrorKind.action}
							/>
						{/if}

						{#if cloudImportStep === 'input'}
							<p class="text-sm text-[var(--color-text)] mb-3">
								{SETTINGS_LABELS.cloudImportDesc}
							</p>
							<div class="flex gap-2">
								<input
									type="text"
									bind:value={cloudImportPin}
									placeholder={SETTINGS_LABELS.cloudImportPinPlaceholder}
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
										{SETTINGS_LABELS.cloudImportChecking}
									{:else}
										{SETTINGS_LABELS.cloudImportConfirmAction}
									{/if}
								</Button>
							</div>
						{:else if cloudImportStep === 'preview' && cloudImportPreview}
							<div class="bg-[var(--color-feedback-info-bg)] rounded-lg p-4 mb-3">
								<p class="text-sm font-bold text-[var(--color-feedback-info-text)] mb-2">
									{SETTINGS_LABELS.cloudImportPreviewTitle}
								</p>
								{#if cloudImportPreview.exportType === 'template'}
									<ul class="text-xs text-[var(--color-feedback-info-text)] space-y-1">
										{#if cloudImportPreview.activities}
											<li>
												{SETTINGS_LABELS.cloudImportPreviewActivities(
													cloudImportPreview.activities,
												)}
											</li>
										{/if}
										{#if cloudImportPreview.checklistTemplates}
											<li>
												{SETTINGS_LABELS.cloudImportPreviewChecklists(
													cloudImportPreview.checklistTemplates,
												)}
											</li>
										{/if}
									</ul>
									<p class="text-xs text-[var(--color-text-muted)] mt-2">
										{SETTINGS_LABELS.cloudImportTemplateNote}
									</p>
								{:else}
									<p class="text-xs text-[var(--color-feedback-info-text)]">
										{SETTINGS_LABELS.cloudImportFullNote}
									</p>
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
									{SETTINGS_LABELS.cloudImportCancel}
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
										{SETTINGS_LABELS.cloudImporting}
									{:else}
										{SETTINGS_LABELS.cloudImportAction}
									{/if}
								</Button>
							</div>
						{:else if cloudImportStep === 'done' && cloudImportResult}
							<div class="bg-[var(--color-feedback-success-bg)] rounded-lg p-4 mb-3">
								<p
									class="text-sm font-bold text-[var(--color-feedback-success-text)] mb-2"
								>
									{SETTINGS_LABELS.cloudImportComplete}
								</p>
								<ul class="text-xs text-[var(--color-feedback-success-text)] space-y-1">
									{#if cloudImportResult.activitiesCreated}
										<li>
											{SETTINGS_LABELS.cloudImportResultActivities(
												cloudImportResult.activitiesCreated,
											)}
										</li>
									{/if}
									{#if cloudImportResult.checklistsCreated}
										<li>
											{SETTINGS_LABELS.cloudImportResultChecklists(
												cloudImportResult.checklistsCreated,
											)}
										</li>
									{/if}
									{#if cloudImportResult.childrenImported}
										<li>
											{SETTINGS_LABELS.cloudImportResultChildren(
												cloudImportResult.childrenImported,
											)}
										</li>
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
								{SETTINGS_LABELS.cloudImportClose}
							</Button>
						{/if}
					</div>
				</div>
			{/if}
		</Card>
	{/if}

	<!-- #2362 PR-3 Phase 7b-2: ChildSelectionDialog (template 取込時のみ表示) -->
	<ChildSelectionDialog
		children={importTargetChildren}
		bind:open={childSelectionOpen}
		allowMultiple={true}
		onConfirm={handleChildSelectionConfirm}
		onCancel={handleChildSelectionCancel}
		testid="cloud-import-child-selection-dialog"
	/>

	<!-- Danger Zone: データクリア (#2323 GitHub Danger Zone パターン) -->
	<!-- #4665: ページガイド「すべてのデータを削除」step の anchor -->
	<section class="danger-zone" data-testid="data-danger-zone" data-tutorial="data-danger-zone">
		<header class="danger-zone__header">
			<h3 class="danger-zone__title">⚠️ {SETTINGS_LABELS.dangerZoneTitle}</h3>
			<p class="danger-zone__desc">{SETTINGS_LABELS.dangerZoneDesc}</p>
		</header>

		<div class="danger-zone__body">
			<h4 class="text-base font-bold text-[var(--color-feedback-error-text)] mb-2">
				{SETTINGS_LABELS.clearSectionTitle}
			</h4>

			{#if clearSuccess}
				<SuccessAlert message={SETTINGS_LABELS.clearCompleted} />
			{/if}

			{#if clearError}
				<ErrorAlert message={clearError} severity="error" action="retry" />
			{/if}

			{#if form?.clearError}
				<ErrorAlert message={form.clearError} severity="warning" action="fix_input" />
			{/if}

			<p class="text-sm text-[var(--color-text)] mb-3">{SETTINGS_LABELS.clearDesc}</p>

			{#if data.dataSummary}
				<div class="bg-[var(--color-feedback-error-bg)] rounded-lg p-4 mb-4">
					<p class="text-sm font-bold text-[var(--color-feedback-error-text)] mb-2">
						{SETTINGS_LABELS.clearCurrentDataTitle}
					</p>
					<ul class="text-xs text-[var(--color-feedback-error-text)] space-y-1 columns-2">
						<li>{SETTINGS_LABELS.dataImportPreviewChildren(data.dataSummary.children)}</li>
						<li>
							{SETTINGS_LABELS.dataImportPreviewActivityLogs(data.dataSummary.activityLogs)}
						</li>
						<li>
							{SETTINGS_LABELS.dataImportPreviewPointLedger(data.dataSummary.pointLedger)}
						</li>
						<li>{SETTINGS_LABELS.dataImportPreviewStatuses(data.dataSummary.statuses)}</li>
						<li>
							{SETTINGS_LABELS.dataImportPreviewLoginBonuses(data.dataSummary.loginStreaks)}
						</li>
						<li>{SETTINGS_LABELS.dataImportPreviewVoices(data.dataSummary.voices)}</li>
						<li>
							{SETTINGS_LABELS.dataImportPreviewChecklists(
								data.dataSummary.checklistTemplates,
							)}
						</li>
					</ul>
				</div>
			{/if}

			<div
				class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-lg p-3 mb-4"
			>
				<p class="text-xs text-[var(--color-feedback-error-text)] font-bold">
					{SETTINGS_LABELS.clearIrreversibleWarning}
				</p>
			</div>

			<form
				method="POST"
				action="?/clearData"
				use:enhance={({ cancel }) => {
					if (anyFormBusy) {
						cancel();
						return;
					}
					clearSubmitting = true;
					clearSuccess = false;
					clearError = '';
					return async ({ result, update }) => {
						clearSubmitting = false;
						if (result.type === 'success') {
							clearSuccess = true;
							clearConfirmText = '';
							clearAgreeChecked = false;
						}
						await update();
					};
				}}
				class="space-y-3"
			>
				<!-- Step 1: 確認テキスト -->
				<div class="danger-zone__step">
					<p class="danger-zone__step-label">{SETTINGS_LABELS.dangerStep1Label}</p>
					<FormField
						label={SETTINGS_LABELS.clearConfirmFieldLabel}
						type="text"
						id="clearConfirm"
						name="confirm"
						bind:value={clearConfirmText}
						placeholder={SETTINGS_LABELS.clearConfirmKeyword}
					/>
				</div>

				<!-- Step 2: 同意チェック -->
				<div class="danger-zone__step">
					<p class="danger-zone__step-label">{SETTINGS_LABELS.dangerStep2Label}</p>
					<label class="flex items-start gap-2 cursor-pointer">
						<input
							type="checkbox"
							bind:checked={clearAgreeChecked}
							name="agree"
							value="true"
							class="mt-1 h-4 w-4 rounded border-[var(--color-border-strong)]"
							data-testid="data-danger-agree-checkbox"
						/>
						<span class="text-sm text-[var(--color-text)]">
							{SETTINGS_LABELS.clearDangerConsentLabel}
						</span>
					</label>
				</div>

				<!-- Step 3: 実行 -->
				<div class="danger-zone__step">
					<p class="danger-zone__step-label">{SETTINGS_LABELS.dangerStep3Label}</p>
					<Button
						type="submit"
						variant="danger"
						size="md"
						class="w-full"
						disabled={clearSubmitting || !canConfirmClear}
						data-testid="data-danger-execute-button"
					>
						{clearSubmitting ? SETTINGS_LABELS.clearSubmitting : SETTINGS_LABELS.clearSubmitButton}
					</Button>
				</div>
			</form>
		</div>
	</section>
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
