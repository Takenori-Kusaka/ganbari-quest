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

<div class="min-h-dvh bg-gradient-to-b from-[var(--color-feedback-warning-bg)] to-[var(--color-feedback-warning-bg)]">
	<div class="max-w-lg mx-auto px-4 py-8">
		<!-- Hero -->
		<div class="text-center mb-8">
			<div class="flex justify-center mb-4">
				<Logo variant="compact" size={160} />
			</div>
			<h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">
				デモ体験ありがとうございます！
			</h1>
			<p class="text-[var(--color-text)]">
				お子さまの「がんばり」を<br />冒険に変えてみませんか？
			</p>
		</div>

		<!-- Primary CTA -->
		<Card variant="elevated" padding="lg" class="border border-[var(--color-feedback-warning-border)] mb-6 text-center">
			{#snippet children()}
			<p class="text-lg font-bold text-[var(--color-text)] mb-1">7日間の無料トライアル</p>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">クレジットカード登録不要で今すぐ始められます</p>
			<a
				href="/auth/signup"
				onclick={handleCtaClick}
				class="block w-full py-3 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-warning)] text-white font-bold rounded-xl text-center text-lg shadow-sm hover:shadow-md transition-shadow"
			>
				無料で はじめる
			</a>
			<p class="text-xs text-[var(--color-text-muted)] mt-2">いつでもキャンセルOK・違約金なし</p>
			{/snippet}
		</Card>

		<!-- Value propositions -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-[var(--color-text)] mb-4">がんばりクエストでできること</h2>
			<div class="space-y-4">
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">📋</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">お子さまの名前で記録</p>
						<p class="text-xs text-[var(--color-text-muted)]">デモでは保存されませんが、本番ではすべて安全に保存されます</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">📊</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">成長の可視化</p>
						<p class="text-xs text-[var(--color-text-muted)]">月次レポートでお子さまの成長傾向をレーダーチャートで確認</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">🎯</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">デイリーミッション</p>
						<p class="text-xs text-[var(--color-text-muted)]">毎日の目標で「続ける力」を自然に育てます</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">👨‍👩‍👧‍👦</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">家族みんなで管理</p>
						<p class="text-xs text-[var(--color-text-muted)]">きょうだいをまとめて管理。家族メンバーの招待も可能</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">🔒</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">安心・安全</p>
						<p class="text-xs text-[var(--color-text-muted)]">PIN認証で子供のデータを保護。広告なし・データ販売なし</p>
					</div>
				</div>
			</div>
			{/snippet}
		</Card>

		<!-- Pricing summary -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-[var(--color-text)] mb-4">料金プラン</h2>
			<div class="grid grid-cols-2 gap-3">
				<div class="rounded-xl border border-[var(--color-border-default)] p-4 text-center">
					<p class="text-sm text-[var(--color-text-muted)] mb-1">月額プラン</p>
					<p class="text-2xl font-bold text-[var(--color-text)]">¥500<span class="text-sm font-normal text-[var(--color-text-muted)]">/月</span></p>
				</div>
				<div class="rounded-xl border-2 border-[var(--color-premium)] p-4 text-center relative">
					<span class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[var(--color-stat-purple)] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">おすすめ</span>
					<p class="text-sm text-[var(--color-text-muted)] mb-1">年額プラン</p>
					<p class="text-2xl font-bold text-[var(--color-text)]">¥5,000<span class="text-sm font-normal text-[var(--color-text-muted)]">/年</span></p>
					<p class="text-xs text-[var(--color-premium-light)] font-medium mt-1">2ヶ月分お得</p>
				</div>
			</div>
			<a href="/pricing" class="block text-center text-sm text-[var(--color-brand-500)] mt-3 hover:underline">
				料金プランの詳細を見る
			</a>
			{/snippet}
		</Card>

		<!-- Testimonial / Social proof -->
		<div class="bg-gradient-to-r from-[var(--color-feedback-warning-bg)] to-[var(--color-feedback-warning-bg)] rounded-2xl border border-[var(--color-feedback-warning-border)] p-6 mb-6">
			<h2 class="text-lg font-bold text-[var(--color-text)] mb-3 text-center">ご利用者の声</h2>
			<div class="space-y-3">
				<div class="bg-[var(--color-surface-card)] rounded-xl p-3">
					<p class="text-sm text-[var(--color-text)] italic">「毎朝、自分からスタンプを押したがるようになりました」</p>
					<p class="text-xs text-[var(--color-text-muted)] mt-1 text-right">— 5歳男の子のママ</p>
				</div>
				<div class="bg-[var(--color-surface-card)] rounded-xl p-3">
					<p class="text-sm text-[var(--color-text)] italic">「お手伝いが楽しいゲームに変わった。親も記録が楽」</p>
					<p class="text-xs text-[var(--color-text-muted)] mt-1 text-right">— 8歳女の子のパパ</p>
				</div>
			</div>
		</div>

		<!-- Secondary CTA -->
		<div class="text-center mb-8">
			<a
				href="/auth/signup"
				class="inline-block w-full py-3 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-warning)] text-white font-bold rounded-xl text-center text-lg shadow-sm hover:shadow-md transition-shadow"
			>
				無料トライアルを はじめる
			</a>
			<p class="text-xs text-[var(--color-text-muted)] mt-2">7日間無料 ・ いつでもキャンセルOK</p>
		</div>

		<!-- Back to demo -->
		<div class="text-center">
			<a href="/demo" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
				デモに戻る
			</a>
		</div>
	</div>
</div>
