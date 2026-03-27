<script lang="ts">
import { formatPointValue } from '$lib/domain/point-display';
import Logo from '$lib/ui/components/Logo.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
</script>

<svelte:head>
	<title>管理画面 - がんばりクエスト デモ</title>
</svelte:head>

<div data-theme="admin" class="min-h-dvh bg-gradient-to-b from-blue-50 to-blue-100">
	<!-- Admin Header -->
	<header class="sticky top-10 z-30 bg-white/80 backdrop-blur border-b border-gray-200 px-4 py-3">
		<div class="max-w-4xl mx-auto flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Logo variant="compact" />
				<span class="text-xs font-medium text-gray-400 border border-gray-300 rounded px-1.5 py-0.5">管理</span>
			</div>
			<a
				href="/demo"
				class="text-sm px-3 py-1 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-colors"
			>
				デモトップへ
			</a>
		</div>
	</header>

	<main class="max-w-4xl mx-auto p-4">
		<!-- Dashboard overview -->
		<h2 class="text-xl font-bold text-gray-700 mb-4">ダッシュボード</h2>

		<!-- Stats cards -->
		<div class="grid grid-cols-2 gap-3 mb-6">
			<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
				<p class="text-sm text-gray-500">こども</p>
				<p class="text-3xl font-bold text-blue-500">{data.children.length}</p>
			</div>
			<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
				<p class="text-sm text-gray-500">かつどう</p>
				<p class="text-3xl font-bold text-green-500">{data.activities.length}</p>
			</div>
			<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
				<p class="text-sm text-gray-500">きろく数</p>
				<p class="text-3xl font-bold text-purple-500">{data.totalLogs}</p>
			</div>
			<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
				<p class="text-sm text-gray-500">合計ポイント</p>
				<p class="text-3xl font-bold text-amber-500">{fmtPts(data.totalPoints)}</p>
			</div>
		</div>

		<!-- Children list -->
		<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
			<h3 class="text-lg font-bold text-gray-700 mb-3">こどもたち</h3>
			<div class="space-y-3">
				{#each data.children as child}
					<a
						href="/demo/{child.uiMode}/home?childId={child.id}"
						class="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-50 transition-colors"
					>
						<div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-lg">
							{#if child.uiMode === 'baby'}👶{:else if child.uiMode === 'kinder'}🧒{:else if child.uiMode === 'lower'}🧑{:else}🧑‍💻{/if}
						</div>
						<div class="flex-1">
							<p class="font-bold text-gray-700">{child.nickname}</p>
							<p class="text-sm text-gray-500">{child.age}さい</p>
						</div>
						<span class="text-gray-400">›</span>
					</a>
				{/each}
			</div>
		</div>

		<!-- Feature navigation -->
		<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
			<h3 class="text-lg font-bold text-gray-700 mb-3">管理メニュー</h3>
			<div class="grid grid-cols-3 gap-2">
				{#each [
					{ icon: '📋', label: 'かつどう', desc: '活動の追加・編集' },
					{ icon: '✅', label: 'もちもの', desc: 'チェックリスト管理' },
					{ icon: '🎁', label: 'ごほうび', desc: '特別報酬の付与' },
					{ icon: '⭐', label: 'ポイント', desc: 'ポイント管理' },
					{ icon: '🏆', label: 'じっせき', desc: '実績・ライフイベント' },
					{ icon: '📊', label: 'ステータス', desc: '成長データ確認' },
					{ icon: '🌟', label: 'キャリア', desc: 'キャリアプラン管理' },
					{ icon: '👥', label: 'メンバー', desc: '家族メンバー管理' },
					{ icon: '⚙️', label: 'せってい', desc: 'PIN・表示設定' },
				] as item}
					<div class="flex flex-col items-center p-3 rounded-lg bg-gray-50 text-center">
						<span class="text-2xl mb-1">{item.icon}</span>
						<span class="text-sm font-bold text-gray-700">{item.label}</span>
						<span class="text-xs text-gray-400 mt-0.5">{item.desc}</span>
					</div>
				{/each}
			</div>
			<p class="text-xs text-amber-500 text-center mt-4">
				（デモモード：個別の管理画面は閲覧のみです）
			</p>
		</div>
	</main>
</div>
