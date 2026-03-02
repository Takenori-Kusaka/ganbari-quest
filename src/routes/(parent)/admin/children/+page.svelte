<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();

let showAddForm = $state(false);
let editingChildId = $state<number | null>(null);
let confirmDeleteId = $state<number | null>(null);

let generating = $state(false);
let generateResult = $state<{ filePath?: string; error?: string } | null>(null);
let uploading = $state(false);
let uploadResult = $state<{ avatarUrl?: string; error?: string } | null>(null);

async function generateAvatar(childId: number) {
	generating = true;
	generateResult = null;
	try {
		const res = await fetch('/api/v1/images', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'avatar', childId }),
		});
		const json = await res.json();
		if (res.ok) {
			generateResult = { filePath: json.filePath };
		} else {
			generateResult = { error: json.error?.message ?? '生成に失敗しました' };
		}
	} catch {
		generateResult = { error: 'ネットワークエラーが発生しました' };
	} finally {
		generating = false;
	}
}

async function uploadAvatar(childId: number, file: File) {
	uploading = true;
	uploadResult = null;
	try {
		const formData = new FormData();
		formData.append('avatar', file);
		const res = await fetch(`/api/v1/children/${childId}/avatar`, {
			method: 'POST',
			body: formData,
		});
		const json = await res.json();
		if (res.ok) {
			uploadResult = { avatarUrl: json.avatarUrl };
		} else {
			uploadResult = { error: json.error?.message ?? 'アップロードに失敗しました' };
		}
	} catch {
		uploadResult = { error: 'ネットワークエラーが発生しました' };
	} finally {
		uploading = false;
	}
}

function handleFileSelect(childId: number, event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) {
		uploadAvatar(childId, file);
	}
}
</script>

