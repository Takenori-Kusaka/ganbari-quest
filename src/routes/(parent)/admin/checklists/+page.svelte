<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

let selectedChildId = $state(0);

$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

// Add item dialog
let addItemOpen = $state(false);
let addItemTemplateId = $state(0);
let itemName = $state('');
let itemIcon = $state('🏫');
let itemFrequency = $state('daily');
let itemDirection = $state('bring');

// Add template dialog
let addTemplateOpen = $state(false);
let templateName = $state('');
let templateIcon = $state('📋');

// Override dialog
let overrideOpen = $state(false);
let overrideDate = $state('');
let overrideAction = $state('add');
let overrideName = $state('');
let overrideIcon = $state('📦');

const FREQUENCY_OPTIONS = [
	{ value: 'daily', label: 'まいにち' },
	{ value: 'weekday:月', label: '月よう' },
	{ value: 'weekday:火', label: '火よう' },
	{ value: 'weekday:水', label: '水よう' },
	{ value: 'weekday:木', label: '木よう' },
	{ value: 'weekday:金', label: '金よう' },
	{ value: 'weekday:土', label: '土よう' },
];

const DIRECTION_OPTIONS = [
	{ value: 'bring', label: '持参' },
	{ value: 'return', label: '持帰' },
	{ value: 'both', label: '往復' },
];

const COMMON_ICONS = ['🏫', '👕', '👟', '🎨', '🎵', '📚', '🧹', '🍱', '💧', '📦', '🎒', '✏️'];

function openAddItem(templateId: number) {
	addItemTemplateId = templateId;
	itemName = '';
	itemIcon = '🏫';
	itemFrequency = 'daily';
	itemDirection = 'bring';
	addItemOpen = true;
}

function openAddTemplate() {
	templateName = '';
	templateIcon = '📋';
	addTemplateOpen = true;
}

function openOverride() {
	overrideDate = data?.today ?? '';
	overrideAction = 'add';
	overrideName = '';
	overrideIcon = '📦';
	overrideOpen = true;
}

function frequencyLabel(freq: string): string {
	const opt = FREQUENCY_OPTIONS.find((o) => o.value === freq);
	return opt?.label ?? freq;
}

function directionLabel(dir: string): string {
	const opt = DIRECTION_OPTIONS.find((o) => o.value === dir);
	return opt?.label ?? dir;
}
</script>

