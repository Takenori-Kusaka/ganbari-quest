<script lang="ts">
// #4767 PO 回答 #3: クラウド保管枠を占有している全行を状態付きで見せ、各行を削除できるようにする。
// 旧実装 (settings/data/+page.svelte 直書き) は DL 回数を使い切った行を一覧から落としていたため、
// 「保管枠 2 / 3」と表示されながら 3 件目で 403 になり、顧客には消す対象が見えなかった。
import { type CloudExportStoredRow, cloudRowStateLabel } from '$lib/domain/cloud-export-quota';
import { formatJstDate, SETTINGS_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	exports: CloudExportStoredRow[];
	/** 削除リクエスト中の行 id (その行のボタンを loading にする)。 */
	deletingId?: string | null;
	onDelete: (id: string) => void;
}

let { exports, deletingId = null, onDelete }: Props = $props();
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
							{exp.exportType === 'template'
								? SETTINGS_LABELS.cloudExportTypeTemplate
								: SETTINGS_LABELS.cloudExportTypeFull}
							{#if exp.description}· {exp.description}{/if}
						</p>
						<p class="text-xs text-[var(--color-text-muted)]">
							{SETTINGS_LABELS.cloudStoredCreated(formatJstDate(exp.createdAt))}
							· {SETTINGS_LABELS.cloudAutoDeleteIn(exp.daysUntilAutoDelete)}
							{#if exp.rowState === 'downloadable'}
								· {SETTINGS_LABELS.cloudStoredDownloads(exp.downloadCount, exp.maxDownloads)}
							{/if}
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
						<!-- DL 導線は取り出せる行 (ready かつ回数が残る) だけ。 -->
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
						<!-- 削除は全行で可能 (枠が即戻る)。 -->
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="text-[var(--color-feedback-error-text)] hover:brightness-75"
							loading={deletingId === exp.id}
							disabled={deletingId !== null}
							data-testid="cloud-export-delete-{exp.id}"
							onclick={() => onDelete(exp.id)}
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
{/if}
