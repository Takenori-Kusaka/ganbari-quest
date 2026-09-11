<script lang="ts">
/**
 * 退会 (アカウント削除) 申請中であることと復元導線を出す共通バナー (#1781 / #4699)。
 *
 * #4699: 旧実装は `/admin/settings/account` の 1 画面にしか無かったため、申請したことを忘れた /
 * 家族の別端末で気づかない保護者が、猶予期間の経過で全データを失う経路が残っていた。
 * `gracePeriodStatus` は admin `+layout.server.ts` が全 admin route に配布しているので、
 * 本 component を AdminLayout に置いて **全 admin ページ**で常時見えるようにする。
 * 設定 > アカウント画面も同じ component を使う (二重実装を作らない)。
 */
import { DELETION_GRACE_RESTORE_ENDPOINT } from '$lib/domain/constants/deletion-grace';
import { SETTINGS_LABELS } from '$lib/domain/labels';
import { ErrorAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';

interface GracePeriodStatus {
	isSoftDeleted: boolean;
	softDeletedAt: string | null;
	gracePeriodDays: number;
	physicalDeletionDate: string | null;
	daysRemaining: number;
	isExpired: boolean;
	planTier: string | null;
}

interface Props {
	status: GracePeriodStatus | null | undefined;
	/** 復元後の再読み込みを親に委ねる場合に指定 (既定: location.reload) */
	onRestored?: () => void;
	class?: string;
	testid?: string;
}

let {
	status,
	onRestored,
	class: className = '',
	testid = 'deletion-grace-banner',
}: Props = $props();

const visible = $derived(Boolean(status?.isSoftDeleted) && !status?.isExpired);

/**
 * 物理削除日を「YYYY年M月D日」で表示する (ISO をそのまま出さない)。
 * SSR は Lambda = UTC で描画されるため `timeZone: 'Asia/Tokyo'` を明示する
 * (JST 00:00〜09:00 に前日として表示されるのを防ぐ、#4015)。
 */
const deletionDateLabel = $derived.by(() => {
	const iso = status?.physicalDeletionDate;
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

let restoreSubmitting = $state(false);
let restoreError = $state('');

async function handleRestore() {
	if (restoreSubmitting) return;
	restoreSubmitting = true;
	restoreError = '';
	try {
		const res = await fetch(DELETION_GRACE_RESTORE_ENDPOINT, { method: 'POST' });
		const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
		if (!res.ok) {
			throw new Error(body.message ?? body.error ?? SETTINGS_LABELS.deletionGraceRestoreError);
		}
		if (onRestored) {
			onRestored();
		} else {
			location.reload();
		}
	} catch (err) {
		restoreError = err instanceof Error ? err.message : SETTINGS_LABELS.deletionGraceRestoreError;
	} finally {
		restoreSubmitting = false;
	}
}
</script>

{#if visible && status}
	<div
		data-testid={testid}
		class="bg-[var(--color-feedback-warning-bg)] border-2 border-[var(--color-feedback-warning-border)] rounded-xl p-6 {className}"
		role="status"
	>
		<h3 class="text-lg font-bold text-[var(--color-feedback-warning-text)] mb-2">
			{SETTINGS_LABELS.deletionGraceTitle}
		</h3>
		<p class="text-sm text-[var(--color-feedback-warning-text)] mb-4">
			{SETTINGS_LABELS.deletionGraceDesc(status.daysRemaining, deletionDateLabel)}
		</p>
		{#if restoreError}
			<ErrorAlert message={restoreError} severity="error" action="retry" />
		{/if}
		<Button
			type="button"
			variant="success"
			size="md"
			disabled={restoreSubmitting}
			onclick={handleRestore}
			data-testid="{testid}-restore-button"
		>
			{restoreSubmitting
				? SETTINGS_LABELS.deletionGraceRestoreSubmitting
				: SETTINGS_LABELS.deletionGraceRestoreAction}
		</Button>
	</div>
{/if}
