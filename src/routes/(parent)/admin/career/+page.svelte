<script lang="ts">
import { createEmptyMandalaChart } from '$lib/domain/validation/career';
import MandalaChart from '$lib/features/career/components/MandalaChart.svelte';

let { data } = $props();

let expandedChild = $state<number | null>(null);

function toggleChild(childId: number) {
	expandedChild = expandedChild === childId ? null : childId;
}
</script>

<svelte:head>
	<title>キャリアプラン管理 - がんばりクエスト</title>
</svelte:head>

{#if data.children.length === 0}
	<p class="text-gray-500">子供が登録されていません。</p>
{:else}
	{#each data.children as child}
		<div class="bg-white rounded-lg shadow-sm mb-4 overflow-hidden">
			<button
				class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
				onclick={() => toggleChild(child.id)}
			>
				<div class="flex items-center gap-3">
					<span class="text-2xl">{child.plan?.careerField?.icon ?? '🌟'}</span>
					<div>
						<span class="font-bold text-gray-800">{child.nickname}</span>
						<span class="text-sm text-gray-500 ml-2">({child.age}さい)</span>
						{#if child.plan}
							<p class="text-sm text-blue-600 mt-0.5">
								{child.plan.careerField?.name ?? child.plan.dreamText ?? 'プラン作成済み'}
							</p>
						{:else}
							<p class="text-sm text-gray-400 mt-0.5">プラン未作成</p>
						{/if}
					</div>
				</div>
				<span class="text-gray-400 text-lg">{expandedChild === child.id ? '▲' : '▼'}</span>
			</button>

			{#if expandedChild === child.id && child.plan}
				<div class="border-t border-gray-100 p-4">
					<!-- 選択した職業 -->
					{#if child.plan.careerField}
						<div class="flex items-center gap-2 mb-4 p-3 bg-amber-50 rounded-lg">
							<span class="text-xl">{child.plan.careerField.icon ?? '💼'}</span>
							<div>
								<span class="font-bold">{child.plan.careerField.name}</span>
								{#if child.plan.careerField.description}
									<p class="text-xs text-gray-500">{child.plan.careerField.description}</p>
								{/if}
							</div>
						</div>
					{/if}

					<!-- 夢のテキスト -->
					{#if child.plan.dreamText}
						<div class="mb-4">
							<h3 class="text-sm font-bold text-gray-600 mb-1">将来の夢</h3>
							<p class="text-gray-800">{child.plan.dreamText}</p>
						</div>
					{/if}

					<!-- マンダラチャート -->
					<div class="mb-4">
						<h3 class="text-sm font-bold text-gray-600 mb-2">マンダラチャート</h3>
						<MandalaChart
							chart={child.plan.mandalaChart ?? createEmptyMandalaChart()}
							readonly={true}
						/>
					</div>

					<!-- タイムライン -->
					{#if child.plan.timeline3y || child.plan.timeline5y || child.plan.timeline10y}
						<div class="mb-2">
							<h3 class="text-sm font-bold text-gray-600 mb-2">タイムライン</h3>
							<div class="space-y-2">
								{#if child.plan.timeline3y}
									<div class="flex items-start gap-2">
										<span class="text-sm">🌱</span>
										<div>
											<span class="text-xs font-bold text-green-600">3年後</span>
											<p class="text-sm text-gray-700">{child.plan.timeline3y}</p>
										</div>
									</div>
								{/if}
								{#if child.plan.timeline5y}
									<div class="flex items-start gap-2">
										<span class="text-sm">🌿</span>
										<div>
											<span class="text-xs font-bold text-green-600">5年後</span>
											<p class="text-sm text-gray-700">{child.plan.timeline5y}</p>
										</div>
									</div>
								{/if}
								{#if child.plan.timeline10y}
									<div class="flex items-start gap-2">
										<span class="text-sm">🌳</span>
										<div>
											<span class="text-xs font-bold text-green-600">10年後</span>
											<p class="text-sm text-gray-700">{child.plan.timeline10y}</p>
										</div>
									</div>
								{/if}
							</div>
						</div>
					{/if}

					<p class="text-xs text-gray-400 mt-2">
						バージョン: {child.plan.version} | 作成日: {child.plan.createdAt?.slice(0, 10) ?? '—'}
					</p>
				</div>
			{:else if expandedChild === child.id}
				<div class="border-t border-gray-100 p-4 text-center text-gray-400">
					<p>まだキャリアプランが作成されていません。</p>
					<p class="text-xs mt-1">子供が「つよさ」画面の「みらいのゆめ」から作成できます。</p>
				</div>
			{/if}
		</div>
	{/each}
{/if}
