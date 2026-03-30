<script lang="ts">
import { formatPointValue } from '$lib/domain/point-display';
import { getActivityDisplayNameForAdult } from '$lib/domain/validation/activity';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

const groupedActivities = $derived.by(() => {
	const groups: Record<number, typeof data.activities> = {};
	for (const cat of data.categoryDefs) {
		groups[cat.id] = data.activities.filter((a) => a.categoryId === cat.id);
	}
	return groups;
});
</script>

<svelte:head>
	<title>活動管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-bold text-gray-700">活動管理</h1>
		<span class="text-xs text-gray-400">{data.activities.length}件</span>
	</div>

	<!-- Demo Notice -->
	<div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
		<span class="text-amber-500">&#x26A0;&#xFE0F;</span>
		<p class="text-sm text-amber-700">デモモードのため、変更はできません</p>
	</div>

	<!-- Activities grouped by category -->
	{#each data.categoryDefs as catDef (catDef.id)}
		{@const activities = groupedActivities[catDef.id] ?? []}
		{#if activities.length > 0}
			<section>
				<div class="flex items-center gap-2 mb-3">
					<span class="text-xl">{catDef.icon}</span>
					<h2 class="text-base font-bold" style="color: {catDef.accent};">{catDef.name}</h2>
					<span class="text-xs text-gray-400 ml-auto">{activities.length}件</span>
				</div>
				<div class="grid gap-2">
					{#each activities as activity (activity.id)}
						<div class="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
							<span class="text-2xl">{activity.icon}</span>
							<div class="flex-1 min-w-0">
								<p class="font-bold text-gray-700 text-sm truncate">
									{getActivityDisplayNameForAdult(activity)}
								</p>
								{#if activity.ageMin != null || activity.ageMax != null}
									<p class="text-xs text-gray-400">
										{#if activity.ageMin != null && activity.ageMax != null}
											{activity.ageMin}〜{activity.ageMax}歳
										{:else if activity.ageMin != null}
											{activity.ageMin}歳〜
										{:else if activity.ageMax != null}
											〜{activity.ageMax}歳
										{/if}
									</p>
								{/if}
							</div>
							<div class="text-right">
								<p class="text-sm font-bold text-amber-500">{fmtPts(activity.basePoints)}</p>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/each}

	<!-- Demo CTA -->
	<div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 rounded-xl p-4 text-center">
		<p class="text-sm font-bold text-gray-700 mb-1">活動をカスタマイズしませんか？</p>
		<p class="text-xs text-gray-500 mb-3">
			登録すると、お子さまに合わせた活動を自由に追加・編集できます。
		</p>
		<a
			href="/demo/signup"
			class="inline-block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-sm"
		>
			無料で はじめる &rarr;
		</a>
	</div>
</div>
