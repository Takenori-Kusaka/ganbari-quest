<script lang="ts">
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
	info: 'bg-blue-50 border-blue-200 text-blue-700',
	warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
	error: 'bg-red-50 border-red-200 text-red-700',
};

const iconMap: Record<Severity, string> = {
	info: 'ℹ️',
	warning: '⚠️',
	error: '❌',
};

const actionText: Record<Exclude<Action, 'none'>, string> = {
	retry: 'しばらくしてからもう一度お試しください。',
	fix_input: '入力内容をご確認ください。',
	contact_admin: '管理者にお問い合わせください。',
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
				もう一度試す
			</button>
		{/if}
	</div>
</div>
