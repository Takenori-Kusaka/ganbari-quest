<script lang="ts">
import { enhance } from '$app/forms';

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
let textBody = $state('');
let sendSuccess = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

function selectStamp(code: string) {
	selectedStamp = code;
	messageType = 'stamp';
}
</script>

<svelte:head>
	<title>おうえんメッセージ - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- Step 1: Select child -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">1. こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<button
					class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors
						{selectedChildId === child.id ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 shadow-sm hover:shadow-md'}"
					onclick={() => (selectedChildId = child.id)}
				>
					{child.nickname}
				</button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Choose message type -->
	<section>
		<h3 class="text-sm font-bold text-gray-500 mb-2">2. おうえんの種類</h3>
		<div class="flex gap-2 mb-3">
			<button
				class="px-4 py-2 rounded-xl text-sm font-bold transition-colors
					{messageType === 'stamp' ? 'bg-pink-500 text-white' : 'bg-white text-gray-600 shadow-sm hover:shadow-md'}"
				onclick={() => (messageType = 'stamp')}
			>
				スタンプ
			</button>
			<button
				class="px-4 py-2 rounded-xl text-sm font-bold transition-colors
					{messageType === 'text' ? 'bg-pink-500 text-white' : 'bg-white text-gray-600 shadow-sm hover:shadow-md'}"
				onclick={() => (messageType = 'text')}
			>
				ひとことメッセージ
			</button>
		</div>

		{#if messageType === 'stamp'}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
				{#each data.stamps as stamp}
					<button
						class="bg-white rounded-xl p-3 shadow-sm text-center hover:shadow-md transition-shadow
							{selectedStamp === stamp.code ? 'ring-2 ring-pink-400' : ''}"
						onclick={() => selectStamp(stamp.code)}
					>
						<span class="text-3xl block">{stamp.icon}</span>
						<p class="text-xs font-bold text-gray-600 mt-1">{stamp.label}</p>
					</button>
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
						maxlength="30"
						bind:value={textBody}
						placeholder="がんばってるね！だいすき！"
						class="w-full px-3 py-2 border rounded-lg text-sm"
					/>
					<span class="text-xs text-gray-400 mt-1 block text-right">
						{textBody.length}/30
					</span>
				</label>
			</div>
		{/if}
	</section>

	<!-- Step 3: Confirm & send -->
	<form
		method="POST"
		action="?/send"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'success' && result.data && 'sent' in result.data) {
					sendSuccess = true;
					selectedStamp = '';
					textBody = '';
					setTimeout(() => {
						sendSuccess = false;
					}, 3000);
				}
				await update();
			};
		}}
		class="bg-white rounded-xl p-4 shadow-sm"
	>
		<input type="hidden" name="childId" value={selectedChildId} />
		<input type="hidden" name="messageType" value={messageType} />
		{#if messageType === 'stamp'}
			<input type="hidden" name="stampCode" value={selectedStamp} />
		{:else}
			<input type="hidden" name="body" value={textBody} />
		{/if}

		<button
			type="submit"
			disabled={messageType === 'stamp' ? !selectedStamp : !textBody.trim()}
			class="w-full py-3 bg-pink-500 text-white rounded-xl font-bold hover:bg-pink-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if messageType === 'stamp'}
				{@const stamp = data.stamps.find((s) => s.code === selectedStamp)}
				{stamp ? `${stamp.icon} ${stamp.label}` : 'スタンプを選んでね'}
			{:else}
				{textBody.trim() ? `💌 「${textBody}」を送る` : 'メッセージを入力してね'}
			{/if}
		</button>
	</form>

	<!-- Success Message -->
	{#if sendSuccess}
		<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center animate-bounce-in">
			<p class="text-green-700 font-bold">おうえんメッセージを送りました！</p>
		</div>
	{/if}

	<!-- Recent messages for selected child -->
	{#if selectedChild?.recentMessages && selectedChild.recentMessages.length > 0}
		<section>
			<h3 class="text-sm font-bold text-gray-500 mb-2">最近のメッセージ</h3>
			<div class="space-y-2">
				{#each selectedChild.recentMessages as msg}
					<div class="bg-white rounded-xl p-3 shadow-sm flex items-center gap-3">
						<span class="text-2xl">{msg.icon}</span>
						<div class="flex-1 min-w-0">
							{#if msg.messageType === 'stamp' && msg.stampCode}
								{@const stamp = data.stamps.find((s) => s.code === msg.stampCode)}
								<p class="text-sm font-bold text-gray-700">{stamp?.label ?? msg.stampCode}</p>
							{:else if msg.body}
								<p class="text-sm font-bold text-gray-700">{msg.body}</p>
							{/if}
							<p class="text-xs text-gray-400">{new Date(msg.sentAt).toLocaleString('ja-JP')}</p>
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
</div>
