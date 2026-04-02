<script lang="ts">
import { enhance } from '$app/forms';
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

<div class="space-y-6" data-tutorial="rewards-section">
	<!-- Step 1: Select child -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">1. こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="rounded-xl {selectedChildId === child.id ? '' : 'bg-white text-gray-600 shadow-sm hover:shadow-md'}"
					onclick={() => selectedChildId = child.id}
				>
					👤 {child.nickname}
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Select template or custom -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">2. テンプレートを選択（またはカスタム）</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each data.templates as tmpl}
				<Button
					variant="ghost"
					size="sm"
					class="bg-white rounded-xl p-3 shadow-sm text-center hover:shadow-md flex-col h-auto
						{selectedTemplate?.title === tmpl.title ? 'ring-2 ring-blue-400' : ''}"
					onclick={() => selectTemplate(tmpl)}
				>
					<span class="text-2xl block">{tmpl.icon ?? '🎁'}</span>
					<p class="text-xs font-bold text-gray-600 mt-1">{tmpl.title}</p>
					<p class="text-xs text-amber-500 font-bold">{tmpl.points}P</p>
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 3: Confirm & submit -->
	<Card variant="elevated" padding="md">
		{#snippet children()}
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
			class="space-y-3"
		>
			<h3 class="text-sm font-bold text-gray-500">3. 内容を確認して付与</h3>
			<input type="hidden" name="childId" value={selectedChildId} />

			<div class="grid grid-cols-2 gap-3">
				<FormField label="タイトル" type="text" name="title" bind:value={customTitle} required />
				<FormField label="ポイント" type="number" name="points" bind:value={customPoints} min={1} max={10000} required />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label="アイコン" type="text" name="icon" bind:value={customIcon} />
				<FormField label="カテゴリ">
					{#snippet children()}
						<select name="category" bind:value={customCategory} class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm">
							{#each Object.entries(categoryLabels) as [value, label]}
								<option {value}>{label}</option>
							{/each}
						</select>
					{/snippet}
				</FormField>
			</div>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
			>
				{customIcon} {customTitle || '報酬'} ({customPoints}P) を付与する
			</Button>
		</form>
		{/snippet}
	</Card>

	<!-- Success Message -->
	{#if grantSuccess}
		<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center">
			<p class="text-green-700 font-bold">特別報酬を付与しました！</p>
		</div>
	{/if}
</div>
