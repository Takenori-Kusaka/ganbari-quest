// src/lib/server/services/message-service.ts
// 親子おうえんメッセージサービス

import {
	countUnshownMessages,
	findMessages,
	findUnshownMessage,
	insertMessage,
	markMessageShown,
} from '$lib/server/db/message-repo';
import type { InsertParentMessageInput } from '$lib/server/db/types';

/** 定型スタンプ一覧 */
export const STAMP_PRESETS = [
	{ code: 'sugoi', label: 'すごいね！', icon: '🌟' },
	{ code: 'ganbatta', label: 'がんばったね！', icon: '💪' },
	{ code: 'arigatou', label: 'ありがとう！', icon: '💖' },
	{ code: 'miteruyo', label: 'みてるよ！', icon: '👀' },
	{ code: 'omedetou', label: 'おめでとう！', icon: '🎉' },
	{ code: 'daisuki', label: 'だいすき！', icon: '🤗' },
	{ code: 'papa_ganbare', label: 'パパもがんばるよ', icon: '🔥' },
	{ code: 'mama_ureshii', label: 'ママもうれしい', icon: '😊' },
] as const;

export type StampCode = (typeof STAMP_PRESETS)[number]['code'];

/** スタンプコードからプリセットを取得 */
export function getStampPreset(code: string) {
	return STAMP_PRESETS.find((s) => s.code === code);
}

/** おうえんメッセージを送信 */
export async function sendMessage(input: InsertParentMessageInput, tenantId: string) {
	if (input.messageType === 'stamp' && input.stampCode) {
		const preset = getStampPreset(input.stampCode);
		if (preset) {
			input.icon = preset.icon;
		}
	}
	return insertMessage(input, tenantId);
}

/** 子供の未表示メッセージを取得（スタンプラベル付き） */
export async function getUnshownMessage(childId: number, tenantId: string) {
	const msg = await findUnshownMessage(childId, tenantId);
	if (!msg) return undefined;
	const stamp = msg.stampCode ? getStampPreset(msg.stampCode) : undefined;
	return { ...msg, stampLabel: stamp?.label ?? '' };
}

/** 未表示メッセージ数を取得 */
export async function getUnshownMessageCount(childId: number, tenantId: string) {
	return countUnshownMessages(childId, tenantId);
}

/** メッセージを表示済みにする */
export async function markAsShown(messageId: number, tenantId: string) {
	return markMessageShown(messageId, tenantId);
}

/** メッセージ履歴を取得 */
export async function getMessageHistory(childId: number, tenantId: string, limit = 20) {
	return findMessages(childId, limit, tenantId);
}