<svelte:head>
	<title>こども管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold text-gray-700">こども一覧</h2>
		<button
			class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-bold hover:bg-blue-600 transition-colors"
			onclick={() => showAddForm = !showAddForm}
		>
			{showAddForm ? 'キャンセル' : '+ こどもを追加'}
		</button>
	</div>

	<!-- Add child form -->
	{#if showAddForm}
		<form
			method="POST"
			action="?/addChild"
			use:enhance={() => {
				return async ({ result, update }) => {
					if (result.type === 'success') {
						showAddForm = false;
					}
					await update();
				};
			}}
			class="bg-white rounded-xl p-4 shadow-sm space-y-3"
		>
			<h3 class="font-bold text-gray-600">こどもを追加</h3>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
				<div>
					<label for="add-nickname" class="block text-xs font-bold text-gray-500 mb-1">ニックネーム</label>
					<input
						id="add-nickname"
						name="nickname"
						type="text"
						required
						placeholder="例: ゆうきちゃん"
						class="w-full px-3 py-2 border rounded-lg text-sm"
					/>
				</div>
				<div>
					<label for="add-age" class="block text-xs font-bold text-gray-500 mb-1">年齢</label>
					<input
						id="add-age"
						name="age"
						type="number"
						min="0"
						max="18"
						required
						placeholder="4"
						class="w-full px-3 py-2 border rounded-lg text-sm"
					/>
				</div>
				<div>
					<label for="add-theme" class="block text-xs font-bold text-gray-500 mb-1">テーマカラー</label>
					<select id="add-theme" name="theme" class="w-full px-3 py-2 border rounded-lg text-sm">
						<option value="pink">🩷 ピンク</option>
						<option value="blue">💙 ブルー</option>
						<option value="green">💚 みどり</option>
						<option value="orange">🧡 オレンジ</option>
						<option value="purple">💜 むらさき</option>
					</select>
				</div>
			</div>
			<button
				type="submit"
				class="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition-colors"
			>
				追加する
			</button>
		</form>
	{/if}

	<!-- Children list -->
	<div class="grid gap-3">
		{#each data.children as child}
			<div class="bg-white rounded-xl p-4 shadow-sm">
				{#if editingChildId === child.id}
					<!-- Edit form -->
					<form
						method="POST"
						action="?/editChild"
						use:enhance={() => {
							return async ({ result, update }) => {
								if (result.type === 'success') {
									editingChildId = null;
								}
								await update();
							};
						}}
						class="space-y-3"
					>
						<input type="hidden" name="childId" value={child.id} />
						<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
							<div>
								<label for="edit-nickname-{child.id}" class="block text-xs font-bold text-gray-500 mb-1">ニックネーム</label>
								<input
									id="edit-nickname-{child.id}"
									name="nickname"
									type="text"
									value={child.nickname}
									class="w-full px-3 py-2 border rounded-lg text-sm"
								/>
							</div>
							<div>
								<label for="edit-age-{child.id}" class="block text-xs font-bold text-gray-500 mb-1">年齢</label>
								<input
									id="edit-age-{child.id}"
									name="age"
									type="number"
									min="0"
									max="18"
									value={child.age}
									class="w-full px-3 py-2 border rounded-lg text-sm"
								/>
							</div>
							<div>
								<label for="edit-theme-{child.id}" class="block text-xs font-bold text-gray-500 mb-1">テーマカラー</label>
								<select id="edit-theme-{child.id}" name="theme" class="w-full px-3 py-2 border rounded-lg text-sm">
									<option value="pink" selected={child.theme === 'pink'}>🩷 ピンク</option>
									<option value="blue" selected={child.theme === 'blue'}>💙 ブルー</option>
									<option value="green" selected={child.theme === 'green'}>💚 みどり</option>
									<option value="orange" selected={child.theme === 'orange'}>🧡 オレンジ</option>
									<option value="purple" selected={child.theme === 'purple'}>💜 むらさき</option>
								</select>
							</div>
						</div>
						<div class="flex gap-2">
							<button
								type="submit"
								class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600"
							>
								保存
							</button>
							<button
								type="button"
								class="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300"
								onclick={() => editingChildId = null}
							>
								キャンセル
							</button>
						</div>
					</form>
				{:else}
					<!-- Display mode -->
					<div class="flex items-center gap-4">
						<a
							href="/admin/children?id={child.id}"
							class="flex items-center gap-4 flex-1 {data.selectedChild?.id === child.id ? 'font-bold' : ''}"
						>
							<span class="text-3xl">👤</span>
							<div class="flex-1">
								<p class="font-bold text-gray-700">{child.nickname}</p>
								<p class="text-sm text-gray-400">{child.age}歳 / {child.uiMode} / Lv.{child.level}</p>
							</div>
							<div class="text-right">
								<p class="text-lg font-bold text-amber-500">{child.balance.toLocaleString()}P</p>
							</div>
						</a>
						<div class="flex gap-1">
							<button
								class="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs hover:bg-gray-200"
								onclick={() => editingChildId = child.id}
							>
								編集
							</button>
							{#if confirmDeleteId === child.id}
								<form
									method="POST"
									action="?/removeChild"
									use:enhance={() => {
										return async ({ update }) => {
											confirmDeleteId = null;
											await update();
										};
									}}
								>
									<input type="hidden" name="childId" value={child.id} />
									<button
										type="submit"
										class="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
									>
										本当に削除
									</button>
								</form>
								<button
									class="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs hover:bg-gray-200"
									onclick={() => confirmDeleteId = null}
								>
									やめる
								</button>
							{:else}
								<button
									class="px-2 py-1 bg-red-50 text-red-400 rounded text-xs hover:bg-red-100"
									onclick={() => confirmDeleteId = child.id}
								>
									削除
								</button>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Selected child detail -->
	{#if data.selectedChild}
		{@const child = data.selectedChild}
		<section class="bg-white rounded-xl p-6 shadow-sm space-y-4">
			<div class="flex items-center gap-4">
				{#if uploadResult?.avatarUrl || generateResult?.filePath || child.avatarUrl}
					<img
						src={uploadResult?.avatarUrl ?? generateResult?.filePath ?? child.avatarUrl}
						alt={child.nickname}
						class="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
					/>
				{:else}
					<span class="text-4xl">👤</span>
				{/if}
				<div class="flex-1">
					<h3 class="text-lg font-bold text-gray-700">{child.nickname} の詳細</h3>
				</div>
				<div class="flex gap-1">
					<label
						class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors cursor-pointer {uploading ? 'opacity-50 pointer-events-none' : ''}"
					>
						{uploading ? 'アップロード中...' : '📷 写真'}
						<input
							type="file"
							accept="image/jpeg,image/png,image/webp"
							class="hidden"
							onchange={(e) => handleFileSelect(child.id, e)}
							disabled={uploading}
						/>
					</label>
					<button
						class="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-bold hover:bg-purple-600 transition-colors disabled:opacity-50"
						disabled={generating}
						onclick={() => generateAvatar(child.id)}
					>
						{generating ? '生成中...' : '✨ AI生成'}
					</button>
				</div>
			</div>
			{#if uploadResult?.error || generateResult?.error}
				<p class="text-red-500 text-sm">{uploadResult?.error ?? generateResult?.error}</p>
			{/if}
			{#if uploadResult?.avatarUrl}
				<p class="text-green-600 text-sm font-bold">写真をアップロードしました</p>
			{/if}
			{#if generateResult?.filePath}
				<p class="text-green-600 text-sm font-bold">アバターを生成しました</p>
			{/if}

			<!-- Basic Info -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
				<div class="bg-blue-50 rounded-lg p-3">
					<p class="text-xl font-bold text-blue-600">{child.age}歳</p>
					<p class="text-xs text-gray-500">年齢</p>
				</div>
				<div class="bg-purple-50 rounded-lg p-3">
					<p class="text-xl font-bold text-purple-600">Lv.{child.status?.level ?? '?'}</p>
					<p class="text-xs text-gray-500">{child.status?.levelTitle ?? ''}</p>
				</div>
				<div class="bg-amber-50 rounded-lg p-3">
					<p class="text-xl font-bold text-amber-600">{child.balance?.balance?.toLocaleString() ?? 0}P</p>
					<p class="text-xs text-gray-500">ポイント残高</p>
				</div>
				<div class="bg-green-50 rounded-lg p-3">
					<p class="text-xl font-bold text-green-600">{child.logSummary?.totalCount ?? 0}</p>
					<p class="text-xs text-gray-500">累計記録数</p>
				</div>
			</div>

			<!-- Status -->
			{#if child.status?.statuses}
				<div>
					<h4 class="font-bold text-gray-600 mb-2">ステータス</h4>
					<div class="grid gap-2">
						{#each Object.entries(child.status.statuses) as [category, detail]}
							<div class="flex items-center gap-2">
								<span class="text-sm font-bold w-20 text-gray-500">{category}</span>
								<div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
									<div
										class="h-full bg-blue-400 rounded-full transition-all"
										style="width: {Math.min(detail.value, 100)}%"
									></div>
								</div>
								<span class="text-xs font-bold text-gray-500 w-12 text-right">{detail.value.toFixed(0)}</span>
								<span class="text-xs w-8 text-center">
									{detail.trend === 'up' ? '↑' : detail.trend === 'down' ? '↓' : '→'}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Recent activity logs -->
			{#if child.recentLogs && child.recentLogs.length > 0}
				<div>
					<h4 class="font-bold text-gray-600 mb-2">最近の活動記録</h4>
					<div class="space-y-1 max-h-60 overflow-y-auto">
						{#each child.recentLogs as log}
							<div class="flex items-center gap-2 text-sm py-1 border-b border-gray-50">
								<span>{log.activityIcon}</span>
								<span class="flex-1 text-gray-600">{log.activityName}</span>
								<span class="text-amber-500 font-bold">+{log.points}P</span>
								<span class="text-xs text-gray-400">{new Date(log.recordedAt).toLocaleDateString('ja-JP')}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Achievements -->
			{#if child.achievements && child.achievements.length > 0}
				<div>
					<h4 class="font-bold text-gray-600 mb-2">実績</h4>
					<div class="flex flex-wrap gap-2">
						{#each child.achievements as ach}
							<div
								class="flex items-center gap-1 px-2 py-1 rounded-full text-xs
									{ach.unlockedAt ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-400'}"
							>
								<span>{ach.icon}</span>
								<span>{ach.name}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>
