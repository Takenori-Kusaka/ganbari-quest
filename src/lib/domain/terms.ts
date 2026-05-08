// src/lib/domain/terms.ts
// SSOT 2 階層化 Phase 1 基盤 (#1916)
//
// 用語集（atom 専用）。
// labels.ts (compound) は本ファイルを必ず import し、表示文字列を組み立てる。
//
// 階層図:
//   terms.ts (atom)  →  labels.ts (compound)  →  *.svelte / *.html / shared-labels.js
//
// 設計原則:
//   - atom: 単一の用語（プラン名・価格・期間・解約・無料訴求）
//   - 値の変更は本ファイル 1 行修正で全 LP・アプリ本体・法務文書に伝播
//   - compound（複数 atom を文に組み立てた表示文字列）は labels.ts 側に置く
//
// エクスポート一覧:
//   PLAN_TERMS       — プラン名（短縮形）
//   PLAN_FULL_TERMS  — プラン名（フル形、「〜プラン」付き）
//   PRICE_TERMS      — 価格 atom（¥500 / ¥780 / ¥0 / 月 / 〜 / 税込）
//   TRIAL_TERMS      — トライアル atom（7日間 / カード登録）
//   CANCEL_TERMS     — 解約 atom
//   FREE_TERMS       — 無料訴求 atom
//   CTA_TERMS        — CTA / トライアル動詞句 atom（無料体験 / 無料で試す / 無料で試せます、#1958）
//
// 参照: docs/DESIGN.md §6 / Issue #1916 / Issue #1917 (template literal parser) / Issue #1958

// ============================================================
// PLAN_TERMS — プラン名（短縮形、PLAN_SHORT_LABELS の atom）
// ============================================================

export const PLAN_TERMS = {
	free: '無料',
	standard: 'スタンダード',
	family: 'ファミリー',
} as const;

// ============================================================
// PLAN_FULL_TERMS — プラン名（フル形、「〜プラン」付き、PLAN_LABELS の atom）
// ============================================================

export const PLAN_FULL_TERMS = {
	free: '無料プラン',
	standard: 'スタンダードプラン',
	family: 'ファミリープラン',
} as const;

// ============================================================
// PRICE_TERMS — 価格 atom
// ============================================================

export const PRICE_TERMS = {
	standard: '¥500',
	family: '¥780',
	free: '¥0',
	taxNote: '（税込）',
	monthlyPrefix: '月 ',
	fromSuffix: '〜',
} as const;

// ============================================================
// TRIAL_TERMS — トライアル atom
// ============================================================

export const TRIAL_TERMS = {
	duration: '7日間',
	// #1944 Phase 3 D4: LP 系 namespace (LP_PAMPHLET_PHASEB / LP_GROWTH_ROADMAP) で
	// 「7 日間」（半角空白入り）として頻出するため、半角空白付き variant を独立 atom として追加。
	// duration ('7日間' 空白なし) と durationSpaced ('7 日間' 空白あり) は表示文字列レベルで
	// 別物として扱い、char-by-char 一致を維持する（過去 namespace で揺らぎを解消できなかった経緯あり）。
	durationSpaced: '7 日間',
	durationDays: 7,
	noCreditCard: 'クレジットカード登録不要',
	noCreditCardShort: 'クレカ登録不要',
	// #1958 Phase 7 H1: TRIAL_LABELS.bannerDescNotStarted の文末「カード登録不要。」用 atom。
	// 既存の noCreditCard (12 文字) / noCreditCardShort (8 文字) と異なる中間長 (7 文字) であり、
	// 文字列差分ゼロ維持のため新 atom として独立させる。
	noCreditCardMid: 'カード登録不要',
} as const;

// ============================================================
// CANCEL_TERMS — 解約 atom
// ============================================================

export const CANCEL_TERMS = {
	anytime: 'いつでも解約',
	anytimeOk: 'いつでも解約 OK',
} as const;

// ============================================================
// FREE_TERMS — 無料訴求 atom
// ============================================================

export const FREE_TERMS = {
	base: '基本無料',
	start: 'まずは無料',
	tryFree: '無料で始める',
} as const;

// ============================================================
// CTA_TERMS — CTA / トライアル訴求の動詞句 atom (#1958 Phase 7 H1)
// ============================================================
//
// 「無料体験」「無料で試す」「無料で試せます」等、トライアル CTA で頻出する
// 動詞句・名詞句を atom として集約。labels.ts ACTION_LABELS / TRIAL_LABELS の
// compound はこの atom を参照する。
//
// 設計指針:
//   - freeTrialNoun: 名詞「無料体験」（「〜中」「〜は明日で終了します」「〜が終了しました」）
//   - freeTrialVerb: 終止形「無料で試す」（CTA ボタン文末）
//   - freeTrialDesc: 可能形「無料で試せます」（タイトル文脈、#1383 で個別定数化済）

export const CTA_TERMS = {
	freeTrialNoun: '無料体験',
	freeTrialVerb: '無料で試す',
	freeTrialDesc: '無料で試せます',
} as const;
