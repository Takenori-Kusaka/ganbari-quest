<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import {
	formatPointValue,
	formatPointValueWithSign,
	getUnitLabel,
} from '$lib/domain/point-display';
import Button from '$lib/ui/primitives/Button.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();
let detailTab = $state<'info' | 'status' | 'logs' | 'achievements' | 'voice'>('info');
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
	{ id: 'voice', label: '📢 ボイス' },
] as const;

let generating = $state(false);
let generateResult = $state<{ filePath?: string; error?: string } | null>(null);
let uploading = $state(false);
let uploadResult = $state<{ avatarUrl?: string; error?: string } | null>(null);

// ボイス関連
let voiceUploading = $state(false);
let voiceLabel = $state('');
let voiceRecording = $state(false);
let mediaRecorder: MediaRecorder | null = $state(null);
let recordedBlob: Blob | null = $state(null);
let recordedUrl: string | null = $state(null);
let recordDuration = $state(0);
let recordTimer: ReturnType<typeof setInterval> | null = null;

async function startRecording() {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
		const recorder = new MediaRecorder(stream, { mimeType });
		const chunks: Blob[] = [];

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};
		recorder.onstop = () => {
			for (const t of stream.getTracks()) t.stop();
			const blob = new Blob(chunks, { type: mimeType });
			recordedBlob = blob;
			if (recordedUrl) URL.revokeObjectURL(recordedUrl);
			recordedUrl = URL.createObjectURL(blob);
			voiceRecording = false;
			if (recordTimer) clearInterval(recordTimer);
		};

		recorder.start();
		mediaRecorder = recorder;
		voiceRecording = true;
		recordDuration = 0;
		recordTimer = setInterval(() => {
			recordDuration++;
			if (recordDuration >= 10) stopRecording();
		}, 1000);
	} catch {
		// マイクアクセス拒否
	}
}

function stopRecording() {
	if (mediaRecorder && mediaRecorder.state !== 'inactive') {
		mediaRecorder.stop();
	}
	if (recordTimer) {
		clearInterval(recordTimer);
		recordTimer = null;
	}
}

