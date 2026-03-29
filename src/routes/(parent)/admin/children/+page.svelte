<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import {
	formatPointValue,
	formatPointValueWithSign,
	getUnitLabel,
} from '$lib/domain/point-display';

let { data, form } = $props();
let detailTab = $state<'info' | 'status' | 'logs' | 'achievements' | 'birthday'>('info');
let statusEditSuccess = $state(false);
let sliderValues: Record<number, number> = $state({});
const childLimit = $derived(
	(data as Record<string, unknown>).childLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

let showAddForm = $state(false);
let editingChildId = $state<number | null>(null);
let confirmDeleteId = $state<number | null>(null);

const detailTabs = [
	{ id: 'info', label: '📋 基本情報' },
	{ id: 'status', label: '📊 ステータス' },
	{ id: 'logs', label: '📝 活動記録' },
	{ id: 'achievements', label: '🏆 実績' },
	{ id: 'birthday', label: '🎂 ふりかえり' },
] as const;

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

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

async function uploadAvatar(childId: number, file: File) {
	uploading = true;
	uploadResult = null;

	if (file.size > MAX_UPLOAD_SIZE) {
		const sizeMB = (file.size / 1024 / 1024).toFixed(1);
		uploadResult = {
			error: `ファイルサイズが大きすぎます（${sizeMB}MB）。5MB以下の画像を選択してください`,
		};
		uploading = false;
		return;
	}

	try {
		const formData = new FormData();
		formData.append('avatar', file);
		const res = await fetch(`/api/v1/children/${childId}/avatar`, {
			method: 'POST',
			body: formData,
		});
		if (res.ok) {
			const json = await res.json();
			uploadResult = { avatarUrl: json.avatarUrl };
		} else if (res.status === 500) {
			uploadResult = {
				error:
					'サーバーエラーが発生しました。画像が大きすぎる可能性があります。5MB以下のJPEG/PNG/WebPを選択してください',
			};
		} else {
			const json = await res.json().catch(() => null);
			uploadResult = { error: json?.message ?? 'アップロードに失敗しました' };
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
	{#if childLimit && !childLimit.allowed}
		<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
			<span class="text-2xl">⚠️</span>
			<div>
				<p class="font-bold text-amber-800">こどもの登録上限に達しています</p>
				<p class="text-sm text-amber-700 mt-1">
					現在 {childLimit.current}人 / 最大 {childLimit.max}人。
					プランをアップグレードすると、もっと登録できます。
				</p>
			</div>
		</div>
	{/if}

	<div class="flex items-center justify-between" data-tutorial="children-list">
		<h2 class="text-lg font-bold text-gray-700">こども一覧</h2>
		{#if !childLimit || childLimit.allowed}
			<button
				class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-bold hover:bg-blue-600 transition-colors"
				onclick={() => showAddForm = !showAddForm}
				data-tutorial="add-child-btn"
			>
				{showAddForm ? 'キャンセル' : '+ こどもを追加'}
			</button>
		{:else}
			<button
				class="px-4 py-2 bg-gray-300 text-gray-500 rounded-lg text-sm font-bold cursor-not-allowed"
				disabled
			>
				上限に達しています
			</button>
		{/if}
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
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
					<label for="add-birthDate" class="block text-xs font-bold text-gray-500 mb-1">たんじょうび</label>
					<input
						id="add-birthDate"
						name="birthDate"
						type="date"
						max={new Date().toISOString().split('T')[0]}
						class="w-full px-3 py-2 border rounded-lg text-sm"
					/>
					<p class="text-xs text-gray-400 mt-0.5">設定すると年齢が自動計算されます</p>
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
		{#each data.children as child, i}
			<div class="bg-white rounded-xl p-4 shadow-sm" data-tutorial={i === 0 ? 'child-card' : undefined}>
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
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
								<label for="edit-birthDate-{child.id}" class="block text-xs font-bold text-gray-500 mb-1">たんじょうび</label>
								<input
									id="edit-birthDate-{child.id}"
									name="birthDate"
									type="date"
									max={new Date().toISOString().split('T')[0]}
									value={child.birthDate ?? ''}
									class="w-full px-3 py-2 border rounded-lg text-sm"
								/>
							</div>
							<div>
								<label for="edit-age-{child.id}" class="block text-xs font-bold text-gray-500 mb-1">年齢{child.birthDate ? '（自動計算）' : ''}</label>
								<input
									id="edit-age-{child.id}"
									name="age"
									type="number"
									min="0"
									max="18"
									value={child.age}
									readonly={!!child.birthDate}
									class="w-full px-3 py-2 border rounded-lg text-sm {child.birthDate ? 'bg-gray-100 text-gray-500' : ''}"
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
							{#if child.avatarUrl}
								<img src={child.avatarUrl} alt={child.nickname} class="w-10 h-10 rounded-full object-cover" loading="lazy" />
							{:else}
								<span class="text-3xl">👤</span>
							{/if}
							<div class="flex-1">
								<p class="font-bold text-gray-700">{child.nickname}</p>
								<p class="text-sm text-gray-400">{child.age}歳 / {child.uiMode} / Lv.{child.level}</p>
							</div>
							<div class="text-right">
								<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance)}</p>
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
		<section class="bg-white rounded-xl shadow-sm overflow-hidden">
			<!-- Header -->
			<div class="p-4 border-b border-gray-100 flex items-center gap-4">
				{#if uploadResult?.avatarUrl || generateResult?.filePath || child.avatarUrl}
					<img
						src={uploadResult?.avatarUrl ?? generateResult?.filePath ?? child.avatarUrl}
						alt={child.nickname}
						class="w-14 h-14 rounded-full object-cover border-2 border-gray-200" loading="lazy"
					/>
				{:else}
					<span class="text-3xl">👤</span>
				{/if}
				<div class="flex-1">
					<h3 class="text-lg font-bold text-gray-700">{child.nickname}</h3>
					<p class="text-sm text-gray-400">{child.age}歳 / Lv.{child.status?.level ?? '?'} {child.status?.levelTitle ?? ''}</p>
				</div>
				<div class="flex gap-1">
					<label
						class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors cursor-pointer {uploading ? 'opacity-50 pointer-events-none' : ''}"
					>
						{uploading ? '...' : '📷'}
						<input
							type="file"
							accept="image/jpeg,image/png,image/webp"
							class="hidden"
							onchange={(e) => handleFileSelect(child.id, e)}
							disabled={uploading}
						/>
					</label>
					<button
						class="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-bold hover:bg-purple-600 transition-colors disabled:opacity-50"
						disabled={generating}
						onclick={() => generateAvatar(child.id)}
					>
						{generating ? '...' : '✨'}
					</button>
				</div>
			</div>
			{#if uploadResult?.error || generateResult?.error}
				<p class="text-red-500 text-sm px-4 pt-2">{uploadResult?.error ?? generateResult?.error}</p>
			{/if}
			{#if uploadResult?.avatarUrl}
				<p class="text-green-600 text-sm font-bold px-4 pt-2">写真をアップロードしました</p>
			{/if}
			{#if generateResult?.filePath}
				<p class="text-green-600 text-sm font-bold px-4 pt-2">アバターを生成しました</p>
			{/if}

			<!-- Tabs -->
			<div class="flex border-b border-gray-100 overflow-x-auto px-2">
				{#each detailTabs as tab}
					<button
						class="px-3 py-2.5 text-xs font-bold whitespace-nowrap transition-colors border-b-2
							{detailTab === tab.id
							? 'border-blue-500 text-blue-600'
							: 'border-transparent text-gray-400 hover:text-gray-600'}"
						onclick={() => { detailTab = tab.id; statusEditSuccess = false; }}
					>
						{tab.label}
					</button>
				{/each}
			</div>

			<!-- Tab content -->
			<div class="p-4 space-y-4">
				{#if detailTab === 'info'}
					<!-- Basic Info cards -->
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
							<p class="text-xl font-bold text-amber-600">{fmtBal(child.balance?.balance ?? 0)}</p>
							<p class="text-xs text-gray-500">{getUnitLabel(ps.mode, ps.currency)}残高</p>
						</div>
						<div class="bg-green-50 rounded-lg p-3">
							<p class="text-xl font-bold text-green-600">{child.logSummary?.totalCount ?? 0}</p>
							<p class="text-xs text-gray-500">累計記録数</p>
						</div>
					</div>
				{:else if detailTab === 'status'}
					<!-- Status editing with sliders -->
					{#if statusEditSuccess}
						<div class="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-sm font-bold">
							ステータスを更新しました
						</div>
					{/if}
					{#if child.status?.statuses && data.categoryDefs}
						<div class="flex flex-col gap-3">
							{#each data.categoryDefs as catDef (catDef.id)}
								{@const stat = child.status?.statuses[catDef.id]}
								{#if stat}
									{@const maxVal = child.status?.maxValue ?? 100}
									{@const sliderStep = maxVal > 100 ? 1 : 0.5}
									{@const currentVal = sliderValues[catDef.id] ?? stat.value}
									{@const diff = currentVal - stat.value}
									{@const hasChanged = Math.abs(diff) >= 0.5}
									<div class="bg-gray-50 rounded-lg p-3">
										<div class="flex items-center justify-between mb-1">
											<div class="flex items-center gap-2">
												<span>{catDef.icon}</span>
												<span class="font-bold text-gray-700 text-sm">{catDef.name}</span>
											</div>
											<span class="text-xs text-yellow-500">{'★'.repeat(stat.stars)}{'☆'.repeat(5 - stat.stars)}</span>
										</div>
										<form
											method="POST"
											action="?/updateStatus"
											use:enhance={() => {
												statusEditSuccess = false;
												return async ({ result }) => {
													if (result.type === 'success') {
														statusEditSuccess = true;
														delete sliderValues[catDef.id];
														await invalidateAll();
													}
												};
											}}
											class="space-y-1"
										>
											<input type="hidden" name="childId" value={child.id} />
											<input type="hidden" name="categoryId" value={catDef.id} />
											<input
												type="range"
												name="value"
												min="0"
												max={maxVal}
												step={sliderStep}
												value={currentVal}
												oninput={(e) => { sliderValues[catDef.id] = Number(e.currentTarget.value); }}
												class="w-full accent-blue-500"
											/>
											<div class="flex items-center justify-between">
												<div>
													<span class="text-lg font-bold text-gray-700">{currentVal}</span>
													<span class="text-xs text-gray-400"> / {maxVal}</span>
													{#if hasChanged}
														<span class="ml-1 text-xs font-bold {diff > 0 ? 'text-green-500' : 'text-red-500'}">
															{diff > 0 ? '+' : ''}{diff.toFixed(1)}
														</span>
													{/if}
												</div>
												<button
													type="submit"
													disabled={!hasChanged}
													class="px-3 py-1 text-xs font-bold rounded-lg transition-colors
														{hasChanged
														? 'bg-blue-500 text-white hover:bg-blue-600'
														: 'bg-gray-200 text-gray-400 cursor-not-allowed'}"
												>
													保存
												</button>
											</div>
										</form>
									</div>
								{/if}
							{/each}
						</div>
					{:else}
						<p class="text-center text-gray-400 py-4">ステータスデータがありません</p>
					{/if}
				{:else if detailTab === 'logs'}
					<!-- Activity logs -->
					{#if child.recentLogs && child.recentLogs.length > 0}
						<div class="space-y-1 max-h-80 overflow-y-auto">
							{#each child.recentLogs as log}
								<div class="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50">
									<span>{log.activityIcon}</span>
									<span class="flex-1 text-gray-600">{log.activityName}</span>
									<span class="text-amber-500 font-bold">{fmtPts(log.points)}</span>
									<span class="text-xs text-gray-400">{new Date(log.recordedAt).toLocaleDateString('ja-JP')}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-center text-gray-400 py-4">活動記録がありません</p>
					{/if}
				{:else if detailTab === 'achievements'}
					<!-- Achievements -->
					{#if child.achievements && child.achievements.length > 0}
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
					{:else}
						<p class="text-center text-gray-400 py-4">実績がありません</p>
					{/if}
				{:else if detailTab === 'birthday'}
					<!-- Birthday reviews -->
					{#if child.birthdayReviews && child.birthdayReviews.length > 0}
						<div class="space-y-2">
							{#each child.birthdayReviews as review}
								<div class="bg-pink-50 rounded-lg p-3 text-sm">
									<div class="flex items-center justify-between mb-1">
										<span class="font-bold">{review.reviewYear}年（{review.ageAtReview}歳）</span>
										<span class="text-amber-600 font-bold">{fmtPts(review.totalPoints)}</span>
									</div>
									{#if review.aspirationText}
										<p class="text-gray-600 text-xs">🌟 {review.aspirationText}</p>
									{/if}
									<p class="text-gray-400 text-xs mt-1">
										基本:{fmtPts(review.basePoints)} / 健康:{fmtPts(review.healthPoints)} / 目標:{fmtPts(review.aspirationPoints)}
									</p>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-center text-gray-400 py-4">ふりかえりがありません</p>
					{/if}
				{/if}
			</div>
		</section>
	{/if}
</div>

<style>
	.avatar-spinner {
		display: inline-block;
		width: 0.8em;
		height: 0.8em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