<svelte:head>
	<title>もちもの管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-bold text-gray-700">もちものチェックリスト管理</h2>

	<!-- Child selector -->
	{#if data.children.length > 1}
		<div class="flex gap-2">
			{#each data.children as child (child.id)}
				<button
					class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {selectedChildId === child.id
						? 'bg-blue-500 text-white'
						: 'bg-white text-gray-600 hover:bg-blue-50'}"
					onclick={() => (selectedChildId = child.id)}
				>
					{child.nickname}
				</button>
			{/each}
		</div>
	{/if}

	{#if selectedChild}
		<!-- Templates -->
		{#if selectedChild.templates.length === 0}
			<div class="bg-white rounded-xl p-6 text-center text-gray-400">
				<p class="text-3xl mb-2">📋</p>
				<p>チェックリストがまだありません</p>
			</div>
		{/if}

		{#each selectedChild.templates as template (template.id)}
			<div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<!-- Template header -->
				<div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
					<div class="flex items-center gap-2">
						<span class="text-xl">{template.icon}</span>
						<span class="font-bold text-gray-700">{template.name}</span>
						{#if !template.isActive}
							<span class="text-xs px-2 py-0.5 bg-gray-200 text-gray-500 rounded">無効</span>
						{/if}
					</div>
					<div class="flex items-center gap-1">
						<form method="POST" action="?/toggleTemplate" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<input type="hidden" name="isActive" value={template.isActive} />
							<button
								type="submit"
								class="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
								title={template.isActive ? '無効にする' : '有効にする'}
							>
								{template.isActive ? '無効化' : '有効化'}
							</button>
						</form>
						<form method="POST" action="?/deleteTemplate" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<button
								type="submit"
								class="px-2 py-1 text-xs rounded bg-red-50 hover:bg-red-100 text-red-500"
								onclick={(e) => { if (!confirm('削除しますか？')) e.preventDefault(); }}
							>
								削除
							</button>
						</form>
					</div>
				</div>

				<!-- Items list -->
				<div class="divide-y divide-gray-50">
					{#each template.items as item (item.id)}
						<div class="flex items-center justify-between px-4 py-2">
							<div class="flex items-center gap-2">
								<span>{item.icon}</span>
								<span class="text-sm font-medium">{item.name}</span>
								<span class="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-500 rounded">{frequencyLabel(item.frequency)}</span>
								<span class="text-xs px-1.5 py-0.5 bg-green-50 text-green-500 rounded">{directionLabel(item.direction)}</span>
							</div>
							<form method="POST" action="?/removeItem" use:enhance={() => async () => invalidateAll()}>
								<input type="hidden" name="itemId" value={item.id} />
								<button
									type="submit"
									class="text-xs text-gray-400 hover:text-red-500 px-1"
									title="削除"
								>
									✕
								</button>
							</form>
						</div>
					{/each}
				</div>

				<!-- Add item button -->
				<div class="px-4 py-2 border-t border-gray-50">
					<button
						class="w-full py-2 text-sm text-blue-500 font-medium hover:bg-blue-50 rounded-lg transition-colors"
						onclick={() => openAddItem(template.id)}
					>
						+ アイテム追加
					</button>
				</div>
			</div>
		{/each}

		<!-- Actions -->
		<div class="flex gap-2">
			<button
				class="flex-1 py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-colors"
				onclick={openAddTemplate}
			>
				+ テンプレート作成
			</button>
			<button
				class="flex-1 py-3 bg-white text-blue-500 font-bold rounded-xl border border-blue-200 hover:bg-blue-50 transition-colors"
				onclick={openOverride}
			>
				📅 ワンオフ追加
			</button>
		</div>

		<!-- Today's overrides -->
		{#if selectedChild.overrides.length > 0}
			<div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<div class="px-4 py-3 bg-amber-50 border-b border-amber-100">
					<span class="font-bold text-gray-700">📅 本日のワンオフ</span>
				</div>
				<div class="divide-y divide-gray-50">
					{#each selectedChild.overrides as ov (ov.id)}
						<div class="flex items-center justify-between px-4 py-2">
							<div class="flex items-center gap-2">
								<span>{ov.icon}</span>
								<span class="text-sm">{ov.itemName}</span>
								<span class="text-xs px-1.5 py-0.5 {ov.action === 'add' ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'} rounded">
									{ov.action === 'add' ? '追加' : '除外'}
								</span>
							</div>
							<form method="POST" action="?/removeOverride" use:enhance={() => async () => invalidateAll()}>
								<input type="hidden" name="overrideId" value={ov.id} />
								<button type="submit" class="text-xs text-gray-400 hover:text-red-500 px-1" title="削除" aria-label="削除">✕</button>
							</form>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Add template dialog -->
<Dialog bind:open={addTemplateOpen} closable={true} title="テンプレート作成">
	<form
		method="POST"
		action="?/createTemplate"
		use:enhance={() => {
			addTemplateOpen = false;
			return async () => invalidateAll();
		}}
		class="space-y-4"
	>
		<input type="hidden" name="childId" value={selectedChildId} />

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1">
				<span>名前</span>
				<input
					type="text"
					name="name"
					bind:value={templateName}
					placeholder="例: がっこうのもちもの"
					required
					class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
				/>
			</label>
		</div>

		<div>
			<span class="block text-sm font-medium text-gray-700 mb-1">アイコン</span>
			<div class="flex gap-1 flex-wrap">
				{#each ['📋', '🎒', '🏫', '📚'] as ic}
					<button
						type="button"
						class="w-10 h-10 rounded-lg text-xl {templateIcon === ic ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'}"
						onclick={() => (templateIcon = ic)}
					>{ic}</button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={templateIcon} />
		</div>

		<button
			type="submit"
			class="w-full py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-colors"
		>
			作成
		</button>
	</form>
</Dialog>

<!-- Add item dialog -->
<Dialog bind:open={addItemOpen} closable={true} title="アイテム追加">
	<form
		method="POST"
		action="?/addItem"
		use:enhance={() => {
			addItemOpen = false;
			return async () => invalidateAll();
		}}
		class="space-y-4"
	>
		<input type="hidden" name="templateId" value={addItemTemplateId} />

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1">
				<span>名前</span>
				<input
					type="text"
					name="name"
					bind:value={itemName}
					placeholder="例: ハンカチ"
					required
					class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
				/>
			</label>
		</div>

		<div>
			<span class="block text-sm font-medium text-gray-700 mb-1">アイコン</span>
			<div class="flex gap-1 flex-wrap">
				{#each COMMON_ICONS as ic}
					<button
						type="button"
						class="w-10 h-10 rounded-lg text-xl {itemIcon === ic ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'}"
						onclick={() => (itemIcon = ic)}
					>{ic}</button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={itemIcon} />
		</div>

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1">
				<span>頻度</span>
				<select name="frequency" bind:value={itemFrequency} class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
					{#each FREQUENCY_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
		</div>

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1">
				<span>方向</span>
				<select name="direction" bind:value={itemDirection} class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
					{#each DIRECTION_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
		</div>

		<button
			type="submit"
			class="w-full py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-colors"
		>
			追加
		</button>
	</form>
</Dialog>

<!-- Override dialog -->
<Dialog bind:open={overrideOpen} closable={true} title="ワンオフ追加/除外">
	<form
		method="POST"
		action="?/addOverride"
		use:enhance={() => {
			overrideOpen = false;
			return async () => invalidateAll();
		}}
		class="space-y-4"
	>
		<input type="hidden" name="childId" value={selectedChildId} />

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1">
				<span>日付</span>
				<input
					type="date"
					name="targetDate"
					bind:value={overrideDate}
					required
					class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
				/>
			</label>
		</div>

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1">
				<span>操作</span>
				<select name="action" bind:value={overrideAction} class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
					<option value="add">追加</option>
					<option value="remove">除外</option>
				</select>
			</label>
		</div>

		<div>
			<label class="block text-sm font-medium text-gray-700 mb-1">
				<span>アイテム名</span>
				<input
					type="text"
					name="itemName"
					bind:value={overrideName}
					placeholder="例: リュック（遠足）"
					required
					class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
				/>
			</label>
		</div>

		<div>
			<span class="block text-sm font-medium text-gray-700 mb-1">アイコン</span>
			<div class="flex gap-1 flex-wrap">
				{#each COMMON_ICONS as ic}
					<button
						type="button"
						class="w-10 h-10 rounded-lg text-xl {overrideIcon === ic ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'}"
						onclick={() => (overrideIcon = ic)}
					>{ic}</button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={overrideIcon} />
		</div>

		<button
			type="submit"
			class="w-full py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-colors"
		>
			追加
		</button>
	</form>
</Dialog>
