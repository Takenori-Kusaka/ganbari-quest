import { z } from 'zod';

/** メッセージ種別 */
export const MESSAGE_TYPES = ['stamp', 'text', 'reward_notice'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** 親が送信可能なメッセージ種別（UI・バリデーション用） */
export const SENDABLE_MESSAGE_TYPES = ['stamp', 'text'] as const;
export type SendableMessageType = (typeof SENDABLE_MESSAGE_TYPES)[number];

/** 自由テキストメッセージの最大文字数 */
export const MESSAGE_TEXT_MAX_LENGTH = 200;

/** メッセージ送信スキーマ */
export const sendMessageSchema = z
	.object({
		childId: z.coerce.number().int().positive(),
		messageType: z.enum(MESSAGE_TYPES),
		stampCode: z.string().max(30).optional(),
		body: z.string().max(MESSAGE_TEXT_MAX_LENGTH).optional(),
		icon: z.string().max(10).optional(),
	})
	.refine(
		(data) => {
			if (data.messageType === 'stamp') return !!data.stampCode;
			if (data.messageType === 'text') return !!data.body;
			return true;
		},
		{ message: 'stampにはstampCode、textにはbodyが必要です' },
	);

/** メッセージ取得パラメータ */
export const messageQuerySchema = z.object({
	childId: z.coerce.number().int().positive(),
});
