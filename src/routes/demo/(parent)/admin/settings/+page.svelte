<script lang="ts">
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import { CURRENCY_DEFS, formatPointValue } from '$lib/domain/point-display';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);

const decayOptions = [
	{ value: 'off', label: 'なし', desc: 'ステータスは下がりません' },
	{ value: 'gentle', label: 'やさしい', desc: '2週間放置で少し下がる' },
	{ value: 'normal', label: 'ふつう', desc: '1週間放置で下がる' },
	{ value: 'strict', label: 'きびしい', desc: '3日放置で下がる' },
];
</script>

<svelte:head>
	<title>設定 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page Header -->
	<h1 class="text-lg font-bold text-[var(--color-text-primary)]">設定</h1>

	<DemoBanner />

	<!-- おやカギコード設定 -->
	<Card>
		<div class="space-y-3">
			<h2 class="text-sm font-bold text-[var(--color-text-primary)]">{OYAKAGI_LABELS.sectionTitle}</h2>
			<p class="text-xs text-[var(--color-text-muted)]">
				管理画面にアクセスするための{OYAKAGI_LABELS.name}を変更できます。{OYAKAGI_LABELS.defaultValueHint}。
			</p>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
				<FormField label={`現在の${OYAKAGI_LABELS.shortName}`} type="password" disabled placeholder="****" />
				<FormField label={`新しい${OYAKAGI_LABELS.shortName}`} type="password" disabled placeholder="****" />
				<FormField label="確認" type="password" disabled placeholder="****" />
			</div>
		</div>
	</Card>

	<!-- Point Display Settings -->
	<Card>
		<div class="space-y-3">
		<h2 class="text-sm font-bold text-[var(--color-text-primary)]">&#x2B50; ポイント表示設定</h2>
		<p class="text-xs text-[var(--color-text-muted)]">
			ポイントの表示方法を「ポイント (P)」または「通貨」に切り替えられます。
		</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<div class="bg-[var(--color-feedback-info-bg)] rounded-lg p-3 border-2 border-[var(--color-feedback-info-border)]">
				<p class="text-sm font-bold text-[var(--color-feedback-info-text)]">&#x1F4CA; ポイントモード</p>
				<p class="text-xs text-[var(--color-text-muted)] mt-1">例: {formatPointValue(1250, 'point', 'JPY', 1)}</p>
			</div>
			<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 border-2 border-[var(--color-border)]">
				<p class="text-sm font-bold text-[var(--color-text-muted)]">&#x1F4B0; 通貨モード</p>
				<p class="text-xs text-[var(--color-text-tertiary)] mt-1">例: {formatPointValue(1250, 'currency', 'JPY', 1)}</p>
			</div>
		</div>
		<div>
			<p class="text-xs font-bold text-[var(--color-text-tertiary)] mb-1">対応通貨</p>
			<div class="flex flex-wrap gap-2">
				{#each Object.entries(CURRENCY_DEFS) as [code, def]}
					<span class="inline-flex items-center gap-1 px-2 py-1 bg-[var(--color-surface-secondary)] rounded text-xs text-[var(--color-text-muted)]">
						{def.flag} {code} ({def.symbol})
					</span>
				{/each}
			</div>
		</div>
		</div>
	</Card>

	<!-- Decay Settings -->
	<Card>
		<div class="space-y-3">
			<h2 class="text-sm font-bold text-[var(--color-text-primary)]">&#x1F4C9; ステータス減衰設定</h2>
			<p class="text-xs text-[var(--color-text-muted)]">
				活動をサボるとステータスがゆっくり下がります。お子さまに合った強度を選べます。
			</p>
			<div class="grid grid-cols-2 gap-2">
				{#each decayOptions as opt}
					<div
						class="rounded-lg p-3 border-2 {data.decayIntensity === opt.value
							? 'border-[var(--color-feedback-info-border)] bg-[var(--color-feedback-info-bg)]'
							: 'border-[var(--color-border)] bg-[var(--color-surface-muted)]'}"
					>
						<p class="text-sm font-bold {data.decayIntensity === opt.value ? 'text-[var(--color-feedback-info-text)]' : 'text-[var(--color-text-muted)]'}">
							{opt.label}
						</p>
						<p class="text-xs text-[var(--color-text-tertiary)] mt-0.5">{opt.desc}</p>
					</div>
				{/each}
			</div>
		</div>
	</Card>

	<!-- Data Management -->
	<Card>
		<div class="space-y-3">
			<h2 class="text-sm font-bold text-[var(--color-text-primary)]">&#x1F4BE; データ管理</h2>
			<p class="text-xs text-[var(--color-text-muted)]">
				登録すると、データのエクスポート・インポート・初期化が利用できます。
			</p>
			<div class="grid grid-cols-3 gap-2">
				<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 text-center">
					<span class="text-xl block mb-1">&#x1F4E4;</span>
					<p class="text-xs font-bold text-[var(--color-text-tertiary)]">エクスポート</p>
				</div>
				<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 text-center">
					<span class="text-xl block mb-1">&#x1F4E5;</span>
					<p class="text-xs font-bold text-[var(--color-text-tertiary)]">インポート</p>
				</div>
				<div class="bg-[var(--color-surface-muted)] rounded-lg p-3 text-center">
					<span class="text-xl block mb-1">&#x1F5D1;&#xFE0F;</span>
					<p class="text-xs font-bold text-[var(--color-text-tertiary)]">初期化</p>
				</div>
			</div>
		</div>
	</Card>

	<!-- Feedback -->
	<Card>
		<div class="space-y-3">
			<h2 class="text-sm font-bold text-[var(--color-text-primary)]">&#x1F4AC; フィードバック</h2>
			<p class="text-xs text-[var(--color-text-muted)]">
				ご意見・ご要望・バグ報告をお寄せください。登録後に利用可能です。
			</p>
		</div>
	</Card>

	<DemoCta
		title="すべての設定を利用しませんか？"
		description="登録すると、PIN設定・ポイント表示・減衰設定などが自由にカスタマイズできます。"
	/>
</div>
