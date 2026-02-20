<script lang="ts">
	interface Props {
		onInput: (digit: string) => void;
		onDelete: () => void;
		onSubmit: () => void;
		disabled?: boolean;
	}

	let { onInput, onDelete, onSubmit, disabled = false }: Props = $props();

	const keys = [
		['1', '2', '3'],
		['4', '5', '6'],
		['7', '8', '9'],
		['←', '0', 'OK'],
	];

	function handleKey(key: string) {
		if (disabled) return;
		if (key === '←') {
			onDelete();
		} else if (key === 'OK') {
			onSubmit();
		} else {
			onInput(key);
		}
	}
</script>

<div class="grid grid-cols-3 gap-[var(--spacing-sm)] max-w-xs mx-auto" role="group" aria-label="すうじパッド">
	{#each keys as row}
		{#each row as key}
			<button
				class="tap-target w-16 h-16 rounded-[var(--radius-md)] text-xl font-bold
					flex items-center justify-center transition-colors
					{key === 'OK'
						? 'bg-[var(--theme-primary)] text-white'
						: key === '←'
							? 'bg-gray-200 text-[var(--color-text)]'
							: 'bg-white border-2 border-gray-200 text-[var(--color-text)]'}
					{disabled ? 'opacity-50 pointer-events-none' : 'hover:brightness-95'}"
				{disabled}
				aria-label={key === '←' ? 'けす' : key === 'OK' ? 'けってい' : key}
				onclick={() => handleKey(key)}
			>
				{key}
			</button>
		{/each}
	{/each}
</div>
