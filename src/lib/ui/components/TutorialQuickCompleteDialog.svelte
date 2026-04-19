<script lang="ts">
import { TUTORIAL_LABELS } from '$lib/domain/labels';
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
}

let { showResume, showQuickComplete, showExitConfirm, onConfirmExit, onCancelExit }: Props =
	$props();

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
	title={TUTORIAL_LABELS.resumeTitle}
	closable={false}
	size="sm"
	testid="tutorial-resume-dialog"
>
	<div class="dialog-body">
		<p>{TUTORIAL_LABELS.resumePrompt}</p>
	</div>
	<div class="dialog-actions">
		<Button variant="secondary" size="sm" onclick={dismissResumePrompt}>
			{TUTORIAL_LABELS.resumeCancel}
		</Button>
		<Button variant="secondary" size="sm" onclick={() => startFromBeginning()}>
			{TUTORIAL_LABELS.resumeFromStart}
		</Button>
		<Button variant="primary" size="sm" onclick={() => resumeTutorial()}>
			{TUTORIAL_LABELS.resumeContinue}
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
	ariaLabel={TUTORIAL_LABELS.exitConfirmAriaLabel}
	closable={true}
	size="sm"
	testid="tutorial-exit-confirm-dialog"
>
	<div class="dialog-body">
		<p>{TUTORIAL_LABELS.exitConfirmPrompt}</p>
		<p class="dialog-hint">{TUTORIAL_LABELS.exitConfirmHint}</p>
	</div>
	<div class="dialog-actions">
		<Button variant="secondary" size="sm" onclick={onCancelExit}>
			{TUTORIAL_LABELS.exitConfirmCancel}
		</Button>
		<Button variant="danger" size="sm" onclick={onConfirmExit}>
			{TUTORIAL_LABELS.exitConfirmConfirm}
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
