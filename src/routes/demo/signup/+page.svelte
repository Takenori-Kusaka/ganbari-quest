<script lang="ts">
import { trackDemoEvent } from '$lib/features/demo/demo-analytics.js';
import Logo from '$lib/ui/components/Logo.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

// Track conversion page view
trackDemoEvent('demo_signup_page');

function handleCtaClick() {
	trackDemoEvent('demo_cta_click', { location: 'signup_page' });
}
</script>

<svelte:head>
	<title>デモ体験ありがとうございます - がんばりクエスト</title>
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-amber-50 to-orange-50">
	<div class="max-w-lg mx-auto px-4 py-8">
		<!-- Hero -->
		<div class="text-center mb-8">
			<div class="flex justify-center mb-4">
				<Logo variant="compact" size={160} />
			</div>
			<h1 class="text-2xl font-bold text-gray-800 mb-2">
				デモ体験ありがとうございます！
			</h1>
			<p class="text-gray-600">
				お子さまの「がんばり」を<br />冒険に変えてみませんか？
			</p>
		</div>

		<!-- Primary CTA -->
		<Card variant="elevated" padding="lg" class="border border-orange-200 mb-6 text-center">
			{#snippet children()}
			<p class="text-lg font-bold text-gray-700 mb-1">7日間の無料トライアル</p>
			<p class="text-sm text-gray-500 mb-4">クレジットカード登録不要で今すぐ始められます</p>
			<a
				href="/auth/signup"
				onclick={handleCtaClick}
				class="block w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-lg shadow-sm hover:shadow-md transition-shadow"
			>
				無料で はじめる
			</a>
			<p class="text-xs text-gray-400 mt-2">いつでもキャンセルOK・違約金なし</p>
			{/snippet}
		</Card>

		<!-- Value propositions -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-gray-700 mb-4">がんばりクエストでできること</h2>
			<div class="space-y-4">
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">📋</span>
					<div>
						<p class="font-bold text-gray-700 text-sm">お子さまの名前で記録</p>
						<p class="text-xs text-gray-500">デモでは保存されませんが、本番ではすべて安全に保存されます</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">📊</span>
					<div>
						<p class="font-bold text-gray-700 text-sm">成長の可視化</p>
						<p class="text-xs text-gray-500">月次レポートでお子さまの成長傾向をレーダーチャートで確認</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">🎯</span>
					<div>
						<p class="font-bold text-gray-700 text-sm">デイリーミッション</p>
						<p class="text-xs text-gray-500">毎日の目標で「続ける力」を自然に育てます</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">👨‍👩‍👧‍👦</span>
					<div>
						<p class="font-bold text-gray-700 text-sm">家族みんなで管理</p>
						<p class="text-xs text-gray-500">きょうだいをまとめて管理。家族メンバーの招待も可能</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">🔒</span>
					<div>
						<p class="font-bold text-gray-700 text-sm">安心・安全</p>
						<p class="text-xs text-gray-500">PIN認証で子供のデータを保護。広告なし・データ販売なし</p>
					</div>
				</div>
			</div>
			{/snippet}
		</Card>

		<!-- Pricing summary -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-gray-700 mb-4">料金プラン</h2>
			<div class="grid grid-cols-2 gap-3">
				<div class="rounded-xl border border-gray-200 p-4 text-center">
					<p class="text-sm text-gray-500 mb-1">月額プラン</p>
					<p class="text-2xl font-bold text-gray-800">¥500<span class="text-sm font-normal text-gray-400">/月</span></p>
				</div>
				<div class="rounded-xl border-2 border-purple-400 p-4 text-center relative">
					<span class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">おすすめ</span>
					<p class="text-sm text-gray-500 mb-1">年額プラン</p>
					<p class="text-2xl font-bold text-gray-800">¥5,000<span class="text-sm font-normal text-gray-400">/年</span></p>
					<p class="text-xs text-purple-500 font-medium mt-1">2ヶ月分お得</p>
				</div>
			</div>
			<a href="/pricing" class="block text-center text-sm text-blue-500 mt-3 hover:underline">
				料金プランの詳細を見る
			</a>
			{/snippet}
		</Card>

		<!-- Secondary CTA -->
		<div class="text-center mb-8">
			<a
				href="/auth/signup"
				class="inline-block w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-lg shadow-sm hover:shadow-md transition-shadow"
			>
				無料トライアルを はじめる
			</a>
			<p class="text-xs text-gray-400 mt-2">7日間無料 ・ いつでもキャンセルOK</p>
		</div>

		<!-- Back to demo -->
		<div class="text-center">
			<a href="/demo" class="text-sm text-gray-400 hover:text-gray-600 transition-colors">
				デモに戻る
			</a>
		</div>
	</div>
</div>
