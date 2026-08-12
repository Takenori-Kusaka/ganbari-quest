// src/lib/server/ai/unavailable-message.ts
// AI が使えないときの顧客向け文言を、**配備 (誰が運用しているか)** から選ぶ (#4366 / #4375)。
//
// ## なぜ配備で分けるか
//
// クラウド版の文言は「運営が検知済みです」と言明する。その裏付けは
// `[ai-alert] ai-provider-unavailable` log → alarm `ganbari-quest-ai-provider-unavailable`
// → Discord 通知だが、**この alarm は AWS の `OpsStack` にしか存在しない**。
//
// 自宅 NUC で動かしているセルフホスト家庭には「運営」が居ない。にもかかわらず同じ文言を出すと:
//
// - 事実として嘘になる (誰も検知していない)
// - 本当に直せるのは目の前の親自身なのに、「誰かが対応中」と告げて設定を直す動機を奪う
//
// しかも AI 不達の理由のうち `not-configured` (env が配られていない = Gemini / Bedrock の
// 資格情報を設定していない) は、セルフホスト家庭が最も踏みやすい経路である。
//
// ## 判定
//
// 運営が運用しているのは AWS 上の配備 (`aws-prod` / デモ Lambda) だけ。それ以外
// (`nuc-prod` / `local-debug` / `build`) はセルフホスト側に倒す。**既定を「運営は居ない」側に
// 置く**のは、嘘をつく方向に倒れないため (未知のモードが増えても偽の約束をしない)。
//
// 実行モードから安く分岐する形は `src/lib/server/services/function-url-limit.ts` と同じ
// (`resolveRuntimeMode({ env })`)。

import { POINTS_LABELS } from '$lib/domain/labels';
import { getEnv, type TypedEnv } from '$lib/runtime/env';
import { resolveRuntimeMode } from '$lib/runtime/runtime-mode';

/** 運営 (がんばりクエスト運営) が運用している配備の実行モード。ここだけが「検知済み」と言える。 */
const OPERATED_BY_VENDOR_MODES = new Set(['aws-prod', 'demo']);

/**
 * この配備を運営が運用しているか。false = セルフホスト (NUC / ローカル) で、
 * 障害を検知して直すのは運営ではなくその家庭自身。
 */
export function isVendorOperatedDeployment(env: TypedEnv = getEnv()): boolean {
	return OPERATED_BY_VENDOR_MODES.has(resolveRuntimeMode({ env }));
}

/**
 * AI が使えないときに顧客へ返す文言。どちらの配備でも
 * (a) 顧客のせい・写真のせいではないこと (b) いま手入力で完了できること を必ず伝える。
 */
export function resolveAiUnavailableMessage(env: TypedEnv = getEnv()): string {
	return isVendorOperatedDeployment(env)
		? POINTS_LABELS.receiptAiUnavailableManaged
		: POINTS_LABELS.receiptAiUnavailableSelfHosted;
}
