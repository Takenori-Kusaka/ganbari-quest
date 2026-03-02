<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});
let amount = $state(500);
let convertResult = $state<{
	converted: boolean;
	message: string;
	convertedAmount: number;
	remainingBalance: number;
} | null>(null);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));
const maxConvertable = $derived(selectedChild?.balance?.convertableAmount ?? 0);
</script>

<svelte:head>
	<title>ポイント変換 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-lg font-bold text-gray-700">ポイント変換</h2>

	<!-- Balance Overview -->
	<div class="grid gap-3">
		{#each data.children as child}
			{#if child.balance}
				<div
					class="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 cursor-pointer transition-shadow
						{selectedChildId === child.id ? 'ring-2 ring-blue-400' : 'hover:shadow-md'}"
					role="button"
					tabindex="0"
					onclick={() => selectedChildId = child.id}
					onkeydown={(e) => { if (e.key === 'Enter') selectedChildId = child.id; }}
				>
					<span class="text-2xl">👤</span>
					<div class="flex-1">
						<p class="font-bold text-gray-700">{child.nickname}</p>
					</div>
					<div class="text-right">
						<p class="text-lg font-bold text-amber-500">{child.balance.balance.toLocaleString()}P</p>
						<p class="text-xs text-gray-400">変換可能: {child.balance.convertableAmount.toLocaleString()}P</p>
					</div>
				</div>
			{/if}
		{/each}
	</div>

	<!-- Convert Form -->
	{#if selectedChild && maxConvertable > 0}
		<form
			method="POST"
			action="?/convert"
			use:enhance={() => {
				return async ({ result, update }) => {
					if (result.type === 'success' && result.data && 'converted' in result.data) {
						convertResult = result.data as typeof convertResult;
					}
					await update();
				};
			}}
			class="bg-white rounded-xl p-6 shadow-sm space-y-4"
		>
			<h3 class="font-bold text-gray-700">{selectedChild.nickname}のポイントを変換</h3>
			<input type="hidden" name="childId" value={selectedChildId} />

			<div>
				<span class="block text-sm font-bold text-gray-500 mb-2">変換ポイント数（500P単位）</span>
				<div class="flex gap-2 flex-wrap">
					{#each [500, 1000, 1500, 2000] as opt}
						{#if opt <= maxConvertable}
							<button
								type="button"
								class="px-4 py-2 rounded-lg text-sm font-bold transition-colors
									{amount === opt ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
								onclick={() => amount = opt}
							>
								{opt.toLocaleString()}P
							</button>
						{/if}
					{/each}
				</div>
				<input type="hidden" name="amount" value={amount} />
			</div>

			<button
				type="submit"
				class="w-full py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-colors"
			>
				{amount.toLocaleString()}P を変換する
			</button>
		</form>
	{:else if selectedChild}
		<div class="bg-white rounded-xl p-6 shadow-sm text-center text-gray-400">
			<p>変換可能なポイントがありません（500P以上必要）</p>
		</div>
	{/if}

	<!-- Result -->
	{#if convertResult}
		<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center">
			<p class="text-green-700 font-bold">{convertResult.message}</p>
			<p class="text-sm text-green-600 mt-1">残高: {convertResult.remainingBalance.toLocaleString()}P</p>
		</div>
	{/if}
</div>
