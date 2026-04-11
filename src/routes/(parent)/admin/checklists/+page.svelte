<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import PremiumBadge from '$lib/ui/components/PremiumBadge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

let selectedChildId = $state(0);

$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

// #723: Free プランのテンプレート上限（UI ゲート用）
// null = 無制限（Standard/Family）
const checklistMax = $derived(data.checklistTemplateMax);
const currentCount = $derived(selectedChild?.templates.length ?? 0);
const atLimit = $derived(checklistMax !== null && currentCount >= checklistMax);

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
let templateTimeSlotValue = $state('anytime');

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

const TIME_SLOT_OPTIONS = [
	{ value: 'anytime', label: 'いつでも', icon: '🕐' },
	{ value: 'morning', label: 'あさ', icon: '☀️' },
	{ value: 'afternoon', label: 'ひる', icon: '🌤️' },
	{ value: 'evening', label: 'よる', icon: '🌙' },
];

function getTimeSlot(template: { id: number; timeSlot?: string }): string {
	return template.timeSlot ?? 'anytime';
}

function timeSlotLabel(slot: string): string {
	const opt = TIME_SLOT_OPTIONS.find((o) => o.value === slot);
	return opt ? `${opt.icon} ${opt.label}` : slot;
}

const COMMON_ICONS = ['🏫', '👕', '👟', '🎨', '🎵', '📚', '🧹', '🍱', '💧', '📦', '🎒', '✏️'];

// Dialog exclusion: only one dialog open at a time
const anyDialogOpen = $derived(addItemOpen || addTemplateOpen || overrideOpen);

function openAddItem(templateId: number) {
	if (anyDialogOpen) return;
	addItemTemplateId = templateId;
	itemName = '';
	itemIcon = '🏫';
	itemFrequency = 'daily';
	itemDirection = 'bring';
	addItemOpen = true;
}

function openAddTemplate() {
	if (anyDialogOpen) return;
	// #723: Free プランで上限到達時はダイアログを開かない（サーバー側でも 403 で拒否）
	if (atLimit) return;
	templateName = '';
	templateIcon = '📋';
	addTemplateOpen = true;
}

