// src/lib/server/services/voice-service.ts
// 親の声・カスタム音声管理サービス

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sanitizeAudio } from '$lib/server/security/file-sanitizer';
import { validateAudioMagicBytes } from '$lib/server/security/magic-bytes';
import { deleteFile, saveFile } from '$lib/server/storage';
import { storageKeyToPublicUrl, voiceKey } from '$lib/server/storage-keys';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VOICES_PER_CHILD = 10;
const ALLOWED_AUDIO_TYPES = [
	'audio/mpeg',
	'audio/mp4',
	'audio/wav',
	'audio/webm',
	'audio/ogg',
	'audio/x-m4a',
];

function extFromMime(mime: string): string {
	const map: Record<string, string> = {
		'audio/mpeg': 'mp3',
		'audio/mp4': 'm4a',
		'audio/wav': 'wav',
		'audio/webm': 'webm',
		'audio/ogg': 'ogg',
		'audio/x-m4a': 'm4a',
	};
	return map[mime] ?? 'mp3';
}

export interface VoiceListItem {
	id: number;
	label: string;
	publicUrl: string;
	durationMs: number | null;
	isActive: boolean;
	createdAt: string;
}

export type UploadVoiceError =
	| 'NOT_FOUND'
	| 'INVALID_FILE'
	| 'FILE_TOO_LARGE'
	| 'UNSUPPORTED_TYPE'
	| 'TOO_MANY_VOICES';

/** 子供のボイス一覧を取得 */
export async function listVoices(
	childId: number,
	scene: string,
	tenantId: string,
): Promise<VoiceListItem[]> {
	const voices = await getRepos().voice.findByChild(childId, scene, tenantId);
	return voices.map((v) => ({
		id: v.id,
		label: v.label,
		publicUrl: v.publicUrl,
		durationMs: v.durationMs,
		isActive: v.isActive === 1,
		createdAt: v.createdAt,
	}));
}

/** ボイスをアップロード */
// biome-ignore lint/complexity/useMaxParams: 既存コード、別Issueで対応予定
export async function uploadVoice(
	childId: number,
	tenantId: string,
	file: File,
	label: string,
	scene = 'complete',
	durationMs?: number,
): Promise<{ id: number; publicUrl: string } | { error: UploadVoiceError }> {
	if (!(file instanceof File) || file.size === 0) {
		return { error: 'INVALID_FILE' };
	}
	if (file.size > MAX_FILE_SIZE) {
		return { error: 'FILE_TOO_LARGE' };
	}
	if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
		return { error: 'UNSUPPORTED_TYPE' };
	}

	// マジックバイト検証（Content-Type偽装対策）
	const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	const magicCheck = validateAudioMagicBytes(headerBytes, file.type);
	if (!magicCheck.valid) {
		return { error: 'INVALID_FILE' };
	}

	// 上限チェック
	const existing = await getRepos().voice.findByChild(childId, scene, tenantId);
	if (existing.length >= MAX_VOICES_PER_CHILD) {
		return { error: 'TOO_MANY_VOICES' };
	}

	const ext = extFromMime(file.type);
	const storageKey = voiceKey(tenantId, childId, ext);
	const publicUrl = storageKeyToPublicUrl(storageKey);

	const rawBuffer = Buffer.from(await file.arrayBuffer());
	// 音声メタデータ除去（MP3 ID3タグ等）
	const buffer = sanitizeAudio(rawBuffer, file.type);
	await saveFile(storageKey, buffer, file.type);

	const { id } = await getRepos().voice.insert({
		childId,
		scene,
		label: label.trim(),
		filePath: storageKey,
		publicUrl,
		durationMs: durationMs ?? null,
		isActive: 0,
		tenantId,
	});

	return { id, publicUrl };
}

/** ボイスをアクティブに設定 */
export async function activateVoice(
	voiceId: number,
	childId: number,
	scene: string,
	tenantId: string,
): Promise<boolean> {
	const voice = await getRepos().voice.findById(voiceId, tenantId);
	if (!voice || voice.childId !== childId) return false;
	await getRepos().voice.setActive(voiceId, childId, scene, tenantId);
	return true;
}

/** ボイスを非アクティブに（ショップ音に戻す） */
async function _deactivateVoice(childId: number, scene: string, tenantId: string): Promise<void> {
	const voices = await getRepos().voice.findByChild(childId, scene, tenantId);
	for (const v of voices) {
		if (v.isActive === 1) {
			await getRepos().voice.setActive(-1, childId, scene, tenantId);
			break;
		}
	}
}

/** ボイスを削除（ファイルも削除） */
export async function deleteVoice(voiceId: number, tenantId: string): Promise<boolean> {
	const voice = await getRepos().voice.findById(voiceId, tenantId);
	if (!voice) return false;

	try {
		await deleteFile(voice.filePath);
	} catch (err) {
		logger.error('[voice-service] ボイスファイル削除失敗', {
			error: err instanceof Error ? err.message : String(err),
			context: { voiceId, filePath: voice.filePath },
		});
	}

	await getRepos().voice.deleteById(voiceId, tenantId);
	return true;
}

/** 子供のアクティブボイスパスを取得（レイアウトから呼ばれる） */
export async function getActiveVoicePath(
	childId: number,
	tenantId: string,
	scene = 'complete',
): Promise<string | null> {
	const voice = await getRepos().voice.findActiveVoice(childId, scene, tenantId);
	return voice?.publicUrl ?? null;
}
