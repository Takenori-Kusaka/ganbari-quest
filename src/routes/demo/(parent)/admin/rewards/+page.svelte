<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';

let { data } = $props();

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

let selectedTemplate = $state<string | null>(null);
</script>

<svelte:head>
	<title>特別報酬 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- Step 1: Select child -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">1. こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<button
					class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors
						{selectedChildId === child.id
						? 'bg-blue-500 text-white'
						: 'bg-white text-gray-600 shadow-sm hover:shadow-md'}"
					onclick={() => (selectedChildId = child.id)}
				>
					👤 {child.nickname}
				</button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Select template -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">2. テンプレートを選択（またはカスタム）</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each data.templates as tmpl}
				<button
					class="bg-white rounded-xl p-3 shadow-sm text-center hover:shadow-md transition-shadow
						{selectedTemplate === tmpl.title ? 'ring-2 ring-blue-400' : ''}"
					onclick={() => (selectedTemplate = tmpl.title)}
				>
					<span class="text-2xl block">{tmpl.icon}</span>
					<p class="text-xs font-bold text-gray-600 mt-1">{tmpl.title}</p>
					<p class="text-xs text-amber-500 font-bold">{tmpl.points}P</p>
				</button>
			{/each}
		</div>
	</section>

	<!-- Step 3: Confirm -->
	<div class="bg-white rounded-xl p-4 shadow-sm space-y-3">
		<h3 class="text-sm font-bold text-gray-500">3. 内容を確認して付与</h3>

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">タイトル</span>
				<input
					type="text"
					disabled
					value={selectedTemplate ?? ''}
					placeholder="テンプレートを選択"
					class="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
				/>
			</label>
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">ポイント</span>
				<input
					type="number"
					disabled
					value={100}
					class="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
				/>
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">アイコン</span>
				<input
					type="text"
					disabled
					value="🎁"
					class="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
				/>
			</label>
			<label class="block">
				<span class="block text-xs font-bold text-gray-500 mb-1">カテゴリ</span>
				<select
					disabled
					class="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
				>
					<option>とくべつ</option>
				</select>
			</label>
		</div>

		<button
			disabled
			class="w-full py-3 bg-gray-200 text-gray-400 rounded-xl font-bold cursor-not-allowed"
		>
			デモでは報酬を付与できません
		</button>
	</div>

	<DemoCta
		title="特別報酬で子どもをもっと応援しませんか？"
		description="登録すると、テンプレートやカスタム報酬を自由に付与できます。"
	/>
</div>