function openOverride() {
	if (anyDialogOpen) return;
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
	<title>チェックリスト管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4">
	<!-- Child selector -->
	{#if data.children.length > 1}
		<div class="flex gap-2">
			{#each data.children as child (child.id)}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class={selectedChildId === child.id ? '' : 'bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-feedback-info-bg)]'}
					onclick={() => (selectedChildId = child.id)}
				>
					{child.nickname}
				</Button>
			{/each}
		</div>
	{/if}

	{#if selectedChild}
		<!-- Templates -->
		{#if selectedChild.templates.length === 0}
			<Card variant="elevated" padding="lg">
				{#snippet children()}
				<div class="text-center text-[var(--color-text-tertiary)]">
					<p class="text-3xl mb-2">📋</p>
					<p>チェックリストがまだありません</p>
				</div>
				{/snippet}
			</Card>
		{/if}

		{#each selectedChild.templates as template (template.id)}
			<Card variant="default" padding="none">
				{#snippet children()}
				<!-- Template header -->
				<div class="flex items-center justify-between px-4 py-3 bg-[var(--color-surface-muted)] border-b border-[var(--color-border-light)]">
					<div class="flex items-center gap-2">
						<span class="text-xl">{template.icon}</span>
						<span class="font-bold text-[var(--color-text-primary)]">{template.name}</span>
						<span class="text-xs px-2 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] rounded">{timeSlotLabel(getTimeSlot(template))}</span>
						{#if !template.isActive}
							<span class="text-xs px-2 py-0.5 bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] rounded">無効</span>
						{/if}
					</div>
					<div class="flex items-center gap-1">
						<form method="POST" action="?/toggleTemplate" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<input type="hidden" name="isActive" value={template.isActive} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								class="bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)]"
								title={template.isActive ? '無効にする' : '有効にする'}
							>
								{template.isActive ? '無効化' : '有効化'}
							</Button>
						</form>
						<form method="POST" action="?/deleteTemplate" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								class="bg-[var(--color-feedback-error-bg)] hover:bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]"
								onclick={(e) => { if (!confirm('削除しますか？')) e.preventDefault(); }}
							>
								削除
							</Button>
						</form>
					</div>
				</div>

				<!-- Time slot selector -->
				<div class="flex items-center gap-1 px-4 py-2 bg-white border-b border-[var(--color-surface-muted)]">
					<span class="text-xs text-[var(--color-text-muted)] mr-1">時間帯:</span>
					{#each TIME_SLOT_OPTIONS as opt}
						<form method="POST" action="?/updateTimeSlot" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<input type="hidden" name="timeSlot" value={opt.value} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								class="text-xs px-2 py-1 {getTimeSlot(template) === opt.value ? 'bg-[var(--color-feedback-info-bg-strong)] text-[var(--color-feedback-info-text)] ring-1 ring-[var(--color-feedback-info-border)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-secondary)]'}"
							>
								{opt.icon} {opt.label}
							</Button>
						</form>
					{/each}
				</div>

				<!-- Items list -->
				<div class="divide-y divide-gray-50">
					{#each template.items as item (item.id)}
						<div class="flex items-center justify-between px-4 py-2">
							<div class="flex items-center gap-2">
								<span>{item.icon}</span>
								<span class="text-sm font-medium">{item.name}</span>
								<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] rounded">{frequencyLabel(item.frequency)}</span>
								<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] rounded">{directionLabel(item.direction)}</span>
							</div>
							<form method="POST" action="?/removeItem" use:enhance={() => async () => invalidateAll()}>
								<input type="hidden" name="itemId" value={item.id} />
								<Button
									type="submit"
									variant="ghost"
									size="sm"
									class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-feedback-error-text)] px-1"
									title="削除"
								>
									✕
								</Button>
							</form>
						</div>
					{/each}
				</div>

				<!-- Add item button -->
				<div class="px-4 py-2 border-t border-[var(--color-surface-muted)]">
					<Button
						variant="ghost"
						size="sm"
						class="w-full py-2 text-sm text-[var(--color-feedback-info-text)] hover:bg-[var(--color-feedback-info-bg)]"
						onclick={() => openAddItem(template.id)}
					>
						+ アイテム追加
					</Button>
				</div>
				{/snippet}
			</Card>
		{/each}

		<!-- #723: Free プランで上限到達時のアップグレード誘導 -->
		{#if !data.isPremium && checklistMax !== null}
			<div class="px-4 py-3 rounded-lg bg-[var(--color-surface-trial)] border border-[var(--color-border-trial)] text-sm">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="text-base">📋</span>
						<span class="text-[var(--color-text-primary)]">
							{#if atLimit}
								フリープランの上限 ({checklistMax}個) に達しました
							{:else}
								チェックリスト {currentCount} / {checklistMax}
							{/if}
						</span>
					</div>
					<a
						href="/pricing"
						class="text-xs font-bold text-[var(--color-action-primary)] hover:underline"
					>
						アップグレード →
					</a>
				</div>
				{#if atLimit}
					<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
						スタンダード以上にアップグレードすると無制限に作成できます。
					</p>
				{/if}
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex gap-2 items-center">
			<Button
				variant="primary"
				size="md"
				class="flex-1"
				disabled={atLimit}
				onclick={openAddTemplate}
			>
				+ テンプレート作成
			</Button>
			<Button
				variant="outline"
				size="md"
				class="flex-1"
				onclick={openOverride}
			>
				📅 ワンオフ追加
			</Button>
			{#if !data.isPremium}
				<PremiumBadge size="sm" label="スタンダード以上" />
			{/if}
		</div>

		<!-- Today's overrides -->
		{#if selectedChild.overrides.length > 0}
			<Card variant="default" padding="none">
				{#snippet children()}
				<div class="px-4 py-3 bg-[var(--color-feedback-warning-bg)] border-b border-[var(--color-feedback-warning-bg-strong)]">
					<span class="font-bold text-[var(--color-text-primary)]">📅 本日のワンオフ</span>
				</div>
				<div class="divide-y divide-gray-50">
					{#each selectedChild.overrides as ov (ov.id)}
						<div class="flex items-center justify-between px-4 py-2">
							<div class="flex items-center gap-2">
								<span>{ov.icon}</span>
								<span class="text-sm">{ov.itemName}</span>
								<span class="text-xs px-1.5 py-0.5 {ov.action === 'add' ? 'bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)]' : 'bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)]'} rounded">
									{ov.action === 'add' ? '追加' : '除外'}
								</span>
							</div>
							<form method="POST" action="?/removeOverride" use:enhance={() => async () => invalidateAll()}>
								<input type="hidden" name="overrideId" value={ov.id} />
								<Button type="submit" variant="ghost" size="sm" class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-feedback-error-text)] px-1" title="削除" aria-label="削除">✕</Button>
							</form>
						</div>
					{/each}
				</div>
				{/snippet}
			</Card>
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

		<FormField label="名前" type="text" name="name" bind:value={templateName} placeholder="例: がっこうのもちもの" required />

		<div>
			<span class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">アイコン</span>
			<div class="flex gap-1 flex-wrap">
				{#each ['📋', '🎒', '🏫', '📚'] as ic}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="w-10 h-10 text-xl {templateIcon === ic ? 'ring-2 ring-[var(--color-border-focus)] bg-[var(--color-feedback-info-bg)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-secondary)]'}"
						onclick={() => (templateIcon = ic)}
					>{ic}</Button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={templateIcon} />
		</div>

		<FormField label="時間帯">
			{#snippet children()}
				<select name="timeSlot" bind:value={templateTimeSlotValue} class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors">
					{#each TIME_SLOT_OPTIONS as opt}
						<option value={opt.value}>{opt.icon} {opt.label}</option>
					{/each}
				</select>
			{/snippet}
		</FormField>

		<Button
			type="submit"
			variant="primary"
			size="md"
			class="w-full"
		>
			作成
		</Button>
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

		<FormField label="名前" type="text" name="name" bind:value={itemName} placeholder="例: ハンカチ" required />

		<div>
			<span class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">アイコン</span>
			<div class="flex gap-1 flex-wrap">
				{#each COMMON_ICONS as ic}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="w-10 h-10 text-xl {itemIcon === ic ? 'ring-2 ring-[var(--color-border-focus)] bg-[var(--color-feedback-info-bg)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-secondary)]'}"
						onclick={() => (itemIcon = ic)}
					>{ic}</Button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={itemIcon} />
		</div>

		<FormField label="頻度">
			{#snippet children()}
				<select name="frequency" bind:value={itemFrequency} class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors">
					{#each FREQUENCY_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			{/snippet}
		</FormField>

		<FormField label="方向">
			{#snippet children()}
				<select name="direction" bind:value={itemDirection} class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors">
					{#each DIRECTION_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			{/snippet}
		</FormField>

		<Button
			type="submit"
			variant="primary"
			size="md"
			class="w-full"
		>
			追加
		</Button>
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

		<FormField label="日付" type="date" name="targetDate" bind:value={overrideDate} required />

		<FormField label="操作">
			{#snippet children()}
				<select name="action" bind:value={overrideAction} class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors">
					<option value="add">追加</option>
					<option value="remove">除外</option>
				</select>
			{/snippet}
		</FormField>

		<FormField label="アイテム名" type="text" name="itemName" bind:value={overrideName} placeholder="例: リュック（遠足）" required />

		<div>
			<span class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">アイコン</span>
			<div class="flex gap-1 flex-wrap">
				{#each COMMON_ICONS as ic}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="w-10 h-10 text-xl {overrideIcon === ic ? 'ring-2 ring-[var(--color-border-focus)] bg-[var(--color-feedback-info-bg)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-secondary)]'}"
						onclick={() => (overrideIcon = ic)}
					>{ic}</Button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={overrideIcon} />
		</div>

		<Button
			type="submit"
			variant="primary"
			size="md"
			class="w-full"
		>
			追加
		</Button>
	</form>
</Dialog>
