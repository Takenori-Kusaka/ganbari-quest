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
//   LP_FAQ_TERMS     — LP「FAQ / よくある(ご)質問」atom（PO-4-10、#1896 + PO-4-12、#1898）
//   AGE_RANGE_TERMS  — 年齢レンジ atom（3〜18 歳 / 3 歳から 18 歳まで、UIUX-E-1、#1913）
//   POINT_TERMS      — ポイント単位 atom（pt / ポイント / P、UIUX-E-3、#1913）
//   CURRENCY_TERMS   — 通貨 atom（¥ / 円、UIUX-E-5、#1913）
//   FREE_PLAN_TERMS  — 無料プラン訴求 atom（永久無料 バッジ語、UIUX-E-7、#1913）
//   AUTONOMY_TERMS   — 自律 / 自走 リフレーム atom（UIUX-F-16、#2058）
//
// 参照: docs/DESIGN.md §6 / Issue #1916 / Issue #1917 (template literal parser) / Issue #1958 / Issue #1896 / Issue #1898 / Issue #1913 / Issue #2058

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
	// #1904 (PERS-CRT-5): hero cta-trust-badges 用の動詞ベース詳細訴求 atom。
	// 「クレジットカード登録不要」を 6 箇所連発から hero 1 箇所のみに絞り、その 1 箇所では
	// 「いつ入力するか」を明示することで田中ゆかり P1 の「後で登録しろって言われるんでしょ?」
	// サブスク被害連想を断つ。短縮形 (noCreditCard) / 体言止め (noCreditCardMid) と意味文脈が
	// 異なるため独立 atom として保持し、cta-trust-badges 1 箇所限定で使用する。
	noCreditCardDetailed: '無料体験中もカード情報は不要。有料プラン切替時に初めて入力します',
} as const;

// ============================================================
// CANCEL_TERMS — 解約 atom
// ============================================================

