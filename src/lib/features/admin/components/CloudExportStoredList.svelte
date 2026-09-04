<script lang="ts">
// #4767 PO 回答 #3: クラウド保管枠を占有している全行を状態付きで見せ、各行を削除できるようにする。
// 旧実装 (settings/data/+page.svelte 直書き) は DL 回数を使い切った行を一覧から落としていたため、
// 「保管枠 2 / 3」と表示されながら 3 件目で 403 になり、顧客には消す対象が見えなかった。
//
// #4767 QM must: 削除は S3 の全バージョンを消す **取り消せない** 操作なので、押した瞬間には実行せず
// Dialog primitive (DESIGN.md §5) で「何が消えるのか」「元に戻せない」ことを確認してから実行する。
import { type CloudExportStoredRow, cloudRowStateLabel } from '$lib/domain/cloud-export-quota';
import { formatJstDate, SETTINGS_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	exports: CloudExportStoredRow[];
	/** 削除リクエスト中の行 id (その行のボタンを loading にする)。 */
	deletingId?: string | null;
	onDelete: (id: string) => void;
}

let { exports, deletingId = null, onDelete }: Props = $props();

/** 確認 dialog を開いている行 (null = 閉じている)。確定するまで削除は起きない。 */
let confirmTarget = $state<CloudExportStoredRow | null>(null);
const confirmOpen = $derived(confirmTarget !== null);

function exportTypeLabel(row: CloudExportStoredRow): string {
	return row.exportType === 'template'
		? SETTINGS_LABELS.cloudExportTypeTemplate
		: SETTINGS_LABELS.cloudExportTypeFull;
}

function confirmDelete() {
	const target = confirmTarget;
	if (!target) return;
	confirmTarget = null;
	onDelete(target.id);
}
</script>

{#if exports.length > 0}
	<div data-testid="cloud-export-stored-list">
		<h4 class="text-sm font-bold text-[var(--color-text)] mb-1">
			{SETTINGS_LABELS.cloudStoredTitle}
		</h4>
		<p class="text-xs text-[var(--color-text-muted)] mb-2">
			{SETTINGS_LABELS.cloudStoredListDesc}
		</p>
		<div class="space-y-2">
			{#each exports as exp (exp.id)}
				<div
					class="bg-[var(--color-surface-muted)] rounded-lg p-3 flex items-center justify-between gap-3"
					data-testid="cloud-export-row-{exp.id}"
				>
					<div class="min-w-0">
						<p class="text-sm font-mono font-bold text-[var(--color-action-primary-strong)]">
							{exp.pinCode}
						</p>
						<p class="text-xs text-[var(--color-text-muted)]">
							{exportTypeLabel(exp)}
							{#if exp.description}· {exp.description}{/if}
						</p>
						<!--
							#4767 QM should: 期限 (絶対日付) / 作成日 / DL 回数は **状態によらず常に出す**。
							状態ごとに出し分けると、その行だけ「いつ消えるのか」「あと何回取り出せるのか」が
							読めなくなる (旧実装は使い切り行から期限が消えていた)。
						-->
						<p class="text-xs text-[var(--color-text-muted)]">
							{SETTINGS_LABELS.cloudStoredCreated(formatJstDate(exp.createdAt))}
							· {SETTINGS_LABELS.cloudStoredExpiry(formatJstDate(exp.expiresAt))}
							· {SETTINGS_LABELS.cloudAutoDeleteIn(exp.daysUntilAutoDelete)}
							· {SETTINGS_LABELS.cloudStoredDownloads(exp.downloadCount, exp.maxDownloads)}
						</p>
						<!-- 行の状態 (PO 回答 #3 の 4 語 + 生成待ち / 生成中)。role=status で読み上げる。 -->
						{#if exp.rowState === 'pending' || exp.rowState === 'building'}
							<p
								class="text-xs text-[var(--color-feedback-info-text)] flex items-center gap-1"
								role="status"
								data-testid="cloud-export-status-{exp.id}"
							>
								<span
									class="inline-block w-3 h-3 border-2 border-[var(--color-feedback-info-text)] border-t-transparent rounded-full animate-spin"
									aria-hidden="true"
								></span>
								{cloudRowStateLabel(exp.rowState)}
							</p>
						{:else if exp.rowState === 'failed'}
							<p
								class="text-xs text-[var(--color-feedback-error-text)]"
								role="status"
								data-testid="cloud-export-status-{exp.id}"
							>
								{SETTINGS_LABELS.cloudStatusFailed(exp.failureReason ?? '')}
							</p>
						{:else if exp.rowState === 'exhausted'}
							<p
								class="text-xs text-[var(--color-feedback-warning-text)]"
								role="status"
								data-testid="cloud-export-status-{exp.id}"
							>
								{cloudRowStateLabel(exp.rowState)}
							</p>
						{:else}
							<p
								class="text-xs text-[var(--color-feedback-success-text)]"
								role="status"
								data-testid="cloud-export-status-{exp.id}"
							>
								{cloudRowStateLabel(exp.rowState)}
							</p>
						{/if}
					</div>
					<div class="flex items-center gap-2 shrink-0">
						<!-- DL 導線は取り出せる行だけ。 -->
						{#if exp.rowState === 'downloadable'}
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
						<!-- 削除は全行で可能 (枠が即戻る)。ただし押しただけでは消えない (確認 dialog を開くだけ)。 -->
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="text-[var(--color-feedback-error-text)] hover:brightness-75"
							loading={deletingId === exp.id}
							disabled={deletingId !== null}
							data-testid="cloud-export-delete-{exp.id}"
							onclick={() => {
								confirmTarget = exp;
							}}
						>
							{deletingId === exp.id
								? SETTINGS_LABELS.cloudStoredDeleting
								: SETTINGS_LABELS.cloudStoredDelete}
						</Button>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!--
		#4767 QM must: 取り消せない削除の確認。何が消えるのか (PIN / 種別 / 状態) を名指しし、
		元に戻せないことを明示する。閉じる = 何もしない (削除は確定ボタンでのみ起きる)。
	-->
	<Dialog
		open={confirmOpen}
		onOpenChange={({ open }) => {
			if (!open) confirmTarget = null;
		}}
		title={SETTINGS_LABELS.cloudDeleteConfirmTitle}
		testid="cloud-export-delete-confirm"
		size="sm"
	>
		{#if confirmTarget}
			<p class="text-sm text-[var(--color-text)] mb-2" data-testid="cloud-export-delete-confirm-target">
				{SETTINGS_LABELS.cloudDeleteConfirmTarget(
					confirmTarget.pinCode,
					exportTypeLabel(confirmTarget),
					cloudRowStateLabel(confirmTarget.rowState),
				)}
			</p>
			<p class="text-sm text-[var(--color-feedback-error-text)] mb-2">
				{SETTINGS_LABELS.cloudDeleteConfirmIrreversible}
			</p>
			<p class="text-xs text-[var(--color-text-muted)] mb-4">
				{SETTINGS_LABELS.cloudDeleteConfirmQuotaNote}
			</p>
			<div class="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-testid="cloud-export-delete-cancel"
					onclick={() => {
						confirmTarget = null;
					}}
				>
					{SETTINGS_LABELS.cloudDeleteConfirmCancel}
				</Button>
				<Button
					type="button"
					variant="danger"
					size="sm"
					data-testid="cloud-export-delete-execute"
					onclick={confirmDelete}
				>
					{SETTINGS_LABELS.cloudDeleteConfirmExecute}
				</Button>
			</div>
		{/if}
	</Dialog>
{/if}
