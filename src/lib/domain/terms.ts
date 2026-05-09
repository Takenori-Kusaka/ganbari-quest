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
	// #1918 Phase 5 F1 追記: 「7 日間無料」「7日間無料」のような〈期間 + 無料〉compound を
	// terms.ts の atom 組合わせ (TRIAL_TERMS.duration[Spaced] + FREE_TERMS.suffix) で
	// char-by-char 再現可能にするための独立 suffix atom。
	// PLAN_TERMS.free = '無料' とは意味文脈が異なる (プラン名 vs. 価格訴求 suffix) ため
	// 文字列値が同一でも独立 atom として保持し、ADR-0045 の compound 組立で参照する。
	suffix: '無料',
	// #1903 (PERS-CRT-6): 「基本無料」と「月 ¥500〜」を価格バンドに並べると田中ゆかり P1 が
	// 「結局いくら払うの?」と離脱級認知ギャップを起こす（freemium × 低価格帯特有の混乱）。
	// 「必要なら」を上位プラン提示の前置として挟むことで「無料先 + 条件付き上位プラン」
	// 構造を視覚化し、選択肢の階層を明示する。
	// 用例: `${FREE_TERMS.priceGate} ${PRICE_TERMS.monthlyPrefix}${PRICE_TERMS.standard}${PRICE_TERMS.fromSuffix}`
	// → '必要なら 月 ¥500〜'
	priceGate: '必要なら',
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

// ============================================================
// LP_FAQ_TERMS — LP「FAQ / よくあるご質問」用語 atom (#1898 PO-4-12)
// ============================================================
//
// 「FAQ」「よくあるご質問」等、LP 法的注記 / FAQ 導線 / nav リンクで頻出する
// 名詞句を atom として集約。labels.ts LP_LEGAL_DISCLAIMER_LABELS / LP_FAQ_LABELS /
// LP_NAV_LABELS 等の compound はこの atom を参照する。
//
// 設計指針:
//   - canonicalShort: 短縮形「FAQ」（法的注記 / 賠償リンク / 解約 disclaimer の inline link 文末）
//   - canonicalLong:  長形「よくあるご質問」（nav / 専用ページ見出し等の独立表示）
//
// PO-4-12 (4 回目指摘) で `LP_LEGAL_DISCLAIMER_LABELS.liabilityBody` /
// `liabilityLinks` / `cancelDisclaimerLinks` の値内に「FAQ」リテラルが
// 直接混入していた構造を、本 atom 経由の template literal 参照に置換する
// （ADR-0045 §3.3 atom / compound 責務分離）。
//
// canonicalShort の値「FAQ」は本 atom 定義の 1 箇所のみとし、labels.ts 値内の
// 文字列リテラル「FAQ」直書きは scripts/check-no-plan-literals.mjs 等で
// 段階的に取り締まる方針（中期 follow-up #1909 textlint-rule-prh）。

export const LP_FAQ_TERMS = {
	canonicalShort: 'FAQ',
	canonicalLong: 'よくあるご質問',
} as const;
