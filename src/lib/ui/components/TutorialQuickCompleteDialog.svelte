<script lang="ts">
import { getChildTutorialLabels, TUTORIAL_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import {
	continueFullTutorial,
	dismissResumePrompt,
	finishQuickTutorial,
	resumeTutorial,
	startFromBeginning,
} from '$lib/ui/tutorial/tutorial-store.svelte';

interface Props {
	showResume: boolean;
	showQuickComplete: boolean;
	showExitConfirm: boolean;
	onConfirmExit: () => void;
	onCancelExit: () => void;
	/**
	 * 子供画面で表示するときの年齢モード (#4652)。指定時は再開 / 終了確認の文言を
	 * 子供向け年齢帯 variant にする (preschool / elementary はひらがな)。
	 * 親向け漢字文言を子供画面にそのまま出していた不具合の是正 (EPIC #4650 F9)。
	 */
	childUiMode?: string;
}

let {
	showResume,
	showQuickComplete,
	showExitConfirm,
	onConfirmExit,
	onCancelExit,
	childUiMode,
}: Props = $props();

// 子供画面では年齢帯 variant、親管理画面では従来の TUTORIAL_LABELS を使う。
const L = $derived(childUiMode ? getChildTutorialLabels(childUiMode).dialog : TUTORIAL_LABELS);

function handleResumeOpenChange(details: { open: boolean }) {
	if (!details.open) {
		dismissResumePrompt();
	}
}

function handleExitOpenChange(details: { open: boolean }) {
	if (!details.open) {
		onCancelExit();
	}
}
</script>

<!-- Resume prompt dialog -->
<Dialog
	open={showResume}
	onOpenChange={handleResumeOpenChange}
	title={L.resumeTitle}
	closable={false}
	size="sm"
	testid="tutorial-resume-dialog"
>
	<div class="dialog-body">
		<p>{L.resumePrompt}</p>
	</div>
	<div class="dialog-actions">
		<Button variant="secondary" size="sm" onclick={dismissResumePrompt}>
			{L.resumeCancel}
		</Button>
		<Button variant="secondary" size="sm" onclick={() => startFromBeginning()}>
			{L.resumeFromStart}
		</Button>
		<Button variant="primary" size="sm" onclick={() => resumeTutorial()}>
			{L.resumeContinue}
		</Button>
	</div>
</Dialog>

<!-- #955: Quick complete dialog — チャプター1終了後の選択画面 -->
<Dialog
	open={showQuickComplete}
	title={TUTORIAL_LABELS.quickCompleteTitle}
	closable={false}
	size="sm"
	testid="tutorial-quick-complete-dialog"
>
	<div class="dialog-body">
		<p>{TUTORIAL_LABELS.quickCompleteBody}</p>
		<p class="dialog-hint">{TUTORIAL_LABELS.quickCompleteHint}</p>
	</div>
	<div class="dialog-actions">
		<Button variant="secondary" size="sm" onclick={() => continueFullTutorial()}>
			{TUTORIAL_LABELS.quickContinue}
		</Button>
		<Button variant="primary" size="sm" onclick={() => finishQuickTutorial()}>
			{TUTORIAL_LABELS.quickFinish}
		</Button>
	</div>
</Dialog>

<!-- Exit confirmation dialog -->
<Dialog
	open={showExitConfirm}
	onOpenChange={handleExitOpenChange}
	ariaLabel={L.exitConfirmAriaLabel}
	closable={true}
	size="sm"
	testid="tutorial-exit-confirm-dialog"
>
	<div class="dialog-body">
		<p>{L.exitConfirmPrompt}</p>
		<p class="dialog-hint">{L.exitConfirmHint}</p>
	</div>
	<div class="dialog-actions">
		<Button variant="secondary" size="sm" onclick={onCancelExit}>
			{L.exitConfirmCancel}
		</Button>
		<Button variant="danger" size="sm" onclick={onConfirmExit}>
			{L.exitConfirmConfirm}
		</Button>
	</div>
</Dialog>

<style>
	.dialog-body p {
		margin: 0;
		color: var(--color-text-primary);
		line-height: 1.5;
	}

	.dialog-hint {
		margin-top: var(--sp-sm) !important;
		font-size: 0.875rem;
		color: var(--color-text-secondary) !important;
	}

	.dialog-actions {
		display: flex;
		gap: var(--sp-sm);
		justify-content: flex-end;
		margin-top: var(--sp-md);
		flex-wrap: wrap;
	}
</style>
