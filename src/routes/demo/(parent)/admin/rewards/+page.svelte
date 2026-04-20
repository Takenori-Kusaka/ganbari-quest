<script lang="ts">
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

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

	<!-- Page Description -->
	<div class="page-description">
		<p class="page-description__title">🎁 とくべつなごほうび
			<span class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle">有料限定</span>
		</p>
		<p class="page-description__text">
			がんばったこどもへの特別なごほうびを設定・付与します。
			日常の活動ポイントとは別に、お手伝いや特別な成果に対してボーナスポイントを贈れます。
		</p>
		<p class="page-description__hint">
			💌 スタンプやメッセージは
			<a href="/demo/admin/messages" class="page-description__link">おうえんメッセージ</a>
			から送れます
		</p>
	</div>

	<!-- #728/#793: 無料プラン向けアップグレード誘導（デモ） -->
	<div class="bg-[var(--color-premium-bg)] rounded-xl p-4 space-y-3 border border-[var(--color-border-premium)]" data-testid="demo-rewards-upgrade-banner">
		<div class="flex items-start gap-3">
			<span class="text-2xl">✨</span>
			<div class="flex-1">
				<p class="font-bold text-[var(--color-premium)]">特別なごほうび設定はスタンダードプラン以上の機能です</p>
				<p class="text-xs text-[var(--color-premium-light)] mt-1">
					無料プランではプリセット閲覧のみ可能です。スタンダードプラン以上にアップグレードすると、カスタムのボーナスごほうびを作成・付与できます。
				</p>
			</div>
		</div>
	</div>

	<!-- AI Suggest Reward Panel (demo: always family) -->
	<AiSuggestRewardPanel onaccept={() => {}} isFamily={true} />

	<!-- Step 1: Select child -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">1. こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<Button
					variant="ghost"
					size="sm"
					disabled
					class="bg-white text-[var(--color-text-secondary)] shadow-sm"
					onclick={() => (selectedChildId = child.id)}
				>
					👤 {child.nickname}
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Select template -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">2. テンプレートを選択（またはカスタム）</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each data.templates as tmpl}
				<Button
					variant="ghost"
					size="sm"
					disabled
					class="bg-white rounded-xl p-3 shadow-sm
						{selectedTemplate === tmpl.title ? 'ring-2 ring-[var(--color-border-focus)]' : ''}"
					onclick={() => (selectedTemplate = tmpl.title)}
				>
					<span class="text-2xl block">{tmpl.icon}</span>
					<p class="text-xs font-bold text-[var(--color-text-secondary)] mt-1">{tmpl.title}</p>
					<p class="text-xs text-[var(--color-feedback-warning-text)] font-bold">{tmpl.points}P</p>
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 3: Confirm -->
	<Card>
		<div class="space-y-3">
			<h3 class="text-sm font-bold text-[var(--color-text-muted)]">3. 内容を確認して付与</h3>

			<div class="grid grid-cols-2 gap-3">
				<FormField label="タイトル" type="text" disabled value={selectedTemplate ?? ''} placeholder="テンプレートを選択" />
				<FormField label="ポイント" type="number" disabled value={100} />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label="アイコン" type="text" disabled value="🎁" />
				<NativeSelect
					label="カテゴリ"
					disabled
					options={[{ value: 'special', label: 'とくべつ' }]}
				/>
			</div>

			<Button
				variant="ghost"
				size="md"
				class="w-full bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed"
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

<style>
	.page-description {
		background: var(--color-surface-card, white);
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
		color: var(--color-text-muted, #6b7280);
		line-height: 1.5;
	}
	.page-description__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted, #6b7280);
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
