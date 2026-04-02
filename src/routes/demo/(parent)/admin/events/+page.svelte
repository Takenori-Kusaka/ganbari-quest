<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';

let { data } = $props();

interface SeasonEvent {
	id: number;
	code: string;
	name: string;
	description: string | null;
	eventType: string;
	startDate: string;
	endDate: string;
	bannerIcon: string;
	bannerColor: string | null;
	rewardConfig: string | null;
	isActive: number;
}

function isCurrentlyActive(event: SeasonEvent): boolean {
	const today = new Date().toISOString().slice(0, 10);
	return event.isActive === 1 && event.startDate <= today && event.endDate >= today;
}

function formatDate(d: string): string {
	return d.replace(/-/g, '/');
}
</script>

<svelte:head>
	<title>イベント管理（デモ） - がんばりクエスト</title>
</svelte:head>

<DemoBanner />

<div class="space-y-4">
	<h2 class="text-lg font-bold">🎉 シーズンイベント管理</h2>

	{#if data.events.length === 0}
		<div class="rounded-xl border bg-white p-8 text-center">
			<p class="text-2xl">🎪</p>
			<p class="mt-2 text-sm font-semibold text-gray-500">イベントはまだありません</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.events as event (event.id)}
				{@const active = isCurrentlyActive(event)}
				<div class="rounded-xl border bg-white p-4" class:border-amber-300={active}>
					<div class="flex items-center gap-2">
						<span class="text-xl">{event.bannerIcon}</span>
						<div>
							<h3 class="text-sm font-bold">
								{event.name}
								{#if active}
									<span
										class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
										>開催中</span
									>
								{/if}
							</h3>
							<p class="text-xs text-gray-500">
								<code class="rounded bg-gray-100 px-1">{event.code}</code>
								· {formatDate(event.startDate)} 〜 {formatDate(event.endDate)}
								· {event.eventType}
							</p>
							{#if event.description}
								<p class="mt-1 text-xs text-gray-600">{event.description}</p>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<DemoCta title="イベント管理を使ってみませんか？" description="期間限定イベントでお子さまのやる気を引き出そう！" />
</div>
