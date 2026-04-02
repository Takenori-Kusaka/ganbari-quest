<script lang="ts">
import { enhance } from '$app/forms';

let { data, form } = $props();

let creating = $state(false);

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
	<title>イベント管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold">🎉 シーズンイベント管理</h2>
		<button
			class="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-white"
			onclick={() => { creating = !creating; }}
		>
			{creating ? 'キャンセル' : '＋ 新規イベント'}
		</button>
	</div>

	{#if form?.error}
		<div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{form.error}</div>
	{/if}
	{#if form?.created}
		<div class="rounded-lg bg-green-50 p-3 text-sm text-green-700">イベントを作成しました</div>
	{/if}
	{#if form?.updated}
		<div class="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">イベントを更新しました</div>
	{/if}
	{#if form?.deleted}
		<div class="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">イベントを削除しました</div>
	{/if}

	<!-- Create form -->
	{#if creating}
		<form method="POST" action="?/create" use:enhance class="rounded-xl border bg-white p-4 space-y-3">
			<h3 class="font-bold text-sm">新規イベント作成</h3>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">コード</span>
					<input name="code" type="text" placeholder="spring-2026" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">名前</span>
					<input name="name" type="text" placeholder="しんがっきスタートダッシュ" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
			</div>
			<label class="block">
				<span class="text-xs font-semibold text-gray-600">説明</span>
				<input name="description" type="text" placeholder="新学期の目標を立てて活動しよう！"
					class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
			</label>
			<div class="grid grid-cols-3 gap-3">
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">種別</span>
					<select name="eventType" class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm">
						<option value="seasonal">季節</option>
						<option value="monthly">月次</option>
						<option value="campaign">キャンペーン</option>
					</select>
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">開始日</span>
					<input name="startDate" type="date" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">終了日</span>
					<input name="endDate" type="date" required
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">アイコン</span>
					<input name="bannerIcon" type="text" value="🎉"
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
				<label class="block">
					<span class="text-xs font-semibold text-gray-600">バナー色（CSS）</span>
					<input name="bannerColor" type="text" placeholder="linear-gradient(135deg, #fef3c7, #fde68a)"
						class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
				</label>
			</div>
			<label class="block">
				<span class="text-xs font-semibold text-gray-600">報酬設定（JSON）</span>
				<input name="rewardConfig" type="text" placeholder={'{"points":50,"title":"スタートダッシュ達成！"}'}
					class="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm" />
			</label>
			<button type="submit" class="w-full rounded-lg bg-amber-500 py-2 text-sm font-bold text-white">
				作成
			</button>
		</form>
	{/if}

	<!-- Event list -->
	{#if data.events.length === 0}
		<div class="rounded-xl border bg-white p-8 text-center">
			<p class="text-2xl">🎪</p>
			<p class="mt-2 text-sm font-semibold text-gray-500">イベントはまだありません</p>
			<p class="text-xs text-gray-400">上のボタンから作成してください</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.events as event (event.id)}
				{@const active = isCurrentlyActive(event)}
				<div class="rounded-xl border bg-white p-4" class:border-amber-300={active}>
					<div class="flex items-start justify-between gap-2">
						<div class="flex items-center gap-2">
							<span class="text-xl">{event.bannerIcon}</span>
							<div>
								<h3 class="font-bold text-sm">
									{event.name}
									{#if active}
										<span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">開催中</span>
									{/if}
									{#if event.isActive === 0}
										<span class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">無効</span>
									{/if}
								</h3>
								<p class="text-xs text-gray-500">
									<code class="bg-gray-100 px-1 rounded">{event.code}</code>
									· {formatDate(event.startDate)} 〜 {formatDate(event.endDate)}
									· {event.eventType}
								</p>
								{#if event.description}
									<p class="text-xs text-gray-600 mt-1">{event.description}</p>
								{/if}
							</div>
						</div>
						<form method="POST" action="?/delete" use:enhance
							onsubmit={(e) => { if (!confirm(`「${event.name}」を削除しますか？`)) e.preventDefault(); }}
						>
							<input type="hidden" name="id" value={event.id} />
							<button type="submit" class="text-xs text-red-400 hover:text-red-600">削除</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
