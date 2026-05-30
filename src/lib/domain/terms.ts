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
//   CHILD_TERMS      — 子供 / お子さま / こども 表記の atom（TECH-F、#1914）
//   PARENT_TERMS     — 親 / 保護者 表記の atom（TECH-F、#1914）
//   SIGNUP_TERMS     — お申し込み / サインアップ / アカウント作成 表記の atom（TECH-F、#1914）
//   LOGIN_TERMS      — ログイン / サインイン 表記の atom（TECH-F、#1914）
//   TRIAL_PERIOD_TERMS — 7 日間無料トライアル compound atom（TECH-F 中頻度、#1915）
//   UPGRADE_TERMS    — プラン変更 / アップグレード / 上位プラン atom（TECH-F 中頻度、#1915）
//   PLAN_CHANGE_TERMS — プラン変更 / archive / restore atom（Phase 5 #2656 + Phase 7 PR-2a、#2688 / Round 1 #2689 で atom-only に絞込）
//   GRADUATION_TERMS — 卒業 / 最終ゴール atom（TECH-F 中頻度、#1915）
//   ADVENTURE_TERMS  — 冒険 / メインクエスト atom（TECH-F 中頻度、#1915）
//   MECHANISM_TERMS  — 仕組み / 工夫 / 設計 atom（TECH-F 中頻度、#1915）
//   LIFESTAGE_TERMS  — 年齢 / 年齢区分 / 学年 atom（TECH-F 中頻度、#1915）
//   CHEER_TERMS      — 応援 / 応援する / できごと atom（EPIC #2266、#2276）
//   REWARD_TERMS     — ごほうび管理 / ごほうびショップ / プリセット atom（EPIC #2266、#2276）
//   TEMPLATE_TERMS   — みんなのテンプレート / テンプレート atom（EPIC #2266、#2276）
//   CHECKOUT_TERMS   — Stripe Checkout custom_text atom（景品表示法対応、EPIC #2345 / #2346）
//   TOKUSHOHO_TERMS  — 特商法第12条の6 6 項目見出し + 短い名詞 atom（Phase 3 #2573 + Phase 7 PR-2a、#2688 / Round 1 #2689 で 6 見出し + cancelButtonLabel に絞込、法令文 compound は labels.ts 側へ移動）
//   CHECKOUT_SUCCESS_TERMS — Stripe Checkout 完了後 success ページ atom（Phase 3 #2572 + Phase 7 PR-2a、#2688 / Round 1 #2689 で 5 variant 見出し + ボタンラベルに絞込、本文 compound は labels.ts 側へ移動）
//
// 参照: docs/DESIGN.md §6 / Issue #1916 / Issue #1917 (template literal parser) / Issue #1958 / Issue #1896 / Issue #1898 / Issue #1913 / Issue #2058 / Issue #1914 / Issue #1915 / Issue #2266 / Issue #2276 / Issue #2345 / Issue #2346 / Issue #2688 (Phase 7 PR-2a)

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
// CANCEL_TERMS — 解約 atom (#1914 で TECH-F 拡張)
// ============================================================
//
// #1914: 「解約」「キャンセル」「退会」3 表記の SSOT 集約。
// 「キャンセル」はボタン操作取消 (UI_LABELS.cancel) と意味文脈が異なるため、
// 「解約」意味の atom として canonical / canonicalVerb を新規追加。
// 「退会」も「解約 → アカウント削除」の意味で labels.ts 値内で混在していたため統一。
//
// 設計指針:
//   - canonical    : '解約' （体言止め、見出し / FAQ 質問 / 設定セクション題で第一選択）
//   - canonicalVerb: '解約する' （動詞、設定 / pricing 画面のアクション系で使用）
//   - anytime      : 'いつでも解約' （pricing badge / CTA disclaimer の短縮形）
//   - anytimeOk    : 'いつでも解約できます（契約期間の縛りなし）' (#1904 PERS-CRT-5)
//   - account      : '退会' （契約の意味の「解約」と区別したアカウント削除文脈の名詞）
//                   → 法務文書整合で「退会」用語を維持しつつ atom 経由参照を担保
//
// 「ボタンの操作取消（モーダル × ボタン）」は UI_LABELS.cancel に既存集約済み。
// 本 atom は「サブスク契約の解約 / アカウント退会」専用。

