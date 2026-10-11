// src/lib/domain/custom-reward-gate.ts (#4584)
//
// 「オリジナルのごほうびの作成・編集（ポイントの調整を含む）」(CUSTOM_REWARD_FEATURE_NAME、#4992)
// の解放判定。**表示と実行が同じ述語を読む**ための SSOT。
// 拒否: admin/rewards の ?/add ?/addPreset ?/update ?/copyFromChild ?/restorePreview ?/restoreFile
//       + special-rewards API (POST / templates PUT)。
//       copyFromChild / restore* はごほうびの行を新しく作る (写し元のオリジナルや、書き換えた
//       バックアップファイルの内容がそのまま入る) ため、作成と同じ扱いにする。
// 表示: admin/rewards の「+ 追加」手動項目の鍵マーク、一覧の「編集」のロック表示と注記 (#4992)。
//
// # なぜ独立した module にするか
//
// この機能は `site/pricing.html` の有料列と `plan-features.ts` で**有料の根拠として売られて
// いる**が、それを表す `PLAN_LIMITS.canCustomReward` は production code から一度も参照されて
// いなかった (#4584)。実際の拒否は admin/rewards の各 action が `isPaidTier(tier)` を直接
// 呼んで行っており、**フラグと実装が別々の真実**になっていた。フラグを変えても挙動は変わらず、
// 逆に実装を変えてもフラグは古いままになる。
//
// そこで判定を 1 つの述語に集約し、`PLAN_LIMITS.canCustomReward` はここから導出、
// 拒否もここを読む。以後どちらか片方だけを変えることはできない。
//
// 同型: `canFreeTextMessage` (#4504)。同 class の 3 件目を機械で止める fitness function は
// `tests/unit/architecture/plan-limits-field-enforcement.test.ts`。

import type { PlanTier } from './constants/plan-tier';

/**
 * オリジナルのごほうびの作成・編集を使えるか (スタンダード以上)。
 *
 * **server の拒否と UI の出し分けの両方がこれを読む。** 表示だけ絞って実行を素通しにすると
 * 「見えないのに叩けば通る」、逆だと「押せるのに 403」になる (#4506 の実害)。
 */
export function isCustomRewardUnlocked(tier: PlanTier): boolean {
	return tier === 'standard' || tier === 'family';
}
