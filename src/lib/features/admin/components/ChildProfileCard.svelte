<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { calculateAgeFromBirthDate } from '$lib/domain/date-utils';
import { getAgeTierLabel, getThemeOptions } from '$lib/domain/labels';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import {
	formatPointValue,
	formatPointValueWithSign,
	getUnitLabel,
} from '$lib/domain/point-display';
import type { CategoryDef } from '$lib/domain/validation/activity';
import BirthdayInput from '$lib/ui/primitives/BirthdayInput.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';
import Select from '$lib/ui/primitives/Select.svelte';

interface PointSettings {
	mode: PointUnitMode;
	currency: CurrencyCode;
	rate: number;
}

interface Props {
	child: {
		id: number;
		nickname: string;
		age: number;
		uiMode: string;
		theme: string;
		avatarUrl?: string | null;
		birthDate?: string | null;
		birthdayBonusMultiplier?: number;
		balance: { balance: number } | null;
		status: {
			level: number;
			levelTitle: string;
			statuses: Record<number, { value: number; level: number; stars: number }>;
		} | null;
		recentLogs: Array<{
			activityIcon: string;
			activityName: string;
			points: number;
			recordedAt: string;
		}>;
		logSummary: { totalCount: number } | null;
		achievements: Array<{
			icon: string;
			name: string;
			unlockedAt?: string | null;
		}>;
		voices: Array<{
			id: number;
			label: string;
			publicUrl: string;
			isActive: boolean;
		}>;
	};
	categoryDefs: readonly CategoryDef[];
	pointSettings: PointSettings;
	onDelete?: () => void;
}

let { child, categoryDefs, pointSettings: ps, onDelete }: Props = $props();

// --- State ---
let isEditing = $state(false);
// svelte-ignore state_referenced_locally
let themeValue = $state(child.theme);
// svelte-ignore state_referenced_locally
let editBirthDate = $state<string | undefined>(child.birthDate ?? undefined);
const editAgeFromBirthDate = $derived(
	editBirthDate ? calculateAgeFromBirthDate(editBirthDate) : undefined,
);
let detailTab = $state<'info' | 'status' | 'logs' | 'achievements' | 'voice'>('info');
let statusEditSuccess = $state(false);
let sliderValues: Record<number, number> = $state({});

$effect(() => {
	if (!isEditing) {
		themeValue = child.theme;
		editBirthDate = child.birthDate ?? undefined;
	}
});

// Avatar
let generating = $state(false);
let generateResult = $state<{ filePath?: string; error?: string } | null>(null);
let uploading = $state(false);
let uploadResult = $state<{ avatarUrl?: string; error?: string } | null>(null);

// Voice
let voiceUploading = $state(false);
let voiceLabel = $state('');
let voiceRecording = $state(false);
let mediaRecorder: MediaRecorder | null = $state(null);
let recordedBlob: Blob | null = $state(null);
let recordedUrl: string | null = $state(null);
let recordDuration = $state(0);
let recordTimer: ReturnType<typeof setInterval> | null = null;

// Delete confirmation
let confirmDelete = $state(false);

const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

const detailTabs = [
	{ id: 'info', label: '📋 基本情報' },
	{ id: 'status', label: '📊 ステータス' },
	{ id: 'logs', label: '📝 活動記録' },
	{ id: 'achievements', label: '🏆 実績' },
	{ id: 'voice', label: '📢 ボイス' },
] as const;

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

