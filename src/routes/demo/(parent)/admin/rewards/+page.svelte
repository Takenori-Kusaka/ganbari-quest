<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

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
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class={selectedChildId === child.id
						? ''
						: 'bg-white text-gray-600 shadow-sm hover:shadow-md'}
					onclick={() => (selectedChildId = child.id)}
				>
					👤 {child.nickname}
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Select template -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">2. テンプレートを選択（またはカスタム）</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each data.templates as tmpl}
				<Button
					variant="ghost"
					size="sm"
					class="bg-white rounded-xl p-3 shadow-sm hover:shadow-md
						{selectedTemplate === tmpl.title ? 'ring-2 ring-blue-400' : ''}"
					onclick={() => (selectedTemplate = tmpl.title)}
				>
					<span class="text-2xl block">{tmpl.icon}</span>
					<p class="text-xs font-bold text-gray-600 mt-1">{tmpl.title}</p>
					<p class="text-xs text-amber-500 font-bold">{tmpl.points}P</p>
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 3: Confirm -->
	<Card>
		<div class="space-y-3">
			<h3 class="text-sm font-bold text-gray-500">3. 内容を確認して付与</h3>

			<div class="grid grid-cols-2 gap-3">
				<FormField label="タイトル" type="text" disabled value={selectedTemplate ?? ''} placeholder="テンプレートを選択" />
				<FormField label="ポイント" type="number" disabled value={100} />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label="アイコン" type="text" disabled value="🎁" />
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

			<Button
				variant="ghost"
				size="md"
				class="w-full bg-gray-200 text-gray-400 cursor-not-allowed"
				disabled
			>
				デモでは報酬を付与できません
			</Button>
		</div>
	</Card>

	<DemoCta
		title="特別報酬で子どもをもっと応援しませんか？"
		description="登録すると、テンプレートやカスタム報酬を自由に付与できます。"
	/>
</div>