export const CANCEL_TERMS = {
	anytime: 'いつでも解約',
	// #1904 (PERS-CRT-5): 旧値 'いつでも解約 OK' は田中ゆかり P1 が
	// 「OK って書いてあるけど本当に違約金とかないの?」とサブスク被害連想で警戒。
	// 動詞ベース + 契約期間明示で軽さを排除し、不安の根本（解約の縛り）に直接答える。
	// 文字数は 6 → 19 文字に増えるが LP `cta-trust-badges` / `pricing.html ctaDisclaimerBadges`
	// 等の表示コンテキストでは行内収まる範囲で許容（必要に応じて CSS 側で改行調整）。
	anytimeOk: 'いつでも解約できます（契約期間の縛りなし）',
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
// LP_FAQ_TERMS — LP「FAQ / よくある(ご)質問」atom (#1896 PO-4-10、4 回目指摘 + #1898 PO-4-12)
// ============================================================
//
// LP 内で「FAQ」「FAQ 専用ページ」「FAQ 専用ページ（24 項目）」「よくあるご質問」
// 「よくある質問」が 5 表記混在し、PO 指摘 4 回連続再発の構造的問題が発生していた (#1896)。
// 同概念の string リテラルが labels.ts の独立 const (k71/k78/k87/k89/k102 / faqTitle)
// に分散し key 名が意味を持たなかったため、本 namespace に正準形 SSOT を集約。
//
// #1898 PO-4-12 では `LP_LEGAL_DISCLAIMER_LABELS.liabilityBody` /
// `liabilityLinks` / `cancelDisclaimerLinks` の値内に「FAQ」リテラルが
// 直接混入していた構造を、本 atom 経由の template literal 参照に置換した
// （ADR-0045 §3.3 atom / compound 責務分離）。
//
// 設計指針:
//   - canonicalLong    : 「よくあるご質問」(LP nav / footer / heading 全箇所統一)
//   - canonicalShort   : 「FAQ」(法的注記 / aria-label / mailto subject 等の限定的短縮形のみ)
//   - linkLabel        : インライン a タグ内のリンクラベル（canonicalLong と同値）
//   - faqHtmlTitle     : faq.html / pricing.html FAQ section の見出し（canonicalLong と同値）
//   - inlineCtaSentence: index.html 「他のご質問は <a>FAQ ページ</a> をご覧ください」誘導文
//
// 旧文言「FAQ 専用ページ（24 項目）」「FAQ 専用ページ」は項目数の経時変動 (24/26/28 …)
// で disclaimer 整合が破綻するため、誘導文では「よくあるご質問」単独に統一する。
//
// canonicalShort の値「FAQ」は本 atom 定義の 1 箇所のみとし、labels.ts 値内の
// 文字列リテラル「FAQ」直書きは scripts/check-no-plan-literals.mjs 等で
// 段階的に取り締まる方針（中期 follow-up #1909 用語白リスト CI）。

export const LP_FAQ_TERMS = {
	canonicalLong: 'よくあるご質問',
	canonicalShort: 'FAQ',
	linkLabel: 'よくあるご質問',
	faqHtmlTitle: 'よくあるご質問',
	// 値は `${LP_FAQ_TERMS.inlineCtaSentence}` で labels.ts compound から参照。
	// HTML 属性に " を含むため JS 側は ' で囲む。Biome formatter による自動折り返しは
	// generate-design-md-sections.mjs の multi-line aware parser が対応 (#1896)。
	inlineCtaSentence:
		'他のご質問は <a href="faq.html" class="nav-text">よくあるご質問</a> をご覧ください。',
} as const;

// ============================================================
// AGE_RANGE_TERMS — 年齢レンジ atom (UIUX-E-1、#1913)
// ============================================================
//
// LP 全体で「3〜18 歳」「3 歳から 18 歳まで」「3-18 歳」「13-18 歳」の表記揺れが PO 4 表記混在で
// 検出されたため (#1913 E-1)、波ダッシュ短縮形 / 自然形 / 数値部分のみ の 3 系統 atom に集約。
//
// 設計指針:
//   - short            : '3〜18 歳' （波ダッシュ + 半角空白 + 「歳」、見出し / バッジ等の短縮形）
//   - long             : '3 歳から 18 歳まで' （自然形、本文・概要訴求向け）
//   - numericShort     : '3〜18' （波ダッシュのみ、表組み / メタ情報用、後置で「歳」を別途付与）
//   - juniorShort      : '13〜18 歳' （carousel-3 alt 等の中高生レンジ表示、半角ハイフン排除）
//   - juniorNumericShort: '13〜18' （carousel-3 系 alt 内 numeric 部）
//
// 半角ハイフン形 ('3-18 歳' / '13-18 歳') は AC2 で 0 件にする対象。本 atom 経由で全箇所を
// 波ダッシュ統一する。

export const AGE_RANGE_TERMS = {
	short: '3〜18 歳',
	long: '3 歳から 18 歳まで',
	numericShort: '3〜18',
	juniorShort: '13〜18 歳',
	juniorNumericShort: '13〜18',
} as const;

// ============================================================
// POINT_TERMS — ポイント単位 atom (UIUX-E-3、#1913)
// ============================================================
//
// アプリ全体で「ポイント」「P」「pt」が混在し、子供 SS では P / 説明文では「ポイント」と
// 文脈別に揃えるべきところを単に揺れていた状態 (#1913 E-3)。
// AC5 = 子供 SS 以外の説明文で「P」（半角アルファベット単独）が 0 件であり、
// 「pt」は単位短縮形として shop / status 系で運用継続（AC5 対象外）。
//
// 設計指針:
//   - unit       : 'pt' （単位短縮形、shop / status / weeklyChallenge 等の数値直後）
//   - unitFull   : 'ポイント' （説明文・LP 訴求文の標準形）
//   - unitSymbol : 'P' （子供 SS 内の単位記号、shop 内 manualHint / manualMin 等の限定的短縮形）

export const POINT_TERMS = {
	unit: 'pt',
	unitFull: 'ポイント',
	unitSymbol: 'P',
} as const;

// ============================================================
// CURRENCY_TERMS — 通貨 atom (UIUX-E-5、#1913)
// ============================================================
//
// 「¥」「&#165;」「&#xA5;」「円」が混在し、HTML エンティティ表記 (&#xA5; / &#165;) が
// pamphlet.html / shared-labels.js / labels.ts 内に残っていた (#1913 E-5)。
// AC7 = `&#xA5;` / `&#165;` HTML entity が 0 件、「¥」直書き統一。
//
// 設計指針:
//   - yen     : '¥' （直書き U+00A5、全箇所統一）
//   - yenFull : '円' （文末用、「500円」「780円」等の数値後置形）
//
// 「¥500」「¥780」「¥0」の compound は PRICE_TERMS で先に集約済のため、CURRENCY_TERMS は
// 単体記号として PRICE_TERMS や labels.ts compound 内で「¥」を直書きする際の atom 参照源。

export const CURRENCY_TERMS = {
	yen: '¥',
	yenFull: '円',
} as const;

// ============================================================
// FREE_PLAN_TERMS — 無料プラン訴求 atom (UIUX-E-7、#1913)
// ============================================================
//
// LP 全体で「フリー」「ずっと無料」「永久無料」「無料プラン」が訴求文脈で混在し、
// PO 指摘 (UIUX-E-7) で「ずっと無料」撤去 + 「永久無料」訴求バッジ + 「無料プラン」説明
// に統一する方針が確定 (#1913 E-7)。AC8 = 「ずっと無料」が 0 件。
//
// 設計指針:
//   - forever     : '永久無料' （バッジ語、planFreeBadge / planFreePriceSub 等で使用）
//   - foreverDot  : '永久無料 ・ ' （bullet 連結 prefix、planFreePriceSub 等で使用）
//   - planSelfNoun: 'フリー' （プラン名カード見出し / pricing 表 row 名、PLAN_TERMS.free と
//                   等価だが planFreeName 文脈で短縮表記を維持するため独立 atom 化）
//
// 「ずっと無料」は撤去対象のため atom には含めない（再混入防止）。

export const FREE_PLAN_TERMS = {
	forever: '永久無料',
	foreverDot: '永久無料 ・ ',
	planSelfNoun: 'フリー',
} as const;

// ============================================================
// AUTONOMY_TERMS — 自律 / 自走 リフレーム atom (UIUX-F-16、#2058)
// ============================================================
//
// 「自律」「自走」は IT リテラシー親目線の硬い語彙で子供向けプロダクトトーンと不整合
// （PR #2054 / #1912 UIUX-F-16 deferred）。LP マーケティング面では親しみやすい
// 「自分から動きだす」「自分で計画する」へリフレームする。
//
// 設計指針:
//   - selfMotivated     : 「自分から動きだす」（自発性、旧「自走」の言い換え、終止形）
//   - selfMotivatedPast : 「自分から動きだした」（過去形・条件形 prefix、versus row3DigitalTitle で
//                          「〜たら」接続用。連用形「動きだし」+「た」で文法的に自然な接続を保証）
//   - selfPlanning      : 「自分で計画する」（計画性・自立性、旧「自律」の言い換え、終止形）
//   - selfPlanningAble  : 「自分で計画できる」（可能形、growth-roadmap sectionDesc 等で使用）
//
// スコープ範囲（AC2 法務確認の保守的判断、Issue #2058 タスクコンテキスト指示）:
//   - LP マーケティング面（LP_VERSUS_LABELS / LP_GROWTH_ROADMAP_LABELS）はリフレーム対象
//   - 法務文書（LP_LEGAL_TERMS_LABELS.section14 / LP_LEGAL_PRIVACY_LABELS.section6_2）は
//     法務承認後の別 PR で対応（契約用語「自律」が「卒業 = サービス終了 trigger」定義の
//     根拠語彙となっており、用語変更が契約意図に影響する可能性があるため、本 PR では未変更）
//   - CANCELLATION_LABELS / GRADUATION_LABELS / discord-notify-service.ts も同上
//     （カテゴリ ID 'graduation' の hint / Discord 内部通知 / 卒業フロー UI は法的文脈と接続）
//
// 法務 review 必要事項（PR body に明示）:
//   - 利用規約第 14 条（卒業 — ポジティブな解約について）の「自律的に行えるようになった時点」
//     の用語変更可否
//   - プライバシーポリシー第 6 条の 2（卒業フローと事例公開承諾）の「自律して使う必要が
//     なくなった」の用語変更可否
//   - 法務承認取得後、LP_LEGAL_*_LABELS / CANCELLATION_LABELS / GRADUATION_LABELS の
//     atom 化を別 PR で実施（#2058 follow-up）

export const AUTONOMY_TERMS = {
	selfMotivated: '自分から動きだす',
	selfMotivatedPast: '自分から動きだした',
	selfPlanning: '自分で計画する',
	selfPlanningAble: '自分で計画できる',
} as const;
