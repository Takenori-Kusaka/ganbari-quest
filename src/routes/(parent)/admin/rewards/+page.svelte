<script lang="ts">
import { enhance } from '$app/forms';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

type RewardTab = 'special' | 'stamp' | 'message';
let activeTab = $state<RewardTab>('stamp');
let selectedChildId = $state(0);

$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

// --- Special Reward ---
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

// --- Stamp ---
let selectedStamp = $state('');
let stampSuccess = $state(false);

// --- Text Message ---
let messageBody = $state('');
let messageSent = $state(false);

const categoryLabels: Record<string, string> = {
	うんどう: 'うんどう',
	べんきょう: 'べんきょう',
	せいかつ: 'せいかつ',
	こうりゅう: 'こうりゅう',
	そうぞう: 'そうぞう',
	とくべつ: 'とくべつ',
};

const tabs: { key: RewardTab; label: string; icon: string }[] = [
	{ key: 'stamp', label: 'おうえん', icon: '💌' },
	{ key: 'special', label: 'ごほうび', icon: '🎁' },
	{ key: 'message', label: 'メッセージ', icon: '✉️' },
];
</script>

<svelte:head>
	<title>こどもを褒める - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4">
	<!-- Child Selector (shared across all tabs) -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">こどもを選択</h3>
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

	<!-- Tab Selector -->
	<div class="flex gap-1 bg-white rounded-xl p-1 shadow-sm">
		{#each tabs as tab}
			<button
				type="button"
				class="flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all
					{activeTab === tab.key
						? 'bg-[var(--color-action-primary)] text-white shadow-sm'
						: 'text-gray-500 hover:bg-gray-50'}"
				onclick={() => activeTab = tab.key}
			>
				{tab.icon} {tab.label}
			</button>
		{/each}
	</div>

	<!-- Error Display -->
	{#if form?.error}
		<div class="bg-red-50 rounded-xl p-3 border border-red-200 text-red-600 text-sm">
			{form.error}
		</div>
	{/if}

	<!-- Tab: Stamp -->
	{#if activeTab === 'stamp'}
		<Card variant="elevated" padding="md">
			{#snippet children()}
			<form
				method="POST"
				action="?/sendStamp"
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success' && result.data && 'stampSent' in result.data) {
							stampSuccess = true;
							selectedStamp = '';
							setTimeout(() => { stampSuccess = false; }, 3000);
						}
						await update();
					};
				}}
			>
				<h3 class="text-sm font-bold text-gray-500 mb-3">おうえんスタンプを送る</h3>
				<input type="hidden" name="childId" value={selectedChildId} />
				<input type="hidden" name="stampCode" value={selectedStamp} />

				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
					{#each data.stampPresets as stamp}
						<button
							type="button"
							class="stamp-btn {selectedStamp === stamp.code ? 'stamp-btn--selected' : ''}"
							onclick={() => selectedStamp = stamp.code}
						>
							<span class="text-3xl block">{stamp.icon}</span>
							<span class="text-xs font-bold text-gray-600 mt-1">{stamp.label}</span>
						</button>
					{/each}
				</div>

				<Button
					type="submit"
					variant="primary"
					size="md"
					class="w-full"
					disabled={!selectedStamp}
				>
					スタンプを送る
				</Button>
			</form>
			{/snippet}
		</Card>

		{#if stampSuccess}
			<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center">
				<p class="text-green-700 font-bold">おうえんスタンプを送りました！</p>
			</div>
		{/if}
	{/if}

	<!-- Tab: Special Reward -->
	{#if activeTab === 'special'}
		<section>
			<h3 class="text-sm font-bold text-gray-500 mb-2">テンプレートを選択</h3>
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
				<h3 class="text-sm font-bold text-gray-500">内容を確認して付与</h3>
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

		{#if grantSuccess}
			<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center">
				<p class="text-green-700 font-bold">特別報酬を付与しました！</p>
			</div>
		{/if}
	{/if}

	<!-- Tab: Text Message -->
	{#if activeTab === 'message'}
		<Card variant="elevated" padding="md">
			{#snippet children()}
			<form
				method="POST"
				action="?/sendText"
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success' && result.data && 'messageSent' in result.data) {
							messageSent = true;
							messageBody = '';
							setTimeout(() => { messageSent = false; }, 3000);
						}
						await update();
					};
				}}
				class="space-y-3"
			>
				<h3 class="text-sm font-bold text-gray-500">テキストメッセージを送る</h3>
				<input type="hidden" name="childId" value={selectedChildId} />

				<FormField label="メッセージ（200文字まで）">
					{#snippet children()}
						<textarea
							name="body"
							bind:value={messageBody}
							maxlength={200}
							rows={3}
							placeholder="がんばったね！おつかれさま！"
							class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm resize-none"
						></textarea>
					{/snippet}
				</FormField>
				<div class="text-right text-xs text-gray-400">{messageBody.length}/200</div>

				<Button
					type="submit"
					variant="primary"
					size="md"
					class="w-full"
					disabled={!messageBody.trim()}
				>
					メッセージを送る
				</Button>
			</form>
			{/snippet}
		</Card>

		{#if messageSent}
			<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center">
				<p class="text-green-700 font-bold">メッセージを送りました！</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.stamp-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0.75rem 0.5rem;
		border-radius: 0.75rem;
		background: var(--color-surface-card, #fff);
		border: 2px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
	}
	.stamp-btn:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}
	.stamp-btn--selected {
		border-color: var(--color-action-primary, #667eea);
		background: var(--color-surface-muted, #f8fafc);
	}
</style>
