<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	open: boolean;
	subscriptionMonths: number;
	lostItems: string[];
	childName?: string;
	childActivityCount?: number;
	onKeep: () => void;
	onCancel: () => void;
}

let {
	open = $bindable(),
	subscriptionMonths,
	lostItems,
	childName,
	childActivityCount,
	onKeep,
	onCancel,
}: Props = $props();
</script>

<Dialog bind:open title="解約する前に...">
	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<span class="text-2xl">🎖️</span>
			<p class="font-bold">あなたは {subscriptionMonths}ヶ月 継続中です</p>
		</div>

		{#if lostItems.length > 0}
			<div class="rounded-lg bg-red-50 p-3">
				<p class="text-sm font-bold text-red-800 mb-2">解約すると失われるもの:</p>
				<ul class="space-y-1">
					{#each lostItems as item}
						<li class="text-xs text-red-700 flex items-start gap-1">
							<span class="text-red-400">・</span>
							{item}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if childName && childActivityCount}
			<div class="rounded-lg bg-blue-50 p-3">
				<p class="text-sm text-blue-800">
					💡 {childName}は 今月 <strong>{childActivityCount}回</strong> がんばりました
				</p>
			</div>
		{/if}

		<p class="text-xs text-gray-500">
			※ 解約しても基本データは残ります。再開すれば継続月数も引き継がれます。
		</p>

		<div class="flex gap-2">
			<Button variant="primary" size="sm" class="flex-1" onclick={onKeep}>
				やっぱり続ける
			</Button>
			<Button variant="ghost" size="sm" class="flex-1" onclick={onCancel}>
				解約手続きへ
			</Button>
		</div>
	</div>
</Dialog>
