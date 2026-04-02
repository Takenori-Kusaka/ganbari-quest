<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

let messageType = $state<'stamp' | 'text'>('stamp');
let selectedStamp = $state('');

const selectedChild = $derived(data.children.find((c: { id: number }) => c.id === selectedChildId));
</script>

<svelte:head>
	<title>おうえんメッセージ - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- Step 1: Select child -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">1. こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class={selectedChildId === child.id
						? ''
						: 'bg-white text-gray-600 shadow-sm hover:shadow-md'}
					onclick={() => (selectedChildId = child.id)}
				>
					{child.nickname}
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Choose message type -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">2. おうえんの種類</h3>
		<div class="flex gap-2 mb-3">
			<Button
				variant={messageType === 'stamp' ? 'primary' : 'ghost'}
				size="sm"
				class={messageType === 'stamp'
					? 'bg-pink-500'
					: 'bg-white text-gray-600 shadow-sm hover:shadow-md'}
				onclick={() => (messageType = 'stamp')}
			>
				スタンプ
			</Button>
			<Button
				variant={messageType === 'text' ? 'primary' : 'ghost'}
				size="sm"
				class={messageType === 'text'
					? 'bg-pink-500'
					: 'bg-white text-gray-600 shadow-sm hover:shadow-md'}
				onclick={() => (messageType = 'text')}
			>
				ひとことメッセージ
			</Button>
		</div>

		{#if messageType === 'stamp'}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
				{#each data.stamps as stamp}
					<Button
						variant="ghost"
						size="sm"
						class="bg-white rounded-xl p-3 shadow-sm hover:shadow-md
							{selectedStamp === stamp.code ? 'ring-2 ring-pink-400' : ''}"
						onclick={() => { selectedStamp = stamp.code; }}
					>
						<span class="text-3xl block">{stamp.icon}</span>
						<p class="text-xs font-bold text-gray-600 mt-1">{stamp.label}</p>
					</Button>
				{/each}
			</div>
		{:else}
			<div class="bg-white rounded-xl p-4 shadow-sm">
				<label class="block">
					<span class="block text-xs font-bold text-gray-500 mb-1">
						メッセージ（30文字以内）
					</span>
					<input
						type="text"
						maxlength={30}
						disabled
						placeholder="がんばってるね！だいすき！"
						class="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
					/>
				</label>
			</div>
		{/if}
	</section>

	<!-- Step 3: Send button (disabled) -->
	<div class="bg-white rounded-xl p-4 shadow-sm">
		<Button
			variant="ghost"
			size="md"
			class="w-full bg-gray-200 text-gray-400 cursor-not-allowed"
			disabled
		>
			デモではメッセージを送れません
		</Button>
	</div>

	<!-- Recent messages (demo data) -->
	{#if selectedChild?.recentMessages && selectedChild.recentMessages.length > 0}
		<section>
			<h3 class="text-sm font-bold text-gray-500 mb-2">最近のメッセージ</h3>
			<div class="space-y-2">
				{#each selectedChild.recentMessages as msg}
					<div class="bg-white rounded-xl p-3 shadow-sm flex items-center gap-3">
						<span class="text-2xl">{msg.icon}</span>
						<div class="flex-1 min-w-0">
							{#if msg.messageType === 'stamp' && msg.stampCode}
								{@const stamp = data.stamps.find(
									(s: { code: string }) => s.code === msg.stampCode,
								)}
								<p class="text-sm font-bold text-gray-700">
									{stamp?.label ?? msg.stampCode}
								</p>
							{:else if msg.body}
								<p class="text-sm font-bold text-gray-700">{msg.body}</p>
							{/if}
							<p class="text-xs text-gray-400">
								{new Date(msg.sentAt).toLocaleString('ja-JP')}
							</p>
						</div>
						{#if msg.shownAt}
							<span class="text-xs text-green-500">既読</span>
						{:else}
							<span class="text-xs text-orange-500">未読</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<DemoCta
		title="おうえんメッセージで親子のつながりを深めませんか？"
		description="登録すると、スタンプやメッセージでお子さまを応援できます。"
	/>
</div>
