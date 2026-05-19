// src/lib/server/services/cheer-service.ts
// 応援機能 (cheer) サービス層
//
// EPIC #2266 / Issue #2267:
//   親が任意理由 + 直接 P 付与で子供を応援する機能。
//   現状 /admin/messages はスタンプ/テキスト送信のみ (P 付与なし) で「存在意義なし」(PO 報告 2026-05-19) のため、
//   応援 (cheer) に統合: 任意理由 + 直接 P 付与 + 付随スタンプ/メッセージ。
//
// 設計:
//   - balance 即時加算 (point-repo.insertPointEntry / type='cheer')
//   - parent_messages に reward_notice タイプで履歴 1 行 insert (bonus_points + reward_category 列を活用)
//   - 子供画面で reward_notice を表示 (既存 message 表示機構を流用、ADR-0012 連続演出禁止)
//
// プランゲート: なし (#2267 設計方針: 応援は任意理由 + P 付与で、free でも使える基本機能)

import { insertMessage } from '$lib/server/db/message-repo';
import { findChildById, insertPointEntry } from '$lib/server/db/point-repo';

/** 応援理由の最大文字数 (UI 制約と一致) */
export const CHEER_REASON_MAX_LENGTH = 100;

/** 付与可能なポイント値の範囲 (PO 確定: システム上限なし、UI 入力範囲のみ) */
export const CHEER_POINTS_MIN = 1;
export const CHEER_POINTS_MAX = 10000;

/** 応援カテゴリ (rewards 画面と同じ 6 種) */
export const CHEER_CATEGORIES = [
	'うんどう',
	'べんきょう',
	'せいかつ',
	'こうりゅう',
	'そうぞう',
	'とくべつ',
] as const;
export type CheerCategory = (typeof CHEER_CATEGORIES)[number];

export interface GrantCheerInput {
	/** 子供 ID */
	childId: number;
	/** 任意理由テキスト (例: 「運動会で 1 位」) */
	reason: string;
	/** 付与ポイント (1〜10000) */
	points: number;
	/** カテゴリ (うんどう/べんきょう/せいかつ/こうりゅう/そうぞう/とくべつ) */
	category: CheerCategory | string;
	/** アイコン絵文字 (UI 表示用) */
	icon: string;
	/** 付随スタンプコード (任意、stamp-service と協調する将来拡張用) */
	stampCode?: string | null;
	/** 付随メッセージ本文 (任意、reason とは別の補足) */
	body?: string | null;
}

export type GrantCheerError =
	| { error: 'NOT_FOUND'; target: 'child' }
	| { error: 'INVALID_REASON' }
	| { error: 'INVALID_POINTS' }
	| { error: 'INVALID_CATEGORY' };

export interface GrantCheerResult {
	/** parent_messages.id */
	messageId: number;
	/** 加算後の残高 (将来 UI で「{nickname} の残高は {n}P になりました」表示用、現状未使用でも返却) */
	pointEntryAmount: number;
	/** point ledger に記録された description */
	description: string;
}

/**
 * 応援 (cheer) を付与する。
 *
 * 流れ:
 *   1. 入力バリデーション (理由 / points / category)
 *   2. point_ledger に + insertPointEntry (type='cheer', description=reason)
 *   3. parent_messages に reward_notice タイプで 1 行 insert
 *      - bonus_points = points / reward_category = category
 *      - body = reason (子供画面表示用) + 任意 body suffix
 *
 * 子供画面側 (既存 message 表示機構) が reward_notice を 1 件ずつ pop 表示する。
 * ADR-0012 整合: 同時 1 件、連続演出なし (queue 待ち)。
 */
export async function grantCheer(
	input: GrantCheerInput,
	tenantId: string,
): Promise<GrantCheerResult | GrantCheerError> {
	// バリデーション
	const reason = input.reason.trim();
	if (!reason || reason.length > CHEER_REASON_MAX_LENGTH) {
		return { error: 'INVALID_REASON' };
	}
	if (
		!Number.isFinite(input.points) ||
		input.points < CHEER_POINTS_MIN ||
		input.points > CHEER_POINTS_MAX
	) {
		return { error: 'INVALID_POINTS' };
	}
	if (!CHEER_CATEGORIES.includes(input.category as CheerCategory)) {
		return { error: 'INVALID_CATEGORY' };
	}

	// 子供存在チェック (tenant スコープ)
	const child = await findChildById(input.childId, tenantId);
	if (!child) return { error: 'NOT_FOUND', target: 'child' };

	// 1. ポイント加算 (即時)
	const description = `${input.icon} 応援: ${reason}`;
	await insertPointEntry(
		{
			childId: input.childId,
			amount: input.points,
			type: 'cheer',
			description,
		},
		tenantId,
	);

	// 2. parent_messages に reward_notice 1 行 insert
	//    body には reason + 任意 body suffix (子供画面の reward_notice 表示で利用)
	const noticeBody = input.body?.trim() ? `${reason}\n${input.body.trim()}` : reason;

	const message = await insertMessage(
		{
			childId: input.childId,
			messageType: 'reward_notice',
			stampCode: input.stampCode ?? null,
			body: noticeBody,
			icon: input.icon,
			bonusPoints: input.points,
			rewardCategory: input.category,
		},
		tenantId,
	);

	return {
		messageId: message.id,
		pointEntryAmount: input.points,
		description,
	};
}
