<script lang="ts">
import Logo from '$lib/ui/components/Logo.svelte';

let { data } = $props();
</script>

<svelte:head>
	<title>かつどうパック - がんばりクエスト</title>
	<meta name="description" content="お子さまの年齢に合った活動セット。がんばりクエストのプリセットパックで、すぐに始められます。" />
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-amber-50 to-orange-50">
	<div class="max-w-2xl mx-auto px-4 py-8">
		<!-- Header -->
		<div class="text-center mb-8">
			<div class="flex justify-center mb-3">
				<Logo variant="compact" size={160} />
			</div>
			<h1 class="text-2xl font-bold text-gray-800 mb-2">かつどうパック</h1>
			<p class="text-sm text-gray-600">
				お子さまの年齢に合った活動セットで<br />すぐに始められます
			</p>
		</div>

		<!-- Pack cards -->
		<div class="grid grid-cols-2 gap-4 mb-8">
			{#each data.packs as pack}
				<a
					href="/activity-packs/{pack.packId}"
					class="block bg-white rounded-2xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
				>
					<span class="text-3xl block mb-2">{pack.icon}</span>
					<h2 class="text-sm font-bold text-gray-800 mb-1">{pack.packName}</h2>
					<p class="text-xs text-gray-500 mb-2">
						{pack.targetAgeMin}〜{pack.targetAgeMax}歳 / {pack.activityCount}件
					</p>
					<div class="flex flex-wrap gap-1">
						{#each pack.tags as tag}
							<span class="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">{tag}</span>
						{/each}
					</div>
				</a>
			{/each}
		</div>

		<!-- CTA -->
		<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center mb-6">
			<p class="text-sm font-bold text-gray-700 mb-1">パックをインポートするには</p>
			<p class="text-xs text-gray-500 mb-3">
				アカウント登録後、管理画面からワンタップでインポートできます
			</p>
			<a
				href="/auth/signup"
				class="block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-sm"
			>
				無料で はじめる
			</a>
			<p class="text-xs text-gray-400 mt-2">7日間無料トライアル付き</p>
		</div>

		<!-- Demo link -->
		<div class="text-center">
			<a href="/demo" class="text-sm text-blue-500 hover:underline">
				デモを体験してみる
			</a>
		</div>
	</div>
</div>
