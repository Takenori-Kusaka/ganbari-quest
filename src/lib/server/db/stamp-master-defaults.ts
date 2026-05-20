// src/lib/server/db/stamp-master-defaults.ts
// Default stamp masters SSOT (16 stamps: N×5 + R×5 + SR×4 + UR×2)
//
// 経緯 (Issue 起票時点 2026-05-20):
// - 本番 cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で
//   stamp_masters seed が tenant 作成時に行われず DynamoDB scan で 0 件 → loginStamp 500
// - PR #2280 で dynamodb stamp-card-repo を Pre-PMF fallback (return []) 化したが、
//   stamp-card-service.stampToday が `enabledStamps.length === 0` で throw する設計のため
//   loginStamp action から呼ばれた瞬間に POST 500 が再発した
// - スタンプカード機能は本番で active (子供 home 自動押印) のため Pre-PMF Bucket B
//   (まだ作らない) ではなく Bucket A (今すぐ必要) に該当
//
// 設計方針 (SSOT):
// - 16 stamp は固定 master (絵文字 + name + rarity)、tenant 別カスタマイズなし (Pre-PMF)
// - demo-data.ts / dynamodb fallback / sqlite create-tables.ts の 3 箇所が同一 default を参照
// - 値の変更は本ファイル 1 行修正で 3 箇所すべてに伝播 (ADR-0045 atom / compound パターンと同型)
//
// 関連: docs/design/asset-catalog.md「現在のシールマスタ」16 行表 = 本ファイルの SSOT

import type { StampMaster } from './types';

/** デフォルト stamp master 16 件 (固定、tenant 別カスタマイズなし) */
export const DEFAULT_STAMP_MASTERS_DATA: ReadonlyArray<{
	id: number;
	name: string;
	emoji: string;
	rarity: 'N' | 'R' | 'SR' | 'UR';
}> = [
	// Normal (5)
	{ id: 1, name: 'にこにこ', emoji: '😊', rarity: 'N' },
	{ id: 2, name: 'グッジョブ', emoji: '👍', rarity: 'N' },
	{ id: 3, name: 'スター', emoji: '⭐', rarity: 'N' },
	{ id: 4, name: 'ハート', emoji: '❤️', rarity: 'N' },
	{ id: 5, name: 'がんばった', emoji: '💪', rarity: 'N' },
	// Rare (5)
	{ id: 6, name: 'ロケット', emoji: '🚀', rarity: 'R' },
	{ id: 7, name: 'おうかん', emoji: '👑', rarity: 'R' },
	{ id: 8, name: 'トロフィー', emoji: '🏆', rarity: 'R' },
	{ id: 9, name: 'にじ', emoji: '🌈', rarity: 'R' },
	{ id: 10, name: 'たいよう', emoji: '☀️', rarity: 'R' },
	// Super Rare (4)
	{ id: 11, name: 'ドラゴン', emoji: '🐉', rarity: 'SR' },
	{ id: 12, name: 'ユニコーン', emoji: '🦄', rarity: 'SR' },
	{ id: 13, name: 'たからばこ', emoji: '📦', rarity: 'SR' },
	{ id: 14, name: 'まほうのつえ', emoji: '🪄', rarity: 'SR' },
	// Ultra Rare (2)
	{ id: 15, name: 'でんせつのけん', emoji: '⚔️', rarity: 'UR' },
	{ id: 16, name: 'きせきのほし', emoji: '🌟', rarity: 'UR' },
];

/**
 * Default stamp masters を完全な StampMaster[] エンティティとして返す。
 *
 * - `now`: createdAt / updatedAt の ISO 文字列。テストでは固定値を渡せる
 * - `isDefault: 1` / `isEnabled: 1` 固定 (全 16 件が enabled な default seed)
 */
export function getDefaultStampMasters(now: string = new Date().toISOString()): StampMaster[] {
	return DEFAULT_STAMP_MASTERS_DATA.map((d) => ({
		id: d.id,
		name: d.name,
		emoji: d.emoji,
		rarity: d.rarity,
		isDefault: 1,
		isEnabled: 1,
		createdAt: now,
		updatedAt: now,
	}));
}
