<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	open: boolean;
	childAge: number;
	basePoints: number;
	healthPoints: number;
	aspirationPoints: number;
	totalPoints: number;
	onClose?: () => void;
}

let {
	open = $bindable(),
	childAge,
	basePoints,
	healthPoints,
	aspirationPoints,
	totalPoints,
	onClose,
}: Props = $props();

let revealed = $state(false);

$effect(() => {
	if (open) {
		revealed = false;
		const timer = setTimeout(() => {
			revealed = true;
		}, 1000);
		return () => clearTimeout(timer);
	}
});
</script>

<Dialog bind:open closable={false} title="">
	<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center py-[var(--spacing-md)]">
		{#if !revealed}
			<div class="text-6xl animate-spin-in">🎁</div>
			<p class="text-lg font-bold">プレゼントをあけるよ...</p>
		{:else}
			<div class="text-6xl animate-bounce-in">🎉</div>
			<h2 class="text-xl font-bold">{childAge}さいおめでとう！</h2>

			<div class="w-full bg-[var(--theme-bg)] rounded-[var(--radius-md)] p-3 text-left">
				<div class="flex justify-between text-sm mb-1">
					<span>🎂 おたんじょうびポイント</span>
					<span class="font-bold">+{basePoints}P</span>
				</div>
				{#if healthPoints > 0}
					<div class="flex justify-between text-sm mb-1">
						<span>🩺 けんこうボーナス</span>
						<span class="font-bold text-green-600">+{healthPoints}P</span>
					</div>
				{/if}
				{#if aspirationPoints > 0}
					<div class="flex justify-between text-sm mb-1">
						<span>🌟 もくひょうボーナス</span>
						<span class="font-bold text-purple-600">+{aspirationPoints}P</span>
					</div>
				{/if}
				<hr class="my-2 border-[var(--color-border)]" />
				<div class="flex justify-between text-base font-bold">
					<span>ごうけい</span>
					<span class="text-[var(--color-point)]">+{totalPoints}P</span>
				</div>
			</div>

			<div class="animate-point-pop">
				<p class="text-2xl font-bold text-[var(--color-point)]">+{totalPoints} ポイント！</p>
			</div>

			<button
				class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg mt-[var(--spacing-sm)]"
				onclick={() => { open = false; onClose?.(); }}
			>
				やったね！
			</button>
		{/if}
	</div>
</Dialog>
