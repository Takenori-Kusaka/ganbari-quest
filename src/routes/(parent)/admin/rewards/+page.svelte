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
let selectedTemplate = $state<{
	title: string;
	points: number;
	icon: string;
	category: string;
} | null>(null);
let customTitle = $state('');
let customPoints = $state(100);
let customIcon = $state('🎁');
let customCategory = $state('とくべつ');
let grantSuccess = $state(false);

function selectTemplate(tmpl: { title: string; points: number; icon?: string; category: string }) {
	selectedTemplate = { ...tmpl, icon: tmpl.icon ?? '🎁' };
	customTitle = tmpl.title;
	customPoints = tmpl.points;
	customIcon = tmpl.icon ?? '🎁';
	customCategory = tmpl.category;
}

const categoryLabels: Record<string, string> = {
	うんどう: 'うんどう',
	べんきょう: 'べんきょう',
	せいかつ: 'せいかつ',
	こうりゅう: 'こうりゅう',
	そうぞう: 'そうぞう',
	とくべつ: 'とくべつ',
};
</script>

<svelte:head>
	<title>特別報酬 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-lg font-bold text-gray-700">特別報酬を付与</h2>

	<!-- Step 1: Select child -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">1. こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<button
					class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors
						{selectedChildId === child.id ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 shadow-sm hover:shadow-md'}"
					onclick={() => selectedChildId = child.id}
				>
					👤 {child.nickname}
				</button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Select template or custom -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">2. テンプレートを選択（またはカスタム）</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each data.templates as tmpl}
				<button
					class="bg-white rounded-xl p-3 shadow-sm text-center hover:shadow-md transition-shadow
						{selectedTemplate?.title === tmpl.title ? 'ring-2 ring-blue-400' : ''}"
					onclick={() => selectTemplate(tmpl)}
				>
					<span class="text-2xl block">{tmpl.icon ?? '🎁'}</span>
					<p class="text-xs font-bold text-gray-600 mt-1">{tmpl.title}</p>
					<p class="text-xs text-amber-500 font-bold">{tmpl.points}P</p>
				</button>
			{/each}
		</div>
	</section>

	<!-- Step 3: Confirm & submit -->
	<form
		method="POST"
		action="?/grant"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'success' && result.data && 'granted' in result.data) {
					grantSuccess = true;
					setTimeout(() => { grantSuccess = false; }, 3000);
				}
				await update();
			};
		}}
		class="bg-white rounded-xl p-4 shadow-sm space-y-3"
	>
		<h3 class="text-sm font-bold text-gray-500">3. 内容を確認して付与</h3>
		<input type="hidden" name="childId" value={selectedChildId} />

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">タイトル</span>
				<input type="text" name="title" bind:value={customTitle} required class="w-full px-3 py-2 border rounded-lg text-sm" />
			</label>
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">ポイント</span>
				<input type="number" name="points" bind:value={customPoints} min="1" max="10000" required class="w-full px-3 py-2 border rounded-lg text-sm" />
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">アイコン</span>
				<input type="text" name="icon" bind:value={customIcon} class="w-full px-3 py-2 border rounded-lg text-sm" />
			</label>
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">カテゴリ</span>
				<select name="category" bind:value={customCategory} class="w-full px-3 py-2 border rounded-lg text-sm">
					{#each Object.entries(categoryLabels) as [value, label]}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>
		</div>

		<button
			type="submit"
			class="w-full py-3 bg-purple-500 text-white rounded-xl font-bold hover:bg-purple-600 transition-colors"
		>
			{customIcon} {customTitle || '報酬'} ({customPoints}P) を付与する
		</button>
	</form>

	<!-- Success Message -->
	{#if grantSuccess}
		<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center">
			<p class="text-green-700 font-bold">特別報酬を付与しました！</p>
		</div>
	{/if}
</div>