export const CANCEL_TERMS = {
	canonical: '解約',
	canonicalVerb: '解約する',
	anytime: 'いつでも解約',
	anytimeOk: 'いつでも解約できます（契約期間の縛りなし）',
	account: '退会',
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

// ============================================================
// ADMIN_VIEW_TERMS — 「管理画面」 → 「ご家族の見守り画面」 rename atom (#2057)
// ============================================================
//
// 本サービスにおける管理者向け画面 (旧称「管理画面」) の正式名称 atom。
// LP / アプリ本体 UI / 利用規約 第14条 / プライバシーポリシー 第6条の2 / FAQ /
// E2E test の期待値で 1 行修正で全箇所伝播させるため、SSOT として独立 atom 化。
//
// ADR-0045 (terms.ts SSOT 2 階層化) に従い、labels.ts compound はこの atom を
// `${ADMIN_VIEW_TERMS.canonical}` の template literal で参照する。
//
// 設計指針:
//   - canonical: 正式名称（UI / 法務文書 / FAQ で第一選択。「ご家族の見守り画面」）
//   - short:     短縮形（ナビ・ボタン等の文字数制約箇所。「見守り画面」）
//   - parent:    所有者を強調する文脈用（旧「親管理画面」相当。「保護者の見守り画面」）
//
// 「Stripe の管理画面」のような外部サービスの「管理画面」用語とは意味文脈が異なるため、
// 別 atom (STRIPE_PORTAL_TERMS) として分離する。
//
// 参照: docs/DESIGN.md §6 / Issue #2057 / Issue #1912 (UIUX-F-13)

export const ADMIN_VIEW_TERMS = {
	canonical: 'ご家族の見守り画面',
	short: '見守り画面',
	parent: '保護者の見守り画面',
} as const;

// ============================================================
// STRIPE_PORTAL_TERMS — Stripe billing portal の用語 atom (#2057)
// ============================================================
//
// 本サービスの「管理画面 → ご家族の見守り画面」リネームに伴い、Stripe billing portal
// 側の「Stripeの管理画面」「請求管理画面」等の表現も同 atom 経由で集約する。
//
// Stripe 自身は portal を「カスタマーポータル」と呼ぶが、日本語 UI では
// 「請求管理ページ」「Stripe の請求管理ページ」が定着しているためこちらを採用。
// 本サービスの canonical 「ご家族の見守り画面」と意味衝突しない別語彙として保つ。

export const STRIPE_PORTAL_TERMS = {
	canonical: 'Stripe の請求管理ページ',
	short: '請求管理ページ',
	billingPortal: '請求管理ページ',
} as const;

// ============================================================
// CHILD_TERMS — 「子供」「お子さま」「子ども」「こども」4 表記の SSOT atom (#1914)
// ============================================================
//
// labels.ts 全体で「子供」(40) / 「お子さま」(76) / 「子ども」(1) / 「こども」(以下大量)
// の 4 表記混在が検出された (#1914 TECH-F)。文脈別 2 系統に集約:
//
//   - honorific : 「お子さま」 (LP hero 主訴求 / 法務文書 / 保護者向け説明文の敬称)
//   - neutral   : 「子供」 (機能説明 / コード namespace 名 / 客観的記述)
//   - hiragana  : 「こども」 (子供本人向け UI / セットアップ / 短い見出し、ひらがな専用)
//
// 「子ども」(混合表記) は 0 件化対象。「こども」(ひらがな) は子供画面 (preschool/elementary)
// で意図的に使用されており SSOT 集約対象として hiragana atom で保持。
//
// 設計指針:
//   - 同じ画面内で 2 表記混在を避ける（hero=お子さま、機能説明=子供 を厳守）
//   - 子供画面 (uiMode preschool/elementary) は hiragana 統一
//   - 法務文書（利用規約・プライバシーポリシー）は honorific 統一

export const CHILD_TERMS = {
	honorific: 'お子さま',
	neutral: '子供',
	hiragana: 'こども',
} as const;

// ============================================================
// PARENT_TERMS — 「親」「保護者」2 表記の SSOT atom (#1914)
// ============================================================
//
// labels.ts 全体で「親」(19) / 「保護者」(17) 表記混在が検出された (#1914 TECH-F)。
// 文脈別 2 系統に集約:
//
//   - honorific : 「保護者」 (法務文書 / 利用規約 / 正式文脈)
//   - neutral   : 「親」 (LP hero / 機能説明文 / 客観的記述)
//
// 設計指針:
//   - 法務文書（利用規約・プライバシーポリシー）は honorific 統一
//   - LP マーケティング訴求は neutral でも honorific でも文脈に応じて使い分け可
//   - 同一文内に両表記が混在することは避ける（grep でセクション単位の整合確認）

export const PARENT_TERMS = {
	honorific: '保護者',
	neutral: '親',
} as const;

// ============================================================
// SIGNUP_TERMS — 「登録」「サインアップ」「アカウント作成」「お申し込み」4 表記の SSOT atom (#1914)
// ============================================================
//
// labels.ts 全体で「登録」(行為としての多義語) / 「サインアップ」 / 「アカウント作成」 /
// 「お申し込み」の 4 表記混在が検出された (#1914 TECH-F)。
//
// 「登録」は「活動登録」「お子さま登録」「ポイント登録」等で行為を表す多義語として
// 広く使われており、機械的に 0 件化することは不可能。本 atom では「サブスク／アカウント
// 開設意味の登録」のみを「お申し込み」に統一する方針:
//
//   - canonical    : 'お申し込み' （プラン契約・アカウント開設の敬称、CTA / pricing 文末）
//   - canonicalVerb: 'お申し込みする' （動詞、アクション系 CTA）
//   - signup       : 'サインアップ' (英語カタカナ、技術ドキュメント / 内部 ID 等の限定的維持)
//                    → labels.ts 値内では 0 件化対象だが、test fixtures / cognito 内部用語は
//                       対象外（UI 表示文言以外）
//
// 「アカウント作成」「サインアップ」が labels.ts 内に検出された場合は本 atom canonical に
// 置換する。「アカウント登録」「会員登録」も同じ意味として canonical に統一する。
//
// 例外 (atom 化非対象):
//   - 「お子さま登録」「活動登録」「ポイント登録」等 サブ機能としての「登録」
//   - PAGE_TITLES.signup: 'アカウント登録' （ナビゲーションラベルとして残置可、要 PO 判断）

export const SIGNUP_TERMS = {
	canonical: 'お申し込み',
	canonicalVerb: 'お申し込みする',
	signup: 'サインアップ',
} as const;

// ============================================================
// LOGIN_TERMS — 「ログイン」「サインイン」2 表記の SSOT atom (#1914)
// ============================================================
//
// labels.ts 全体で「ログイン」統一は既に達成済（grep 検証で「サインイン」0 件）。
// 本 atom は後続変更で表記が再混入することを防ぐ予防的 SSOT。
//
//   - canonical : 'ログイン' （UI 表示の第一選択）
//   - signin    : 'サインイン' (技術ドキュメント / 内部用語のみ、UI 表示は 0 件)
//
// 法務文書（プライバシーポリシー）で「サインイン」が残存している場合、文脈確認の上で
// 別 PR で対応（本 PR スコープは labels.ts compound 集約に限定）。

export const LOGIN_TERMS = {
	canonical: 'ログイン',
	signin: 'サインイン',
} as const;

// ============================================================
// TRIAL_PERIOD_TERMS — 7 日間無料トライアル compound atom (TECH-F 中頻度 / #1915)
// ============================================================
//
// LP / アプリ全体で「7 日間無料トライアル」「7 日間の無料体験」「7日間無料で試す」
// 「7 日間無料」が混在 (#1915 中頻度 D-1)。すでに `TRIAL_TERMS.duration` /
// `TRIAL_TERMS.durationSpaced` の期間 atom と `CTA_TERMS.freeTrialNoun` の
// 「無料体験」atom は terms.ts に存在するが、「7 日間無料トライアル」(統合形) を
// 直接参照する atom がなく `LP_COMMON_LABELS.trialPeriodLabel` 等で
// template literal 化されている。
//
// 設計指針:
//   - full         : '7 日間無料トライアル' (半角空白あり、LP 統一表記、#1913 UIUX-E-2)
//   - shortNoSpace : '7日間無料トライアル'  (半角空白なし、半角揺れ吸収用、表記揺れ救済枠)
//
// 既存の TRIAL_TERMS / CTA_TERMS / LP_COMMON_LABELS.trialPeriodLabel との関係:
//   - terms.ts 内 atom: 期間 (TRIAL_TERMS.duration) と訴求名詞 (CTA_TERMS.freeTrialNoun) の
//     2 atom を持つが、本サービスで最頻出の compound「7 日間無料トライアル」を
//     1 atom として独立化することで、半角空白の有無による表記揺れ (#1913) の再発を構造的に防ぐ。
//   - labels.ts compound: `LP_COMMON_LABELS.trialPeriodLabel` 等は `${TRIAL_TERMS.durationSpaced}無料トライアル`
//     で表現されていたが、本 atom 経由参照 (`${TRIAL_PERIOD_TERMS.full}`) に統一する。

export const TRIAL_PERIOD_TERMS = {
	full: '7 日間無料トライアル',
	shortNoSpace: '7日間無料トライアル',
} as const;

// ============================================================
// UPGRADE_TERMS — プラン変更 (旧「アップグレード」「上位プラン」) atom (TECH-F 中頻度 / #1915)
// ============================================================
//
// LP / アプリ全体で「アップグレード」「上位プラン」「プラン変更」が混在 (#1915 中頻度 D-2)。
// Issue 設計方針では「プラン変更」を canonical として 0 件化する方針。
//
// スコープ調整 (PR 本文に明記):
//   admin UI / FAQ / モーダル等の「アップグレード」ボタン文言は確立した UX 用語であり、
//   一括「プラン変更」化はユーザの認知混乱を招くリスクが高い (Pre-PMF / ADR-0010)。
//   本 atom は terms.ts SSOT として canonical 値を定義するが、labels.ts compound への
//   実適用は LP 文脈 (LP_*_LABELS / PRICING / FAQ) を最優先とし、admin UI の段階的移行は
//   別 Issue で扱う方針 (#1915 PR スコープ調整、ADR-0045 §3.3 段階移行原則)。
//
// 設計指針:
//   - canonical    : 'プラン変更'  (LP / 法務 / 説明文での標準形)
//   - actionVerb   : 'アップグレード' (既存 UI 動詞 atom、admin ボタン互換維持用 — 撤去は別 Issue)
//   - higherPlan   : '上位プラン'   (既存 UI 名詞 atom、説明文互換維持用 — 撤去は別 Issue)

export const UPGRADE_TERMS = {
	canonical: 'プラン変更',
	actionVerb: 'アップグレード',
	higherPlan: '上位プラン',
} as const;

// ============================================================
// PLAN_CHANGE_TERMS — プラン変更 (アップ / ダウン / archive / restore / protected) atom
// ============================================================
//
// Phase 5 グループ C #2656 §2 原則 3 + §3.1 で確定された atom (Phase 7 PR-2a)。
// Phase 3 #2574 (期末ダウン banner) + #2575 (archived reactivation) + #2623 (Phase 4 動線)
// で共通参照される SSOT atom を 1 namespace に統合。
//
// 設計意図:
//   プラン変更 (アップ / ダウン 双方) と「archive / restore / protected」関連の
//   単一用語 atom 集約。ADR-0049 retention 90 日整合で free / paid variant を併設し、
//   景表法 5 条 1 号 (優良誤認表示) 回避を構造担保する。
//
// 関連 ADR:
//   - ADR-0012 (Anti-engagement): 「失う / 消える / 使えなくなる」atom を含めない
//                                  (煽り回避、Phase 5 §2 原則 3 統合判断 + Phase 3 #2575 §文言)
//   - ADR-0045 (terms.ts 2 階層): atom 単一用語、compound 組立は labels.ts 側
//                                  (`PLAN_CHANGE_LABELS` は PR-2b で追加、本 PR scope 外)
//   - ADR-0049 (retention 90 日): protectedFree / resumeReadyFree variant で
//                                  free plan 90 日物理削除事実を伝達 (景表法 5 条整合)
//   - ADR-0058 (family → premium rename): premium plan 文脈の compound 組立は PR-4 以降
//
// 統合判断の根拠 (Phase 5 §2 原則 3、本 PR で SSOT 化):
//   - #2574 提案の主軸 key (banner / reactivation 動線で参照)
//   - 旧版 11 key のうち、#2689 Round 1 で compound 句 (`restoreAble` / `resumeReady*` /
//     `protected*` / `keepCurrent`) は labels.ts `PLAN_CHANGE_LABELS` に移動 (Phase 7 PR-2b)
//
// 設計指針 (key 別、Round 1 後):
//   - 動詞: changeVerb / changeNoun ("プランを変更" / "プラン変更")
//   - ダウン確定状態: scheduledChange ("切り替わります"、#2574 banner 専用、単語 atom)
//   - archive 行為: archive / archiveVerb ("アーカイブ" / "アーカイブされます")
//   - 復活: restore ("復活"、単語 atom のみ)
//   - 保護 atom / CTA compound: PR-2b で labels.ts compound として組立 (ADR-0045 §3.3 整合)

// #2689 Round 1 (Adversarial business 軸 + ADR-0045 §3.3 整合):
// 旧版では `restoreAble: 'すぐに復活できます'` / `resumeReady*` / `protected*` / `keepCurrent` など
// 助詞・複数 atom 結合の compound 句が混在していた。ADR-0045 §3.3 「terms.ts に compound (複数 atom
// 組立文) を追加禁止」に整合させ、本 atom には**単一概念の動詞・名詞**のみを残す。
// 旧 compound 句は labels.ts `PLAN_CHANGE_LABELS` (Phase 7 PR-2b で追加予定) に template literal 経由で移動する。
export const PLAN_CHANGE_TERMS = {
	// 動詞 (#2574 + #2575 共通)
	changeVerb: 'プランを変更',
	changeNoun: 'プラン変更',
	// ダウン確定状態 (#2574 専用、単語 atom)
	scheduledChange: '切り替わります',
	// archive 行為 (#2574 + #2575 共通、単語 atom)
	archive: 'アーカイブ',
	archiveVerb: 'アーカイブされます',
	// 復活 (#2574 + #2575 共通、単語 atom)
	restore: '復活',
} as const;

// ============================================================
// GRADUATION_TERMS — 卒業 (旧「ゴール」「最終地点」) atom (TECH-F 中頻度 / #1915)
// ============================================================
//
// LP 全体で「卒業」「ゴール」「最終地点」が混在 (#1915 中頻度 D-4)。
// AC3 = 「ゴール」「最終地点」が 0 件、「卒業」統一。
//
// 設計指針:
//   - canonical : '卒業'       (本サービスのアイデンティティ用語、ADR-0011 / docs/design)
//   - finalGoal : '最終ゴール' (旧「最終地点」「最終ゴール」リテラル吸収、コメント上では「ゴール」を
//                              意味分離して保持する場合に参照)

export const GRADUATION_TERMS = {
	canonical: '卒業',
	finalGoal: '最終ゴール',
} as const;

// ============================================================
// ADVENTURE_TERMS — 冒険 (旧「クエスト」「アドベンチャー」) atom (TECH-F 中頻度 / #1915)
// ============================================================
//
// LP / アプリで「冒険」「クエスト」「アドベンチャー」が混在 (#1915 中頻度 D-5)。
//
// スコープ調整 (PR 本文に明記、AC4 0 件化不可項目):
//   1. 商品名「がんばりクエスト」は brand identity であり変更不可 (APP_LABELS.name 等で
//      多数の compound に出現)。
//   2. ゲームメカニクス用語「メインクエスト」「メインクエスト ×2」は子供 UI で
//      確立した語彙であり、子供画面 UX を毀損するため変更不可 (BABY_HOME_LABELS /
//      DEMO_BATTLE_LABELS 等で参照)。
//   3. 「クエスト集」(MARKETPLACE_LABELS) はマーケットプレイス独自の語彙であり、
//      LP truth (ADR-0013) との整合のため別 Issue で扱う。
//   上記 3 項目は terms.ts atom 経由参照は不採用とし、リテラル維持。
//   本 atom は新規 compound (LP 説明文等) で「冒険」を参照する場合の SSOT として定義する。
//
// 設計指針:
//   - canonical : '冒険'         (LP 説明文 / 法務 / 一般説明での標準形)
//   - mainQuest : 'メインクエスト' (子供 UI で確立したゲームメカニクス用語、撤去対象外)

export const ADVENTURE_TERMS = {
	canonical: '冒険',
	mainQuest: 'メインクエスト',
} as const;

// ============================================================
// MECHANISM_TERMS — 仕組み (旧「設計」「工夫」) atom (TECH-F 中頻度 / #1915)
// ============================================================
//
// LP 全体で「設計」「工夫」「仕組み」が混在 (#1915 中頻度 D-7)。PO 採択 B 案で
// 「仕組み」canonical 化、AC5 = 「設計」「工夫」0 件 (連語例外あり)。
//
// スコープ調整 (PR 本文に明記、AC5 連語例外):
//   1. 「2 つの工夫」「3 つの工夫」(LP_INDEX_PHASEB_LABELS.k21 等) は #1782 / #1708 で
//      PO 確定済の構造的見出しであり、「2 つの仕組み」へリフレームすると意味が変わる
//      (「仕組み」= mechanism / system、「工夫」= clever device の意味差分)。
//      連語例外として保持 (Issue 本文 AC5 exception 句に整合)。
//   2. 「無断課金が構造的に発生しない設計」「煽らない設計」(LP_INDEX_LABELS / 5639 等)
//      は LP truth (ADR-0013) で「設計上の特性」を強調する文脈であり、「仕組み」では
//      意味弱化する。これらは LP 訴求での意図的選択のため連語例外として保持。
//   3. 「カスタム設計」「初回セットアップ … で回せるよう設計」等の連語 (#1915 AC5 exception)
//      も同様の理由で保持。
//   本 atom は新規 compound / 単独「仕組み」参照箇所での SSOT として定義する。
//
// 設計指針:
//   - canonical : '仕組み' (mechanism / system、LP 顧客語彙)
//   - device    : '工夫'   (clever device、構造的見出し「N つの工夫」用、撤去対象外)
//   - blueprint : '設計'   (engineering design、特性訴求連語用、撤去対象外)

export const MECHANISM_TERMS = {
	canonical: '仕組み',
	device: '工夫',
	blueprint: '設計',
} as const;

// ============================================================
// LIFESTAGE_TERMS — 年齢 / 年齢区分 atom (TECH-F 中頻度 / #1915)
// ============================================================
//
// 「年齢」「年齢帯」「年齢区分」「学年」が混在 (#1915 中頻度 D-6)。既存
// `AGE_RANGE_TERMS` (3〜18 歳 等) は数値レンジの atom であり、概念用語の
// atom が別途必要。AC6 = 「年齢」「年齢帯」「学年」「年齢区分」が AGE_RANGE_TERMS
// 系参照に統一。
//
// スコープ調整 (PR 本文に明記):
//   1. 「年齢区分」(AGE_TIER_LABELS の説明 / statAgeTierLabel 等) は ADR-0011 で確立した
//      アプリ内分類用語であり、UI 表示の「年齢区分」ボタン / table header は維持。
//      本 atom は新規 compound での参照源として定義する。
//   2. 「学年」(MEMBERS_LABELS.description / LP_INDEX_PHASEB_LABELS.k23 等) は preset の
//      学年別カスタマイズに関する具体的説明文で、概念用語「年齢」とは意味分離。
//      撤去対象外。
//
// 設計指針:
//   - canonical    : '年齢'       (概念用語、本文・段落での標準形)
//   - tier         : '年齢区分'   (ADR-0011 確立分類、UI ラベル / table header 用)
//   - schoolGrade  : '学年'       (preset カスタマイズ用語、独立保持)

export const LIFESTAGE_TERMS = {
	canonical: '年齢',
	tier: '年齢区分',
	schoolGrade: '学年',
} as const;

// ============================================================
// CHEER_TERMS — 応援 atom (#2276 / EPIC #2266)
// ============================================================
//
// PO 報告 (2026-05-19): 「応援 = 任意の理由で直接子供にポイント付与 (運動会一位等)、
// スタンプ/メッセージは P 付与に付随する理由表現」。本 atom は cheer 機能の
// canonical / action / reasonField の 3 用途 SSOT。
//
// 設計指針:
//   - canonical    : '応援'       (汎用名詞、ナビ / ページタイトル等の標準形)
//   - action       : '応援する'    (ボタン動詞、grantButton 用)
//   - reasonField  : 'できごと'    (入力ラベル、PO 「子供にも分かる平易語」の今後の置換候補)
//
// 既存リテラル (CHEER_LABELS '応援' 多数) との段階的 atom 化のため本 atom を導入。
// 1 行修正で 「応援」→「がんばり応援」等のリブランディング時に伝播可能。

export const CHEER_TERMS = {
	canonical: '応援',
	action: '応援する',
	reasonField: 'できごと',
} as const;

// ============================================================
// REWARD_TERMS — ごほうび atom (#2276 / EPIC #2266)
// ============================================================
//
// PO 報告 (2026-05-19): rewards CRUD と子供 shop の責務分離。CRUD は親管理画面の
// /admin/rewards、shop は子供画面の /(child)/shop。「テンプレート」内部用語を
// UI から撤去し「プリセット」に置換 (atom 経由)。
//
// 設計指針:
//   - menu      : 'ごほうび管理'    ( /admin/rewards の (b) CRUD 正式名 )
//   - shop      : 'ごほうびショップ' ( /(child)/shop の (a) 子供 shop 正式名 )
//   - preset    : 'プリセット'      ( テンプレ用語の代替、UI 露出用 )
//   - canonical : 'ごほうび'        ( 短縮形、ナビ / セクションタイトル等の標準形 )
//
// 既存 REWARDS_LABELS の '管理' / '一覧' / '申請' 等は本 atom と組み合わせて使う。

export const REWARD_TERMS = {
	menu: 'ごほうび管理',
	shop: 'ごほうびショップ',
	preset: 'プリセット',
	canonical: 'ごほうび',
} as const;

// ============================================================
// TEMPLATE_TERMS — みんなのテンプレート atom (#2276 / EPIC #2266)
// ============================================================
//
// PO 確定方針 (A0、2026-05-19): URL `/marketplace` は維持、UI ラベルのみ
// 「みんなのテンプレート」統一。本 atom は UI 露出専用の SSOT。
//
// 設計指針:
//   - userFacing  : 'みんなのテンプレート' ( /marketplace の UI ラベル統一 )
//   - short       : 'テンプレート'         ( ナビ短縮形 / 詰めて表示する文脈用 )
//   - browse      : 'みんなのテンプレートを見る' ( CTA ボタン文言 )
//
// 「マーケットプレイス」リテラルは UI 露出禁止 (ADR-0041 移行完了)、内部識別子
// (`marketplace-item.ts` / API endpoint 等) は維持。

export const TEMPLATE_TERMS = {
	userFacing: 'みんなのテンプレート',
	short: 'テンプレート',
	browse: 'みんなのテンプレートを見る',
} as const;

// ============================================================
// CHECKOUT_TERMS — Stripe Checkout custom_text atom (#2346 / EPIC #2345)
// ============================================================
//
// PO 確定文言 (2026-05-20): Stripe Checkout `custom_text.submit` /
// `custom_text.after_submit` で従来「すべての機能」と表示していたものを
// 「お選びのプランの機能」に置換する。
//
// 法的根拠:
//   - 景品表示法 5 条 1 号 (優良誤認表示) — 「すべての機能」と表示すると
//     スタンダードプラン購入時にファミリープラン機能まで含むと誤認させる可能性
//   - 特商法 2022-06 改正 最終確認画面ガイドライン — Stripe Checkout 最終確認画面の
//     誤認表示は消費者契約取消可能性 (消費者契約法 4 条 1 項)
//   - 消費者庁「動画見放題プラン」措置命令事例 — 本ケースと相同類型
//   - 「お選びのプランの機能」と限定文言にすることで、上位プラン機能を含むと誤認させる
//     リスクを構造的に排除する
//
// 設計指針:
//   - chosenPlanFeature : 'お選びのプランの機能'  (景品表示法対応の限定文言、submit / after_submit
//                         compound の中核 atom。プラン名を動的に差し込まないことで Stripe Checkout
//                         の plan tier 未確定タイミングを回避し、かつ「お選びの」で能動的選択を
//                         喚起 = 優良誤認回避)
//
// 既存 atom (PLAN_FULL_TERMS) との関係:
//   - PLAN_FULL_TERMS は「スタンダードプラン」「ファミリープラン」等の plan tier 名 atom
//   - CHECKOUT_TERMS は plan tier を意図的に動的化しない (景品表示法整合) ため独立 atom

export const CHECKOUT_TERMS = {
	chosenPlanFeature: 'お選びのプランの機能',
} as const;

// ============================================================
// TOKUSHOHO_TERMS — 特商法第12条の6 6 項目見出し + 補足文言 atom (#2573 / Phase 7 PR-2a)
// ============================================================
//
// 特商法 6 項目は **法務文書 (tokushoho.html) / Stripe Checkout `custom_text` /
// `/admin/subscription/confirm` 画面** の 3 経路で **同一文言** を維持する必要があり、
// SSOT 化が必須 (Phase 5 グループ C #2656 §3.2 配置確定、Phase 3 #2573 §4.1 SSOT)。
//
// 法的根拠:
//   - 改正特商法 (令和3年改正) 第12条の6 第1項各号
//   - 消費者庁「通信販売の申込み段階における表示についてのガイドライン」(令和4年6月)
//   - 景品表示法第5条1号 (優良誤認、CHECKOUT_TERMS と相補)
//
// 既存 atom との関係:
//   - PRICE_TERMS — 価格本体 (¥500 / ¥780 / ¥0 / 税込) は既存
//   - TRIAL_TERMS — 7 日間 / カード登録不要は既存
//   - CANCEL_TERMS — 解約 (いつでも解約) は既存
//   - CHECKOUT_TERMS — 「お選びのプランの機能」(景品表示法対応) は既存
//   - TOKUSHOHO_TERMS — 本 atom、特商法 6 項目の見出し + 短い名詞 atom のみ
//     (法令文 compound は #2689 Round 1 で labels.ts 側に移動、ADR-0045 §3.3 整合)
//
// 設計指針 (Round 1 後):
//   - 6 ブロック見出し (heading1-6): 法令で定められた表示順序を厳密維持、各見出しは単一名詞句
//   - cancelButtonLabel: 'やめる' (短い動詞句、compound 組立用)
//   - 法令文 compound (subscriptionType / pciNote / noAdditionalFee / cancelMethodFull /
//     cancelAfterPolicy / consentLabel / confirmButtonLabel / autoRenewalNotice /
//     noProrationRefund): labels.ts `TOKUSHOHO_LABELS` で template literal 組立 (Phase 7 PR-2b)
//
// 関連 compound: SUBSCRIPTION_CONFIRM_LABELS (Phase 7 PR-2b で追加、本 PR scope 外)

// #2689 Round 1 (Adversarial business 軸 + ADR-0045 §3.3 整合):
// 旧版では `cancelMethodFull` / `cancelAfterPolicy` / `autoRenewalNotice` / `pciNote` / `noAdditionalFee`
// / `consentLabel` / `subscriptionType` 等の法令文 (複数 atom 結合の文章) が混在していた。
// ADR-0045 §3.3 「terms.ts に compound 追加禁止」に整合させ、本 atom には**6 ブロック見出し** (法令で
// 表示順序が定められた単一名詞句) と**短い名詞 atom** のみを残す。
// 旧 compound 句は labels.ts `TOKUSHOHO_LABELS` (Phase 7 PR-2b で追加予定) に template literal 経由で
// 移動する。法令改正時の影響範囲を可視化するため、compound 側で他 atom (CANCEL_TERMS /
// STRIPE_PORTAL_TERMS / ADMIN_VIEW_TERMS / PRICE_TERMS) と結合する責務を持たせる。
export const TOKUSHOHO_TERMS = {
	// 6 ブロック見出し (法令で定められた表示順序を厳密維持、各見出しは単一名詞句 atom)
	heading1Quantity: '分量',
	heading2Price: '販売価格',
	heading3Payment: '支払時期・方法',
	heading4Delivery: '引渡時期・自動更新',
	heading5Cancel: '申込撤回・解約方法',
	heading6Important: '重要事項',
	// 短い名詞 atom (compound 組立用、単一概念)
	cancelButtonLabel: 'やめる',
} as const;

// ============================================================
// CHECKOUT_SUCCESS_TERMS — Stripe Checkout 完了後 success ページ atom (#2572 / Phase 7 PR-2a)
// ============================================================
//
// `/admin/subscription/success` (Checkout 完了直後の 5 variant 画面) で使う SSOT atom
// (Phase 5 グループ C #2656 §3.3 配置確定、Phase 3 #2572 §文言 atom SSOT)。
//
// 既存 `CHECKOUT_TERMS` (Checkout 直前 custom_text 用) とは意味文脈が異なるため別 atom 化:
//   - CHECKOUT_TERMS: Stripe Checkout `custom_text.submit` / `after_submit` の限定文言
//   - CHECKOUT_SUCCESS_TERMS: success ページ (5 variant) の見出し + ボタンラベル
//     (本文 *Body* は #2689 Round 1 で labels.ts compound 側に移動、ADR-0045 §3.3 整合)
//
// 5 variant 設計 (Phase 3 #2572 polling 設計):
//   - variant A: success (Webhook 即時反映、2 秒後自動 redirect)
//   - variant B: preparing (Webhook 待機中、polling 5 秒間隔、最大 60 秒)
//   - variant C: processing (コンビニ / 銀行振込等の確認時間、メール通知後手動 redirect)
//   - variant D: failed (Webhook 失敗、プランページ手動戻り)
//   - variant E: timeout (polling timeout、再読込促し)
//
// 関連 compound: CHECKOUT_SUCCESS_LABELS (Phase 7 PR-2b で追加、本 PR scope 外)
// 関連 ADR:
//   - ADR-0045 (terms.ts 2 階層): atom 単一文言、compound 組立 (plan 名動的差し込み) は labels.ts 側

// #2689 Round 1 (Adversarial UX 軸 + ADR-0045 §3.3 整合):
// 旧版では 5 variant (success / preparing / processing / failed / timeout) の本文 (`*Body*`) を atom 化
// していたが、これらは「保護者の決済完了ストレス局面でのコピーライティング A/B 最適化」を阻害する
// 構造的越境 (本文は複数 atom の組立 = compound) であった。Adversarial UX 軸の指摘通り、本文は
// labels.ts `CHECKOUT_SUCCESS_LABELS` (Phase 7 PR-2b で追加予定) に template literal 経由で移動する。
// `successBodyTemplate` (動的差し込み template) は特に compound 側に置くべき責務であり、atom と称しつつ
// concat を強制すると SSOT が二重管理化する (Adversarial UX 軸 §2)。
//
// 本 atom には 5 variant の**見出し** (短い単一名詞句) と**ボタンラベル** (動詞句) のみを残す。
// 本文 (`*Body*`) は compound 側で見出し + ボタン + 動的差し込み (plan 名等) と組み合わせる。
export const CHECKOUT_SUCCESS_TERMS = {
	// variant A: success (Webhook 即時反映、2 秒後自動 redirect)
	successHeading: 'ご利用ありがとうございます',
	goHomeButton: 'ホームへ移動',
	// variant B: preparing (Webhook 待機中、polling 5 秒間隔、最大 60 秒)
	preparingHeading: '準備中',
	// variant C: processing (コンビニ / 銀行振込等の確認時間)
	processingHeading: 'お支払いの確認をしています',
	goHomeBackButton: 'ホームへ戻る',
	// variant D: failed (Webhook 失敗)
	failedHeading: 'お支払いが完了していません',
	backToPlanButton: 'プランページに戻る',
	// variant E: timeout (polling timeout)
	timeoutHeading: '処理に時間がかかっています',
	reloadButton: '再読込',
} as const;

// ============================================================
// NUC_EDITION_TERMS — NUC セルフホスト版 atom (EPIC #2327 / #2329)
// ============================================================
//
// PO 報告 (2026-05-20): NUC ローカル版で /admin/license が冗長表示 (ライセンスキー /
// placeholder / 支払い履歴 等)、業界 prior art (Mattermost Team Edition / Bitwarden
// self-hosted / GitLab CE) の Edition badge + 簡略表示型に統合 (案 B 採用)。
//
// 設計指針:
//   - selfHosted    : 'セルフホスト版'  (Edition badge 主題、Mattermost "Team Edition" 整合)
//   - fullAccess    : '全機能利用可能'  (NUC の最大特典説明)
//   - unlimited     : '無制限'          (利用状況 dl の値、データ保持 / activity)
//   - editionEmoji  : '🏠'              (Edition badge の視覚 anchor、家庭内 self-host)
//
// LP / 法務文書には未使用 (NUC 認知は admin 画面のみで完結)。
// runtime-mode.ts (ADR-0040) と組み合わせて使う。

export const NUC_EDITION_TERMS = {
	selfHosted: 'セルフホスト版',
	fullAccess: '全機能利用可能',
	unlimited: '無制限',
	editionEmoji: '🏠',
} as const;

// ============================================================
// OYAKAGI_TERMS — おやカギコード関連 atom (#2353)
// ============================================================
//
// PR #2325 (EPIC #2310 Parent-Gate PIN gate) 導入時に OYAKAGI_LABELS が
// labels.ts compound に直接ハードコード (gatePinRequiredBanner /
// gateModalDescription / gatePinRequiredBanner etc.) されており、
// ADR-0045 §3.3 (terms.ts SSOT 2 階層化) 違反が #2353 設計欠陥 2 で検出された。
//
// 「おやカギコード」「おやカギ」atom を独立化し、labels.ts compound 側は
// `${OYAKAGI_TERMS.name}` template literal で参照する形に refactor することで、
// 「カギ → ロック」「コード → 暗証番号」等の用語変更が 1 行で全箇所に伝播する。
//
// 設計指針:
//   - name       : 'おやカギコード'  (主訴求、フォーム / dialog / error / banner で第一選択)
//   - shortName  : 'おやカギ'        (アクション動詞「を変更」と組合せる短縮形)
//
// 参照: docs/DESIGN.md §6 / Issue #2353 / ADR-0045

export const OYAKAGI_TERMS = {
	name: 'おやカギコード',
	shortName: 'おやカギ',
} as const;

// ============================================================
// PIN_DEFAULT_TERMS — 初期 PIN 表示用 atom (#2353 設計欠陥 5 関連)
// ============================================================
//
// #2353 設計欠陥 5: PIN modal に「初期値は 5086（がんばり）です」を表示すると
// 子供が見て即入力できる脆弱性。「setup フローでのみ伝達、gate modal では非表示」
// が PO 確定方針。
//
// ただし setup 完了画面 / setup wizard / onboarding dialog で「初期 PIN を覚えて
// おいてください」と伝達する文脈は残るため、用語自体は atom 化して 1 行更新できる
// 体制を維持する。値そのものは src/lib/domain/constants/oyakagi.ts の DEFAULT_PIN
// (= '5086') を SSOT とし、本 atom は表示用の文字列だけ。
//
// 設計指針:
//   - hintFull       : '初期値は 5086（がんばり）です'  (setup 完了 / onboarding dialog 用)
//   - hintCompact    : '初期 5086（がんばり）'           (短縮版、checklist 等向け)

export const PIN_DEFAULT_TERMS = {
	hintFull: '初期値は 5086（がんばり）です',
	hintCompact: '初期 5086（がんばり）',
} as const;

// ============================================================
// OVERFLOW_MENU_TERMS — admin route 共通 ⋮ menu atom (EPIC #2362 PR-2)
// ============================================================
//
// 5 admin route (activity / reward / challenge / checklist / rule bonus) 共通の
// top-right ⋮ overflow menu に並ぶ標準項目 atom。各 route で項目 ON/OFF 可能 (props 制御)。
//
// 設計指針 (User 合意済 2026-05-23 §6.1):
//   - menu trigger 自体は icon button (⋮)、aria-label を本 atom で供給
//   - 標準 7 項目 (marketplace / ai / divider / restore / export / divider / help)
//   - AI を menu 内に格下げ = エンジニア独善デザイン排除、顧客目線「単なる追加時のサジェスト機能」
//
// 既存 ACTION_LABELS との関係:
//   - ACTION_LABELS は CRUD 基本動詞 (save / delete / cancel)
//   - 本 atom は overflow menu 固有の項目ラベル (label + icon emoji)

export const OVERFLOW_MENU_TERMS = {
	openLabel: 'メニューを開く',
	itemMarketplace: 'みんなのテンプレから取込',
	itemMarketplaceIcon: '📦',
	itemAiSuggest: 'AI で提案してもらう',
	itemAiSuggestIcon: '🤖',
	itemRestore: 'バックアップから復元',
	itemRestoreIcon: '⬇',
	itemExport: 'エクスポート',
	itemExportIcon: '⬆',
	itemHelp: 'このページのヘルプ',
	itemHelpIcon: '❓',
} as const;

// ============================================================
// CHILD_SELECTION_TERMS — per-child 取込ダイアログ atom (EPIC #2362 PR-2)
// ============================================================
//
// per-child 採用 type (activity / reward / challenge) の marketplace 取込時に、
// 「誰に追加するか / 全員に追加するか」を選択させる Dialog の atom。
//
// 設計指針 (User 合意済 2026-05-23 §6.2):
//   - title: 「どのお子さまに追加?」 (CHILD_TERMS.honorific = 'お子さま' を採用)
//   - option 1: 「全員に追加」 (primary、最も使われる選択肢を default)
//   - option 2-N: 各 child の名前 + アイコン (radio / multi-select 切替可)
//   - footer: 「追加」/「キャンセル」
//
// 既存 CHILD_TERMS との関係:
//   - CHILD_TERMS.honorific = 'お子さま' を本 compound (CHILD_SELECTION_LABELS) で参照
//   - 本 atom は dialog 固有の動詞句のみ (短文 atom)

export const CHILD_SELECTION_TERMS = {
	dialogTitleSuffix: 'に追加?',
	dialogTitleQuestion: 'どの',
	allOptionLabel: '全員に追加',
	confirmLabel: '追加',
	cancelLabel: 'キャンセル',
	listAriaLabel: 'お子さま一覧',
	/** 年齢 suffix (UI 表示用、例: "5 歳" の "歳") */
	ageUnitSuffix: '歳',
} as const;

// ============================================================
// VISIBILITY_CHIP_TERMS — family master per-child visibility atom (EPIC #2362 PR-2)
// ============================================================
//
// family master 採用 type (checklist / rule bonus) の edit modal 内で、
// per-child visibility (どの子に配信するか) を chip toggle で表示する UI の atom。
//
// 設計指針 (User 合意済 2026-05-23 §6.3):
//   - chip click で toggle (ON = 表示 / OFF = 非表示)
//   - 「全員 ON」「全員 OFF」ショートカット button
//   - state 永続化は呼び出し側責務 (Pure presentation)
//
// 既存 CHILD_TERMS との関係:
//   - 個別 chip ラベルは child.nickname を直接表示 (atom 化対象外、データ駆動)
//   - 本 atom は section title / toggle ラベル / shortcut button のみ

export const VISIBILITY_CHIP_TERMS = {
	sectionTitle: '配信するお子さま',
	toggleOn: '表示',
	toggleOff: '非表示',
	allOnLabel: '全員 ON',
	allOffLabel: '全員 OFF',
	groupAriaLabel: '配信お子さま選択',
} as const;
