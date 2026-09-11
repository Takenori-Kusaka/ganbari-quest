// src/lib/domain/free-text-message-gate.ts
// ひとことメッセージ (自由テキスト) のプランゲート述語 SSOT (#4504 / EPIC #4495)。
//
// # 何が壊れていたか
//
// LP は自由テキストを **プレミアム限定** と訴求している (pricing 比較表 / pamphlet) のに、
// 実装にゲートが無く全プランで送信できた。`PLAN_LIMITS.canFreeTextMessage` は
// **定義だけで参照ゼロのデッド設定**で、送信経路 2 本 (`/admin/cheer` の action と
// `POST /api/v1/messages/[childId]`) はどちらも tier を見ていなかった。
// 旧 `/admin/messages` の family 専用化 (#772) が cheer 統合 (#2266 / #2267) で失われたもの。
//
// # なぜ述語を 1 本にするか
//
// AI 提案 (`$lib/domain/ai-suggest-gate`) と同型。enforcement (server) と表示 (UI) が
// 別々の式で導出されると、片側だけがずれて「表示の嘘」になる (#2902 → #4506 の実例)。
// **同じ関数を両方が import する**ことで、ずれた状態を作れなくする。
//
// # ⚠️ これは表示専用の述語ではない — 緩めると認可が緩む
//
// UI のロック表示と server の認可の両方がこれを読む。「standard にも入力欄だけ見せたい」
// のような表示都合をこの条件に足すと、同じ条件が enforcement 側にも効き、
// **プレミアム以外が自由テキストを送信できる** (差別化機能の無償開放)。
// 表示都合が必要になったら、この関数は enforcement のまま据え置き、表示側に別述語を足す。
//
// # 適用範囲 (定型応援は含まない)
//
// ゲートするのは **自由テキスト (`body`)** のみ。プリセットのスタンプ / 定型応援は
// **全プランのまま**である (LP も定型応援は全プラン共通と訴求しており、そちらが正)。

import type { PlanTier } from '$lib/domain/constants/plan-tier';

/**
 * 自由テキストのひとことメッセージが当該プランで送信可能か。
 *
 * トライアル中は `resolvePlanTier` が `TRIAL_TIER` (premium) を返すため、
 * トライアル利用者もここで許可される (別分岐を書かない)。
 */
export function isFreeTextMessageUnlocked(tier: PlanTier): boolean {
	return tier === 'family';
}
