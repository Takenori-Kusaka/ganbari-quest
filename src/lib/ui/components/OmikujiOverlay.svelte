<script lang="ts">
	import Dialog from '$lib/ui/primitives/Dialog.svelte';

	interface Props {
		open: boolean;
		rank: string;
		basePoints: number;
		multiplier: number;
		totalPoints: number;
		consecutiveDays: number;
		onClose?: () => void;
	}

	let { open = $bindable(), rank, basePoints, multiplier, totalPoints, consecutiveDays, onClose }: Props =
		$props();

	let revealed = $state(false);

	const rankEffects: Record<string, { bg: string; particle: string }> = {
		大大吉: { bg: 'bg-gradient-to-b from-yellow-300 to-amber-500', particle: '✨🌟💫' },
		大吉: { bg: 'bg-gradient-to-b from-purple-300 to-pink-400', particle: '🌈✨' },
		中吉: { bg: 'bg-gradient-to-b from-blue-200 to-indigo-300', particle: '⭐' },
		小吉: { bg: 'bg-gradient-to-b from-green-200 to-teal-300', particle: '🍀' },
		吉: { bg: 'bg-gradient-to-b from-sky-100 to-blue-200', particle: '' },
		末吉: { bg: 'bg-gradient-to-b from-gray-100 to-gray-200', particle: '' },
	};

	const defaultEffect = { bg: 'bg-gradient-to-b from-sky-100 to-blue-200', particle: '' };
	const currentEffect = $derived(rankEffects[rank] ?? defaultEffect);

	$effect(() => {
		if (open) {
			revealed = false;
			const timer = setTimeout(() => {
				revealed = true;
			}, 1500);
			return () => clearTimeout(timer);
		}
	});

	function handleClose() {
		open = false;
		onClose?.();
	}
</script>

<Dialog bind:open closable={false} title="">
	<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center py-[var(--spacing-md)]">
		<h2 class="text-xl font-bold">🎋 きょうのうんせい 🎋</h2>

		{#if !revealed}
			<div class="w-32 h-40 rounded-[var(--radius-md)] bg-red-600 flex items-center justify-center animate-spin-in">
				<span class="text-4xl text-white font-bold">❓</span>
			</div>
		{:else}
			<div
				class="w-40 h-48 rounded-[var(--radius-md)] flex flex-col items-center justify-center gap-2 shadow-lg
					{currentEffect.bg} animate-bounce-in"
			>
				{#if currentEffect.particle}
					<span class="text-2xl">{currentEffect.particle}</span>
				{/if}
				<span class="text-3xl font-bold">{rank}</span>
				{#if currentEffect.particle}
					<span class="text-2xl">{currentEffect.particle}</span>
				{/if}
			</div>

			<div class="animate-point-pop">
				<p class="text-2xl font-bold text-[var(--color-point)]">+{totalPoints} ポイント！</p>
			</div>

			{#if consecutiveDays >= 2}
				<p class="text-sm font-bold">
					{consecutiveDays}にちれんぞくログイン！
					{#if multiplier > 1}
						<span class="text-[var(--theme-accent)]">× {multiplier}ばい → {totalPoints}P ゲット</span>
					{/if}
				</p>
			{/if}

			{#if consecutiveDays === 2}
				<p class="text-xs text-[var(--color-text-muted)]">あと1にちで ×1.5ばい！</p>
			{:else if consecutiveDays === 6}
				<p class="text-xs text-[var(--color-text-muted)]">あと1にちで ×2.0ばい！</p>
			{:else if consecutiveDays === 13}
				<p class="text-xs text-[var(--color-text-muted)]">あと1にちで ×2.5ばい！</p>
			{:else if consecutiveDays === 29}
				<p class="text-xs text-[var(--color-text-muted)]">あと1にちで ×3.0ばい！</p>
			{/if}

			<button
				class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg mt-[var(--spacing-sm)]"
				onclick={handleClose}
			>
				タップしてすすむ
			</button>
		{/if}
	</div>
</Dialog>
