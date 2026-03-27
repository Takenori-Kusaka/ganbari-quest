<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface HealthCheckItem {
	key: string;
	label: string;
	icon: string;
}

interface Props {
	open: boolean;
	childAge: number;
	healthCheckItems: HealthCheckItem[];
	onSubmit: (data: {
		healthChecks: Record<string, boolean>;
		aspirationText: string;
	}) => void;
	onClose?: () => void;
}

let { open = $bindable(), childAge, healthCheckItems, onSubmit, onClose }: Props = $props();

let step = $state<'intro' | 'health' | 'aspiration' | 'confirm'>('intro');
let healthChecks = $state<Record<string, boolean>>({});
let aspirationText = $state('');

// Reset state when overlay opens
$effect(() => {
	if (open) {
		step = 'intro';
		healthChecks = {};
		aspirationText = '';
	}
});

function toggleCheck(key: string) {
	healthChecks = { ...healthChecks, [key]: !healthChecks[key] };
}

function handleSubmit() {
	onSubmit({ healthChecks, aspirationText });
}

const checkedCount = $derived(Object.values(healthChecks).filter(Boolean).length);
</script>

<Dialog bind:open closable={false} title="">
	<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center py-[var(--spacing-sm)]">
		{#if step === 'intro'}
			<!-- Birthday greeting -->
			<div class="text-6xl animate-bounce-in">🎂</div>
			<h2 class="text-xl font-bold">
				おたんじょうび<br />おめでとう！
			</h2>
			<p class="text-lg text-[var(--color-point)] font-bold">
				{childAge}さいになったね！
			</p>
			<p class="text-sm text-[var(--color-text-muted)]">
				いっしょにふりかえりをしよう
			</p>
			<button
				class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg mt-[var(--spacing-sm)]"
				onclick={() => { soundService.play('tap'); step = 'health'; }}
			>
				はじめる！
			</button>

		{:else if step === 'health'}
			<!-- Health check -->
			<h2 class="text-lg font-bold">🩺 けんこうチェック</h2>
			<p class="text-sm text-[var(--color-text-muted)]">
				このいちねん、できたことにタップしよう！
			</p>

			<div class="flex flex-col gap-[var(--spacing-xs)] w-full">
				{#each healthCheckItems as item (item.key)}
					<button
						class="flex items-center gap-[var(--spacing-sm)] w-full px-3 py-3 rounded-[var(--radius-md)] text-left transition-all tap-target
							{healthChecks[item.key] ? 'bg-green-100 border-2 border-green-400' : 'bg-gray-50 border-2 border-transparent'}"
						onclick={() => toggleCheck(item.key)}
					>
						<span class="text-2xl">{item.icon}</span>
						<span class="flex-1 font-bold text-sm">{item.label}</span>
						{#if healthChecks[item.key]}
							<span class="text-xl">✅</span>
						{/if}
					</button>
				{/each}
			</div>

			{#if checkedCount === healthCheckItems.length}
				<p class="text-sm font-bold text-[var(--theme-accent)] animate-bounce-in">
					パーフェクト！ +100ボーナス！
				</p>
			{/if}

			<div class="flex gap-[var(--spacing-sm)] w-full mt-[var(--spacing-xs)]">
				<button
					class="tap-target flex-1 py-3 rounded-[var(--radius-md)] bg-gray-200 font-bold"
					onclick={() => { soundService.play('tap'); step = 'intro'; }}
				>
					もどる
				</button>
				<button
					class="tap-target flex-1 py-3 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold"
					onclick={() => { soundService.play('tap'); step = 'aspiration'; }}
				>
					つぎへ
				</button>
			</div>

		{:else if step === 'aspiration'}
			<!-- Aspiration -->
			<h2 class="text-lg font-bold">🌟 ことしのもくひょう</h2>
			<p class="text-sm text-[var(--color-text-muted)]">
				ことしがんばりたいことをかいてみよう！<br />
				（かかなくてもOK）
			</p>

			<textarea
				class="w-full h-24 p-3 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] text-base resize-none"
				placeholder="れい：およげるようになりたい！"
				bind:value={aspirationText}
			></textarea>

			<div class="flex gap-[var(--spacing-sm)] w-full mt-[var(--spacing-xs)]">
				<button
					class="tap-target flex-1 py-3 rounded-[var(--radius-md)] bg-gray-200 font-bold"
					onclick={() => { soundService.play('tap'); step = 'health'; }}
				>
					もどる
				</button>
				<button
					class="tap-target flex-1 py-3 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold"
					onclick={() => { soundService.play('tap'); step = 'confirm'; }}
				>
					かくにん
				</button>
			</div>

		{:else if step === 'confirm'}
			<!-- Confirm & submit -->
			<h2 class="text-lg font-bold">📋 ふりかえりかくにん</h2>

			<div class="w-full text-left bg-[var(--theme-bg)] rounded-[var(--radius-md)] p-3">
				<p class="text-sm font-bold mb-1">🩺 けんこう: {checkedCount}/{healthCheckItems.length}</p>
				{#each healthCheckItems as item (item.key)}
					{#if healthChecks[item.key]}
						<p class="text-xs pl-2">{item.icon} {item.label}</p>
					{/if}
				{/each}

				{#if aspirationText.trim()}
					<p class="text-sm font-bold mt-2 mb-1">🌟 もくひょう:</p>
					<p class="text-xs pl-2">{aspirationText}</p>
				{/if}
			</div>

			<div class="flex gap-[var(--spacing-sm)] w-full mt-[var(--spacing-xs)]">
				<button
					class="tap-target flex-1 py-3 rounded-[var(--radius-md)] bg-gray-200 font-bold"
					onclick={() => { soundService.play('tap'); step = 'aspiration'; }}
				>
					もどる
				</button>
				<button
					class="tap-target flex-1 py-3 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold"
					onclick={handleSubmit}
				>
					おくる！
				</button>
			</div>
		{/if}
	</div>
</Dialog>
