<script lang="ts">
import { CURRENCY_DEFS, formatPointValue } from '$lib/domain/point-display';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);

const themeOptions = [
	{ value: 'pink', label: 'ピンク', icon: '&#x1F49B;' },
	{ value: 'blue', label: 'ブルー', icon: '&#x1F499;' },
	{ value: 'green', label: 'みどり', icon: '&#x1F49A;' },
	{ value: 'orange', label: 'オレンジ', icon: '&#x1F9E1;' },
	{ value: 'purple', label: 'むらさき', icon: '&#x1F49C;' },
];

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
	<h1 class="text-lg font-bold text-gray-700">設定</h1>

	<DemoBanner />

	<!-- PIN Settings -->
	<section class="bg-white rounded-xl p-4 shadow-sm space-y-3">
		<h2 class="text-sm font-bold text-gray-700">&#x1F512; PINコード設定</h2>
		<p class="text-xs text-gray-500">
			管理画面にアクセスするためのPINコードを変更できます。
		</p>
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
			<FormField label="現在のPIN" type="password" disabled placeholder="****" />
			<FormField label="新しいPIN" type="password" disabled placeholder="****" />
			<FormField label="確認" type="password" disabled placeholder="****" />
		</div>
	</section>

	<!-- Point Display Settings -->
	<section class="bg-white rounded-xl p-4 shadow-sm space-y-3">
		<h2 class="text-sm font-bold text-gray-700">&#x2B50; ポイント表示設定</h2>
		<p class="text-xs text-gray-500">
			ポイントの表示方法を「ポイント (P)」または「通貨」に切り替えられます。
		</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<div class="bg-blue-50 rounded-lg p-3 border-2 border-blue-300">
				<p class="text-sm font-bold text-blue-700">&#x1F4CA; ポイントモード</p>
				<p class="text-xs text-gray-500 mt-1">例: {formatPointValue(1250, 'point', 'JPY', 1)}</p>
			</div>
			<div class="bg-gray-50 rounded-lg p-3 border-2 border-gray-200">
				<p class="text-sm font-bold text-gray-500">&#x1F4B0; 通貨モード</p>
				<p class="text-xs text-gray-400 mt-1">例: {formatPointValue(1250, 'currency', 'JPY', 1)}</p>
			</div>
		</div>
		<div>
			<p class="text-xs font-bold text-gray-400 mb-1">対応通貨</p>
			<div class="flex flex-wrap gap-2">
				{#each Object.entries(CURRENCY_DEFS) as [code, def]}
					<span class="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-500">
						{def.flag} {code} ({def.symbol})
					</span>
				{/each}
			</div>
		</div>
	</section>

	<!-- Decay Settings -->
	<section class="bg-white rounded-xl p-4 shadow-sm space-y-3">
		<h2 class="text-sm font-bold text-gray-700">&#x1F4C9; ステータス減衰設定</h2>
		<p class="text-xs text-gray-500">
			活動をサボるとステータスがゆっくり下がります。お子さまに合った強度を選べます。
		</p>
		<div class="grid grid-cols-2 gap-2">
			{#each decayOptions as opt}
				<div
					class="rounded-lg p-3 border-2 {data.decayIntensity === opt.value
						? 'border-blue-300 bg-blue-50'
						: 'border-gray-200 bg-gray-50'}"
				>
					<p class="text-sm font-bold {data.decayIntensity === opt.value ? 'text-blue-700' : 'text-gray-500'}">
						{opt.label}
					</p>
					<p class="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
				</div>
			{/each}
		</div>
	</section>

	<!-- Theme Colors -->
	<section class="bg-white rounded-xl p-4 shadow-sm space-y-3">
		<h2 class="text-sm font-bold text-gray-700">&#x1F3A8; テーマカラー</h2>
		<p class="text-xs text-gray-500">
			こどもごとにテーマカラーを設定できます。こども管理画面から変更してください。
		</p>
		<div class="flex gap-2">
			{#each themeOptions as theme}
				<div class="w-10 h-10 rounded-full border-2 border-gray-200 flex items-center justify-center text-lg" title={theme.label}>
					{@html theme.icon}
				</div>
			{/each}
		</div>
	</section>

	<!-- Data Management -->
	<section class="bg-white rounded-xl p-4 shadow-sm space-y-3">
		<h2 class="text-sm font-bold text-gray-700">&#x1F4BE; データ管理</h2>
		<p class="text-xs text-gray-500">
			登録すると、データのエクスポート・インポート・初期化が利用できます。
		</p>
		<div class="grid grid-cols-3 gap-2">
			<div class="bg-gray-50 rounded-lg p-3 text-center">
				<span class="text-xl block mb-1">&#x1F4E4;</span>
				<p class="text-xs font-bold text-gray-400">エクスポート</p>
			</div>
			<div class="bg-gray-50 rounded-lg p-3 text-center">
				<span class="text-xl block mb-1">&#x1F4E5;</span>
				<p class="text-xs font-bold text-gray-400">インポート</p>
			</div>
			<div class="bg-gray-50 rounded-lg p-3 text-center">
				<span class="text-xl block mb-1">&#x1F5D1;&#xFE0F;</span>
				<p class="text-xs font-bold text-gray-400">初期化</p>
			</div>
		</div>
	</section>

	<!-- Feedback -->
	<section class="bg-white rounded-xl p-4 shadow-sm space-y-3">
		<h2 class="text-sm font-bold text-gray-700">&#x1F4AC; フィードバック</h2>
		<p class="text-xs text-gray-500">
			ご意見・ご要望・バグ報告をお寄せください。登録後に利用可能です。
		</p>
	</section>

	<DemoCta
		title="すべての設定を利用しませんか？"
		description="登録すると、PIN設定・ポイント表示・減衰設定などが自由にカスタマイズできます。"
	/>
</div>