async function generateAvatar() {
	generating = true;
	generateResult = null;
	try {
		const res = await fetch('/api/v1/images', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'avatar', childId: child.id }),
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

async function uploadAvatar(file: File) {
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
		const res = await fetch(`/api/v1/children/${child.id}/avatar`, {
			method: 'POST',
			body: formData,
		});
		if (res.ok) {
			const json = await res.json();
			uploadResult = { avatarUrl: json.avatarUrl };
		} else if (res.status === 500) {
			uploadResult = {
				error: 'サーバーエラーが発生しました。5MB以下のJPEG/PNG/WebPを選択してください',
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

function handleFileSelect(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) uploadAvatar(file);
}

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
		/* マイクアクセス拒否 */
	}
}

function stopRecording() {
	if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
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

const avatarSrc = $derived(uploadResult?.avatarUrl ?? generateResult?.filePath ?? child.avatarUrl);
</script>

<Card padding="none" class="profile-card">
	{#if isEditing}
		<!-- ======== EDIT MODE ======== -->
		<div class="profile-edit">
			<div class="profile-edit__header">
				<span class="profile-edit__badge">編集中</span>
			</div>

			<!-- Avatar section -->
			<div class="profile-edit__section">
				<h4 class="profile-edit__section-title">プロフィール写真</h4>
				<div class="profile-edit__avatar-row">
					<div class="profile-edit__avatar">
						{#if avatarSrc}
							<img src={avatarSrc} alt={child.nickname} class="profile-edit__avatar-img" />
						{:else}
							<span class="profile-edit__avatar-placeholder">👤</span>
						{/if}
					</div>
					<div class="profile-edit__avatar-actions">
						<label class="profile-edit__upload-btn {uploading ? 'profile-edit__upload-btn--disabled' : ''}">
							📷 写真を変更
							<input
								type="file"
								accept="image/jpeg,image/png,image/webp"
								class="hidden"
								onchange={handleFileSelect}
								disabled={uploading}
							/>
						</label>
						<Button
							variant="ghost"
							size="sm"
							class="bg-[var(--color-premium-bg)] text-[var(--color-premium)] hover:opacity-80"
							disabled={generating}
							onclick={generateAvatar}
						>
							{generating ? '生成中...' : '✨ AI生成'}
						</Button>
					</div>
				</div>
				{#if uploadResult?.error || generateResult?.error}
					<p class="profile-edit__error">{uploadResult?.error ?? generateResult?.error}</p>
				{/if}
				{#if uploadResult?.avatarUrl}
					<p class="profile-edit__success">写真をアップロードしました</p>
				{/if}
				{#if generateResult?.filePath}
					<p class="profile-edit__success">アバターを生成しました</p>
				{/if}
			</div>

			<!-- Basic info form -->
			<form
				method="POST"
				action="?/editChild"
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success') {
							isEditing = false;
						}
						await update();
					};
				}}
				class="profile-edit__form"
			>
				<div class="profile-edit__section">
					<h4 class="profile-edit__section-title">基本情報</h4>
					<input type="hidden" name="childId" value={child.id} />
					<div class="profile-edit__grid">
						<FormField
							label="ニックネーム"
							type="text"
							id="edit-nickname-{child.id}"
							name="nickname"
							value={child.nickname}
						/>
						<BirthdayInput
							name="birthDate"
							id="edit-birthDate-{child.id}"
							bind:value={editBirthDate}
						/>
						<FormField label="年齢{editBirthDate ? '（自動計算）' : ''}">
							{#snippet children()}
								<input
									id="edit-age-{child.id}"
									name="age"
									type="number"
									min="0"
									max="18"
									value={editAgeFromBirthDate ?? child.age}
									readonly={!!editBirthDate}
									class="profile-edit__input {editBirthDate ? 'profile-edit__input--readonly' : ''}"
								/>
							{/snippet}
						</FormField>
						<Select
							label="テーマカラー"
							items={getThemeOptions().map((opt) => ({
								value: opt.value,
								label: `${opt.emoji} ${opt.label}`
							}))}
							value={[themeValue]}
							onValueChange={(d) => (themeValue = d.value[0] ?? 'blue')}
						/>
						<input type="hidden" name="theme" value={themeValue} />
					</div>
				</div>

				<!-- Birthday bonus (within edit mode) -->
				{#if child.birthDate}
					<div class="profile-edit__section profile-edit__birthday-bonus">
						<h4 class="profile-edit__section-title">🎂 おたんじょうびボーナス</h4>
						<p class="profile-edit__birthday-note">
							※ ボーナス倍率の変更は別途保存されます
						</p>
					</div>
				{/if}

				<div class="profile-edit__actions">
					<Button type="submit" variant="primary" size="sm">💾 保存</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="bg-[var(--color-neutral-200)] text-[var(--color-text)] hover:bg-[var(--color-neutral-300)]"
						onclick={() => { isEditing = false; }}
					>
						キャンセル
					</Button>
				</div>
			</form>

			<!-- Birthday bonus multiplier (separate form) -->
			{#if child.birthDate}
				<form
					method="POST"
					action="?/updateBirthdayMultiplier"
					class="profile-edit__bonus-form"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="childId" value={child.id} />
					<div class="profile-edit__bonus-row">
						<div class="profile-edit__bonus-select-wrap">
							<NativeSelect
								id="edit-multiplier-{child.id}"
								name="multiplier"
								label="倍率"
								value={child.birthdayBonusMultiplier ?? 1.0}
								options={[0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map((val) => ({ value: val, label: `×${val}` }))}
							/>
						</div>
						<Button type="submit" variant="primary" size="sm" class="bg-[var(--color-warning)] hover:opacity-90">適用</Button>
						<span class="profile-edit__bonus-preview">
							→ {child.age}歳 × 100pt × {child.birthdayBonusMultiplier ?? 1.0}倍 = {Math.round(child.age * 100 * (child.birthdayBonusMultiplier ?? 1.0))}pt
						</span>
					</div>
				</form>
			{/if}

			<!-- Delete section -->
			<div class="profile-edit__danger-zone">
				{#if confirmDelete}
					<p class="profile-edit__danger-text">この子供を本当に削除しますか？</p>
					<div class="profile-edit__danger-actions">
						<form
							method="POST"
							action="?/removeChild"
							use:enhance={() => {
								return async ({ update }) => {
									confirmDelete = false;
									await update();
									onDelete?.();
								};
							}}
						>
							<input type="hidden" name="childId" value={child.id} />
							<Button type="submit" variant="danger" size="sm">本当に削除</Button>
						</form>
						<Button
							variant="ghost"
							size="sm"
							class="bg-[var(--color-neutral-200)] text-[var(--color-text)] hover:bg-[var(--color-neutral-300)]"
							onclick={() => { confirmDelete = false; }}
						>
							やめる
						</Button>
					</div>
				{:else}
					<Button
						variant="ghost"
						size="sm"
						class="bg-[var(--color-feedback-error-bg,#fef2f2)] text-[var(--color-action-danger)] hover:opacity-80"
						onclick={() => { confirmDelete = true; }}
					>
						🗑 この子供を削除
					</Button>
				{/if}
			</div>
		</div>
	{:else}
		<!-- ======== VIEW MODE ======== -->
		<!-- Profile header -->
		<div class="profile-header">
			<div class="profile-header__avatar">
				{#if avatarSrc}
					<img src={avatarSrc} alt={child.nickname} class="profile-header__avatar-img" />
				{:else}
					<span class="profile-header__avatar-placeholder">👤</span>
				{/if}
			</div>
			<div class="profile-header__info">
				<h3 class="profile-header__name">{child.nickname}</h3>
				<p class="profile-header__meta">{child.age}歳 / {getAgeTierLabel(child.uiMode)}</p>
				{#if child.birthDate}
					<p class="profile-header__birthday">🎂 {child.birthDate}</p>
				{/if}
			</div>
			<Button
				variant="ghost"
				size="sm"
				class="bg-[var(--color-brand-100)] text-[var(--color-action-primary)] hover:opacity-80"
				onclick={() => { isEditing = true; detailTab = 'info'; }}
			>
				✏️ 編集
			</Button>
		</div>

		<!-- Tabs -->
		<div class="profile-tabs">
			{#each detailTabs as tab}
				<button
					type="button"
					class="profile-tabs__tab {detailTab === tab.id ? 'profile-tabs__tab--active' : ''}"
					onclick={() => { detailTab = tab.id; statusEditSuccess = false; }}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Tab content -->
		<div class="profile-content">
			{#if detailTab === 'info'}
				<div class="info-grid">
					<div class="info-card info-card--blue">
						<p class="info-card__value">{child.age}歳</p>
						<p class="info-card__label">年齢</p>
					</div>
					<div class="info-card info-card--purple">
						<p class="info-card__value">{getAgeTierLabel(child.uiMode)}</p>
						<p class="info-card__label">UIモード</p>
					</div>
					<div class="info-card info-card--amber">
						<p class="info-card__value">{fmtBal(child.balance?.balance ?? 0)}</p>
						<p class="info-card__label">{getUnitLabel(ps.mode, ps.currency)}残高</p>
					</div>
					<div class="info-card info-card--green">
						<p class="info-card__value">{child.logSummary?.totalCount ?? 0}</p>
						<p class="info-card__label">累計記録数</p>
					</div>
				</div>

			{:else if detailTab === 'status'}
				{#if statusEditSuccess}
					<div class="status-success">ステータスを更新しました</div>
				{/if}
				{#if child.status?.statuses && categoryDefs}
					<div class="status-list">
						{#each categoryDefs as catDef (catDef.id)}
							{@const stat = child.status?.statuses[catDef.id]}
							{#if stat}
								{@const maxVal = Math.max(stat.value * 2, 1000)}
								{@const currentVal = sliderValues[catDef.id] ?? stat.value}
								{@const diff = currentVal - stat.value}
								{@const hasChanged = Math.abs(diff) >= 1}
								<div class="status-item">
									<div class="status-item__header">
										<div class="status-item__label">
											<span>{catDef.icon}</span>
											<span class="status-item__name">{catDef.name}</span>
										</div>
										<span class="status-item__stars">{'★'.repeat(stat.stars)}{'☆'.repeat(5 - stat.stars)}</span>
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
										class="status-item__form"
									>
										<input type="hidden" name="childId" value={child.id} />
										<input type="hidden" name="categoryId" value={catDef.id} />
										<input
											type="range"
											name="value"
											min="0"
											max={maxVal}
											step="1"
											value={currentVal}
											oninput={(e) => { sliderValues[catDef.id] = Number(e.currentTarget.value); }}
											class="status-item__slider"
										/>
										<div class="status-item__footer">
											<div>
												<span class="status-item__xp">{currentVal} XP</span>
												<span class="status-item__level">(Lv.{stat.level})</span>
												{#if hasChanged}
													<span class="status-item__diff {diff > 0 ? 'status-item__diff--positive' : 'status-item__diff--negative'}">
														{diff > 0 ? '+' : ''}{diff}
													</span>
												{/if}
											</div>
											<Button
												type="submit"
												variant={hasChanged ? 'primary' : 'ghost'}
												size="sm"
												disabled={!hasChanged}
												class={hasChanged ? '' : 'bg-[var(--color-neutral-200)] text-[var(--color-text-disabled)] cursor-not-allowed'}
											>保存</Button>
										</div>
									</form>
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<p class="profile-empty">ステータスデータがありません</p>
				{/if}

			{:else if detailTab === 'logs'}
				{#if child.recentLogs && child.recentLogs.length > 0}
					<div class="logs-list">
						{#each child.recentLogs as log}
							<div class="logs-item">
								<span>{log.activityIcon}</span>
								<span class="logs-item__name">{log.activityName}</span>
								<span class="logs-item__points">{fmtPts(log.points)}</span>
								<span class="logs-item__date">{new Date(log.recordedAt).toLocaleDateString('ja-JP')}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="profile-empty">活動記録がありません</p>
				{/if}

			{:else if detailTab === 'achievements'}
				{#if child.achievements && child.achievements.length > 0}
					<div class="achievements-list">
						{#each child.achievements as ach}
							<div class="achievement-badge {ach.unlockedAt ? 'achievement-badge--unlocked' : ''}">
								<span>{ach.icon}</span>
								<span>{ach.name}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="profile-empty">実績がありません</p>
				{/if}

			{:else if detailTab === 'voice'}
				<div class="voice-section">
					<p class="voice-section__hint">
						録音または音声ファイルを登録すると、活動完了時にお子さんに再生されます。
					</p>

					<!-- Recording -->
					<div class="voice-recorder">
						<h4 class="voice-recorder__title">🎤 録音する</h4>
						{#if voiceRecording}
							<div class="voice-recorder__active">
								<span class="voice-recorder__indicator">● 録音中 {recordDuration}秒 / 10秒</span>
								<Button type="button" variant="danger" size="sm" onclick={stopRecording}>■ 停止</Button>
							</div>
						{:else if recordedUrl}
							<div class="voice-recorder__preview">
								<audio src={recordedUrl} controls class="voice-recorder__audio"></audio>
								<Button type="button" variant="ghost" size="sm" onclick={clearRecording} class="text-[var(--color-text-disabled)] hover:text-[var(--color-action-danger)]">取消</Button>
							</div>
						{:else}
							<Button type="button" variant="danger" size="sm" onclick={startRecording}>
								● 録音開始（最大10秒）
							</Button>
						{/if}
					</div>

					<!-- Upload form -->
					<form
						method="POST"
						action="?/uploadVoice"
						enctype="multipart/form-data"
						use:enhance={({ formData }) => {
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
						class="voice-upload"
					>
						<h4 class="voice-upload__title">📁 ファイルからアップロード</h4>
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
								class="voice-upload__file-input"
							/>
						{:else}
							<p class="voice-upload__recording-note">✅ 録音データを使用します</p>
						{/if}
						<Button
							type="submit"
							variant="primary"
							size="sm"
							class="bg-[var(--color-premium)] hover:opacity-90"
							disabled={voiceUploading || !voiceLabel}
						>
							{voiceUploading ? 'アップロード中...' : '💾 保存'}
						</Button>
					</form>

					<!-- Registered voices -->
					{#if child.voices && child.voices.length > 0}
						<div class="voice-list">
							<h4 class="voice-list__title">登録済み（{child.voices.length}件）</h4>
							{#each child.voices as voice}
								<div class="voice-item {voice.isActive ? 'voice-item--active' : ''}">
									<span class="voice-item__label">
										{voice.isActive ? '●' : '○'} {voice.label}
									</span>
									<audio src={voice.publicUrl} controls class="voice-item__audio"></audio>
									{#if !voice.isActive}
										<form method="POST" action="?/activateVoice" use:enhance>
											<input type="hidden" name="voiceId" value={voice.id} />
											<input type="hidden" name="childId" value={child.id} />
											<Button type="submit" variant="ghost" size="sm" class="bg-[var(--color-premium-bg)] text-[var(--color-premium)] hover:opacity-80">有効化</Button>
										</form>
									{/if}
									<form method="POST" action="?/deleteVoice" use:enhance>
										<input type="hidden" name="voiceId" value={voice.id} />
										<Button type="submit" variant="ghost" size="sm" class="text-[var(--color-action-danger)] hover:opacity-80">削除</Button>
									</form>
								</div>
							{/each}
						</div>
					{:else}
						<p class="profile-empty">
							ボイスが登録されていません。録音またはファイルアップロードで追加できます。
						</p>
					{/if}

					<p class="voice-section__note">
						※ 有効なボイスが設定されている場合、ショップの効果音よりも優先されます。
					</p>
				</div>
			{/if}
		</div>
	{/if}
</Card>

<style>
	/* ======== Edit Mode ======== */
	.profile-edit {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.profile-edit__header {
		display: flex;
		justify-content: flex-end;
	}
	.profile-edit__badge {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-action-primary, #3b82f6);
		background: var(--color-surface-accent, #eff6ff);
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
	}
	.profile-edit__section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.profile-edit__section-title {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-text-secondary, #6b7280);
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--color-border-light, #f3f4f6);
	}
	.profile-edit__avatar-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.profile-edit__avatar-img {
		width: 4rem;
		height: 4rem;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--color-border-light, #e5e7eb);
	}
	.profile-edit__avatar-placeholder {
		font-size: 3rem;
	}
	.profile-edit__avatar-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.profile-edit__upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		background: var(--color-action-primary, #3b82f6);
		color: white;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s;
	}
	.profile-edit__upload-btn:hover {
		background: var(--color-action-primary-hover, #2563eb);
	}
	.profile-edit__upload-btn--disabled {
		opacity: 0.5;
		pointer-events: none;
	}
	.profile-edit__error {
		font-size: 0.8rem;
		color: var(--color-danger, #ef4444);
	}
	.profile-edit__success {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-success, #16a34a);
	}
	.profile-edit__form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.profile-edit__grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 480px) {
		.profile-edit__grid {
			grid-template-columns: 1fr;
		}
	}
	.profile-edit__input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--input-border, #d1d5db);
		border-radius: var(--input-radius, 0.5rem);
		background: var(--input-bg, white);
		font-size: 0.875rem;
		transition: border-color 0.15s;
	}
	.profile-edit__input:focus {
		border-color: var(--input-border-focus, #3b82f6);
		outline: none;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}
	.profile-edit__input--readonly {
		background: var(--color-surface-secondary, #f3f4f6);
		color: var(--color-text-tertiary, #9ca3af);
	}
	.profile-edit__actions {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		padding-top: 0.5rem;
	}
	.profile-edit__birthday-bonus {
		background: var(--color-surface-warning, #fffbeb);
		padding: 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid var(--color-border-warning, #fde68a);
	}
	.profile-edit__birthday-note {
		font-size: 0.7rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.profile-edit__bonus-form {
		padding: 0 1rem 0.5rem;
		background: var(--color-surface-warning, #fffbeb);
		border-radius: 0 0 0.5rem 0.5rem;
	}
	.profile-edit__bonus-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.profile-edit__bonus-preview {
		font-size: 0.75rem;
		color: var(--color-warning-text, #92400e);
	}
	.profile-edit__danger-zone {
		border-top: 1px solid var(--color-border-light, #f3f4f6);
		padding-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.profile-edit__danger-text {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-danger, #ef4444);
	}
	.profile-edit__danger-actions {
		display: flex;
		gap: 0.5rem;
	}

	/* ======== View Mode ======== */
	.profile-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		border-bottom: 1px solid var(--color-border-light, #f3f4f6);
	}
	.profile-header__avatar-img {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--color-border-light, #e5e7eb);
	}
	.profile-header__avatar-placeholder {
		font-size: 2.5rem;
	}
	.profile-header__info {
		flex: 1;
		min-width: 0;
	}
	.profile-header__name {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text-primary, #374151);
	}
	.profile-header__meta {
		font-size: 0.85rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.profile-header__birthday {
		font-size: 0.8rem;
		color: var(--color-text-tertiary, #9ca3af);
	}

	/* Tabs */
	.profile-tabs {
		display: flex;
		border-bottom: 1px solid var(--color-border-light, #f3f4f6);
		overflow-x: auto;
		padding: 0 0.5rem;
	}
	.profile-tabs__tab {
		padding: 0.625rem 0.75rem;
		font-size: 0.75rem;
		white-space: nowrap;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-tertiary, #9ca3af);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.profile-tabs__tab:hover {
		color: var(--color-text-secondary, #6b7280);
	}
	.profile-tabs__tab--active {
		color: var(--color-action-primary, #3b82f6);
		border-bottom-color: var(--color-action-primary, #3b82f6);
	}

	/* Content */
	.profile-content {
		padding: 1rem;
	}
	.profile-empty {
		text-align: center;
		color: var(--color-text-tertiary, #9ca3af);
		padding: 1rem 0;
		font-size: 0.875rem;
	}

	/* Info grid */
	.info-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		text-align: center;
	}
	@media (min-width: 640px) {
		.info-grid { grid-template-columns: repeat(4, 1fr); }
	}
	.info-card {
		border-radius: 0.5rem;
		padding: 0.75rem;
	}
	.info-card--blue { background: var(--color-surface-info, #eff6ff); }
	.info-card--purple { background: var(--color-premium-bg, #f5f3ff); }
	.info-card--amber { background: var(--color-surface-warning, #fffbeb); }
	.info-card--green { background: var(--color-surface-success, #f0fdf4); }
	.info-card__value {
		font-size: 1.15rem;
		font-weight: 700;
	}
	.info-card--blue .info-card__value { color: var(--color-action-primary, #2563eb); }
	.info-card--purple .info-card__value { color: var(--color-premium, #7c3aed); }
	.info-card--amber .info-card__value { color: var(--color-gold-500, #d97706); }
	.info-card--green .info-card__value { color: var(--color-success, #16a34a); }
	.info-card__label {
		font-size: 0.7rem;
		color: var(--color-text-tertiary, #6b7280);
	}

	/* Status */
	.status-success {
		background: var(--color-surface-success, #f0fdf4);
		border: 1px solid var(--color-rarity-common, #bbf7d0);
		color: var(--color-success, #16a34a);
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 700;
	}
	.status-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.status-item {
		background: var(--color-surface-secondary, #f9fafb);
		border-radius: 0.5rem;
		padding: 0.75rem;
	}
	.status-item__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.25rem;
	}
	.status-item__label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.status-item__name {
		font-weight: 700;
		color: var(--color-text-primary, #374151);
		font-size: 0.875rem;
	}
	.status-item__stars {
		font-size: 0.75rem;
		color: var(--color-gold-500, #eab308);
	}
	.status-item__form {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.status-item__slider {
		width: 100%;
		accent-color: var(--color-action-primary, #3b82f6);
	}
	.status-item__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.status-item__xp {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--color-text-primary, #374151);
	}
	.status-item__level {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.status-item__diff {
		margin-left: 0.25rem;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.status-item__diff--positive { color: var(--color-success, #22c55e); }
	.status-item__diff--negative { color: var(--color-danger, #ef4444); }

	/* Logs */
	.logs-list {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		max-height: 20rem;
		overflow-y: auto;
	}
	.logs-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-border-light, #f9fafb);
	}
	.logs-item__name {
		flex: 1;
		color: var(--color-text-secondary, #4b5563);
	}
	.logs-item__points {
		color: var(--color-gold-500, #f59e0b);
		font-weight: 700;
	}
	.logs-item__date {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, #9ca3af);
	}

	/* Achievements */
	.achievements-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.achievement-badge {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		background: var(--color-surface-secondary, #f3f4f6);
		color: var(--color-text-tertiary, #9ca3af);
	}
	.achievement-badge--unlocked {
		background: var(--color-surface-warning, #fffbeb);
		color: var(--color-warning-text, #92400e);
	}

	/* Voice */
	.voice-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.voice-section__hint {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, #6b7280);
	}
	.voice-section__note {
		font-size: 0.7rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.voice-recorder, .voice-upload {
		background: var(--color-surface-secondary, #f9fafb);
		border-radius: 0.5rem;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.voice-recorder__title, .voice-upload__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-primary, #374151);
	}
	.voice-recorder__active {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.voice-recorder__indicator {
		color: var(--color-danger, #ef4444);
		font-size: 0.875rem;
		font-weight: 700;
		animation: pulse 1s infinite;
	}
	@keyframes pulse {
		50% { opacity: 0.5; }
	}
	.voice-recorder__preview {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.voice-recorder__audio, .voice-item__audio {
		height: 2rem;
		flex: 1;
	}
	.voice-upload__file-input {
		width: 100%;
		font-size: 0.875rem;
	}
	.voice-upload__recording-note {
		font-size: 0.75rem;
		color: var(--color-success, #16a34a);
	}
	.voice-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.voice-list__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-primary, #374151);
	}
	.voice-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: white;
		border: 1px solid var(--color-border-light, #e5e7eb);
		border-radius: 0.5rem;
		padding: 0.5rem;
	}
	.voice-item--active {
		border-color: var(--color-rarity-epic, #c4b5fd);
		background: var(--color-premium-bg, #faf5ff);
	}
	.voice-item__label {
		font-size: 0.875rem;
		white-space: nowrap;
	}
	.voice-item--active .voice-item__label {
		color: var(--color-premium, #7c3aed);
		font-weight: 700;
	}

	.hidden {
		display: none;
	}
</style>
