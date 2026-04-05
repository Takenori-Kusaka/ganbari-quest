<script lang="ts">
import Logo from '$lib/ui/components/Logo.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
</script>

<svelte:head>
	<title>かつどうパック - がんばりクエスト</title>
	<meta name="description" content="お子さまの年齢に合った活動セット。がんばりクエストのプリセットパックで、すぐに始められます。" />
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-[var(--color-feedback-warning-bg)] to-[var(--color-orange-50)]">	<div class="max-w-2xl mx-auto px-4 py-8">		<!-- Header -->		<div class="text-center mb-8">
			<div class="flex justify-center mb-3">
				<Logo variant="compact" size={160} />
			</div>
			<h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">かつどうパック</h1>
			<p class="text-sm text-[var(--color-text)]">
				お子さまの年齢に合った活動セットで<br />すぐに始められます
			</p>
		</div>

		<!-- Pack cards -->
		<div class="grid grid-cols-2 gap-4 mb-8">
			{#each data.packs as pack}
				<a
					href="/activity-packs/{pack.packId}"
					class="block hover:shadow-md transition-shadow"
				>
					<Card padding="lg">
						{#snippet children()}
						<span class="text-3xl block mb-2">{pack.icon}</span>
						<h2 class="text-sm font-bold text-[var(--color-text)] mb-1">{pack.packName}</h2>
						<p class="text-xs text-[var(--color-text-muted)] mb-2">
							{pack.targetAgeMin}〜{pack.targetAgeMax}歳 / {pack.activityCount}件
						</p>
						<div class="flex flex-wrap gap-1">
							{#each pack.tags as tag}
								<span class="text-[10px] bg-[var(--color-feedback-warning-bg)] text-[var(--color-feedback-warning-text)] px-1.5 py-0.5 rounded-full">{tag}</span>
							{/each}
						</div>
						{/snippet}
					</Card>
				</a>
			{/each}
		</div>

		<!-- CTA -->
		<Card variant="default" padding="lg" class="text-center mb-6">
			{#snippet children()}
			<p class="text-sm font-bold text-[var(--color-text)] mb-1">パックをインポートするには</p>
			<p class="text-xs text-[var(--color-text-muted)] mb-3">
				アカウント登録後、管理画面からワンタップでインポートできます
			</p>
			<a
				href="/auth/signup"
				class="block w-full py-2.5 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-orange-500)] text-white font-bold rounded-xl text-sm"			>				無料で はじめる
			</a>
			<p class="text-xs text-[var(--color-text-muted)] mt-2">7日間無料トライアル付き</p>
			{/snippet}
		</Card>

		<!-- Demo link -->
		<div class="text-center">
			<a href="/demo" class="text-sm text-[var(--color-brand-500)] hover:underline">
				デモを体験してみる
			</a>
		</div>
	</div>
</div>
