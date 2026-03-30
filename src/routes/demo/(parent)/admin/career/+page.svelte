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
</script>

<svelte:head>
	<title>キャリア - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- 子供選択 -->
	<div class="flex gap-2 flex-wrap">
		{#each data.children as child}
			<button
				class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors
					{selectedChildId === child.id
					? 'bg-blue-500 text-white'
					: 'bg-white text-gray-600 shadow-sm hover:shadow-md'}"
				onclick={() => (selectedChildId = child.id)}
			>
				{child.nickname}（{child.age}歳）
			</button>
		{/each}
	</div>

	<!-- 対象年齢説明 -->
	<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
		<p class="font-bold mb-1">キャリア機能について</p>
		<p>
			お子さまの興味・関心を可視化し、将来の夢や目標を一緒に考えるための機能です。
			マンダラチャートを使って「好きなこと」「得意なこと」を整理できます。
		</p>
	</div>

	<!-- キャリア分野一覧 -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-3">興味分野</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each data.fields as field}
				<div class="bg-white rounded-xl p-3 shadow-sm text-center">
					<span class="text-2xl block mb-1">{field.icon}</span>
					<p class="text-xs font-bold text-gray-600">{field.name}</p>
				</div>
			{/each}
		</div>
	</section>

	<!-- マンダラチャート（静的プレビュー） -->
	{#if data.plan}
		{@const mandala = JSON.parse(data.plan.mandalaChart)}
		<section>
			<h3 class="text-sm font-bold text-gray-500 mb-3">マンダラチャート（はるとの例）</h3>
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
				<div class="text-center mb-3">
					<p class="text-lg font-bold text-gray-700">🎯 {mandala.center}</p>
					<p class="text-xs text-gray-400 mt-1">{data.plan.dreamText}</p>
				</div>
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
					{#each mandala.surrounding as block}
						<div class="rounded-lg p-2 text-center border bg-gray-50 border-gray-200">
							<p class="text-xs font-bold text-gray-700">{block.goal}</p>
						</div>
					{/each}
				</div>

				<!-- タイムライン -->
				<div class="mt-4 space-y-2">
					<h4 class="text-xs font-bold text-gray-500">ロードマップ</h4>
					<div class="flex items-start gap-2">
						<span class="text-xs font-bold text-blue-500 w-10 shrink-0">3年後</span>
						<p class="text-xs text-gray-600">{data.plan.timeline3y}</p>
					</div>
					<div class="flex items-start gap-2">
						<span class="text-xs font-bold text-blue-500 w-10 shrink-0">5年後</span>
						<p class="text-xs text-gray-600">{data.plan.timeline5y}</p>
					</div>
					<div class="flex items-start gap-2">
						<span class="text-xs font-bold text-purple-500 w-10 shrink-0">10年後</span>
						<p class="text-xs text-gray-600">{data.plan.timeline10y}</p>
					</div>
				</div>
			</div>
		</section>
	{:else}
		<div class="bg-white rounded-xl p-8 shadow-sm text-center text-gray-400">
			<span class="text-4xl block mb-2">🌟</span>
			<p class="font-bold">キャリアプランはまだ作成されていません</p>
			<p class="text-sm mt-1">登録すると、お子さまと一緒にマンダラチャートを作れます</p>
		</div>
	{/if}

	<DemoCta
		title="お子さまの将来の夢を一緒に考えませんか？"
		description="登録すると、マンダラチャートやキャリア分野の管理ができます。"
	/>
</div>
