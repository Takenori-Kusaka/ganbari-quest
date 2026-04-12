<script lang="ts">
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

export interface ChecklistItemPreview {
	name: string;
	icon: string;
	frequency: string;
	direction: string;
}

export interface ChecklistPreviewData {
	templateName: string;
	templateIcon: string;
	items: ChecklistItemPreview[];
	source: string;
}

interface Props {
	onaccept: (preview: ChecklistPreviewData) => void;
	isPremium?: boolean;
}

let { onaccept, isPremium = false }: Props = $props();

let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<ChecklistPreviewData | null>(null);

async function suggestFromAI() {
	if (!aiInput.trim()) return;
	if (!isPremium) {
		aiError = 'AI チェックリスト提案はスタンダードプラン以上でご利用いただけます';
		return;
	}
	aiLoading = true;
	aiError = '';
	aiPreview = null;
	try {
		const res = await fetch('/api/v1/checklists/suggest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: aiInput }),
		});
		const json = await res.json();
		if (res.ok) {
			aiPreview = json;
		} else {
			aiError = json.error?.message ?? '推定に失敗しました';
		}
	} catch {
		aiError = 'ネットワークエラーが発生しました';
	} finally {
		aiLoading = false;
	}
}

function acceptPreview() {
	if (!aiPreview) return;
	onaccept(aiPreview);
	aiPreview = null;
}

const FREQ_LABELS: Record<string, string> = {
	daily: 'まいにち',
	'weekday:月': '月',
	'weekday:火': '火',
	'weekday:水': '水',
	'weekday:木': '木',
	'weekday:金': '金',
	'weekday:土': '土',
};

const DIR_LABELS: Record<string, string> = {
	bring: '持参',
	return: '持帰',
	both: '往復',
};
</script>

<div
	class="bg-[var(--color-premium-bg)] rounded-xl p-4 shadow-sm space-y-3 border border-[var(--color-border-premium)]"
	data-testid="ai-suggest-checklist-panel"
	data-plan-locked={!isPremium}
>
	<h3 class="font-bold text-[var(--color-premium)]">
		✨ どんなもちものが必要？
		{#if !isPremium}
			<span
				class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle"
				data-testid="ai-suggest-checklist-locked-badge"
			>スタンダード限定</span>
		{/if}
	</h3>
	<p class="text-xs text-[var(--color-premium-light)]">
		シーンや学年を入力すると、持ち物リストを自動で提案します
	</p>
	{#if !isPremium}
		<div
			class="bg-[var(--color-surface-card)] rounded-lg p-3 text-xs space-y-2 border border-[var(--color-border-premium)]"
			data-testid="ai-suggest-checklist-upgrade-card"
		>
			<p class="text-[var(--color-text-primary)]">
				AI チェックリスト提案はスタンダードプラン以上で解放されます。
			</p>
			<a
				href="/admin/license"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold hover:opacity-90 transition-colors"
				data-testid="ai-suggest-checklist-upgrade-cta"
			>
				スタンダードで解放する
			</a>
		</div>
	{/if}
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={aiInput}
			placeholder="例: 小学3年生の月曜日の持ち物、えんそく、プール"
			class="flex-1 px-3 py-2 border rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={!isPremium}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); suggestFromAI(); } }}
		/>
		<button
			type="button"
			class="px-4 py-2 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg text-sm font-bold hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={!isPremium || aiLoading || !aiInput.trim()}
			onclick={suggestFromAI}
		>
			{#if aiLoading}
				<span class="ai-spinner" aria-hidden="true"></span>
				考え中...
			{:else}
				提案する
			{/if}
		</button>
	</div>
	{#if aiLoading}
		<ProgressMessage
			messages={['AIに聞いています...', 'もちものを考え中...', 'あとすこし...']}
			intervalMs={3000}
		/>
	{/if}
	{#if aiError}
		<p class="text-[var(--color-action-danger)] text-sm">{aiError}</p>
	{/if}

	{#if aiPreview}
		<div class="bg-[var(--color-surface-card)] rounded-lg p-3 space-y-2 border border-[var(--color-border-premium)]">
			{#if aiPreview.source === 'fallback'}
				<p class="text-xs text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg)] px-2 py-1 rounded">AIが利用できなかったため、入力内容から推定しました</p>
			{/if}
			<div class="flex items-center gap-2 mb-2">
				<span class="text-2xl">{aiPreview.templateIcon}</span>
				<span class="font-bold text-[var(--color-text)]">{aiPreview.templateName}</span>
				<span class="text-xs text-[var(--color-text-disabled)]">({aiPreview.items.length}個)</span>
			</div>
			<div class="space-y-1 max-h-60 overflow-y-auto">
				{#each aiPreview.items as item, i}
					<div class="flex items-center gap-2 px-2 py-1 rounded bg-[var(--color-surface-muted)]">
						<span class="text-sm w-5 text-center text-[var(--color-text-disabled)]">{i + 1}</span>
						<span>{item.icon}</span>
						<span class="text-sm flex-1">{item.name}</span>
						<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] rounded">{FREQ_LABELS[item.frequency] ?? item.frequency}</span>
						<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] rounded">{DIR_LABELS[item.direction] ?? item.direction}</span>
					</div>
				{/each}
			</div>
			<div class="flex gap-2 mt-2">
				<Button
					type="button"
					variant="primary"
					size="sm"
					class="flex-1"
					onclick={acceptPreview}
				>
					この内容でテンプレートを作成
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="bg-[var(--color-surface-muted-strong)] hover:bg-[var(--color-surface-tertiary)]"
					onclick={() => aiPreview = null}
				>
					やり直す
				</Button>
			</div>
		</div>
	{/if}
</div>

<style>
	.ai-spinner {
		display: inline-block;
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		vertical-align: middle;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
