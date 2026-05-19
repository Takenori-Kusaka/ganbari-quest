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
//   GRADUATION_TERMS — 卒業 / 最終ゴール atom（TECH-F 中頻度、#1915）
//   ADVENTURE_TERMS  — 冒険 / メインクエスト atom（TECH-F 中頻度、#1915）
//   MECHANISM_TERMS  — 仕組み / 工夫 / 設計 atom（TECH-F 中頻度、#1915）
//   LIFESTAGE_TERMS  — 年齢 / 年齢区分 / 学年 atom（TECH-F 中頻度、#1915）
//   CHEER_TERMS      — 応援 / 応援する / できごと atom（EPIC #2266、#2276）
//   REWARD_TERMS     — ごほうび管理 / ごほうびショップ / プリセット atom（EPIC #2266、#2276）
//   TEMPLATE_TERMS   — みんなのテンプレート / テンプレート atom（EPIC #2266、#2276）
//
// 参照: docs/DESIGN.md §6 / Issue #1916 / Issue #1917 (template literal parser) / Issue #1958 / Issue #1896 / Issue #1898 / Issue #1913 / Issue #2058 / Issue #1914 / Issue #1915 / Issue #2266 / Issue #2276

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
