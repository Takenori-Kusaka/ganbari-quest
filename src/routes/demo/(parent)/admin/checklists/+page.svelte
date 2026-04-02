<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

const selectedChild = $derived(data.children.find((c: { id: number }) => c.id === selectedChildId));
</script>

<svelte:head>
	<title>もちものチェックリスト - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- 子供選択 -->
	<div class="flex gap-2 flex-wrap mb-4">
		{#each data.children as child}
			<Button
				variant={selectedChildId === child.id ? 'primary' : 'ghost'}
				size="sm"
				class={selectedChildId === child.id
					? ''
					: 'bg-white text-gray-600 shadow-sm hover:shadow-md'}
				onclick={() => (selectedChildId = child.id)}
			>
				{child.nickname}
			</Button>
		{/each}
	</div>

	{#if selectedChild}
		<!-- テンプレート追加ボタン (disabled) -->
		<div class="flex justify-end">
			<Button
				variant="ghost"
				size="sm"
				class="bg-gray-200 text-gray-400 cursor-not-allowed"
				disabled
			>
				+ テンプレート追加
			</Button>
		</div>

		<!-- チェックリスト一覧 -->
		{#if selectedChild.checklists.length > 0}
			<div class="space-y-4">
				{#each selectedChild.checklists as checklist}
					<Card>
						<div class="flex items-center justify-between mb-3">
							<h3 class="text-sm font-bold text-gray-700">
								{checklist.template.icon} {checklist.template.name}
							</h3>
							<span class="text-xs text-gray-400">
								{checklist.checkedCount}/{checklist.totalCount}
							</span>
						</div>

						<!-- 進捗バー -->
						<div class="w-full bg-gray-200 rounded-full h-2 mb-3">
							<ProgressFill
								pct={checklist.totalCount > 0 ? (checklist.checkedCount / checklist.totalCount) * 100 : 0}
								class="bg-green-500 h-2 rounded-full transition-all"
							/>
						</div>

						<!-- アイテム一覧 -->
						<div class="space-y-1">
							{#each checklist.items as item, idx}
								<div class="flex items-center gap-2 py-1">
									<span class="text-sm {item.checked ? 'opacity-50' : ''}">
										{item.checked ? '☑️' : '⬜'}
									</span>
									<span class="text-sm {item.checked ? 'text-gray-400 line-through' : 'text-gray-700'}">
										{item.icon} {item.name}
									</span>
								</div>
							{/each}
						</div>

						<!-- アイテム追加 (disabled) -->
						<Button
							variant="ghost"
							size="sm"
							class="mt-2 text-xs text-gray-400 cursor-not-allowed"
							disabled
						>
							+ アイテム追加
						</Button>
					</Card>
				{/each}
			</div>
		{:else}
			<Card padding="lg">
				<div class="text-center text-gray-400">
					<span class="text-4xl block mb-2">✅</span>
					<p class="font-bold">チェックリストがありません</p>
					<p class="text-sm mt-1">登録するとお子さまの持ち物チェックリストを管理できます</p>
				</div>
			</Card>
		{/if}
	{/if}

	<DemoCta
		title="お子さまの持ち物管理を楽にしませんか？"
		description="登録すると、曜日別のチェックリストをカスタマイズして忘れ物を防止できます。"
	/>
</div>
