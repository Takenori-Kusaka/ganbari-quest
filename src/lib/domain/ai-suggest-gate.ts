// src/lib/domain/ai-suggest-gate.ts
// AI 提案機能のプランゲート述語 SSOT (#4506 / EPIC #4495)。
//
// # なぜ 1 本にするか
//
// AI 提案は server 側 (`$lib/server/api/suggest-plan-gate.ts`) が premium 限定で enforce している。
// 一方 UI 側は各 admin 画面が `isFamily` prop を **画面ごとに別々の式で導出** していたため、
// 「server は拒否するのに UI は解放表示」「server は許可するのに UI はロック表示」という
// 表示の嘘が 3 画面で三様に発生した (#2902 → #4506 で same-class 3 現場目)。
//
// | 画面 | 旧導出 | 実害 |
// |---|---|---|
// | checklists | `data.planTier === 'family'` だが load が planTier を返さない | 常に false → **プレミアム加入者が購入済み機能を使えない** (money) |
// | activities | `data.isPremium` (= 有料なら true、standard も含む) | standard に解放表示 → 実行時 403 (有利誤認 / legal) |
// | rewards | `data.planTier === 'family'` (load が planTier 返却) | 正 |
//
// enforcement (server) と表示 (UI) が同じ述語を import することで、片側だけがずれる状態を
// 構造的に作れなくする。callsite の網羅は
// `tests/unit/architecture/ai-suggest-gate-derivation.test.ts` (fitness function) が固定する。
//
// # 型で silent false を排除する
//
// 引数は `PlanTier` (optional でない) を要求する。load が `planTier` を返し忘れると callsite が
// `undefined` を渡すことになり、tsc / svelte-check が **型エラーで落ちる**。
// 旧実装の `data.planTier === 'family'` は比較式なので、参照先が存在しなくても静かに false へ
// 潰れて誰にも気づかれなかった (#4506 の根本原因)。述語を関数にすること自体が対策である。

import type { PlanTier } from '$lib/domain/constants/plan-tier';

/**
 * AI 提案機能が当該プランで利用可能か。
 *
 * server 側の enforcement (`validateSuggestRequest`) と同一の判定であり、UI のロック表示 /
 * アップグレード CTA の出し分けはこの述語だけを根拠にする。
 */
export function isAiSuggestUnlocked(tier: PlanTier): boolean {
	return tier === 'family';
}
