<script lang="ts" module>
	interface ToastItem {
		id: number;
		title: string;
		description?: string;
		type: 'success' | 'error' | 'info';
	}

	let toasts = $state<ToastItem[]>([]);
	let nextId = 0;

	export function showToast(
		title: string,
		description?: string,
		type: 'success' | 'error' | 'info' = 'success',
	) {
		const id = nextId++;
		toasts.push({ id, title, description, type });
		setTimeout(() => {
			toasts = toasts.filter((t) => t.id !== id);
		}, 3000);
	}
</script>

<script lang="ts">
	function dismiss(id: number) {
		toasts = toasts.filter((t) => t.id !== id);
	}
</script>

{#if toasts.length > 0}
	<div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-80">
		{#each toasts as toast (toast.id)}
			<div
				class="bg-white shadow-lg rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] flex items-center gap-[var(--spacing-sm)] border-l-4 animate-bounce-in
					{toast.type === 'success' ? 'border-l-[var(--color-success)]' : ''}
					{toast.type === 'error' ? 'border-l-[var(--color-danger)]' : ''}
					{toast.type === 'info' ? 'border-l-[var(--theme-primary)]' : ''}"
				role="alert"
			>
				<div class="flex-1">
					<p class="font-bold text-sm">{toast.title}</p>
					{#if toast.description}
						<p class="text-xs text-[var(--color-text-muted)]">{toast.description}</p>
					{/if}
				</div>
				<button
					class="tap-target w-8 h-8 flex items-center justify-center rounded-[var(--radius-full)] text-[var(--color-text-muted)] hover:bg-black/5"
					aria-label="とじる"
					onclick={() => dismiss(toast.id)}
				>
					✕
				</button>
			</div>
		{/each}
	</div>
{/if}
