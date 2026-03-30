<script lang="ts">
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

function uiModeLabel(mode: string): string {
	switch (mode) {
		case 'baby':
			return 'ベビー';
		case 'kinder':
			return 'キンダー';
		case 'lower':
			return '小学生';
		case 'teen':
			return 'ティーン';
		default:
			return mode;
	}
}
</script>

<svelte:head>
	<title>こども管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-bold text-gray-700">こども管理</h1>
		<span class="text-xs text-gray-400">{data.children.length}人</span>
	</div>

	<!-- Demo Notice -->
	<div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
		<span class="text-amber-500">&#x26A0;&#xFE0F;</span>
		<p class="text-sm text-amber-700">デモモードのため、変更はできません</p>
	</div>

	<!-- Children List -->
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
					<div class="flex-1 min-w-0">
						<p class="font-bold text-gray-700">{child.nickname}</p>
						<p class="text-sm text-gray-400">{child.age}歳</p>
					</div>
					<div class="text-right">
						<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance)}</p>
					</div>
				</div>

				<!-- Detail Cards -->
				<div class="grid grid-cols-3 gap-2 mt-3">
					<div class="bg-blue-50 rounded-lg p-2 text-center">
						<p class="text-xs text-gray-500">年齢</p>
						<p class="text-sm font-bold text-blue-600">{child.age}歳</p>
					</div>
					<div class="bg-purple-50 rounded-lg p-2 text-center">
						<p class="text-xs text-gray-500">UIモード</p>
						<p class="text-sm font-bold text-purple-600">{uiModeLabel(child.uiMode ?? 'kinder')}</p>
					</div>
					<div class="bg-amber-50 rounded-lg p-2 text-center">
						<p class="text-xs text-gray-500">{unit}残高</p>
						<p class="text-sm font-bold text-amber-600">{fmtBal(child.balance)}</p>
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- Demo CTA -->
	<div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 rounded-xl p-4 text-center">
		<p class="text-sm font-bold text-gray-700 mb-1">お子さまを登録しませんか？</p>
		<p class="text-xs text-gray-500 mb-3">
			登録すると、お子さまの成長をリアルタイムで見守れます。
		</p>
		<a
			href="/demo/signup"
			class="inline-block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-sm"
		>
			無料で はじめる &rarr;
		</a>
	</div>
</div>
