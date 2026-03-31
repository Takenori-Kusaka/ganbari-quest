<script lang="ts">
import { getCategoryByCode } from '$lib/domain/validation/activity.js';

let { data } = $props();

const pack = $derived(data.pack);

// Group activities by category
const groupedActivities = $derived.by(() => {
	const groups = new Map<string, typeof pack.activities>();
	for (const activity of pack.activities) {
		const catDef = getCategoryByCode(activity.categoryCode);
		const label = catDef?.name ?? activity.categoryCode;
		if (!groups.has(label)) {
			groups.set(label, []);
		}
		groups.get(label)?.push(activity);
	}
	return [...groups.entries()];
});
</script>

<svelte:head>
	<title>{pack.packName} - かつどうパック - がんばりクエスト</title>
	<meta name="description" content={pack.description} />
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-amber-50 to-orange-50">
	<div class="max-w-2xl mx-auto px-4 py-8">
		<!-- Back link -->
		<a href="/activity-packs" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
			&larr; かつどうパック一覧
		</a>

		<!-- Pack header -->
		<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
			<div class="flex items-start gap-4 mb-4">
				<span class="text-4xl">{pack.icon}</span>
				<div class="flex-1">
					<h1 class="text-xl font-bold text-gray-800 mb-1">{pack.packName}</h1>
					<p class="text-sm text-gray-500">
						{pack.targetAgeMin}〜{pack.targetAgeMax}歳向け ・ {pack.activities.length}件のかつどう
					</p>
				</div>
			</div>
			<p class="text-sm text-gray-600 mb-4">{pack.description}</p>
			<div class="flex flex-wrap gap-1.5">
				{#each pack.tags as tag}
					<span class="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{tag}</span>
				{/each}
			</div>
		</div>

		<!-- Activity list by category -->
		{#each groupedActivities as [categoryName, activities]}
			{@const catDef = getCategoryByCode(activities[0]?.categoryCode ?? 'seikatsu')}
			<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mb-4">
				<h2 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1">
					<span>{catDef?.icon ?? ''}</span>
					{categoryName}
					<span class="text-xs text-gray-400 font-normal ml-auto">{activities.length}件</span>
				</h2>
				<div class="space-y-2">
					{#each activities as activity}
						<div class="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
							<span class="text-xl w-8 text-center flex-shrink-0">{activity.icon}</span>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-gray-700 truncate">{activity.name}</p>
								{#if activity.triggerHint}
									<p class="text-xs text-gray-400 truncate">{activity.triggerHint}</p>
								{/if}
							</div>
							<span class="text-xs text-amber-500 font-bold flex-shrink-0">+{activity.basePoints}pt</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}

		<!-- CTA -->
		<div class="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border border-orange-200 p-6 text-center mb-6">
			<p class="text-sm font-bold text-gray-700 mb-1">このパックを使ってみませんか？</p>
			<p class="text-xs text-gray-500 mb-3">
				アカウント登録後、管理画面からインポートできます
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
