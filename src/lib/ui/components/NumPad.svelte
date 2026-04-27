<script lang="ts">
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import { playSound } from '$lib/ui/sound/play-sound';

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

<div
	class="numpad-grid mx-auto"
	role="group"
	aria-label={UI_COMPONENTS_LABELS.numPadAriaLabel}
>
	{#each keys as row}
		{#each row as key}
			<button
				type="button"
				use:playSound={'tap'}
				class="tap-target numpad-btn
					{key === 'OK'
						? 'numpad-btn--ok'
						: key === '←'
							? 'numpad-btn--delete'
							: 'numpad-btn--digit'}
					{disabled ? 'opacity-50 pointer-events-none' : ''}"
				{disabled}
				aria-label={key === '←' ? UI_COMPONENTS_LABELS.numPadDeleteAriaLabel : key === 'OK' ? UI_COMPONENTS_LABELS.numPadOkAriaLabel : key}
				onclick={() => handleKey(key)}
			>
				{key}
			</button>
		{/each}
	{/each}
</div>

<style>
	.numpad-grid {
		display: grid;
		grid-template-columns: repeat(3, 64px);
		gap: 8px;
		justify-content: center;
	}

	.numpad-btn {
		width: 64px;
		height: 64px;
		border-radius: 16px;
		font-size: 1.25rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: filter 0.15s ease;
		cursor: pointer;
		border: none;
	}

	.numpad-btn:not(:disabled):hover {
		filter: brightness(0.95);
	}

	.numpad-btn--digit {
		background: white;
		border: 2px solid #e5e7eb;
		color: var(--color-text, #2d2d2d);
	}

	.numpad-btn--delete {
		background: #e5e7eb;
		color: var(--color-text, #2d2d2d);
	}

	.numpad-btn--ok {
		background: var(--theme-primary, #3878b8);
		color: white;
	}
</style>
