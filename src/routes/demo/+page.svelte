<script lang="ts">
import Logo from '$lib/ui/components/Logo.svelte';

let { data } = $props();

const modeLabels: Record<string, string> = {
	baby: 'はじめの一歩',
	kinder: 'じぶんでタップ',
	lower: '冒険スタート',
	upper: 'チャレンジ',
	teen: 'みらい設計',
};

const modeColors: Record<string, string> = {
	baby: 'from-pink-400 to-pink-300',
	kinder: 'from-green-400 to-emerald-300',
	lower: 'from-blue-400 to-cyan-300',
	upper: 'from-purple-400 to-violet-300',
	teen: 'from-indigo-400 to-blue-300',
};
</script>

<div class="min-h-dvh bg-gradient-to-b from-amber-50 to-orange-50">
	<div class="max-w-2xl mx-auto px-4 py-8">
		<!-- Hero -->
		<div class="text-center mb-8">
			<div class="flex items-center justify-center gap-2 mb-2">
				<Logo variant="compact" size={180} />
			</div>
			<p class="text-xl font-semibold text-gray-600">デモ体験</p>
			<p class="text-gray-600">
				がんばり家のみんなと一緒に、アプリの機能を体験してみましょう！
			</p>
		</div>

		<!-- Family Introduction -->
		<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
			<h2 class="text-lg font-bold text-gray-700 mb-4">がんばり家のこどもたち</h2>
			<div class="grid grid-cols-2 gap-3">
				{#each data.children as child}
					{@const mode = child.uiMode ?? 'kinder'}
					{@const label = modeLabels[mode] ?? mode}
					{@const colorClass = modeColors[mode] ?? 'from-gray-400 to-gray-300'}
					<a
						href="/demo/{mode}/home?childId={child.id}"
						class="block rounded-xl p-4 bg-gradient-to-br {colorClass} text-white shadow-sm hover:shadow-md transition-shadow"
					>
						<div class="text-2xl mb-1">
							{#if mode === 'baby'}
								👶
							{:else if mode === 'kinder'}
								🧒
							{:else if mode === 'lower'}
								🧑
							{:else}
								🧑‍💻
							{/if}
						</div>
						<div class="font-bold text-lg">{child.nickname}</div>
						<div class="text-sm opacity-90">{child.age}さい・{label}</div>
					</a>
				{/each}
			</div>
		</div>

		<!-- Admin Link -->
		<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
			<h2 class="text-lg font-bold text-gray-700 mb-3">おやの管理画面</h2>
			<p class="text-sm text-gray-500 mb-4">
				活動の追加、こどもの管理、ポイント確認などの管理機能を体験できます。
			</p>
			<a
				href="/demo/admin"
				class="block w-full text-center py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-colors"
			>
				管理画面をみる
			</a>
		</div>

		<!-- Feature highlights -->
		<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
			<h2 class="text-lg font-bold text-gray-700 mb-4">体験できる機能</h2>
			<ul class="space-y-3 text-sm text-gray-600">
				<li class="flex gap-2">
					<span class="text-lg">📋</span>
					<div>
						<span class="font-medium text-gray-700">活動きろく</span>
						— お子さまの日々のがんばりをワンタップで記録
					</div>
				</li>
				<li class="flex gap-2">
					<span class="text-lg">⭐</span>
					<div>
						<span class="font-medium text-gray-700">ステータス</span>
						— 5軸のレーダーチャートで成長を可視化
					</div>
				</li>
				<li class="flex gap-2">
					<span class="text-lg">🏆</span>
					<div>
						<span class="font-medium text-gray-700">実績・称号</span>
						— がんばりに応じて実績を解除、称号を獲得
					</div>
				</li>
				<li class="flex gap-2">
					<span class="text-lg">🎯</span>
					<div>
						<span class="font-medium text-gray-700">デイリーミッション</span>
						— 毎日の目標で継続をサポート
					</div>
				</li>
				<li class="flex gap-2">
					<span class="text-lg">🌟</span>
					<div>
						<span class="font-medium text-gray-700">キャリアプラン</span>
						— 将来の夢に向けた目標設定（中高生向け）
					</div>
				</li>
			</ul>
		</div>
	</div>
</div>
