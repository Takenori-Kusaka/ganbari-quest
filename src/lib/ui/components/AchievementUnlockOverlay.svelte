<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Achievement {
	name: string;
	icon: string;
	bonusPoints: number;
	rarity: string;
}

interface Props {
	open: boolean;
	achievements: Achievement[];
	onClose?: () => void;
}

let { open = $bindable(), achievements, onClose }: Props = $props();

let currentIndex = $state(0);

const current = $derived(achievements[currentIndex] ?? null);
const isLast = $derived(currentIndex >= achievements.length - 1);

const rarityStyles: Record<string, { border: string; bg: string; glow: string }> = {
	common: {
		border: 'border-green-400',
		bg: 'bg-gradient-to-b from-green-50 to-green-100',
		glow: '',
	},
	rare: {
		border: 'border-blue-400',
		bg: 'bg-gradient-to-b from-blue-50 to-blue-100',
		glow: '',
	},
	epic: {
		border: 'border-purple-400',
		bg: 'bg-gradient-to-b from-purple-50 to-purple-200',
		glow: 'shadow-purple-300/50 shadow-lg',
	},
	legendary: {
		border: 'border-yellow-400',
		bg: 'bg-gradient-to-b from-yellow-50 to-amber-200',
		glow: 'shadow-amber-300/50 shadow-lg',
	},
};

const defaultStyle = {
	border: 'border-green-400',
	bg: 'bg-gradient-to-b from-green-50 to-green-100',
	glow: '',
};

function getStyle(rarity: string) {
	return rarityStyles[rarity] ?? defaultStyle;
}

$effect(() => {
	if (open) {
		currentIndex = 0;
		soundService.play('achievement-unlock');
	}
});

function handleNext() {
	if (isLast) {
		open = false;
		onClose?.();
	} else {
		currentIndex++;
		soundService.play('achievement-unlock');
	}
}
</script>

<Dialog bind:open closable={false} title="">
	{#if current}
		{@const style = getStyle(current.rarity)}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center py-[var(--spacing-md)]">
			<p class="text-lg font-bold text-[var(--theme-accent)]">🎉 じっせきかいほう！</p>

			<div
				class="w-32 h-32 rounded-[var(--radius-lg)] border-4 {style.border} {style.bg} {style.glow}
					flex items-center justify-center animate-bounce-in"
			>
				<span class="text-5xl">{current.icon}</span>
			</div>

			<p class="text-xl font-bold">{current.name}</p>

			<div class="animate-point-pop">
				<p class="text-2xl font-bold text-[var(--color-point)]">+{current.bonusPoints} ポイント！</p>
			</div>

			{#if achievements.length > 1}
				<p class="text-sm text-[var(--color-text-muted)]">
					{currentIndex + 1} / {achievements.length}
				</p>
			{/if}

			<button
				class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg mt-[var(--spacing-sm)]"
				onclick={handleNext}
			>
				{isLast ? 'やったね！' : 'つぎへ'}
			</button>
		</div>
	{/if}
</Dialog>
