<script lang="ts">
import { trackDemoEvent } from '$lib/features/demo/demo-analytics.js';
import {
	getGuideState,
	resetGuide,
	restartGuide,
	startGuide,
} from '$lib/features/demo/demo-guide-state.svelte.js';
import Logo from '$lib/ui/components/Logo.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const guide = getGuideState();

// Reset guide state when navigating back to /demo top
// This clears the overlay so it doesn't persist on the top page
$effect(() => {
	resetGuide();
});

function handleGuideStart() {
	startGuide();
	trackDemoEvent('demo_guide_start');
}

function handleGuideRestart() {
	restartGuide();
	trackDemoEvent('demo_guide_start', { restart: true });
}

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

		<!-- Guided demo option -->
		<div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5 mb-6 text-center">
			{#if guide.dismissed}
				<p class="text-sm font-bold text-gray-700 mb-1">ガイドをとじました</p>
				<p class="text-xs text-gray-500 mb-3">もう一度はじめから体験できます</p>
				<a
					href="/demo/kinder/home?childId=902"
					class="block w-full py-2.5 bg-blue-500 text-white font-bold rounded-xl text-sm hover:bg-blue-600 transition-colors"
					onclick={handleGuideRestart}
				>
					ガイドを再開する
				</a>
			{:else}
				<p class="text-sm font-bold text-gray-700 mb-1">はじめてですか？</p>
				<p class="text-xs text-gray-500 mb-3">5ステップで主な機能をご案内します</p>
				<a
					href="/demo/kinder/home?childId=902"
					class="block w-full py-2.5 bg-blue-500 text-white font-bold rounded-xl text-sm hover:bg-blue-600 transition-colors"
					onclick={handleGuideStart}
				>
					ガイド付きデモを はじめる
				</a>
			{/if}
		</div>

		<!-- Family Introduction -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
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
			{/snippet}
		</Card>

		<!-- Admin Link -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
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
			{/snippet}
		</Card>

		<!-- Feature highlights -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
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
			{/snippet}
		</Card>

		<!-- Conversion CTA -->
		<div class="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border border-orange-200 p-6 text-center">
			<p class="text-sm font-bold text-gray-700 mb-1">お子さまの冒険、はじめませんか？</p>
			<p class="text-xs text-gray-500 mb-3">7日間無料 ・ いつでもキャンセルOK</p>
			<a
				href="/demo/signup"
				class="block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-sm"
			>
				無料で はじめる
			</a>
		</div>
	</div>
</div>
