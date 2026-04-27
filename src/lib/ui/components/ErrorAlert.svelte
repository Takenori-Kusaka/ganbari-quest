<script lang="ts">
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';

type Severity = 'info' | 'warning' | 'error';
type Action = 'retry' | 'fix_input' | 'contact_admin' | 'none';

interface Props {
	message: string;
	severity?: Severity;
	action?: Action;
	onretry?: () => void;
}

let { message, severity = 'error', action = 'none', onretry }: Props = $props();

const styleMap: Record<Severity, string> = {
	info: 'bg-[var(--color-feedback-info-bg)] border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)]',
	warning:
		'bg-[var(--color-feedback-warning-bg)] border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)]',
	error:
		'bg-[var(--color-feedback-error-bg)] border-[var(--color-feedback-error-border)] text-[var(--color-feedback-error-text)]',
};

const iconMap: Record<Severity, string> = {
	info: 'ℹ️',
	warning: '⚠️',
	error: '❌',
};

const actionText: Record<Exclude<Action, 'none'>, string> = {
	retry: UI_COMPONENTS_LABELS.errorAlertRetry,
	fix_input: UI_COMPONENTS_LABELS.errorAlertFixInput,
	contact_admin: UI_COMPONENTS_LABELS.errorAlertContactAdmin,
};
</script>

<div class="border rounded-lg p-3 mb-4 text-sm {styleMap[severity]}" role="alert">
	<div class="flex items-start gap-2">
		<span class="flex-shrink-0">{iconMap[severity]}</span>
		<div class="flex-1">
			<p class="font-medium">{message}</p>
			{#if action !== 'none' && actionText[action] && !onretry}
				<p class="mt-1 opacity-75 text-xs">{actionText[action]}</p>
			{/if}
		</div>
		{#if action === 'retry' && onretry}
			<button
				type="button"
				onclick={onretry}
				class="flex-shrink-0 px-3 py-1 text-xs font-bold rounded-md bg-white border border-current opacity-80 hover:opacity-100 transition-opacity"
			>
				{UI_COMPONENTS_LABELS.errorAlertRetryBtn}
			</button>
		{/if}
	</div>
</div>