function clearRecording() {
	if (recordedUrl) URL.revokeObjectURL(recordedUrl);
	recordedBlob = null;
	recordedUrl = null;
	recordDuration = 0;
}

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
				</p>
				<a href="/admin/license" class="inline-flex items-center mt-2 text-sm font-semibold text-blue-600 hover:text-blue-800">
					🚀 プランをアップグレードする →
				</a>
			</div>
		</div>
	{/if}

	<div class="flex items-center justify-between" data-tutorial="children-list">
		{#if !childLimit || childLimit.allowed}
			<Button
				variant="primary"
				size="sm"
				onclick={() => showAddForm = !showAddForm}
				data-tutorial="add-child-btn"
			>
				{showAddForm ? 'キャンセル' : '+ こどもを追加'}
			</Button>
		{:else}
			<Button
				variant="ghost"
				size="sm"
				class="bg-gray-300 text-gray-500 cursor-not-allowed"
				disabled
			>
				上限に達しています
			</Button>
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
				<FormField
					label="ニックネーム"
					type="text"
					id="add-nickname"
					name="nickname"
					required
					placeholder="例: ゆうきちゃん"
				/>
				<FormField
					label="たんじょうび"
					type="date"
					id="add-birthDate"
					name="birthDate"
					max={new Date().toISOString().split('T')[0]}
					hint="設定すると年齢が自動計算されます"
				/>
				<FormField
					label="年齢"
					type="number"
					id="add-age"
					name="age"
					min="0"
					max="18"
					required
					placeholder="4"
				/>
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
			<Button
				type="submit"
				variant="success"
				size="sm"
			>
				追加する
			</Button>
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
							<FormField
								label="ニックネーム"
								type="text"
								id="edit-nickname-{child.id}"
								name="nickname"
								value={child.nickname}
							/>
							<FormField
								label="たんじょうび"
								type="date"
								id="edit-birthDate-{child.id}"
								name="birthDate"
								max={new Date().toISOString().split('T')[0]}
								value={child.birthDate ?? ''}
							/>
							<FormField label="年齢{child.birthDate ? '（自動計算）' : ''}">
								{#snippet children()}
									<input
										id="edit-age-{child.id}"
										name="age"
										type="number"
										min="0"
										max="18"
										value={child.age}
										readonly={!!child.birthDate}
										class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm
											border-[var(--input-border)] focus:border-[var(--input-border-focus)]
											focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors
											{child.birthDate ? 'bg-gray-100 text-gray-500' : ''}"
									/>
								{/snippet}
							</FormField>
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
							<Button
								type="submit"
								variant="primary"
								size="sm"
							>
								保存
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="bg-gray-200 text-gray-600 hover:bg-gray-300"
								onclick={() => editingChildId = null}
							>
								キャンセル
							</Button>
						</div>
					</form>
					<!-- Birthday bonus multiplier (separate form to avoid nesting) -->
					{#if child.birthDate}
						<form
							method="POST"
							action="?/updateBirthdayMultiplier"
							class="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200"
							use:enhance={() => {
								return async ({ update }) => {
									await update({ reset: false });
								};
							}}
						>
							<input type="hidden" name="childId" value={child.id} />
							<p class="text-xs font-bold text-amber-800 mb-2">🎂 おたんじょうびボーナス</p>
							<div class="flex items-center gap-2 flex-wrap">
								<label for="edit-multiplier-{child.id}" class="text-xs text-amber-700 whitespace-nowrap">倍率:</label>
								<select
									id="edit-multiplier-{child.id}"
									name="multiplier"
									class="px-2 py-1 border border-amber-300 rounded text-sm bg-white"
								>
									{#each [0.5, 1.0, 1.5, 2.0, 2.5, 3.0] as val}
										<option value={val} selected={val === (child.birthdayBonusMultiplier ?? 1.0)}>×{val}</option>
									{/each}
								</select>
								<Button type="submit" variant="primary" size="sm" class="bg-amber-500 hover:bg-amber-600">適用</Button>
								<span class="text-xs text-amber-600">
									→ {child.age}歳 × 100pt × {child.birthdayBonusMultiplier ?? 1.0}倍 = {Math.round(child.age * 100 * (child.birthdayBonusMultiplier ?? 1.0))}pt
								</span>
							</div>
						</form>
					{/if}
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
								<p class="text-sm text-gray-400">{child.age}歳 / {child.uiMode}</p>
							</div>
							<div class="text-right">
								<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance)}</p>
							</div>
						</a>
						<div class="flex gap-1">
							<Button
								variant="ghost"
								size="sm"
								class="bg-gray-100 text-gray-500 hover:bg-gray-200"
								onclick={() => editingChildId = child.id}
							>
								編集
							</Button>
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
									<Button
										type="submit"
										variant="danger"
										size="sm"
									>
										本当に削除
									</Button>
								</form>
								<Button
									variant="ghost"
									size="sm"
									class="bg-gray-100 text-gray-500 hover:bg-gray-200"
									onclick={() => confirmDeleteId = null}
								>
									やめる
								</Button>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									class="bg-red-50 text-red-400 hover:bg-red-100"
									onclick={() => confirmDeleteId = child.id}
								>
									削除
								</Button>
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
					<p class="text-sm text-gray-400">{child.age}歳 / {child.uiMode}</p>
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
					<Button
						variant="primary"
						size="sm"
						class="bg-purple-500 hover:bg-purple-600"
						disabled={generating}
						onclick={() => generateAvatar(child.id)}
					>
						{generating ? '...' : '✨'}
					</Button>
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
					<Button
						variant="ghost"
						size="sm"
						class="px-3 py-2.5 text-xs whitespace-nowrap border-b-2 rounded-none
							{detailTab === tab.id
							? 'border-blue-500 text-blue-600'
							: 'border-transparent text-gray-400 hover:text-gray-600'}"
						onclick={() => { detailTab = tab.id; statusEditSuccess = false; }}
					>
						{tab.label}
					</Button>
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
							<p class="text-xl font-bold text-purple-600">{child.uiMode}</p>
							<p class="text-xs text-gray-500">UIモード</p>
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
									{@const maxVal = Math.max(stat.value * 2, 1000)}
									{@const sliderStep = 1}
									{@const currentVal = sliderValues[catDef.id] ?? stat.value}
									{@const diff = currentVal - stat.value}
									{@const hasChanged = Math.abs(diff) >= 1}
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
													<span class="text-lg font-bold text-gray-700">{currentVal} XP</span>
													<span class="text-xs text-gray-400"> (Lv.{stat.level})</span>
													{#if hasChanged}
														<span class="ml-1 text-xs font-bold {diff > 0 ? 'text-green-500' : 'text-red-500'}">
															{diff > 0 ? '+' : ''}{diff}
														</span>
													{/if}
												</div>
												<Button
													type="submit"
													variant={hasChanged ? 'primary' : 'ghost'}
													size="sm"
													disabled={!hasChanged}
													class={hasChanged
														? ''
														: 'bg-gray-200 text-gray-400 cursor-not-allowed'}
												>
													保存
												</Button>
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
				{:else if detailTab === 'voice'}
					<!-- カスタムボイス管理 -->
					<div class="space-y-4">
						<p class="text-xs text-gray-500">
							録音または音声ファイルを登録すると、活動完了時にお子さんに再生されます。
						</p>

						<!-- 録音セクション -->
						<div class="bg-gray-50 rounded-lg p-3 space-y-2">
							<h4 class="text-sm font-bold text-gray-700">🎤 録音する</h4>
							{#if voiceRecording}
								<div class="flex items-center gap-3">
									<span class="text-red-500 text-sm font-bold animate-pulse">● 録音中 {recordDuration}秒 / 10秒</span>
									<Button
										type="button"
										variant="danger"
										size="sm"
										onclick={stopRecording}
									>■ 停止</Button>
								</div>
							{:else if recordedUrl}
								<div class="flex items-center gap-2">
									<audio src={recordedUrl} controls class="h-8 flex-1"></audio>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onclick={clearRecording}
										class="text-gray-400 hover:text-red-500"
									>取消</Button>
								</div>
							{:else}
								<Button
									type="button"
									variant="danger"
									size="sm"
									onclick={startRecording}
								>● 録音開始（最大10秒）</Button>
							{/if}
						</div>

						<!-- アップロードフォーム -->
						<form
							method="POST"
							action="?/uploadVoice"
							enctype="multipart/form-data"
							use:enhance={({ formData }) => {
								// 録音データがあればファイルとして追加
								if (recordedBlob && !formData.get('file')?.valueOf()) {
									const ext = recordedBlob.type.includes('webm') ? 'webm' : 'm4a';
									formData.set('file', new File([recordedBlob], `recording.${ext}`, { type: recordedBlob.type }));
									formData.set('durationMs', String(recordDuration * 1000));
								}
								voiceUploading = true;
								return async ({ result, update }) => {
									voiceUploading = false;
									if (result.type === 'success') {
										clearRecording();
										voiceLabel = '';
										await update();
									}
								};
							}}
							class="bg-gray-50 rounded-lg p-3 space-y-2"
						>
							<h4 class="text-sm font-bold text-gray-700">📁 ファイルからアップロード</h4>
							<input type="hidden" name="childId" value={child.id} />
							<FormField
								label="ラベル"
								type="text"
								name="label"
								bind:value={voiceLabel}
								placeholder="ラベル（例: お母さんの声）"
								maxlength={30}
								required
							/>
							{#if !recordedBlob}
								<input
									type="file"
									name="file"
									accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,audio/x-m4a,.mp3,.m4a,.wav,.webm,.ogg"
									class="w-full text-sm"
								/>
							{:else}
								<p class="text-xs text-green-600">✅ 録音データを使用します</p>
							{/if}
							<Button
								type="submit"
								variant="primary"
								size="sm"
								class="bg-purple-500 hover:bg-purple-600"
								disabled={voiceUploading || !voiceLabel}
							>
								{voiceUploading ? 'アップロード中...' : '💾 保存'}
							</Button>
						</form>

						<!-- 登録済みボイス一覧 -->
						{#if child.voices && child.voices.length > 0}
							<div class="space-y-2">
								<h4 class="text-sm font-bold text-gray-700">登録済み（{child.voices.length}件）</h4>
								{#each child.voices as voice}
									<div class="flex items-center gap-2 bg-white border rounded-lg p-2 {voice.isActive ? 'border-purple-300 bg-purple-50' : 'border-gray-200'}">
										<span class="text-sm {voice.isActive ? 'text-purple-600 font-bold' : 'text-gray-600'}">
											{voice.isActive ? '●' : '○'} {voice.label}
										</span>
										<audio src={voice.publicUrl} controls class="h-7 flex-1"></audio>
										{#if !voice.isActive}
											<form method="POST" action="?/activateVoice" use:enhance>
												<input type="hidden" name="voiceId" value={voice.id} />
												<input type="hidden" name="childId" value={child.id} />
												<Button type="submit" variant="ghost" size="sm" class="bg-purple-100 text-purple-600 hover:bg-purple-200">有効化</Button>
											</form>
										{/if}
										<form method="POST" action="?/deleteVoice" use:enhance>
											<input type="hidden" name="voiceId" value={voice.id} />
											<Button type="submit" variant="ghost" size="sm" class="text-red-400 hover:text-red-600">削除</Button>
										</form>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-center text-gray-400 py-4 text-sm">
								ボイスが登録されていません。録音またはファイルアップロードで追加できます。
							</p>
						{/if}

						<p class="text-xs text-gray-400">
							※ 有効なボイスが設定されている場合、ショップの効果音よりも優先されます。
						</p>
					</div>
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
