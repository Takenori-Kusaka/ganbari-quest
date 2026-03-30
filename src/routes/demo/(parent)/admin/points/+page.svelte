<script lang="ts">
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

const totalBalance = $derived(
	data.children.reduce((sum: number, c: { balance: number }) => sum + c.balance, 0),
);
const maxBalance = $derived(
	Math.max(...data.children.map((c: { balance: number }) => c.balance), 1),
);
</script>

<svelte:head>
	<title>ポイント管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-bold text-gray-700">ポイント管理</h1>
	</div>

	<!-- Demo Notice -->
	<div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
		<span class="text-amber-500">&#x26A0;&#xFE0F;</span>
		<p class="text-sm text-amber-700">デモモードのため、変更はできません</p>
	</div>

	<!-- Total Summary -->
	<div class="bg-white rounded-xl p-4 shadow-sm text-center">
		<p class="text-xs text-gray-500 mb-1">全こども合計{unit}</p>
		<p class="text-3xl font-bold text-amber-500">{fmtBal(totalBalance)}</p>
	</div>

	<!-- Per-child point cards -->
	<div class="grid gap-3">
		{#each data.children as child (child.id)}
			<div class="bg-white rounded-xl p-4 shadow-sm">
				<div class="flex items-center gap-4">
					<span class="text-3xl">
						{#if child.uiMode === 'baby'}
							&#x1F476;
						{:else if child.uiMode === 'kinder'}
							&#x1F9D2;
						{:else if child.uiMode === 'lower'}
							&#x1F9D1;
						{:else}
							&#x1F9D1;&#x200D;&#x1F4BB;
						{/if}
					</span>
					<div class="flex-1">
						<p class="font-bold text-gray-700">{child.nickname}</p>
						<p class="text-sm text-gray-400">{child.age}歳</p>
					</div>
					<div class="text-right">
						<p class="text-2xl font-bold text-amber-500">{fmtBal(child.balance)}</p>
						<p class="text-xs text-gray-400">現在の{unit}残高</p>
					</div>
				</div>

				<!-- Point bar visualization -->
				<div class="mt-3">
					<div class="w-full bg-gray-100 rounded-full h-2.5">
						<div
							class="bg-gradient-to-r from-amber-400 to-orange-400 h-2.5 rounded-full transition-all"
							style="width: {Math.round((child.balance / maxBalance) * 100)}%;"
						></div>
					</div>
				</div>

				<!-- Quick info -->
				<div class="mt-3 flex gap-3 text-xs text-gray-400">
					<span>&#x1F4B1; ポイント変換: デモでは利用不可</span>
				</div>
			</div>
		{/each}
	</div>

	<!-- Explanation Section -->
	<div class="bg-white rounded-xl p-4 shadow-sm">
		<h2 class="text-sm font-bold text-gray-700 mb-2">&#x2139;&#xFE0F; ポイント変換について</h2>
		<ul class="text-xs text-gray-500 space-y-1.5">
			<li>&#x2022; お子さまが活動で貯めたポイントを、おこづかいに変換できます</li>
			<li>&#x2022; 変換レートは設定画面で自由にカスタマイズ可能です</li>
			<li>&#x2022; 変換履歴も記録されるので、安心して管理できます</li>
		</ul>
	</div>

	<!-- Demo CTA -->
	<div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 rounded-xl p-4 text-center">
		<p class="text-sm font-bold text-gray-700 mb-1">ポイントをおこづかいに変換しませんか？</p>
		<p class="text-xs text-gray-500 mb-3">
			登録すると、ポイント変換やレート設定が自由にできます。
		</p>
		<a
			href="/demo/signup"
			class="inline-block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-sm"
		>
			無料で はじめる &rarr;
		</a>
	</div>
</div>
