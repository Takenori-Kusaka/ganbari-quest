<script lang="ts">
import { enhance } from '$app/forms';
import { getErrorMessage } from '$lib/domain/errors';
import type { RewardPreviewData } from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));

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
let showPresets = $state(false);

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

/** AI提案からカテゴリをフォームのカテゴリラベルにマッピング */
const rewardGroupToCategory: Record<string, string> = {
	もの: 'とくべつ',
	たいけん: 'こうりゅう',
	おこづかい: 'とくべつ',
	とくべつ: 'とくべつ',
};

function acceptAiReward(preview: RewardPreviewData) {
	customTitle = preview.title;
	customPoints = preview.points;
	customIcon = preview.icon;
	customCategory = rewardGroupToCategory[preview.category] ?? preview.category;
	selectedTemplate = {
		title: preview.title,
		points: preview.points,
		icon: preview.icon,
		category: customCategory,
	};
}
</script>

<svelte:head>
	<title>ごほうび - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4" data-tutorial="rewards-section">
	<div class="flex items-center gap-2">
		<h2 class="text-lg font-bold">🎁 ごほうび
			{#if !data.isPremium}
				<span class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle">有料限定</span>
			{/if}
		</h2>
		<PageHelpButton />
	</div>
	<!-- Page Description -->
	<div class="page-description">
		<p class="page-description__title">🎁 とくべつなごほうび</p>
		<p class="page-description__text">
			がんばったこどもへの特別なごほうびを設定・付与します。
			日常の活動ポイントとは別に、お手伝いや特別な成果に対してボーナスポイントを贈れます。
		</p>
		<p class="page-description__hint">
			💌 スタンプやメッセージは
			<a href="/admin/messages" class="page-description__link">おうえんメッセージ</a>
			から送れます
		</p>
	</div>

	{#if !data.isPremium}
		<!-- #728: 無料プラン向けアップグレード誘導 -->
		<div class="bg-[var(--color-premium-bg)] rounded-xl p-4 space-y-3 border border-[var(--color-border-premium)]" data-testid="rewards-upgrade-banner">
			<div class="flex items-start gap-3">
				<span class="text-2xl">✨</span>
				<div class="flex-1">
					<p class="font-bold text-[var(--color-premium)]">特別なごほうび設定はスタンダードプラン以上の機能です</p>
					<p class="text-xs text-[var(--color-premium-light)] mt-1">
						アップグレードすると、お手伝いや特別な成果に対してカスタムのボーナスごほうびを作成・付与できます。
					</p>
				</div>
			</div>
			<a
				href="/admin/license"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors"
				data-testid="rewards-upgrade-cta"
			>
				プランを確認する
			</a>
		</div>
	{/if}

	<!-- Child Selector -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="rounded-xl {selectedChildId === child.id ? '' : 'bg-[var(--color-surface-card)] text-[var(--color-text-muted)] shadow-sm hover:shadow-md'}"
					onclick={() => selectedChildId = child.id}
				>
					{child.nickname}
				</Button>
			{/each}
		</div>
	</section>

	<!-- Error Display -->
	{#if errorMessage}
		<div class="bg-[color-mix(in_srgb,var(--color-action-danger)_10%,transparent)] rounded-xl p-3 border border-[color-mix(in_srgb,var(--color-action-danger)_30%,transparent)] text-[var(--color-action-danger)] text-sm">
			{errorMessage}
		</div>
	{/if}

	<!-- AI Suggest Reward Panel (#719) -->
	<AiSuggestRewardPanel onaccept={acceptAiReward} isFamily={data.planTier === 'family'} />

	<!-- Special Reward Templates -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">テンプレートを選択</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each data.templates as tmpl}
				<Button
					variant="ghost"
					size="sm"
					disabled={!data.isPremium}
					class="bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm text-center hover:shadow-md flex-col h-auto
						{selectedTemplate?.title === tmpl.title ? 'ring-2 ring-[var(--color-action-primary)]' : ''}"
					onclick={() => selectTemplate(tmpl)}
				>
					<span class="text-2xl block">{tmpl.icon ?? '🎁'}</span>
					<p class="text-xs font-bold text-[var(--color-text-muted)] mt-1">{tmpl.title}</p>
					<p class="text-xs text-[var(--color-point)] font-bold">{tmpl.points}P</p>
				</Button>
			{/each}
		</div>
	</section>

	<!-- Preset Catalog -->
	<section>
		<button
			type="button"
			class="text-sm font-bold text-[var(--color-text-link)] cursor-pointer bg-transparent border-none p-0 hover:underline"
			onclick={() => { showPresets = !showPresets; }}
		>
			{showPresets ? '▼' : '▶'} プリセットからテンプレートを追加
		</button>

		{#if showPresets}
			<div class="mt-2 space-y-3">
				{#each data.presetGroups as group}
					<div>
						<p class="text-xs font-bold text-[var(--color-text-muted)] mb-1">{group.groupIcon} {group.groupName}</p>
						<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
							{#each group.rewards as preset}
								<form method="POST" action="?/addPreset" use:enhance={() => {
									return async ({ update }) => { await update(); };
								}}>
									<input type="hidden" name="title" value={preset.title} />
									<input type="hidden" name="points" value={preset.points} />
									<input type="hidden" name="icon" value={preset.icon} />
									<input type="hidden" name="category" value={preset.category} />
									<Button
										type="submit"
										variant="ghost"
										size="sm"
										disabled={!data.isPremium}
										class="w-full bg-[var(--color-surface-card)] rounded-xl p-2 shadow-sm text-center hover:shadow-md flex-col h-auto"
									>
										<span class="text-xl block">{preset.icon}</span>
										<p class="text-xs font-bold text-[var(--color-text-muted)] mt-0.5">{preset.title}</p>
										<p class="text-xs text-[var(--color-point)] font-bold">{preset.points}P</p>
									</Button>
								</form>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Grant Form -->
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
			<h3 class="text-sm font-bold text-[var(--color-text-muted)]">内容を確認して付与</h3>
			<input type="hidden" name="childId" value={selectedChildId} />

			<div class="grid grid-cols-2 gap-3">
				<FormField label="タイトル" type="text" name="title" bind:value={customTitle} disabled={!data.isPremium} required />
				<FormField label="ポイント" type="number" name="points" bind:value={customPoints} min={1} max={10000} disabled={!data.isPremium} required />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label="アイコン" type="text" name="icon" bind:value={customIcon} disabled={!data.isPremium} />
				<FormField label="カテゴリ">
					{#snippet children()}
						<select name="category" bind:value={customCategory} disabled={!data.isPremium} class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm disabled:opacity-50 disabled:cursor-not-allowed">
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
				disabled={!data.isPremium}
				class="w-full"
			>
				{customIcon} {customTitle || '報酬'} ({customPoints}P) を付与する
			</Button>
		</form>
		{/snippet}
	</Card>

	{#if grantSuccess}
		<div class="bg-[color-mix(in_srgb,var(--color-action-success)_10%,transparent)] rounded-xl p-4 border border-[color-mix(in_srgb,var(--color-action-success)_30%,transparent)] text-center">
			<p class="text-[var(--color-action-success)] font-bold">特別報酬を付与しました！</p>
		</div>
	{/if}
</div>

<style>
	.page-description {
		background: var(--color-surface-card);
		border-radius: 0.75rem;
		padding: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.page-description__title {
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}
	.page-description__text {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.page-description__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.06));
	}
	.page-description__link {
		color: var(--color-action-primary);
		font-weight: 600;
		text-decoration: none;
	}
	.page-description__link:hover {
		text-decoration: underline;
	}
</style>
