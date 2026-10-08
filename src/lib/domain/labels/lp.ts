// labels 層 (ADR-0045 / #4965): LP (site/*.html)。scripts/generate-lp-labels.mjs が site/shared-labels.js に書き出す。置き場所の規則は docs/DESIGN.md §6
import {
	ADMIN_SCREEN_TERMS,
	ADMIN_VIEW_TERMS,
	ADVENTURE_TERMS,
	AGE_RANGE_TERMS,
	AUTO_SLEEP_TERMS,
	AUTONOMY_TERMS,
	BACKUP_TERMS,
	CANCEL_TERMS,
	CHILD_TERMS,
	CROSS_BORDER_TERMS,
	CTA_TERMS,
	CURRENCY_TERMS,
	DELETION_EXPORT_TERMS,
	DELETION_GRACE_TERMS,
	FAMILY_MEMBER_LIMIT_TERMS,
	FREE_PLAN_TERMS,
	FREE_TERMS,
	GRADUATION_TERMS,
	LIFESTAGE_TERMS,
	LP_FAQ_TERMS,
	MECHANISM_TERMS,
	OSS_LICENSE_TERMS,
	PARENT_TERMS,
	PLAN_FULL_TERMS,
	PLAN_RETENTION_TERMS,
	PLAN_TERMS,
	POINT_TERMS,
	PRESET_ACTIVITY_TERMS,
	PRICE_TERMS,
	PWA_TERMS,
	REWARD_TERMS,
	SIGNUP_TERMS,
	STATUS_AXIS_TERMS,
	STRIPE_PORTAL_TERMS,
	SUPPORT_RESPONSE_TERMS,
	TRIAL_PERIOD_TERMS,
	TRIAL_TERMS,
	UPGRADE_TERMS,
	USAGE_SUMMARY_TERMS,
	VIEWER_LINK_TERMS,
} from '../terms';
import { FREE_PLAN_RETENTION_NOTICE, WRITES_CONTINUE_ASSURANCE } from './billing';
import { CUSTOM_REWARD_FEATURE_NAME } from './plan';

// 注: OPS_LICENSE_PAGE_LABELS (旧 /ops/license dashboard) は Epic #2525 Phase 7 PR-L4 (#2836)
//     license key 全廃に伴い撤去済 (route は PR-L3 #2818 で物理削除、割引配布は Stripe Coupon 代替)。

// ============================================================
// LP コンテンツ (#1344 C1-LP-RETENTION)
// ============================================================

// ============================================================
// LP 共通ナビ / フッター / 共通CTA (#1465 Phase C)
// SSOT: site/*.html の <header> / <footer> 共通部分
// ============================================================

// #1957 (Phase 3 D12): signup を FREE_TERMS.tryFree atom 参照化。
// #1896 (PO-4-10): faq を LP_FAQ_TERMS.canonicalLong 参照化（用語 SSOT 集約）。
//                     他 key (hamburgerAriaLabel / logoAlt / home / marketplace / pricing /
//                     selfhost / login / features) は LP ナビ専用文言で terms.ts atom 該当なし。
export const LP_NAV_LABELS = {
	hamburgerAriaLabel: 'メニュー',
	logoAlt: 'がんばりクエスト',
	home: 'ホーム',
	marketplace: 'テンプレートを探す',
	pricing: '料金プラン',
	faq: `${LP_FAQ_TERMS.canonicalLong}`,
	selfhost: '仕組みを公開（開発者向け）',
	signup: `${FREE_TERMS.tryFree}`,
	login: 'ログイン',
	// #1906 TECH-D-4: skip-to-content link (a11y) — site/*.html 全 10 ファイルで参照
	skipToContent: '本文へスキップ',
} as const;

// #1957 (Phase 3 D12): atom 化対象ゼロをコメント注記で記録（PLAN 系）。
// #1896 (PO-4-10): faqLink を LP_FAQ_TERMS.canonicalLong 参照化（用語 SSOT 集約）。
//                     他 key はブランド名 / リンクラベル / コピーライト等 LP フッター専用文言で
//                     PLAN/PRICE/TRIAL/CANCEL/FREE/CTA いずれの terms.ts atom にも該当しない。
export const LP_FOOTER_LABELS = {
	brandName: 'がんばりクエスト',
	brandTagline: 'お子さまの「がんばり」を冒険に変える家庭向けWebアプリ',
	linksHeading: 'リンク',
	pricingLink: '料金プラン',
	faqLink: `${LP_FAQ_TERMS.canonicalLong}`,
	// #1848: graduation.html 別ページ動線
	graduationLink: '成長ロードマップ',
	selfhostLink: '仕組みを公開（開発者向け）',
	githubLink: 'GitHub',
	contactLink: 'お問い合わせ',
	sponsorLink: 'Sponsor',
	legalHeading: '法的情報',
	termsLink: '利用規約',
	privacyLink: 'プライバシーポリシー',
	slaLink: 'SLA',
	tokushohoLink: '特定商取引法に基づく表記',
	copyright: '© 2026 がんばりクエスト（運営: 日下武紀／個人事業主）. All rights reserved.',
} as const;

// LP Hero 価格 anchor バンド (#1625 R21)
// site/index.html hero 直下に配置する 1 行価格プロミスバンド
// #1946 (Phase 3 D6): terms.ts 参照化。文字列差分ゼロを維持しつつ FREE_TERMS / PRICE_TERMS / CANCEL_TERMS 経由で atom SSOT に統一。
//   - itemPriceLabel ('月') / itemTrial ('有料は 7 日間無料') は terms.ts atom と表記揺れ
//     (PRICE_TERMS.monthlyPrefix が '月 ' 末尾空白あり / TRIAL_TERMS.duration が '7日間' 空白なし)
//     のため、文字列差分ゼロを優先しリテラル維持 (atom 化は別 Issue で表記統一後に再検討)
// #1903 (PERS-CRT-6): itemPriceLabel に FREE_TERMS.priceGate を前置し「必要なら 月」に変更。
//   freemium × 低価格帯（¥500/月）併記で田中ゆかり P1 が「結局いくら払うの?」と離脱級認知
//   ギャップを起こすため、「基本無料」と「月 ¥500〜」が等価選択肢に見える構造を
//   「無料先 + 必要なら上位プラン」の階層構造に並び替える。memory `feedback_lp_pricing_placement_principle`
//   「freemium × 低価格帯は 1 行価格プロミスバンド」原則は維持（セクション再設計はせず文言レベル）。
export const LP_HERO_PRICE_BAND_LABELS = {
	itemFree: FREE_TERMS.base,
	itemPriceLabel: `${FREE_TERMS.priceGate} 月`,
	itemPriceValue: `${PRICE_TERMS.standard}${PRICE_TERMS.fromSuffix}`,
	itemTrial: '有料は 7 日間無料',
	itemCancel: CANCEL_TERMS.anytime,
} as const;

// LP Hero 仕様起点の数字バッジ (#1628 R24 / #1788 honest 刷新)
// PMF 後送り testimonial の代替として仕様値を訴求
// #1788 (P-MAJ-3): presetSuffix を honest 表現「プリセット活動の候補」に刷新
//   （実態は「親がセットアップで選択する候補プール」であり、訴求から「自動で揃う」誤認を排除）
//   CI `measure-lp-dimensions.mjs` の正規表現 `<strong>(\d+)\+</strong>\s*プリセット活動` は
//   「プリセット活動」リテラルが残っていれば検出されるため、honest 表現でも CI 裏取りは継続して機能する
// #1953 (Phase 3 D8): atom 化対象ゼロ → #1913 (UIUX-E-1) で AGE_RANGE_TERMS を新設、ageRange を atom 参照化。
// #4713: プリセット数は PRESET_ACTIVITY_TERMS (terms.ts) の atom に移した。セットアップ時間（約 5 分）は
//   引き続き本 LP 専用の仕様値であり terms.ts に対応 atom 不在。
export const LP_HERO_SPEC_BADGES_LABELS = {
	// #1913: AGE_RANGE_TERMS.short = '3〜18 歳' を参照（波ダッシュ短縮形 atom）
	ageRange: `${AGE_RANGE_TERMS.short}`,
	ageRangeSuffix: '対応',
	presetCount: `${PRESET_ACTIVITY_TERMS.uniqueCountBadge}`,
	presetSuffix: 'プリセット活動 の候補',
	// #4510: 「約 5 分」は repo に計測根拠が無い数値主張だった (300+ プリセットは CI の実数
	// gate があるのと対照的)。人が要する時間は E2E でも測れない (CI 機の実行時間は人の所要
	// 時間ではない) ため、PO 決裁どおり非数値化する
	setupTime: 'かんたん',
	setupSuffix: '初期設定',
} as const;

// LP CTA / 期間表記 SSOT (#1616 R12)
// PM 優先 J 節裁定 2: 「無料で始める」（漢字統一）
// site/ 配下では本定数を data-lp-key で参照し、表記揺れを排除する
//
// #1957 (Phase 3 D12): LP_COMMON_LABELS を縮小 + terms.ts 参照化。
//   - 価格 atom (priceStandardMonthly / priceFamilyMonthly / priceMinFrom) を削除。
//     これらは PRICE_TERMS atom (¥500 / ¥780) と「月 」prefix の連結で表現可能だが、
//     site/*.html 内の data-lp-key=common.priceStandardMonthly 等の参照箇所はゼロであり、
//     LP_HERO_PRICE_BAND_LABELS / LP_PRICING_LABELS 等の他 namespace が独自に terms.ts atom を
//     直接参照しているため重複定義となっていた。本 PR で dead code として撤去し、
//     価格 atom の SSOT を terms.ts (PRICE_TERMS) のみに統一する。
//   - ctaSignup / noCreditCardNote / cancelAnytime を terms.ts atom 参照化。
//   - trialPeriodLabel / trialPeriodShort / trialPeriodFull は TRIAL_TERMS.duration ('7日間'
//     空白なし) と LP の表記 ('7 日間無料' 空白あり) で揺れがあるため、文字列差分ゼロ維持を
//     優先しリテラル維持 (atom 化は別 Issue で表記統一後に再検討)。
//   - bulletPoint / contactEmail / contactHint / ctaDemo / ctaPricing / ctaContact /
//     ctaPricingDetail は LP 連結フレーズ / 連絡先で terms.ts atom 該当なし。
export const LP_COMMON_LABELS = {
	// CTA 動詞（site/ 全ページで本値に統一）
	ctaSignup: `${FREE_TERMS.tryFree}`,
	ctaDemo: 'デモを見る',
	ctaPricing: '料金プラン',
	ctaContact: 'お問い合わせ',
	ctaPricingDetail: '料金の詳細を見る →',
	contactHint: 'メールでお気軽にお問い合わせください',
	contactEmail: 'ganbari.quest.support@gmail.com',
	// 期間表記（「7 日間無料トライアル」に統一）
	// #1913 (UIUX-E-2): trialPeriodShort を全角統一形「7 日間無料トライアル」に集約。
	//   AC4 = 「7 日間無料$」末尾 anchor が 0 件、「7 日間無料トライアル」統一形に整合。
	//   trialPeriodLabel と value 同一だが文脈上の責務が異なるため key は維持。
	// #1915 (TECH-F 中頻度 D-1): TRIAL_PERIOD_TERMS atom 経由参照に置換。
	//   旧 `${TRIAL_TERMS.durationSpaced}無料トライアル` (2 atom 結合) を
	//   `${TRIAL_PERIOD_TERMS.full}` (1 atom 参照) に統一し、SSOT 集約度を高める。
	trialPeriodLabel: `${TRIAL_PERIOD_TERMS.full}`,
	trialPeriodShort: `${TRIAL_PERIOD_TERMS.full}`,
	trialPeriodFull: `${TRIAL_TERMS.durationSpaced}の無料トライアル`,
	// 年齢レンジ表記（#1913 UIUX-E-1: AGE_RANGE_TERMS atom 経由で 2 系統 SSOT 化）
	//   ageRange     : 短縮形「3〜18 歳」（バッジ / 見出し用）
	//   ageRangeLong : 自然形「3 歳から 18 歳まで」（本文・段落用）
	ageRange: `${AGE_RANGE_TERMS.short}`,
	ageRangeLong: `${AGE_RANGE_TERMS.long}`,
	// 通貨記号（#1913 UIUX-E-5: CURRENCY_TERMS atom 経由で「¥」直書き統一、HTML エンティティ撤去）
	//   yenSymbol  : '¥' 単体（compound から PRICE_TERMS 以外で参照する場合の atom 経路）
	yenSymbol: `${CURRENCY_TERMS.yen}`,
	// ポイント単位（#1913 UIUX-E-3: POINT_TERMS atom 経由で「ポイント / pt / P」を文脈別に SSOT 化）
	//   pointUnitFull : 'ポイント'（説明文・LP 訴求文の標準形）
	//   pointUnit     : 'pt'（数値直後の単位短縮形）
	pointUnitFull: `${POINT_TERMS.unitFull}`,
	pointUnit: `${POINT_TERMS.unit}`,
	// クレカ不要訴求
	noCreditCardNote: `${TRIAL_TERMS.noCreditCard}`,
	// 解約訴求
	cancelAnytime: `${CANCEL_TERMS.anytimeOk}`,
	bulletPoint: '・',
	// #1915 (TECH-F 中頻度 8 ドメイン): atom 経由 canonical 表現の参照源を提供。
	//   既存 compound への適用は段階移行（AC scope 調整は PR 本文参照）。
	//   - upgradeCanonical: 'プラン変更' (UPGRADE_TERMS.canonical、admin UI 「アップグレード」表記は別 Issue で移行)
	//   - graduationCanonical: '卒業' (GRADUATION_TERMS.canonical、本サービスのアイデンティティ用語)
	//   - adventureCanonical: '冒険' (ADVENTURE_TERMS.canonical、商品名「がんばりクエスト」「メインクエスト」は brand identity / ゲームメカニクスのため維持)
	//   - mechanismCanonical: '仕組み' (MECHANISM_TERMS.canonical、LP 顧客語彙、「2 つの工夫」「煽らない設計」等の連語は PO 確定済の独立保持)
	//   - lifestageCanonical: '年齢' (LIFESTAGE_TERMS.canonical、概念用語、「年齢区分」「学年」は意味分離で独立保持)
	upgradeCanonical: `${UPGRADE_TERMS.canonical}`,
	graduationCanonical: `${GRADUATION_TERMS.canonical}`,
	adventureCanonical: `${ADVENTURE_TERMS.canonical}`,
	mechanismCanonical: `${MECHANISM_TERMS.canonical}`,
	lifestageCanonical: `${LIFESTAGE_TERMS.canonical}`,
} as const;

// LP 法務系打消し表示 (#1609 R5 / #1610 R6)
// 景表法 第 5 条 + 消費者庁 打消し表示ガイドライン準拠
// data-lp-key で site/index.html / site/faq.html に注入
// #1952 (Phase 4 E5): cancelDisclaimer の 3 PLAN 名 (無料 / スタンダード / ファミリー) を terms.ts (PLAN_TERMS) 参照に。
//                     faqLiabilityFree の「無料プラン」は PLAN_FULL_TERMS.free を参照。
//                     既存テキストとの char-by-char 一致を保ちつつ、プラン名 atom の SSOT を terms.ts に統一。
// #1898 (PO-4-12, 4 回目指摘): liabilityBody / liabilityLinks / cancelDisclaimerLinks の値内に
//                     文字列リテラル「FAQ」が直書きされていた構造を、LP_FAQ_TERMS atom 参照に置換。
//                     ADR-0045 §3.3 atom / compound 責務分離原則に整合。
//                     値内に「FAQ」リテラルが残らないため、用語変更時は LP_FAQ_TERMS の 1 箇所のみ更新で全箇所反映。
export const LP_LEGAL_DISCLAIMER_LABELS = {
	// #1643 R38 + #1733 R16 整合: 実装 grace-period-service.ts の {free: 0, standard: 7, family: 30} に合わせプラン別表記
	// LP メトリクス desktopHeight ratchet 維持のため可読性確保しつつ簡潔に
	// #1952: PLAN 名 atom (PLAN_TERMS) を terms.ts から参照。解約期間数値 (0/7/30) は grace-period-service.ts SSOT との対応で直書き維持
	// #1912 (F-9): SaaS / 法律用語「読み取り専用猶予期間」を顧客語彙へ。
	//   IT リテラシーなし親 P1 が直感的に理解できる「データを見られる期間」表現。
	//   特商法 (tokushoho.html) と利用規約 第14条「卒業」では法的精度のため「猶予期間」を維持。
	// #4496: 旧文言は退会 (アカウント削除) の猶予期間を解約の打消し表示に転用しており、
	//   「解約するとデータが完全に削除される」という事実と異なる予告になっていた
	//   (解約抑止のダークパターンとも解され得る)。解約の事実だけを述べ、削除は退会に紐づける。
	cancelDisclaimer: `※${CANCEL_TERMS.canonical}後も現在の請求期間の終了日までご利用いただけます（日割り返金はありません）。${CANCEL_TERMS.canonical}でデータは削除されず、${PLAN_TERMS.free}プランへ移行します。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。データを完全に消すのはアカウント${CANCEL_TERMS.account}のお手続きです。`,
	// #1898: 「FAQ」を LP_FAQ_TERMS.canonicalShort 参照に置換（4 回目指摘の構造的再発ブロック）
	cancelDisclaimerLinks: `${LP_FAQ_TERMS.canonicalShort} / 特定商取引法に基づく表記`,
	// #1838: cta-bottom セクション全削除に伴い cancelDisclaimerCta / cancelDisclaimerCtaLink を削除。
	//        他箇所（pricing.html / pamphlet.html 等）の disclaimer は cancelDisclaimer + cancelDisclaimerLinks を使用。
	liabilityTitle: 'サービス利用に関する重要なご案内',
	// #1721 R6: LP 本体は具体数字を除去し規約 / FAQ にリンク誘導。詳細記述は faqLiability* / 利用規約第 12 条で残存
	// #1898: 「FAQ」を LP_FAQ_TERMS.canonicalShort 参照に置換
	liabilityBody: `本サービスは個人開発のため、利用規約にて賠償上限を定めております。詳しくは利用規約・${LP_FAQ_TERMS.canonicalShort} をご確認ください。`,
	// #1898: 「FAQ」を LP_FAQ_TERMS.canonicalShort 参照に置換
	liabilityLinks: `利用規約 第 12 条 / ${LP_FAQ_TERMS.canonicalShort}「賠償について」`,
	faqLiabilityIntro:
		'本サービスは個人開発者が運営する小規模サービスであり、利用規約 第 12 条（免責事項）に基づき、賠償額には上限を設けております。',
	faqLiabilityPaid:
		'有料プランをご利用の方: 損害発生月を含む直近 3 ヶ月間に実際にお支払いいただいた利用料の総額を上限とします',
	// #1952: 「無料プラン」は PLAN_FULL_TERMS.free を参照（PLAN_TERMS.free + 'プラン' の組合わせと等価）
	faqLiabilityFree: `${PLAN_FULL_TERMS.free}をご利用の方: 賠償額の上限は 0 円とさせていただきます`,
	faqLiabilityNote:
		'※ 消費者契約法その他の強行法規が適用される場合は、その範囲で当該規定が優先されます。重要事項のため、ご契約前に 利用規約 第 12 条 全文をご確認のうえ、ご納得いただいた方のみご利用ください。',
	faqLiabilityQuestion: 'サービスの不具合等で損害が発生した場合、賠償の上限はありますか？',
} as const;

// ============================================================
// LP /site/pricing.html SSOT (#1650 R44 / Phase 5 pricing 仕上げ)
//
// data-lp-key で site/pricing.html に注入。labels.ts SSOT への同期と、
// 「（税込）」「クラウド保管枠」「7 日間無料体験」等の整合点を一箇所で管理する。
//
// 命名規則: pricing.<area>.<key>
//   - hero / planFree / planStandard / planFamily / comparison / trial / cta / faq
//
// 関連 Issue:
//   - #1641 R36 trial 体験データ保持表記の修正
//   - #1642 R37 trial 体験範囲表記の経路汎用化
//   - #1643 R38 解約後 grace period プラン別表記
//   - #1644 R39 「自動バックアップ」→「クラウド保管枠（手動エクスポート）」
//   - #1645 R40 「税込」明記
//   - #1646 R41 CTA 直下打消し表示
//   - #1647 R42 アプリ /pricing FAQ と整合
//   - #1650 R44 SSOT 同期 + 括弧書き濫用一掃
//   - #1651 R45 ペルソナ別 Job 訴求
//   - #1652 R46 Hero 価格 anchor + 7 日体験
//   - #1653 R47 「卒業」概念 FAQ
//   - #1660 R53 FEATURE_LABELS.aiActivitySuggest
//   - #1947 Phase 3 D7: price / plan atom 直書き撤廃。
//     PRICE_TERMS / PLAN_TERMS を terms.ts から参照し、char-by-char 一致を保つ。
// ============================================================

export const LP_PRICING_LABELS = {
	pageTitle: '料金プラン - がんばりクエスト',
	// #1947: スタンダード月額500円 / ファミリー月額780円 を PLAN_TERMS / PRICE_TERMS atom 参照化。
	//        「500円」「780円」は atom (¥500 / ¥780) から ¥ を除去して「円」連結する compound のため、
	//        実装上は PRICE_TERMS.standard.replace('¥', '') 等を避け、atom 値を直接担保する parse-time 設計を取らず
	//        ここでは PLAN_TERMS のみ参照（価格数値「500」「780」は atom 直接対応がないため直書き維持）。
	metaDescription: `がんばりクエストの料金プラン。基本無料で始められます。${PLAN_TERMS.standard}月額${PRICE_TERMS.standardYenFull}（税込）、${PLAN_TERMS.premium}月額${PRICE_TERMS.familyYenFull}（税込）。すべての有料プランに7日間の無料体験付き。`,
	ogTitle: '料金プラン - がんばりクエスト',
	// #1912 (F-6): og:description の「ログインボーナス」→「毎日のごほうび」へ日本語化
	ogDescription:
		'基本無料で始められます。お子さまのポイント・レベルアップ・毎日のごほうび（おみくじ + スタンプカード）などの冒険体験は無料プランでも一切制限ありません。',

	// Hero (#1652 R46)
	// #1947: heroPriceBand / heroLeadHighlight の price/plan atom を terms.ts 参照化
	heroTitle: '料金プラン',
	heroLead1: 'お子さまの成長を冒険に変える。',
	heroLeadHighlight: `${FREE_TERMS.base}`,
	heroLead2: 'で今日から始められます。',
	heroSubtext: '有料プランはすべて',
	heroSubtextStrong: '7日間の無料体験',
	heroSubtextSuffix: `付き（${TRIAL_TERMS.noCreditCard}）`,
	// #1904 (PERS-CRT-5): 文末「いつでも解約 OK」を CANCEL_TERMS.anytimeOk atom 参照に変更し、
	//                     atom 1 行更新で全コンテンツに伝播するよう SSOT 化（旧値直書き解消）。
	heroPriceBand: `${FREE_TERMS.base} ・ 月 ${PRICE_TERMS.standard}（税込）から ・ 有料は 7 日間無料体験 ・ ${CANCEL_TERMS.anytimeOk}`,
	// #1915 (TECH-F 中頻度 D-1): TRIAL_PERIOD_TERMS atom 経由
	heroCtaPrimary: `${TRIAL_PERIOD_TERMS.full}`,
	heroCtaSecondary: 'プランを比較する',

	// Plan card: Free (#1651 R45 + #1644 R39 + #1645 R40)
	// #1947: planFreePrice / planFreePriceSub の atom (¥0 / クレカ登録不要) を terms.ts 参照化
	// #1913 (UIUX-E-7): planFreeName を FREE_PLAN_TERMS.planSelfNoun 参照化、
	//                  planFreePriceSub の「ずっと無料」を FREE_PLAN_TERMS.forever (= '永久無料') に統一
	//                  （AC8 = 「ずっと無料」が 0 件、訴求バッジ語と説明 sub の整合）。
	//                  planFreeBadge の「永久無料」も同 atom 経由に集約。
	planFreeName: `${FREE_PLAN_TERMS.planSelfNoun}`,
	planFreePrice: `${PRICE_TERMS.free}`,
	planFreePriceSub: `${FREE_PLAN_TERMS.forever} ・ ${TRIAL_TERMS.noCreditCardShort}`,
	planFreePersona: 'まずはお子さま 1〜2 人で試したいご家族へ',
	planFreeDesc: 'デフォルト提供の活動プリセットを使って無料で始められます。',
	planFreeCta: '無料ではじめる',
	planFreeBadge: `${FREE_PLAN_TERMS.forever}`,

	// Plan card: Standard (#1645 R40 + #1651 R45)
	// #1947: planStandardName / planStandardPrice の atom (スタンダード / ¥500) を terms.ts 参照化
	planStandardBadge: 'おすすめ',
	planStandardName: `${PLAN_TERMS.standard}`,
	planStandardPrice: `${PRICE_TERMS.standard}`,
	planStandardUnit: '/月（税込）',
	// #3212: planStandardYearly / planFamilyYearly は年額廃止 (#2719) で撤去
	planStandardPersona: 'お子さま 3 人以上 / 我が家ルールをカスタマイズしたいご家族へ',
	planStandardDesc: 'カスタマイズ自由自在。お子さまにぴったりの環境を作れます。',
	planStandardCta: '7日間 無料体験',

	// Plan card: Family (#1645 R40 + #1651 R45)
	// #1947: planFamilyName / planFamilyPrice の atom (ファミリー / ¥780) を terms.ts 参照化
	planFamilyName: `${PLAN_TERMS.premium}`,
	planFamilyPrice: `${PRICE_TERMS.family}`,
	planFamilyUnit: '/月（税込）',
	planFamilyPersona: '祖父母・離れた家族と一緒に応援したいご家族へ',
	planFamilyDesc: '家族みんなで見守る。きょうだいの比較やレポートで成長を応援できます。',
	planFamilyCta: '7日間 無料体験',

	// Plan note (below cards) — #1650 R44 (括弧書き一掃) / #1629 R25 (「コンボ」→「連続達成ボーナス」へ)
	// #1912 (F-6): 「ログインボーナス」「連続達成ボーナス」→ 「毎日のごほうび」「続けるごほうび」へ
	//   日本語化（PRICING_PAGE_LABELS.featureNote と同方針）。
	allPlansNote:
		'💡 お子さまが楽しめる冒険の仕組み（レベル・おみくじ・スタンプカード・毎日のごほうび・続けるごほうびなど）は',
	allPlansNoteStrong: '全プラン共通',
	allPlansNoteSuffix: 'で制限なし',

	// Comparison table (#1650 R44 + #1657 R50)
	comparisonTitle: '機能比較表',
	comparisonSubtitle: '冒険の仕組みは全プラン共通で制限なく楽しめます',

	// Trial section (#1641 R36 + #1642 R37)
	// #1913 (UIUX-E-2): trialHeading / trialSubheading を「7 日間無料トライアル」表記に統一。
	//   AC3 = trialPeriodLabel 系を全箇所「7 日間無料トライアル」（半角空白あり）統一、
	//   AC4 = 「7 日間の無料体験」（半角空白あり）が 0 件。
	//   trialSubheading は「7 日間の無料体験では」リテラルが grep で引っ掛かるため
	//   「7 日間無料トライアル期間中は」リフレームで撤去（UI 表示変更を伴うため AC9 PO 確認対象）。
	trialHeading: `${TRIAL_TERMS.durationSpaced}無料トライアル`,
	// #1642 R37: 経路汎用化（standard / family どちらの trial も同文言で説明）
	// #4866 系 QM 監査 (LP truth) / PO 差し戻し 2026-09-09:
	// 旧文の「選択したプランの全機能」は**実装と食い違う**。トライアルの tier は
	// `trial-service.ts` の `TRIAL_TIER` で **premium (内部 'family') 固定** (#4501 PO 確定)で、
	// どのプランを選んでも全機能が開く。index / faq は既に「すべての有料機能」と
	// 書いており、pricing だけが古い表現のまま残っていた (ADR-0013 LP truth)。
	trialSubheading: `${TRIAL_TERMS.durationSpaced}無料トライアル期間中は、すべての有料機能を制限なくお試しいただけます`,
	trialStep1Title: 'いつでも好きなタイミングで開始',
	trialStep1Desc: `アカウント登録後、${ADMIN_VIEW_TERMS.canonical}からワンタップで無料体験を開始できます。クレジットカードの登録は不要です。`,
	trialStep2Title: '7日間、選択したプランの全機能が使い放題',
	// #1642 R37: 経路依存（?plan=standard / ?plan=family / admin/license 手動）すべてに対応
	trialStep2Desc: `${PLAN_TERMS.standard}/${PLAN_TERMS.premium}いずれもプランの全機能（カスタム活動・レポート・データエクスポート・AI 自動提案・きょうだいランキング・離れた家族応援メッセージなど）を制限なくお試しいただけます。`,
	trialStep3Title: '終了後は自動で無料プランに戻ります',
	// #1912 (F-10): 「自動課金は一切ありません」→「勝手にお金がかかることはありません」へ日本語化
	trialStep3Desc:
		'無料体験期間が終わると、自動的に無料プランへ移行します。勝手にお金がかかることは一切ありません。',
	trialStepHighlight: '無料体験中にいつでもプラン選択可能',
	trialStepHighlightDesc:
		'気に入ったら無料体験中にそのままプランを選択できます。もちろん、何もしなければ自動で無料プランに戻ります。',
	// #1641 R36: 実装 retention-cleanup-service.ts に整合した「並列構造」
	trialDataReassureLine1Strong:
		'無料体験中に作成したオリジナル活動・ごほうび・もちものチェックリスト・シール・レベル・お子さま登録',
	trialDataReassureLine1Suffix: `は、${PLAN_FULL_TERMS.free}に移行した後も削除されません。上限を超える分は一時的に非表示（アーカイブ）になり、有料プランにアップグレードすると自動で元に戻ります。`,
	// #1912 (F-6): 「ログインボーナス履歴」→「毎日のごほうび履歴」へ日本語化
	trialDataReassureLine2Strong: '活動履歴・ポイント獲得履歴・毎日のごほうび履歴',
	trialDataReassureLine2Suffix: `は無料プランの保持期間（${PLAN_RETENTION_TERMS.freeSpaced}）を超えたものから順次削除されます。`,
	trialDataReassureLine3: `有料プランにアップグレードすれば、より長期間（${PLAN_TERMS.standard}: ${PLAN_RETENTION_TERMS.standardSpaced} / ${PLAN_TERMS.premium}: 無制限）の履歴をご利用いただけます。`,

	// Family pattern section
	familyPatternsTitle: '家族での使い方',
	familyPatternsSubtitle: 'ご家庭の環境に合わせて、2つのスタイルからお選びいただけます',
	familyPatternSharedTag: '全プラン対応',
	familyPatternSharedTitle: '親アカウント共用型',
	familyPatternSharedDesc:
		'親が1つのアカウントを作成し、同じ端末でお子さまと画面を切り替えて使います。設定も操作もシンプルで、すぐに始められます。無料プランを含む全プランで利用できます。',
	// #4512: PLAN_GATE_LABELS.standardOrAboveBadge と同値。LP 生成 (generate-lp-labels) は
	// namespace 跨ぎの参照を解決できないため、ここは atom を直接 template literal で参照する。
	familyPatternInviteTag: `${PLAN_TERMS.standard}以上`,
	familyPatternInviteTitle: '個別アカウント＋招待リンク型',
	familyPatternInviteDesc: `家族グループを作成し、招待リンクで家族を招待。家族メンバーがそれぞれの端末からアクセスでき、離れた場所からもお子さまの成長を見守れます。${PLAN_TERMS.standard}はご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}まで（オーナーを含むため招待は${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで）、${PLAN_TERMS.premium}は無制限で招待できます。`,

	// FAQ (#1647 R42 — labels.ts PRICING_PAGE_LABELS と整合 / #1643 R38 / #1653 R47)
	// #1896 PO-4-10: 旧 'faqTitle: よくある質問' は LP_FAQ_TERMS.faqHtmlTitle 経由に統一
	//   ('よくあるご質問' に長形式化)。key 名は compound 役割を明示する 'faqHeading' に rename
	//   し atom と key 名の混同を防ぐ（site/pricing.html data-lp-key 参照を同期更新）。
	faqHeading: `${LP_FAQ_TERMS.faqHtmlTitle}`,
	faqFreeQ: '無料プランでも十分使えますか？',
	// #1912 (F-6): LP FAQ の「ログインボーナス」→「ごほうび」へ日本語化
	// #4915: プリセットのごほうびも無料プランで追加できる (実装の事実、ADR-0013)。
	// 「商品登録」を「オリジナルごほうびの登録」に絞り、無料でできること/できないことを両方示す。
	// #4992: 有料の範囲は「作成」だけでなく「編集」(取り込んだごほうびの名前・ポイントの変更) も含む。
	//   行名だけでは「オリジナルのごほうびを編集すること」と読めるため、取り込んだものも対象だと本文で言う。
	faqFreeA: `はい。プリセットの活動・チェックリスト・${REWARD_TERMS.canonical}で基本的な機能はすべてお使いいただけます。お子さまの冒険体験（レベル、ポイント、おみくじ、スタンプカード、毎日のごほうび）は${PLAN_FULL_TERMS.free}でも一切制限ありません。ただし${CUSTOM_REWARD_FEATURE_NAME}は${PLAN_FULL_TERMS.standard}以上の機能です。プリセットにない${REWARD_TERMS.canonical}をご自身で作ることと、取り込んだ${REWARD_TERMS.canonical}の名前やポイントを変えることがこれにあたります。`,
	faqAfterTrialQ: '無料体験後はどうなりますか？',
	// #1641 R36 整合: 並列構造で「保持」と「90 日で削除」を両方明記
	// #1912 (F-6): LP FAQ の「ログインボーナス履歴」→「毎日のごほうび履歴」へ日本語化
	// #2057 (UIUX-F-13): 「管理画面」→ ${ADMIN_VIEW_TERMS.canonical} 経由化
	faqAfterTrialA: `7日間の無料体験終了後は無料プランに移行します。有料プランをご希望の場合は、${ADMIN_VIEW_TERMS.canonical}からアップグレードしてください。クレジットカードの事前登録は不要です。無料体験中に作成したオリジナル活動・ごほうび・チェックリスト・シール・レベルは保持されますが、活動履歴・ポイント獲得履歴・毎日のごほうび履歴は無料プランの保持期間（${PLAN_RETENTION_TERMS.freeSpaced}）を超えたものから順次削除されます。`,
	// #4496: 旧文言は退会の猶予期間を解約に転用していた (同ページ faqCancelVsDeleteA と自己矛盾)。
	//   アプリ内 PRICING_PAGE_LABELS.faqCancelA と同じ事実を述べる。
	faqCancelQ: '解約したらデータはすぐに削除されますか？',
	faqCancelA: `いいえ。${CANCEL_TERMS.canonical}してもデータは削除されません。現在の請求期間の終了日までは有料プランをそのままご利用いただけ、その後は${PLAN_FULL_TERMS.free}へ自動的に切り替わります（お子さまの記録は残ります）。${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。必要な記録は、有料プランのご利用期間中に書き出してください。記録の書き出し（エクスポート）は${PLAN_FULL_TERMS.standard}以上の機能です。${PLAN_FULL_TERMS.free}では、${CANCEL_TERMS.account}のお手続きの画面から${DELETION_EXPORT_TERMS.freeScopeSummary}のみ保存できます。データそのものを消すのはアカウント${CANCEL_TERMS.account}のお手続きです。`,
	// #4496: pricing.html hero 直下の打消し表示。旧 HTML 直書き文言は「解約申請後 30 日間は
	//   読み取り専用…その後すべてのデータが完全に削除」と、猶予日数も削除の有無も誤っていた。
	//   HTML 直書きのままだと SSOT を経由せず再発するため、本 namespace に key を起こす
	//   (site/pricing.html の fallback は scripts/sync-lp-fallback.mjs が同期する)。
	heroCancelDisclaimer: `※「${CANCEL_TERMS.anytimeOk}」について: ${CANCEL_TERMS.canonical}後も現在の請求期間の終了日まではご利用いただけます（日割り返金はありません）。${CANCEL_TERMS.canonical}でデータは削除されず、${PLAN_FULL_TERMS.free}へ移行します。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。データを完全に消すのはアカウント${CANCEL_TERMS.account}のお手続きです。`,
	faqBillingDateQ: 'お支払い日はいつですか？',
	// #3212: 年額廃止 (#2719) に伴い月額のみの記述に整合。faqYearlyCancel* は撤去。
	faqBillingDateA:
		'お申し込み日を起算日として毎月自動更新されます。例えば4月15日にお申し込みの場合、次回のお支払い日は5月15日です。',
	faqPaymentQ: '支払い方法は？',
	faqPaymentA:
		'クレジットカード（Stripe が対応する主要ブランド）に対応しています。Stripeによる安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。',
	faqPlanChangeQ: 'プランの変更はできますか？',
	faqPlanChangeA: `はい。${PLAN_TERMS.standard}↔${PLAN_TERMS.premium}の切り替えが可能です。${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」からお手続きいただけます。プラン変更方法についてご不明な点は、お問い合わせください。`,
	faqAdsQ: '子供の画面に広告は出ますか？',
	faqAdsA:
		'いいえ。無料プランでも広告は一切表示しません。お子さまが安心して使える環境を最優先にしています。',
	faqMultiDeviceQ: '家族で複数端末から使えますか？',
	faqMultiDeviceA: `はい。${PLAN_TERMS.standard}以上のプランで、家族メンバーを招待して複数端末からアクセスできます。${PLAN_FULL_TERMS.standard}はご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}まで（オーナーを含むため招待は${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで）、${PLAN_FULL_TERMS.premium}は無制限に招待可能です。${PLAN_FULL_TERMS.free}でも1つの端末でお子さまを切り替えて使えます。`,
	// #1653 R47: 「卒業」概念訴求（FAQ 文脈・機能訴求は禁止）
	// #1915 (TECH-F 中頻度 D-4): GRADUATION_TERMS atom 経由参照（「卒業」「最終ゴール」を SSOT 化）
	//   ※APP_LABELS は LP labels generator の cross-namespace 参照対象外のため product 名「がんばりクエスト」は直書き維持。
	faqGraduationQ: 'ずっと使い続ける必要がありますか？',
	faqGraduationA: `いいえ、お子さまが自立して習慣化できたら「${GRADUATION_TERMS.canonical}」していただいて構いません。がんばりクエストは「子供の自立」を${GRADUATION_TERMS.finalGoal}として設計されており、ずっと依存して使い続けることを想定していません。${GRADUATION_TERMS.canonical}の目安は小学校高学年〜中学生頃です。`,

	// CTA bottom
	ctaBottomTitle: 'お子さまの冒険を始めよう',
	ctaBottomDesc: 'まずは無料ではじめて、お子さまの反応を見てみませんか？',
	ctaBottomPrimary: '無料ではじめる',
	ctaBottomSecondary: 'デモで体験する',

	// #2102 F-1: Tower 型二段 CTA — 「7 日間無料体験」(既存) + 「今すぐ購入」(新規) を並列配置
	// #2836 (Epic #2525 Phase 7 PR-L4): license key 全廃に伴い「購入後ライセンスキーをメールで…」を
	// サブスクリプション整合の文言に置換 (決済後 tenant.status=ACTIVE で即時利用可、key 配布なし)。
	// #3212: 月額/年額トグル (billingToggle*) は年額廃止 (#2719) で撤去。billing=monthly 固定。
	// #4501 PO 決裁 3: トライアルが 1 回限り (FR-8、tenant 単位) であることは LP のどこにも
	// 書かれていなかった。プラン選択の前に知らせる。
	trialCtaNote: `※ ${TRIAL_TERMS.noCreditCard}（${TRIAL_TERMS.durationSpaced}の無料体験経路）。無料体験はご家族につき 1 回かぎりです`,

	// #2103 F-2: 解約 CTA + FAQ 経路明示（γ ハイブリッド: アプリ内 1-click → Stripe Customer Portal）
	// FAQ 既存 faqCancelA は維持し、解約「経路」を補足する追記文 + 新規 FAQ「解約 vs アカウント削除」を追加。
	// CTA-bottom 直下に既存有料ユーザー向け small リンクで /admin/billing へ誘導。
	faqCancelPathNote: `解約経路: ログイン後 [プラン・お支払い] → [請求管理ページを開く] (${STRIPE_PORTAL_TERMS.canonical}) でいつでもお手続きいただけます。`,
	faqCancelVsDeleteQ: `${CANCEL_TERMS.canonical}とアカウント${CANCEL_TERMS.account}は何が違いますか？`,
	// #4496: 「猶予期間後に無料プランへ移行」は誤り (解約に猶予期間は無く、現在の請求期間の
	//   終了日で移行する)。退会側の猶予はプラン別で、無料プランは猶予なし。
	faqCancelVsDeleteA: `${CANCEL_TERMS.canonical}は有料プランの自動更新を停止する手続きで、現在の請求期間の終了日に${PLAN_FULL_TERMS.free}へ自動移行します。データは削除されず、${PLAN_FULL_TERMS.free}の保持期間（${PLAN_RETENTION_TERMS.freeSpaced}）を超えた記録だけが削除され、復元できません（再契約でも戻りません）。アカウント${CANCEL_TERMS.account}は、ログイン後にご自身で実施いただくことで、プラン別の猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）の経過後に全データを完全削除します。`,
	existingCustomerCancelLinkPrefix: 'すでに有料プランをご利用中の方の',
	existingCustomerCancelLinkLabel: `${CANCEL_TERMS.canonical}はこちら`,
	existingCustomerCancelLinkSuffix: `（${ADMIN_VIEW_TERMS.canonical}に移動します）`,

	// ============================================================
	// Phase 7 PR-2b (#2697): Phase 4 #2621 LP_PRICING_LABELS 拡張 (新規 namespace 起こさず key 追加)
	// ============================================================
	// 設計意図:
	//   - Phase 4 #2621 §3.1 LP「CTA 動詞句」統合: 既存 `${CTA_TERMS.freeTrialVerb}` を atom 経由参照、
	//     LP pricing.html `data-lp-key="pricingB.ctaTrialVerb"` で文字列値配信 (#1917 機構整合)
	//   - Phase 4 #2621 §4.1 新規 FAQ「購入手順 3 ステップ」: Phase 2 #2548 谷④購入動線探索の解消
	//   - Phase 4 #2621 §4.2 新規 FAQ「解約手順 3 ステップ」: Phase 2 #2548 谷③解約柔軟性 + Kinde frictionless
	//   - 補強 PR #2684 (代替案 D = ダウン即時 + Stripe credit memo) 反映: 解約後の credit memo / 次回控除
	//     見込みは Stripe Portal で確認可能、本 LP 文言では「解約完了 → 次回更新日まで有料機能継続」を維持
	// 関連 ADR: ADR-0045 (terms.ts 2 階層、atom 経由 template literal 参照) / ADR-0013 (LP truth)

	// CTA 動詞句 (Phase 4 #2621 §3.1、site/pricing.html L297 / L322 を data-lp-key="pricingB.ctaTrialVerb" で参照)
	ctaTrialVerb: `${TRIAL_TERMS.duration}${CTA_TERMS.freeTrialVerb}`,

	// FAQ 購入手順 3 ステップ (Phase 4 #2621 §4.1、Phase 2 #2548 谷④購入動線探索 解消)

	// FAQ 解約手順 3 ステップ (Phase 4 #2621 §4.2、Phase 2 #2548 谷③解約柔軟性 解消、Kinde frictionless 整合)
	faqCancelStepsQ: `有料プランを${CANCEL_TERMS.canonicalVerb}にはどうすればよいですか？`,
	faqCancelStepsAIntro: `以下の 3 ステップで、いつでもご自身で${CANCEL_TERMS.canonicalVerb}ことができます（契約期間の縛りはありません）。`,
	faqCancelStepsStep1: `1. アプリにログイン後、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」セクションを開きます。`,
	faqCancelStepsStep2: `2. 「${STRIPE_PORTAL_TERMS.short}を開く」ボタンを押し、${STRIPE_PORTAL_TERMS.canonical}に移動します。`,
	faqCancelStepsStep3: `3. ${STRIPE_PORTAL_TERMS.short}の画面で「サブスクリプションを${CANCEL_TERMS.canonicalVerb}」を選択すると、${CANCEL_TERMS.canonical}が完了します。次回更新日まで有料機能はご利用いただけます。`,
	faqCancelStepsClosing: `${CANCEL_TERMS.anytimeOk}。${CANCEL_TERMS.canonical}の理由をお聞かせいただくと、サービス改善の参考にさせていただきます。`,
} as const;

// #1621 R17: [06b] retention セクションは [03] L2 (習慣カード) へ統合され、独立セクションは廃止。
//   pamphlet.html / 旧 retention セクション参照のため定数自体は保持（短文のみ）。
// #1629 R25: ADR-0012 Anti-engagement 原則と整合する語彙へ刷新（「変動比率強化」「射幸心」を撤去）。
// #1890 PO-4-4: 「煽らない設計」「1 日 1 回まで」など些末情報・繰り返し主張を撤去し、
//   レア度分散と毎日 1 回のおみくじという「楽しみ」訴求にリフレーム。ADR-0012 anti-engagement は
//   構造（毎日 1 回 cap・onboarding cap 撤廃）で担保しているため文言での繰り返し主張は不要。
export const LP_RETENTION_LABELS = {
	sectionTitle: '三日坊主にならない設計',
	sectionDesc:
		'「有料アプリって三日坊主になりがち…」という不安に先回りで答えます。レア度分散と毎日 1 回のおみくじスタンプが、子供の「明日もやろう」を支えます。',
	card1Title: '飽きを防ぐレア度分散',
	card1Desc:
		'普通のスタンプ (N) から超レアスタンプ (UR) まで 4 段階。毎回違うスタンプが押されることで、子供の「明日もやろう」を支えます。',
	card2Title: '習慣を育てるおみくじスタンプ',
	card2Desc:
		'毎朝のログイン → おみくじ → スタンプカードは、活動の記録とは別の「毎日記録する習慣」を育てるための仕組みです。「ちょっとした楽しみ」で継続を支えます。',
	card3Title: '毎日 1 回のお楽しみ',
	card3Desc:
		'毎日 1 回引けるおみくじスタンプは「もっと引きたい」と煽る連続演出を持ちません。明日もう 1 回というリズムが、自然な継続を生みます。',
	pamphletNote:
		'スタンプカードのレア度分散（N/R/SR/UR）と毎日 1 回のおみくじスタンプが「明日もやろう」を支える習慣形成のエンジン。連続演出を持たない静かな仕組みで、三日坊主を防ぎます。',
} as const;

// ============================================================
// LP [02] アナログ vs デジタル 比較セクション (#1614 R10)
// SSOT: site/index.html [02] セクション用ラベル
// 親 P1 が「シール帳・ホワイトボードでも続けばよいのでは」と離脱する直前の優位訴求
// ============================================================
// #1954 (Phase 3 D9): terms.ts atom 参照化対象ゼロの恒久記録。
//   本 namespace は「シール帳・ホワイトボード（紙）」と「がんばりクエスト（デジタル）」を
//   並べる比較表のため、PLAN 名 (PLAN_TERMS / PLAN_FULL_TERMS) / 価格 (PRICE_TERMS) /
//   トライアル期間 (TRIAL_TERMS) / 解約 (CANCEL_TERMS) / 無料訴求 (FREE_TERMS) /
//   CTA 動詞句 (CTA_TERMS) のいずれの atom にも触れない構造で意図的に組まれている。
//   訴求軸は「自動集計 / 年齢継続 / 卒業 / 端末非依存」の 4 観点であり、料金・期間・解約条件
//   といった具体的な terms に依存しない普遍的な優位性を提示する設計。
//   このため char-by-char 突合の結果、参照化対象は **0 件**。
//   将来 PLAN 名・価格・期間表現等が現れた場合は terms.ts 経由で参照化すること（#1916 SSOT 階層）。
//   検証: 本 namespace 範囲内に '無料' / 'スタンダード' / 'ファミリー' / '7日間' / '7 日間' /
//         '¥500' / '¥780' / '¥0' / '無料プラン' / 'スタンダードプラン' / 'ファミリープラン' /
//         'いつでも解約' / 'クレジットカード登録不要' / '基本無料' / 'まずは無料' /
//         '無料で始める' / '無料体験' / '無料で試す' / '無料で試せます' リテラル 0 件。

export const LP_VERSUS_LABELS = {
	// #1844 (PO-N-2): タイトルの投げかけ撤去 + 4 行 Desc を「体言止め」へ完全統一
	// （旧: 'シール帳・ホワイトボードでも、いいんじゃない？' 投げかけ + Desc が「ですます」混在）
	// #1888 (PO-4-2): 「届かない」「届く差」が田中ゆかり（35 歳・主婦語彙圏）に
	//   「荷物が届く」「メッセージが届く」連想でビジネス用語的にチープと判定。
	//   候補 A（「できない」+「叶える」）に置換して顧客語彙へ整合化。
	sectionTitle: 'シール帳・ホワイトボードではできない 4 つのこと',
	sectionDesc:
		'多くのご家庭がまず紙で試して、続かずに諦めています。「3 歳から 18 歳まで」「家族みんなで」「ずっと続ける」を叶えるのが、がんばりクエストです。',
	tagAnalog: 'シール帳・紙',
	tagDigital: 'がんばりクエスト',
	// #1723 R10: row*Icon (📊 🌱 🎓 📍) は装飾過多のため削除。比較表の構造（タグ + タイトル + 説明）で十分意味が伝わる
	row1AnalogTitle: 'お手伝いの種類が増えたり貼る場所がなくなっちゃう',
	row1DigitalTitle: '自由に子供の活動をカスタマイズ',
	// #1844: ですます → 体言止め
	row1DigitalDesc: `${CHILD_TERMS.honorific}のフェーズに合わせた活動を予めご用意`,
	row2AnalogTitle: 'どれだけ頑張ってきたか振り返るのが大変！',
	row2DigitalTitle: '日々の活動実績をポイントでわかりやすく',
	// #1844: ですます → 体言止め
	row2DigitalDesc: '3 歳から 18 歳まで同じアプリで継続',
	row4AnalogTitle: '家を離れると続けられない',
	row4DigitalTitle: '旅行先・祖父母宅でも続けられる',
	// #1844: ですます → 体言止め
	row4DigitalDesc: 'スマホ・タブレットで連続記録が途切れない',
	// #1784: 各 row の scrshot alt テキスト（PO 指摘: vc-digital カードに scrshot ゼロ → 4 scrshot 配置）
	// #4510: 実画像は /elementary/home (小学生のホーム画面)。alt が別画面を指していた
	//   (撮影 SSOT: scripts/capture-hp-screenshots.mjs の feature-point-level)
	row1ShotAlt: '小学生のホーム画面 — ポイントとレベルの表示',
	// #4510: 実画像は /preschool/home (幼児のホーム画面)。alt が別画面を指しており、
	//   さらに「子ども」表記が混在していた (CHILD_TERMS 経由でも neutral は「子供」)
	row2ShotAlt: '幼児のホーム画面 — ひらがなで大きなタップ領域',
	row3ShotAlt: '卒業マイルストーンと履歴エクスポート画面',
	// #2199: feature-cheer-message 撮影元を /admin/messages (親→子おうえんメッセージ送信フォーム + 履歴)
	//   に振り替え。alt も実画面と LP 訴求「旅行先・祖父母宅でも続けられる」(離れていても家族で
	//   応援が届く) 双方に一致するように rename。
	row4ShotAlt: '家族からおうえんメッセージを送るご家族の見守り画面 — 離れていても家族で繋がれる',
} as const;

// ============================================================
// LP [05b] 年齢別成長ロードマップ — 卒業を最終地点に (#1613 R9)
// StoryBrand 7 要素「Success」と整合
// SSOT: site/index.html [05b] セクション用ラベル
// ============================================================

// #1712 R5: 5 stage の H3 を「親主語ベネフィット」にリフレーム + 親視点 / 子供視点 1 行併記。
//   開発者目線の「○○の特徴」型 → 保護者が観測できる行動変化（「○○が要らなくなる」「○○を聞かなくても」）
//   へ書き換え、購入後の体験イメージを具体化する。
// #1954 (Phase 3 D9): terms.ts atom 参照化スコープ。
//   本 namespace は 5 ステージ（幼児 / 小学生 / 中学生 / 高校生 / 卒業）の長期成長物語を
//   提示する設計。年齢区分文字列（'幼児' / '小学生' / '中学生' / '高校生'）は AGE_TIER_TERMS
//   atom が terms.ts に未定義のため Phase 3 では参照化対象外（将来 atom 化時に再走査）。
//   PLAN 名 / 価格 / 解約 / 無料訴求等は本セクションが「成長過程の語り」を主眼とするため
//   原則登場せず、ctaBottomDesc 1 件のみが「無料体験」atom (CTA_TERMS.freeTrialNoun) と
//   char-by-char 一致するため参照化する。
//   トライアル期間表現 '7 日間' は半角スペース有り、TRIAL_TERMS.duration ('7日間' スペース無し)
//   と char-by-char 一致しないため、#1944 Phase 3 D4 で TRIAL_TERMS.durationSpaced atom を独立追加し
//   ctaBottomDesc を参照化（'7 日間'＋'無料体験' の 2 atom 構成）。
//   検証: 本 namespace 範囲内に PLAN_TERMS / PLAN_FULL_TERMS / PRICE_TERMS / CANCEL_TERMS /
//         FREE_TERMS / CTA_TERMS.freeTrialVerb / freeTrialDesc の atom と char-by-char 一致する
//         直書きは ctaBottomDesc の '無料体験' (CTA_TERMS.freeTrialNoun) と
//         '7 日間' (TRIAL_TERMS.durationSpaced) — 両方とも参照化済み。
export const LP_GROWTH_ROADMAP_LABELS = {
	sectionTitle: '3 歳から 18 歳まで、そして「卒業」へ',
	// #2058 (UIUX-F-16): 「自律」リフレーム。
	// 旧「…『アプリを使わなくても自分で計画できる』自律へ。」は同一文内で「自分で計画できる」と
	// 「自律」が重複し冗長。AUTONOMY_TERMS.selfPlanningAble atom を引用句として残し、
	// 文末「自律へ」を「子育てステージへ」に変更（卒業を最終地点とする growth-roadmap の
	// 物語整合を保ちつつ、IT リテラシー語彙を撤去）。
	sectionDesc: `お子さまの成長に合わせて画面の見た目と情報量が変化。最後は「アプリを使わなくても${AUTONOMY_TERMS.selfPlanningAble}」子育てステージへ。`,
	// #1848: LP 本体は CTA 1 行に短縮。5 ステージ詳細は graduation.html で展開。
	// #1895 (PO-4-9): 「5 ステージの詳細を見る →」は section-desc に「5」の予告がなく
	//   認知ジャンプを誘発（田中ゆかりペルソナ「5 ステージ?なんのステージ?」）。
	//   H2「3 歳から 18 歳まで、そして「卒業」へ」と直接接続する文言にリフレーム。
	linkLabel: '3 歳から 18 歳までの成長ストーリーを見る →',
	pageTitle: '成長ロードマップ - がんばりクエスト',
	pageHeroTitle: '3 歳から 18 歳まで、そして「卒業」へ',
	// #2058 (UIUX-F-16): sectionDesc と同じリフレーム（同文 SSOT）。
	pageHeroLead: `お子さまの成長に合わせて画面の見た目と情報量が変化。最後は「アプリを使わなくても${AUTONOMY_TERMS.selfPlanningAble}」子育てステージへ。`,
	pageMetaDescription:
		'がんばりクエストの成長ロードマップ。幼児（3-5歳）から高校生（16-18歳）、そして「卒業」まで、お子さまの成長に合わせて画面の見た目と情報量が変化していく様子を実画面付きで紹介。',
	breadcrumbHome: 'ホーム',
	breadcrumbCurrent: '成長ロードマップ',
	ctaBottomTitle: '家族で全部使ってから、続けるか決める',
	// #1954 (Phase 3 D9): '無料体験' atom を CTA_TERMS.freeTrialNoun 参照化。
	// #1944 Phase 3 D4: '7 日間' (半角空白入り) を TRIAL_TERMS.durationSpaced atom として独立 + 参照化。
	ctaBottomDesc: `${TRIAL_TERMS.durationSpaced}の${CTA_TERMS.freeTrialNoun}で、お子さまに合うかを家族でゆっくり試せます。`,
	// #1793: 「親が観測できること」(計測・実験用語 / 監視連想で permission marketing 毀損) を
	//   文脈別語彙に刷新。growth-roadmap 5 stages は親子の長期成長物語のため
	//   「家族で実感できること」(家族主体・実感ベース) に統一する。
	parentBenefitLabel: '家族で実感できること',
	childExperienceLabel: '子供が体験すること',
	preschoolAge: '幼児',
	preschoolRange: '3-5',
	preschoolUnit: '歳',
	preschoolTitle: '「はをみがいてー」「おかたづけしてー」が要らなくなる',
	preschoolDesc: '大きなボタンとひらがな UI で「自分で押した！」の達成感を毎日体験。',
	// #1911 (B-6): graduation.html gr-benefit 各文字数 15 字以内に圧縮（旧長文は冗長な「子供が」「ようになる」を含み速読性低下）
	preschoolParentBenefit: '親の声かけが要らなくなる',
	preschoolChildExperience: '押すだけで褒められる達成感',
	elementaryAge: '小学生',
	elementaryRange: '6-12',
	elementaryUnit: '歳',
	elementaryTitle: '「宿題やった？」を聞かなくても、子供から見せてくれる',
	elementaryDesc:
		'漢字 UI に切替、ウィークリーチャレンジで「次は何をやろう？」と自分で目標を立てる力が育ちます。',
	// #1911 (B-6): 15 字以内に圧縮
	elementaryParentBenefit: '子供から達成報告が来る',
	elementaryChildExperience: 'ポイントが積み重なる楽しさ',
	juniorAge: '中学生',
	juniorRange: '13-15',
	juniorUnit: '歳',
	juniorTitle: '部活と塾の両立を、子供が自分で計画する',
	// #2058 (UIUX-F-16): 「自律的な」→「自分で計画する」リフレーム。
	// AUTONOMY_TERMS.selfPlanning atom 経由で IT リテラシー語彙を撤去し、
	// juniorTitle の「自分で計画する」と整合（同 stage 内の語彙統一）。
	juniorDesc: `月次レポートで「自分のペース」を客観視し、${AUTONOMY_TERMS.selfPlanning}リズム調整が可能に。`,
	// #1911 (B-6): 15 字以内に圧縮
	juniorParentBenefit: '時間管理を子供任せに',
	juniorChildExperience: '月次レポートで自己ペース可視化',
	seniorAge: '高校生',
	seniorRange: '16-18',
	seniorUnit: '歳',
	seniorTitle: '進路相談で「これだけやってきた」を子供自身が語れる',
	// #4502 (GAMMA-GRAD-01): 15 年分の保持は無期限保持を持つ premium の条件。
	// 条件を書かずに年数だけ訴求しない
	seniorDesc: `15 年分の活動ログが「自分はこれだけやってきた」という自信に（${PLAN_TERMS.premium}の無期限保持でのご利用時）。`,
	// #1911 (B-6): 15 字以内に圧縮
	seniorParentBenefit: '進路面談で活動履歴を語れる',
	seniorChildExperience: '15年の履歴が自信になる',
	graduateLabel: 'そして',
	graduateAccent: '卒業',
	graduateTitle: 'アプリを開かなくなった日 — それは家族の卒業式',
	graduateDesc: `「使わなくなる」ことががんばりクエストの成功。記録はいつでも書き出してご家族の手元に残せます（書き出しは有料プラン、15 年分の保持は${PLAN_TERMS.premium}の機能です）。`,
	// #1911 (B-6): 15 字以内に圧縮
	// #2058 (UIUX-F-16): 「子供の自律」→「自分で動く姿」リフレーム。
	// AUTONOMY_TERMS atom 直接参照ではなく、graduate stage 文脈で「動詞 → 名詞」転置した
	// 「自分で動く姿」(7 字) で表現。旧「子供の自律を頻度低下で確認」(13 字) と同尺の
	// 「自分で動く姿を頻度低下で確認」(14 字) で 15 字制限内維持。
	graduateParentBenefit: '自分で動く姿を頻度低下で確認',
	graduateChildExperience: 'アプリ無しで計画できる実感',
	// ベネフィット行 + screenshot alt #1707 / #1712
	preschoolShotAlt: '幼児ホーム画面 — 大きな絵文字ボタンと達成スタンプ',
	elementaryShotAlt: '小学生ホーム画面 — ポイント・レベル・チャレンジ',
	juniorShotAlt: '中学生ホーム画面 — 月次レポートと自己ペース可視化',
	seniorShotAlt: '高校生ホーム画面 — 15 年分のログと進路素材',
	graduateShotAlt: '卒業画面 — 履歴エクスポートと家族の手元に残す記録',
} as const;

// ============================================================
// LP [03] core-loop 3 層モデル (#1343)
// SSOT: site/index.html [03] セクション用ラベル
// 用語注: 内部 section ID は "core-loop" を維持（anchor 互換）。顧客向けは「3 つの仕組み」(#1615 / #1892)。
// ============================================================

// #1624 R20: StoryBrand 7 要素のうち Internal Problem / Philosophical / Avoiding Failure
//   を sectionDesc に補完。「毎日同じことを言う疲れ」「子供の自律を信じる」「シール帳で挫折しないため」
// #1787 (R-CRT-4 / U-MIN-9): 4 階層 (section → 2col → layer-grid → step) → 1 階層 3 カードに再構成。
//   1-shot summary 画像 + 各カード短文 1 行のみで「活動 → 習慣 → ごほうび」の循環を表現。
//   旧 STEP 1/2 構造（l1Step1Title/Desc 等）と親子両視点バナー（parentPerspectiveDesc 等）は廃止。
//   既存 keys は SSOT 整合のため一部空文字保持で再混入を CI 検出可能に。
// #1788 (P-MAJ-3): 「プリセット活動で設定は 2 分」(parentPerspectiveDesc) と
//   「プリセット活動がそのまま使える」(l1Step1Desc) を honest 表現へ刷新（候補から選ぶ運用を明示）。
// #1954 (Phase 3 D9): terms.ts atom 参照化対象ゼロの恒久記録。
//   本 namespace は「活動 → 習慣 → ごほうび」の 3 つの仕組み（core-loop）を説明する構造。
//   訴求軸が「ループ全体の動詞句」（記録する / 続ける / 交換する / 計画する）にあり、
//   PLAN 名 (PLAN_TERMS / PLAN_FULL_TERMS) / 価格 (PRICE_TERMS) / トライアル期間 (TRIAL_TERMS) /
//   解約 (CANCEL_TERMS) / 無料訴求 (FREE_TERMS) / CTA 動詞句 (CTA_TERMS) のいずれの atom にも
//   触れない構造で意図的に組まれている。料金や期間に依存しない普遍的な仕組み説明として設計。
//   このため char-by-char 突合の結果、参照化対象は **0 件**。
//   将来 PLAN 名・価格・期間表現等が現れた場合は terms.ts 経由で参照化すること（#1916 SSOT 階層）。
//   検証: 本 namespace 範囲内に '無料' / 'スタンダード' / 'ファミリー' / '7日間' / '7 日間' /
//         '¥500' / '¥780' / '¥0' / '無料プラン' / 'スタンダードプラン' / 'ファミリープラン' /
//         'いつでも解約' / 'クレジットカード登録不要' / '基本無料' / 'まずは無料' /
//         '無料で始める' / '無料体験' / '無料で試す' / '無料で試せます' リテラル 0 件。
// #2058 (UIUX-F-16): AUTONOMY_TERMS atom 追加に伴い、本 namespace 内の
//   「子供が自分から動きだす」(AUTONOMY_TERMS.selfMotivated) と
//   「子供が自分で計画する」(AUTONOMY_TERMS.selfPlanning) を template literal 参照化。
export const LP_CORELOOP_LABELS = {
	sectionTitle: '3 つの仕組みで、毎日のがんばりが本物の報酬になる',
	// #2058 (UIUX-F-16): AUTONOMY_TERMS.selfMotivated atom 参照化（旧文言と完全一致）
	sectionDesc: `毎日「歯みがいた？」「宿題は？」と繰り返し声をかけるのは、親も子も疲れます。活動 → 習慣 → ごほうびの 3 つの仕組みで、子供が${AUTONOMY_TERMS.selfMotivated}毎日へ。`,
	// 1-shot summary 画像 alt (#1787)
	summaryImageAlt:
		'活動 → 習慣 → ごほうび の循環図 — D3 勇者キャラクターを中心に 3 要素が円環で結ばれる',
	// 1-shot summary キャプション (#1787 — 親主語 1 行)
	// #2058 (UIUX-F-16): AUTONOMY_TERMS.selfPlanning atom 参照化（旧文言と完全一致）
	summaryCaption: `活動を記録 → ポイントが貯まる → ごほうびと交換。子供が${AUTONOMY_TERMS.selfPlanning}力を、3 つの仕組みで支えます。`,
	// 仕組み 1: 毎日の活動 — 1 階層短文化
	l1Badge: '活動',
	l1Title: '毎日の活動を記録',
	// #1788 honest 表現: 「プリセット活動がそのまま使える」→「用意された候補から選ぶだけ」
	l1Desc:
		'「はみがきした」「宿題おわった」をタップだけで記録。学年別に用意された候補から、家庭で必要なものを選んで設定できます。',
	// 仕組み 2: 習慣カード — 1 階層短文化
	l2Badge: '習慣',
	l2Title: '習慣カードで続ける',
	// #1890: PO-4-4 些末情報削除 + リフレーム 1 文化（L1/L3 並列性確保、ADR-0012 anti-engagement は構造で担保）。
	//   旧表現「1 日 1 回まで」（制限訴求）→「毎日 1 回引ける」（楽しみ訴求）にリフレーム。
	//   旧文中の「週 7 日中 5 日タップで…自動交換」「煽らない設計」は些末情報のため削除。
	l2Desc: '毎日 1 回引けるおみくじスタンプで、子供が「明日もやろう」と自分から続けたくなります。',
	// 仕組み 3: ごほうび交換 — 1 階層短文化（旧 shopNote を本文へ統合）
	l3Badge: 'ごほうび',
	l3Title: 'ごほうびショップで交換',
	// ADR-0013: 「親が設定し」だけだと、どのプランでもごほうびを自由に作って点数を変えられると読める。
	//   料金表 (LP_PRICING_PHASEB_LABELS.k8b) と同じ線 (無料はプリセットから追加 / 作成・編集は有料) を言う。
	l3Desc: `貯めたポイントはごほうびショップが唯一の出口。実物のプレゼント・お小遣い・特権などを親が${REWARD_TERMS.preset}から選んで並べ、子供が自分で選んで交換できます。${CUSTOM_REWARD_FEATURE_NAME}は${PLAN_TERMS.standard}以上です。`,
	// pamphlet用短文（pamphlet.html 既存参照のため維持）
	pamphletNote:
		'毎日の活動でポイント / 習慣カードのおみくじスタンプ（習慣形成）/ ごほうびショップ（唯一の出口）の 3 つの仕組みで、毎日のがんばりが本物の報酬になります。',
	// #1787 旧構造 keys は再混入検出のため empty で残す（STEP 1/2 + 親子両視点）
	parentPerspectiveTitle: '',
	parentPerspectiveDesc: '',
	childPerspectiveTitle: '',
	childPerspectiveDesc: '',
	l1Step1Title: '',
	l1Step1Desc: '',
	l1Step2Title: '',
	l1Step2Desc: '',
	l2Step1Title: '',
	l2Step1Desc: '',
	l2Step2Title: '',
	l2Step2Desc: '',
	l3Step1Title: '',
	l3Step1Desc: '',
	l3Step2Title: '',
	l3Step2Desc: '',
	shopNote: '',
} as const;

// ============================================================
// LP Pages added dynamically
// ============================================================

// 注: LP_LICENSEKEY_LABELS (旧 site/help/license-key.html 用) は Epic #2525 Phase 7 PR-L4 (#2836)
//     license key 全廃 + help ページ完全削除に伴い撤去済。`/help/license-key` → `/admin/subscription`
//     301 redirect (LEGACY_URL_MAP) で bookmark / 外部リンクを救済する。
// #1944 Phase 3 D4: '基本無料' (FREE_TERMS.base) と 'ファミリープラン' (PLAN_FULL_TERMS.premium) を atom 参照化。
//   text32 '基本無料 / 有料プランあり' / text44 'ファミリープランで利用可' の 2 件。
//   その他のラベルは「セルフホスト版独自の運用語彙」（Docker / GitHub / SaaS版 / RAM 等）が中心で
//   plan / 価格 / 期間 / 解約 / 無料訴求の atom 群とは交わらない構造。
// #1957 (Phase 3 D12 補足): text54 ('SaaS版を無料ではじめる') の「無料」は部分一致のため atom 化不可。
//                     ※ heroButton / bottomButton 系の atom 化は LP_FLOATING_CTA_LABELS で完了。
export const LP_SELFHOST_LABELS = {
	text1: 'セルフホスト版ガイド - がんばりクエスト',
	text2: '&#x1F4E6; セルフホスト版ガイド',
	text3:
		'がんばりクエストはオープンソース。自宅サーバーや NAS で動かせば、データは完全にご自身の管理下に置けます。',
	text4: '&#x1F4BB; GitHub リポジトリ',
	text5: 'SaaS版を使う',
	text6: '&#x1F680; クイックスタート',
	text7: 'Docker がインストールされていれば、3つのコマンドで起動できます。',
	text8: '起動後、ブラウザで ',
	text9: ' にアクセスしてください。',
	text10: '&#x1F4CB; 動作要件',
	text11: 'サーバー',
	text12: 'RAM 512MB 以上',
	text13: 'ストレージ 1GB 以上',
	text14: 'ネットワーク',
	text15: 'LAN 内アクセス',
	text16: '外部公開は任意',
	text17: 'おすすめ環境',
	text18: '&#x2705; セルフホスト版のメリット',
	// #4583: 「外部サーバーにデータを送信しません」は絶対形の否定で、AI 提案 / 領収書 OCR を
	//   有効にすると成立しない (設定により運営者の環境外の生成 AI へ送信される)。改訂後の
	//   プライバシーポリシー第9条④ と正面から食い違うため、事実に合わせる。
	//   **記録そのものが自分の管理下にある**という本来の訴求は残す (過剰否定で価値を消さない)。
	text19:
		' 記録は完全にご自身の管理下。AI 機能を使わない限り、データが外部へ送信されることはありません。',
	text20: ' 完全無料。月額料金なし、機能制限なし。',
	text21: ' カスタマイズ自由。ソースコードを自由に改変できます。',
	text22: ' オフライン利用可能。インターネット接続なしでも LAN 内で動作します。',
	// #4499: 実ライセンス AGPL-3.0-only (LICENSE / package.json) に合わせて修正。
	// 旧「MIT License」表記は虚偽表示だった (GAMMA-SELFHOST-01)。
	// #4547: SPDX 完全形 (-only) に是正 + メリット一覧には「メリットの事実」だけを残し、
	// コピーレフト義務は一覧の外の注記 (licenseObligationNote) に分離した。
	text23: ` オープンソース（${OSS_LICENSE_TERMS.spdxId}）。${OSS_LICENSE_TERMS.commercialUse}。`,
	// メリット一覧の直下に置く注記。義務はメリットではないため箇条書きに混ぜず、
	// かつ埋没させないよう独立した注記として明示する (#4547)。
	licenseObligationNote: `守っていただく義務: ${OSS_LICENSE_TERMS.copyleftObligation}（${OSS_LICENSE_TERMS.spdxId} のコピーレフト条項）。`,
	text24: '&#x1F4CA; SaaS版との比較',
	text25: '項目',
	text26: 'SaaS版',
	text27: 'セルフホスト版',
	text28: 'セットアップ',
	text29: '&#x2705; アカウント登録だけ',
	text30: 'Docker のインストールが必要',
	text31: '料金',
	// #1944 Phase 3 D4: '基本無料' を FREE_TERMS.base 参照化。
	text32: `${FREE_TERMS.base} / 有料プランあり`,
	text33: '&#x2705; 完全無料',
	text34: 'データ管理',
	text35: 'AWS 上に暗号化保存',
	text36: '&#x2705; 自分のサーバーに保存',
	text37: 'メンテナンス',
	text38: '&#x2705; 運営者が対応',
	text39: '自分で更新・バックアップ',
	text40: '外出先からのアクセス',
	text41: '&#x2705; どこからでも',
	text42: 'VPN や外部公開の設定が必要',
	text43: 'AI 機能',
	// #1944 Phase 3 D4: 'ファミリープラン' を PLAN_FULL_TERMS.premium 参照化。
	text44: `&#x2705; ${PLAN_FULL_TERMS.premium}で利用可`,
	// #4583: 「API キーの自前設定が必要」だけでは、**設定すると外部の生成 AI へ送信される**
	//   という肝心の帰結が伝わらない。セルフホストの購入判断に直結するため明示する。
	text45: 'API キーの自前設定が必要（入力内容が外部の生成 AI へ送信されます）',
	text46: '迷ったら SaaS版がおすすめ',
	text47: '&#x1F91D; コントリビュート',
	text48:
		'がんばりクエストはオープンソースで開発中。バグ報告、機能リクエスト、プルリクエスト、どんな貢献も歓迎します。',
	text49: ' でバグ報告・機能リクエスト',
	text50: 'メール',
	text51: ' で開発を支援',
	text52: 'まずは試してみませんか？',
	text53: 'SaaS版ならアカウント登録だけですぐに始められます。セルフホスト版は GitHub からどうぞ。',
	text54: 'SaaS版を無料ではじめる',
} as const;

// ============================================================
// LP_FLOATING_CTA_LABELS (#1732)
// ============================================================
// floating-cta（モバイル下部追従 CTA）の深度別文言。
// ADR-0009 (labels SSOT) + ADR-0012 (Anti-engagement) + ADR-0013 (LP truth) 整合。
//
// 深度切替仕様（site/index.html の floating-cta スクリプトが参照）:
//   - 0% 〜 hero pass (≈ scrollY 500px 以下): 非表示（hero 領域には Hero CTA があるため）
//   - hero pass 〜 midStart% (デフォルト 30%): phase=hero
//       「全機能を家族で試せる（7 日間無料）<small>クレジットカード不要</small>」+ CTA「無料で始める」/ href=/auth/signup
//   - midStart% 〜 bottomStart% (デフォルト 70%): phase=mid
//       「3 つの仕組みは 1 分で体験できます」+ CTA「デモを見る」/ href=/demo (#1892 で内部用語撤廃)
//   - bottomStart% 〜 (デフォルト 70% 以上): phase=bottom
//       「ここまで読まれた方へ」+ CTA「無料で始める」/ href=/auth/signup
//
// CTA テキスト 3 文言 (`無料で始める` x 2 + `デモを見る` x 1) は既に LP 内で許可されている
// ctaVariants 3 種（無料で始める / デモを見る / ログイン）の範囲内に収まる（ratchet 維持）。
// 補強コピー (text) のみが phase で 3 通りに変化する。
//
// Anti-engagement (ADR-0012): 文言は「煽る」表現を避け、状況提示型 / 共感型 / 軽い再訴求 にとどめる。
// 「今すぐ始める」「あと X 人」「タイムセール」などの urgency 演出は使わない。

// #1957 (Phase 3 D12): heroButton / bottomButton を FREE_TERMS.tryFree atom 参照化。
//                     midButton ('デモを見る') / heroText / midText / bottomText / *Href / aria* は
//                     terms.ts atom と表記が異なる連結フレーズや URL/連絡用 aria 文のため atom 化対象外。
//                     - heroText の「7 日間無料」「クレジットカード不要」(短縮形) は TRIAL_TERMS atom と表記揺れあり
//                     - bottomText / ariaLabelHero の「7 日間無料」も同様
//                     文字列差分ゼロ維持を優先しリテラル維持。
// #1904 (PERS-CRT-5): heroText / bottomText から「クレジットカード不要」削除。
//                     3 連発による不信感増幅 (田中ゆかり P1 サブスク被害連想) を解消するため、
//                     hero 領域に「クレジットカード登録不要」関連表記を置かない。
export const LP_FLOATING_CTA_LABELS = {
	// 各 phase の補強コピー（HTML 可、<small> + <strong> のみ想定）
	heroText: '全機能を家族で試せる<small>7 日間無料</small>',
	// #1892 (PO-4-6 2 回目指摘): 旧表現の内部 IA 用語撤廃。前段 [03] 顧客語彙「3 つの仕組み」と整合。
	midText: `3 つの仕組みは 1 分で体験できます<small>${SIGNUP_TERMS.canonical}前に動きを確認</small>`,
	bottomText: 'ここまで読まれた方へ<small>7 日間無料</small>',
	// 各 phase の CTA ボタン文言（既存 ctaVariants 3 種の範囲内）
	heroButton: `${FREE_TERMS.tryFree}`,
	midButton: 'デモを見る',
	bottomButton: `${FREE_TERMS.tryFree}`,
	// 各 phase の CTA href
	// #2261 (2026-05-19 PO 報告): apex (ganbari-quest.com) ではなく www. canonical
	// に統一。LP は www. で配信されているため apex 経由だと 301 リダイレクトが
	// 挟まり UX 劣化（DemoBanner と同一 root cause、DEMO_LABELS.exitHref / signupHref 修正と同時対応）。
	heroHref: 'https://www.ganbari-quest.com/auth/signup',
	midHref: 'https://demo.ganbari-quest.com/',
	bottomHref: 'https://www.ganbari-quest.com/auth/signup',
	// aria-label（読み上げ用）
	// #1915 (TECH-F 中頻度 D-1): TRIAL_PERIOD_TERMS atom 経由
	ariaLabelHero: `${TRIAL_PERIOD_TERMS.full}へのご案内`,
	ariaLabelMid: 'デモ画面で機能を体験',
	ariaLabelBottom: '無料トライアル開始のご案内',
} as const;

// ============================================================
// LP_INDEX_EXTRA_LABELS (#1465 SSOT Fixes)
// ============================================================

// #1956 (Phase 3 D11): terms.ts atom 参照化対象（PLAN_FULL_TERMS / PRICE_TERMS / TRIAL_TERMS /
//   CANCEL_TERMS / FREE_TERMS / CTA_TERMS）。 char-by-char 一致厳守。
//   '7 日間' (半角スペース有り) は TRIAL_TERMS.duration ('7日間' スペース無し) と一致しないため
//   直書き継続（#2007 / #2008 / #2009 と同方針）。
//   '&#165;' (HTML エンティティ) は PRICE_TERMS の '¥' (U+00A5) と一致しないため直書き継続。
export const LP_INDEX_EXTRA_LABELS = {
	k1: 'がんばりクエスト — 「やりなさい」を「やりたい！」に変える家族の冒険アプリ',
	k2: '☰',
	k3: '「やりなさい」を ',
	k4: '「やりたい！」',
	k5: ' に変える家族の冒険アプリ',
	// #1912 (F-3): hero-sub の SSOT は LP_INDEX_PHASEB_LABELS.k3 (ゲームのように楽しめる仕組みに変える) に集約済。
	//   本 indexExtra.k6 は HTML 参照ゼロの zombie key だが、SSOT 整合のため phaseB.k3 と同文言に保つ。
	//   旧文言「ポイント・シール・レベルで冒険に変える」は単語羅列で IT リテラシーなし親 P1 の認知負荷が高い。
	k6: '3〜18 歳の毎日の習慣を、ゲームのように楽しめる仕組みに変える。声をかけなくても、自分から動きだす家族時間へ。',
	k7: `${FREE_TERMS.tryFree}`,
	k8: 'デモを見る',
	// #1904 (PERS-CRT-5): hero L483 hero-note の「クレジットカード登録不要」削除。
	//                     3 連発による不信感増幅を解消するため hero 領域では訴求しない
	//                     (カード要否の説明は FAQ 側 indexB.k72 に集約)。
	// #4502 (GAMMA-LP-04): 無料プランは子供 2 人・招待不可なので「家族何人でも」は誤り。
	// 人数を含意しない表現にする (index.html:832 の正表記と同型)
	k9: 'ご家族で無料ではじめられます',
	k10: '子供のホーム画面 — 活動を記録してポイントゲット',
	k11: 'お子さまの年齢で、画面とむずかしさが変わります',
	// #4502 (GAMMA-LP-05): 実装は 5 mode。LP が 2 パネルに集約しているのは意図的なので、
	// パネル数をそのままモード数として言い切らない
	k12: '3 歳から 18 歳まで、年齢に合わせた UI が対応。',
	k13: 'タップで「今のお子さまに合う UI」をご覧ください。',
	k14: '      0-2 歳のお子様は「準備モード」でご登録いただけます。',
	k15: '詳しくはこちら',
	k16: '幼児 (3-5)',
	k17: '小学生以上 (6-18)',
	k18: 'ひらがな中心・丸みのある大きなボタン',
	k19: '幼児 UI: ひらがな / 大タップ / 絵文字演出',
	// #1912 (F-6): zombie indexExtra namespace。SSOT 整合のため LP_INDEX_PHASEB_LABELS.k12 と
	//   同方針で「ログインボーナス」→「毎日のごほうび」へ日本語化。
	k20: '幼児期に身につけたい習慣を、読める・押せる・選べる形で始められます。',
	k21: 'デモを見る',
	k22: '漢字 + 情報密度で 15 年継続できる UI',
	k23: '小学生以降 UI: 漢字 / 情報密度 / 学年別プリセット',
	k24: '小学校以降は自分で計画してより多くの活動をより楽しく',
	k25: 'デモを見る',
	k26: '&#x1F476; 0〜2 歳のお子様は「',
	k27: '準備モード',
	k28: '」でご登録いただけます &#8212; ',
	k29: 'デモを見る',
	k30: '&#x1F9D1;&#x200D;&#x1F4BB; 親の視点',
	k31: '&#x1F9D2; 子供の視点',
	// #1708 R3-A / #1710 R3-C: 「5 つの工夫」→「3 つの工夫」、ルーティン関連語彙削除、習慣エンジンは活動 must 属性へ移管（kind=routine 廃止）
	// #1782: 「3 つの工夫」→「2 つの工夫」、実績 & 称号カード削除（ADR-0012 §6 整合 + #404 廃止合意の revert 復活への対応）
	// #1802: [03]/[04] 連続「Nつの〜」H2 解消のため [04] H2 を IA sub-section 化（旧表現は #1892 で撤廃済）
	// 旧 k32-k51 を再構成: 旧 5 工夫 → 3 工夫 → 2 工夫（朝準備 / RPG）に圧縮、indexExtra namespace は新 LP では未参照だが SSOT 一貫性のため整合
	// #1892 (PO-4-6 2 回目指摘): 旧 H2/リードの内部 IA 用語を撤廃し顧客語彙化
	//   (詳細は LP_INDEX_PHASEB_LABELS.k21 / k22 のコメント参照)。indexExtra namespace は未参照だが SSOT 一貫性のため整合。
	k32: '毎日の冒険をもっと楽しくする 2 つの工夫',
	k33: '朝の持ち物確認と、夜のボスバトル。子供が朝から夜まで「次のごほうび」を楽しみに待てるしかけです。',
	k34: '朝の準備と冒険のクライマックスの 2 つから、日々のがんばりを支えます。',
	// #1782: k35/k36/k37 (旧 ① 長期の達成感 / 実績 & 称号) は削除済み（empty string で再混入検出）
	k35: '',
	k36: '',
	k37: '',
	k38: '&#9312; 朝の準備をスムーズに',
	k39: '持ち物チェックリスト',
	k40: `${CHILD_TERMS.honorific}が自分で確認でき、朝の声かけを減らせます。`,
	k41: '&#9313; 冒険のクライマックス',
	k42: 'ボスバトル',
	k43: '毎日の努力で貯めたエネルギーでボスに挑戦。小学生から全年齢で使える、冒険の締めくくりです。',
	k52: '遊びだけで終わらせない、親のための機能',
	k53: 'ゲーミフィケーションの裏で、親がちゃんと伴走できる設計。「遊ばせっぱなし」「設定が大変そう」の不安を取り除く 4 つの機能です。',
	k54: '成長の記録（月次レポート）',
	k55: '月次レポートで活動・ポイント推移をひと目で把握。子供の成長を記録として残せます。',
	k56: '時間管理（使いすぎ防止）',
	k57: '設定時間が経過すると画面が自動で閉じる使いすぎ防止タイマー。スクリーンタイムの心配なく使わせられます。',
	k58: 'おうえんメッセージ',
	k59: '「よくがんばったね」の一言が子供のホーム画面に届きます。Family プランで家族全員から送れます。',
	k60: '設定の自由度',
	k61: '活動の種類・ポイント配分・ごほうびは自由にカスタマイズ。お子さまに合わせて調整できます。',
	k62: '料金プラン',
	// #1956 (Phase 3 D11): k63 '月 ¥500' = monthlyPrefix + standard、k65 '基本無料' = FREE_TERMS.base、
	//   k68 '無料体験' = CTA_TERMS.freeTrialNoun、k69 'いつでも解約 OK' = CANCEL_TERMS.anytimeOk、
	//   k70 '無料プラン' = PLAN_FULL_TERMS.free。
	// #1913 (UIUX-E-5): k67 を HTML エンティティ「&#165;」直書きから「¥」直書き (CURRENCY_TERMS.yen) に統一。
	//   AC7 = `&#165;` HTML entity が 0 件、「¥」直書き統一。表示文字は同一 (U+00A5) で UI 影響ゼロ。
	k63: `${PRICE_TERMS.monthlyPrefix}${PRICE_TERMS.standard} から、家族全員が使える設計です。`,
	k64: '安心して始められる 4 つのお約束。',
	k65: `${FREE_TERMS.base}`,
	k66: '有料は',
	k67: `${PRICE_TERMS.monthlyPrefix}${PRICE_TERMS.standard}${PRICE_TERMS.taxNote}${PRICE_TERMS.fromSuffix}`,
	k68: `7 日間${CTA_TERMS.freeTrialNoun}`,
	k69: `${CANCEL_TERMS.anytimeOk}`,
	k70: `お子さま 2 人までのご家庭なら、${PLAN_FULL_TERMS.free}で冒険の仕組みをすべてお使いいただけます。`,
	k71: '3 人以上 / 長期履歴 / AI 自動提案は有料プランで。',
	k72: '料金の詳細を見る &#8594;',
	k73: 'お子さまのデータは、家族だけのものです',
	k74: '広告なし・家族だけで閉じた空間・データは家族の手元に。',
	k75: '「こっそり外に持ち出される」「勝手に操作される」不安をゼロにする 4 つの約束。',
	k76: '広告なし',
	k77: '子供の画面に広告を出しません。行動データを広告に利用することもありません。',
	k78: 'プライバシーポリシー &#8594;',
	k79: '家族限定',
	k80: '家族メンバー以外はお子さまのデータを閲覧できません。招待制で閉じた空間を維持します。',
	k81: '保護者専用のカギ付き',
	k82: `${ADMIN_VIEW_TERMS.canonical}は保護者だけが開けるカギ（おやカギコード）でロックできます。お子さまが自分でポイントを増やしたり設定を変えたりすることができません。`,
	// #1905 (PERS-MAJ-11): k84/k85 を positive framing にリライト（indexB.k68/k69 と整合）。
	//   `LP_INDEX_EXTRA_LABELS` は HTML 参照ゼロの legacy だが SSOT 一貫性のため同期更新。
	k83: '広告ゼロ・データは家族の手元に',
	// #4510 (data/medium): 書き出しは有料プランの機能 (無料は canExport=false)。
	// 無条件に「確実に手元に残せます」と書くとプラン差を隠した約束になる
	k84: '家族のデータが広告にも第三者にも使われない設計です。サービス停止時は事前にお知らせします。記録の書き出し（有料プランの機能）で、お子さまの記録を手元に残せます。',
	k85: '（技術に詳しい方は）ご自宅で同じアプリを動かす方法もあります。<a href="selfhost.html">詳しくはこちら &#8594;</a>',
	// #1896 (PO-4-10): k86 を LP_FAQ_TERMS.canonicalLong 参照化。
	//   旧 k89 = 'FAQ 専用ページ（24 項目）' は項目数の経時変動 (24/26/28 …) で
	//   disclaimer 整合が破綻するため当 namespace から削除（HTML 側で参照ゼロ確認済）。
	//   誘導文の SSOT は LP_FAQ_TERMS.inlineCtaSentence を新規誘導箇所で参照する。
	k86: `${LP_FAQ_TERMS.canonicalLong}`,
	k87: '保護者の皆さまから特によくいただく 3 つ。',
	k88: '他のご質問は ',
	// #1896 (PO-4-10) AC2: k89 完全削除。
	//   旧値 'FAQ 専用ページ（24 項目）' は項目数の経時変動 (24/26/28 …) で
	//   disclaimer 整合が破綻するため namespace から削除（HTML 側参照ゼロ確認済）。
	//   誘導文の SSOT は LP_FAQ_TERMS.inlineCtaSentence。#1898 PO-4-12 で導入された
	//   atom 参照版も AC2 厳密遵守のため最終的に削除する。
	k90: ' をご覧ください。',
	k91: '無料トライアルにクレジットカードは必要ですか？',
	// #1956 (Phase 3 D11): '無料プラン' = PLAN_FULL_TERMS.free 参照化（'7 日間' は半角スペース有りで直書き継続）
	k92: `不要です。メール認証だけで 7 日間すべての有料機能をお試しいただけます。期間終了時は自動で${PLAN_FULL_TERMS.free}に戻るため、`,
	k93: '気付いたら課金されていた',
	k94: 'ということはありません。',
	k95: '子供が勝手に課金してしまう心配はありませんか？',
	k96: 'ありません。課金操作は保護者権限のアカウントからのみ実行できる設計です。お子さまアカウントにはプラン変更ボタン自体が表示されません。',
	k97: '詳しくはこちら',
	k98: 'サービスが終了したらデータはどうなりますか？',
	k99: '終了日の 30 日以上前に登録メールアドレスへお知らせし、その間にデータをバックアップ（ファイルに書き出し）いただけます。',
	k100: '詳しくはこちら',
	k101: '料金・兄弟姉妹・年齢モード・エクスポート等、他のご質問は ',
	// #1896 (PO-4-10) AC2: k102 完全削除。
	//   旧値 'FAQ 専用ページ'、HTML 側参照ゼロ。誘導文 SSOT は LP_FAQ_TERMS.inlineCtaSentence。
	//   #1898 PO-4-12 で導入された atom 参照版も AC2 厳密遵守のため最終的に削除する。
	k103: ' へ。',
	k104: '家族で全部使ってから、続けるか決める',
	// #1956 (Phase 3 D11): 'クレジットカード登録不要' = TRIAL_TERMS.noCreditCard 参照化、
	//   '無料で始める' (k107 / k113) = FREE_TERMS.tryFree 参照化。
	//   '7 日間' は半角スペース有りで直書き継続。
	k105: `7 日間無料・${TRIAL_TERMS.noCreditCard} / いつでも${CANCEL_TERMS.canonical}可能。`,
	k106: '今日からお子さまの「やりたい！」を育てませんか？',
	k107: `${FREE_TERMS.tryFree}`,
	k108: 'ご質問・ご要望は',
	k109: 'メール',
	k110: 'でお気軽にどうぞ',
	k111: '全機能を家族で試せる（7 日間無料）',
	k112: 'クレジットカード不要',
	k113: `${FREE_TERMS.tryFree}`,
	k114: '&#10005;',
} as const;

// ============================================================
// LP Phase B Labels (#1702 — site/{index,pricing,faq,pamphlet}.html 339 件 SSOT 化)
//
// 生成元: #1702 時点の LP SSOT 検査で検出された 339 件の violation 行を
// 全て data-lp-key 化したときの label 値（innerHTML 形式）。
// 各 namespace 内の k1, k2, ... は HTML 内の出現順。
// LP_*_LABELS / LP_*_EXTRA_LABELS との重複は許容（同じ文字列が複数 namespace に存在しうる）。
// 値は applyLpKeys() で DOMPurify.sanitize 後 innerHTML 注入されるため、
// strong/em/a/br/span/sup/sub/small/b/i 以外のタグは drop される。
// ============================================================

export const LP_INDEX_PHASEB_LABELS = {
	k1: 'がんばりクエスト — 「やりなさい」を「やりたい！」に変える家族の冒険アプリ',
	k2: '「やりなさい」を <span>「やりたい！」</span> に変える家族の冒険アプリ',
	k3: '3〜18 歳の毎日の習慣を、ゲームのように楽しめる仕組みに変える。声をかけなくても、自分から動きだす家族時間へ。',
	k4: '3〜18 歳の子供のホーム画面 — 活動を記録してポイントゲット',
	k5: 'お子さまの年齢で、画面とむずかしさが変わります',
	k6: '3 歳から 18 歳まで、年齢に合わせた UI が対応。タップで「今のお子さまに合う UI」をご覧ください。',
	// #4714: 旧アンカー #baby-mode は faq.html に存在せず着地しなかった (実在する #usage へ)。
	k7: '0-2 歳のお子さまは「準備モード」でご登録いただけます。<a href="faq.html#usage" style="color:var(--brand-700)">詳しくはこちら</a>',
	k8: '幼児 (3-5)',
	k9: '小学生以上 (6-18)',
	k10: 'ひらがな中心・丸みのある大きなボタン',
	k11: '幼児 UI: ひらがな / 大タップ / 絵文字演出',
	// #1912 (F-6): 「ログインボーナス」→「毎日のごほうび」へ日本語化
	k12: '幼児期に身につけたい習慣を、読める・押せる・選べる形で始められます。',
	// #1801 M-MIN-2: hero CTA との重複を排除し、[02b] age-panel CTA を「デモを見る」のみに簡略化
	k13: '<a href="https://demo.ganbari-quest.com/" class="btn btn-demo">デモを見る</a>',
	// #4714: 旧「漢字 + 情報密度で 15 年継続できる UI」は、同パネルの SS (小学生ホーム = 漢字最小限)
	//   と食い違っていた。DESIGN.md §8 の年齢帯定義 (小学生 = 漢字最小限 / 中学生以降 = 漢字・情報密度)
	//   に沿って、パネルが束ねる 6〜18 歳の中での変化として述べる。
	k14: '学年に合わせて漢字と情報密度が上がる',
	k15: '小学生以降 UI: 学年に合わせた漢字量 / 情報密度 / 学年別プリセット',
	k16: '小学校以降は自分で計画してより多くの活動をより楽しく',
	// #1801 M-MIN-2: hero CTA との重複を排除し、[02b] age-panel CTA を「デモを見る」のみに簡略化
	k17: '<a href="https://demo.ganbari-quest.com/" class="btn btn-demo">デモを見る</a>',
	// #1910 AC6 (UIUX-A-6): age-panel scrshot vs body 高低差を埋める body 内チェックリスト 6 件
	// 各年齢 UI モードの代表機能 3 件を ✓ で列挙、age-panel-feature span との重複を避け具体例で訴求
	kinderCheck1: '大きなタップ領域 (80px) で押しやすい',
	kinderCheck2: 'ひらがな表示で読みやすい',
	// #4713: 延べ 325 件のうち名前のユニークは 129 種。訴求はユニーク基準に改める (ADR-0013)。
	kinderCheck3: `${PRESET_ACTIVITY_TERMS.uniqueCountBadge} プリセット活動からタップで選ぶだけ`,
	primaryCheck1: '小学生は読みやすさ優先、中学生から漢字と情報密度が上がる',
	primaryCheck2: '学年別プリセット (宿題 / 部活 / 受験) 対応',
	primaryCheck3: 'ポイント履歴で子供自身が次の計画を立てる',
	k18: '&#x1F476; 0〜2 歳のお子さまは「<strong>準備モード</strong>」でご登録いただけます — <a href="https://demo.ganbari-quest.com/">デモを見る</a>',
	k19: '&#x1F9D1;&#x200D;&#x1F4BB; 親の視点',
	k20: '&#x1F9D2; 子供の視点',
	// #1708 R3-A: 4 → 3 圧縮（旧 ③ 旧ルーチン-CLカード削除、kind=routine 廃止 + 活動 must 属性化に伴い）
	// #1782: 3 → 2 圧縮（旧 ① 「実績 & 称号」削除、ADR-0012 §6 整合 + #404 廃止合意の revert 復活への対応）
	//   k23/k24/k25 は削除（実績 & 称号カード）。k38/k39/k40/k41/k42/k43 を新たに使用（持ち物 / RPG バトル）
	// #1892 (PO-4-6 2 回目指摘): 旧 H2/リードの内部 IA 用語を撤廃し、
	//   顧客語彙「2 つの工夫」「しかけ」へ完全置換。前段 [03] core-loop が「3 つの仕組みで…」と
	//   顧客語彙化済みなのに、ここで旧表現が逆戻りして離脱級違和感を生んでいた問題の解消。
	//   PO 確定 C 案 (UI/UX 候補 B): 「2 つの工夫」で範囲明示、主婦語彙圏「しかけ」「楽しみに待てる」採用。
	k21: '毎日の冒険をもっと楽しくする 2 つの工夫',
	k22: '朝の持ち物確認と、夜のボスバトル。子供が朝から夜まで「次のごほうび」を楽しみに待てるしかけです。',
	// #1782: k23/k24/k25 (旧 ① 実績 & 称号) は削除済み（empty string で SSOT 整合維持、再混入時の検出のため key 自体は残す）
	k23: '',
	k24: '',
	k25: '',
	// #1782: 旧 ① (実績 & 称号 = k23/k24/k25) を削除し、旧 ② (持ち物) を ① にシフト → k26 のままで番号 ① 化
	k26: '&#9312; 朝の準備をスムーズに',
	k27: '持ち物チェックリスト',
	k28: `通学や習い事の持ち物を、${CHILD_TERMS.honorific}自身がタップ確認。`,
	k29: '朝の「あれ持った？」を減らします。',
	// #1708 R3-A: k30/k31/k32/k33 (旧 ③ 旧ルーチン-CL) は削除済み
	// #1782: 旧 ③ (RPG バトル = k34/k35/k36) を ② にシフト → 番号 ② 化
	// #1891 (PO-4-5): 「全年齢で 使える、…」widow 解消。句点分割 + 体言止めで文末「使えるです。」widow を防止。
	//   旧: 「毎日の努力で貯めたエネルギーでボスに挑戦。小学生から全年齢で使える、冒険の締めくくりです。」
	//   新: 「毎日のがんばりを力にしてボスバトル！」
	k34: '&#9313; 冒険のクライマックス',
	k35: 'ボスバトル',
	k36: '毎日のがんばりを力にしてボスバトル！',
	// #1720 R4: soft-features 4 → 3 cards 圧縮 (月次レポート featured 凸構成 + 家庭運用補助 + 設定自由度)
	k37: '親が安心できる運用補助',
	// #1894 (PO-4-8): 内部用語「ゲーミフィケーション」撤廃 + 課題リフレーム。
	//   旧: 「ゲーミフィケーションの裏で、親がちゃんと伴走できる設計。「遊ばせっぱなし」「設定が大変そう」の不安を取り除く 3 つの機能です。」
	//   PO 直言:
	//     1. 「ゲーミフィケーション」は内部用語、一般ユーザ向けではない → 「冒険」に置換（hero「家族の冒険アプリ」と用語整合）
	//     2. 「設計」→「仕組み」（顧客語彙）
	//     3. 「設定が大変そう」より P1 ペイン「うちの子に合わなさそう」を訴求（Persona 田中ゆかり受容性検証済）
	//     4. 価値: 「個別ご家庭向けの自由なカスタマイズ」を文末で明示
	//   PO 確定: 論点 2-B = Persona 案 1
	k38: '冒険の裏で、親がちゃんと伴走できる仕組み。「遊ばせっぱなし」「うちの子に合わなさそう」の不安をなくし、ご家庭に合わせて自由にカスタマイズできます。',
	// #4714: カードの SS は /admin/status の成長レポート (5 軸レーダー + 同年齢の平均) であり、
	//   推移グラフ・前月比は写っていない。SS が写している画面の名前と内容に合わせる (ADR-0013)。
	k39: '成長の記録（成長レポート）',
	// #1164: 本段落は lp-copy-layout.spec.ts の 40 字 ratchet 対象。<br> を持たないため
	//   innerText 上は「1 行 = 段落全体」として数えられる。軸名の例示は隣の
	//   feature-auto-sleep カード (softFamilySupportDesc) が担うので、ここは 40 字に収める (#4887)。
	k40: `${STATUS_AXIS_TERMS.axisCount}のバランスをレーダーで表示。同年齢の平均と重ねて見られます。`,
	// #4714: soft-features カードの SS の alt。旧「月次レポート画面 — 活動・ポイント推移グラフ」は
	//   写っている画面 (/admin/status の成長レポート) と別物だった。値の mirror は
	//   tests/unit/domain/lp-alt-caption-mirror-4714.test.ts が index.html と突き合わせる。
	softMonthlyReportImgAlt: `成長レポート画面 — ${STATUS_AXIS_TERMS.axisCount}のレーダーと同年齢の平均`,
	k41: '使いすぎ防止タイマー',
	// #4714 (#4713 と同 class): 実装は「連続利用が 15 分に達すると戻る」であり、
	//   「設定時間が経過すると閉じる」ではない (時間を設定する UI も無い)。現在 site/*.html からは
	//   未参照だが、復活時に誤説明が再流入しないよう同時に是正する。
	k42: `${AUTO_SLEEP_TERMS.activeDuration}つづけて使うと自動で${AUTO_SLEEP_TERMS.returnScreen}に戻ります。時間の設定は不要です。`,
	k43: 'おうえんメッセージ',
	k44: '「よくがんばったね」の一言が子供のホーム画面に届きます。Family プランで家族全員から送れます。',
	k45: '設定の自由度',
	// #1894 (PO-4-8): card 3 本文 (k46) の冒頭で「ご家庭ごとに自由なカスタマイズ」を強調表記し、価値訴求を明示。
	//   旧: 「活動の種類・ポイント配分・ごほうびは自由にカスタマイズ。お子さまに合わせて調整できます。」
	//   PO 期待: 「個別ご家庭向けの自由なカスタマイズ」を card 3 で明示（リード k38 と呼応）
	// ADR-0013: ごほうびは無料ではプリセットから追加するだけで、作成・編集 (ポイントの調整を含む) は
	//   有料 (isCustomRewardUnlocked)。「ごほうびを…細かく調整できます」とプランを限定せずに言わない
	//   (料金表 LP_PRICING_PHASEB_LABELS.k8b と同じ線)。活動の編集は全プラン可なので活動側はそのまま。
	k46: `<strong>ご家庭ごとに自由なカスタマイズ</strong>。活動の種類・ポイント配分を、お子さまに合わせて細かく調整できます。${REWARD_TERMS.canonical}は${REWARD_TERMS.preset}から追加でき、${CUSTOM_REWARD_FEATURE_NAME}は${PLAN_TERMS.standard}以上です。`,
	// #1903 (PERS-CRT-6): k47 / k48 を「無料先 + 必要なら上位プラン」の階層構造に並び替え。
	//   旧 k47 '料金プラン' は単独で並ぶ「月 ¥500〜」と同じく中立的だが、田中ゆかり P1 が
	//   「結局いくら払うの?」と離脱級認知ギャップを起こす。「まずは無料、必要なら月 ¥500〜」
	//   形式で「無料優先 + 条件付き上位プラン」を H2 で明示する。
	//   k48 リードも「家族みんなで基本無料 + 必要なら月 ¥500〜の有料プラン」順に書き直し、
	//   freemium × 低価格帯併記の認知ギャップを文言レベルで解消する（セクション再設計なし）。
	//   FREE_TERMS.start ('まずは無料') / FREE_TERMS.priceGate ('必要なら') / FREE_TERMS.base ('基本無料')
	//   / PRICE_TERMS atom を組み合わせて compound を組み立て、char-by-char SSOT を維持。
	k47: `${FREE_TERMS.start}、${FREE_TERMS.priceGate}${PRICE_TERMS.monthlyPrefix}${PRICE_TERMS.standard}${PRICE_TERMS.fromSuffix}`,
	// #1946 (Phase 3 D6): k48/k49/k51 (price 系) を terms.ts (PRICE_TERMS / FREE_TERMS) 参照に。
	//   k48 '月 ¥500' = monthlyPrefix + standard
	//   k49 '基本無料' = FREE_TERMS.base
	//   k51 '月 ¥500（税込）〜' = monthlyPrefix + standard + taxNote + fromSuffix
	// #1903 (PERS-CRT-6): k48 を「家族みんなで基本無料 + 必要なら月 ¥500〜の有料プラン」順に再構成。
	k48: `家族みんなで${FREE_TERMS.base}で使えます。家族構成や使い方に合わせて、${FREE_TERMS.priceGate}${PRICE_TERMS.monthlyPrefix}${PRICE_TERMS.standard}${PRICE_TERMS.fromSuffix}の有料プランも選べます。安心して始められる 4 つのお約束。`,
	k49: `<strong>${FREE_TERMS.base}</strong>`,
	k50: '・',
	k51: `有料は<strong>${PRICE_TERMS.monthlyPrefix}${PRICE_TERMS.standard}${PRICE_TERMS.taxNote}${PRICE_TERMS.fromSuffix}</strong>`,
	k52: '・',
	// #1915 (TECH-F 中頻度 D-1): TRIAL_PERIOD_TERMS atom 経由
	k53: `<strong>${TRIAL_PERIOD_TERMS.full}</strong>`,
	k54: '・',
	// #1904 (PERS-CRT-5): リテラル直書きを CANCEL_TERMS.anytimeOk atom 参照に切替。
	//                     atom 1 行更新で全コンテンツに伝播するよう SSOT 化。
	k55: `${CANCEL_TERMS.anytimeOk}`,
	k56: 'お子さま 2 人までのご家庭なら、無料プランで冒険の仕組みをすべてお使いいただけます。3 人以上 / 長期履歴 / AI 自動提案は有料プランで。',
	k57: '<a href="pricing.html" class="btn btn-primary">料金の詳細を見る &#8594;</a>',
	k58: 'お子さまのデータは、家族だけのものです',
	k59: '広告なし・家族だけで閉じた空間・データは家族の手元に。「こっそり外に持ち出される」「勝手に操作される」不安をゼロにする 4 つの約束。',
	k60: '広告なし',
	k61: '子供の画面に広告を出しません。行動データを広告に利用することもありません。',
	k62: 'プライバシーポリシー &#8594;',
	k63: '家族限定',
	k64: '家族メンバー以外はお子さまのデータを閲覧できません。招待制で閉じた空間を維持します。',
	// #1911 (B-4): trust-badge #2 / #3 にもリンク追加 (4 件中 2 件のみリンクありの不揃いを是正)
	k64Link: '家族での使い方を詳しく見る &#8594;',
	k65: '保護者専用のカギ付き',
	k66: `${ADMIN_VIEW_TERMS.canonical}は保護者だけが開けるカギ（おやカギコード）でロックできます。お子さまが自分でポイントを増やしたり設定を変えたりすることができません。`,
	// #1911 (B-4): trust-badge #3 のリンク先 (FAQ プライバシー section へ誘導)
	k66Link: 'FAQ で詳しく見る &#8594;',
	// #1796 R-MAJ-6: #1「広告なし」と訴求が重複していたため「広告」を外し「データを家族の手元に」へリフレーム
	// #1905 (PERS-MAJ-11): k68 リードを positive framing にリライト（不安誘発の「運営停止仮定」表現を削除し、
	//   「サービス停止時は事前にお知らせ + データの書き出しができます」へ。
	//   k69 を技術者向け補足文 (≠ 単なる link label) に格上げし、HTML 側で `.trust-badge-tech-note`
	//   クラスで本文 (k68) と視覚的に分離。親ペルソナが selfhost.html に直接誘導されないよう「（技術に詳しい方は）」
	//   prefix で対象読者を限定する。
	k67: 'データを家族の手元に',
	k68: '家族のデータが第三者にも使われない設計です。サービス停止時は事前にお知らせします。記録の書き出し（有料プランの機能）で、お子さまの記録を手元に残せます。',
	k69: '（技術に詳しい方は）ご自宅で同じアプリを動かす方法もあります。<a href="selfhost.html">詳しくはこちら &#8594;</a>',
	// #1896 (PO-4-10): k70 = LP_FAQ_TERMS.canonicalLong に統一。
	// #1897 PO-4-11: 旧 k71 (zombie key、参照 0 件) を削除。本セクション section-desc は k87 を SSOT とする。
	k70: `${LP_FAQ_TERMS.canonicalLong}`,
	k72: '無料トライアルにクレジットカードは必要ですか？',
	k73: '不要です。メール認証だけで 7 日間すべての有料機能をお試しいただけます。期間終了時は自動で無料プランに戻るため、<strong>気付いたら課金されていた</strong>ということはありません。',
	k74: '子供が勝手に課金してしまう心配はありませんか？',
	k75: 'ありません。課金操作は保護者権限のアカウントからのみ実行できる設計です。お子さまアカウントにはプラン変更ボタン自体が表示されません。<a href="faq.html#pricing">詳しくはこちら</a>',
	k76: 'サービスが終了したらデータはどうなりますか？',
	k77: '終了日の 30 日以上前に登録メールアドレスへお知らせし、その間にデータをバックアップ（ファイルに書き出し）いただけます。<a href="faq.html#privacy">詳しくはこちら</a>',
	// #1897 PO-4-11: 旧 k78 footnote (FAQ 案内文 2 重) を削除。section-desc (k87) で 1 行案内に集約。
	// #1838: 旧 indexB.k79/k80/k81/k82 (最終 CTA cta-bottom セクション) を削除 (選択肢 A 採用)。
	//   #1797 で導入した「アプリを開かなくなった日」Success 像は hero 主訴求 + growth-roadmap 達成体験に内在化。
	//   旧 k79 = h2 / k80 = p / k81 = signup ボタン / k82 = mailto 注記。
	//   k83 以降のキー番号は HTML 側参照なし or 別箇所参照のため番号は保持（リネームによる連鎖変更を避ける）。
	k83: '全機能を家族で試せる（7 日間無料）<small>クレジットカード不要</small>',
	k84: '無料で始める',
	// #1736 m-MIN-7: 体験軸 FAQ Q4 (Top 3 → Top 4)
	k85: '子供が自分から使ってくれるようになりますか？',
	// #4502 (GAMMA-LP-02): 「多くの保護者からお声をいただいています」は顧客実績の裏付けが
	// 無い体験談形式で優良誤認になりうる (同 LP 自身が testimonial は PMF 後と注記している)。
	// 実績の主張をやめ、設計意図の説明に書き換える
	k86: '「ガミガミ言わなくても、子供のほうから見せに来る」状態を目指して設計しています。最初の 1 週間は、親子で一緒に楽しむ時間を取ることをおすすめします。',
	// #1736 m-MIN-7: section-desc を「Top 3」→「Top 4」に
	// #1897 PO-4-11: FAQ 案内文重複削除 + 静的「24 項目」管理コスト解消で 1 行短縮。
	//   旧: 「保護者の皆さまから特によくいただく 4 つ。他のご質問は…FAQ 専用ページ（24 項目）…」(footnote k78 と訴求重複)
	//   新: 「特に重要なよくあるご質問。 [その他のご質問はこちら](faq.html)」(footnote k78 削除でリードに集約)
	k87: '<strong>特に重要なよくあるご質問。</strong> <a href="faq.html" class="nav-text">その他のご質問はこちら</a>',
	// #1707 R2: machine-tour 各カードの 1 行ベネフィット
	// #1708 R3-A: tourBenefitRoutine は削除（旧ルーチン-CLカード廃止に伴い）
	// #1793: 「親が観測できること」(計測・実験用語) を文脈別 4 語彙に刷新。
	//   machine-tour [04] バトルカードは「日々の活動が冒険のクライマックスで何になるか」
	//   という家庭内のリアルなエネルギー変換シーンであるため「家庭で起きること」を採用。
	tourBenefitBattle:
		'<strong>家庭で起きること</strong>: 1 日の努力が「バトルで使えるエネルギー」として可視化される',
	// #1707 R2: soft-features 各カードの 1 行ベネフィット
	// #1793: 月次レポート / 設定の自由度は「親が日々のオペレーションで楽になる効果」を訴求するため
	//   「家庭で楽になること」を採用。
	softBenefitMonthlyReport:
		'<strong>家庭で楽になること</strong>: よく取り組んでいる分野と手つかずの分野が一目でわかる',
	// #1720 R4 で softBenefitFamilySupport に統合済の旧キー。SSOT 整合のため語彙だけ更新
	softBenefitAutoSleep: `<strong>家庭で楽になること</strong>: ${AUTO_SLEEP_TERMS.activeDuration}つづけて使うと自動で戻り、長時間利用が起きない`,
	softBenefitCheerMessage:
		'<strong>家族で実感できること</strong>: 家族から送ったメッセージを子供が読むと既読が付く',
	softBenefitSettings:
		'<strong>家庭で楽になること</strong>: 子供の年齢・興味に合わせて活動とポイント配分を細かく調整できる',
	// #1720 R4: 統合カード「家庭に寄り添う運用補助」（時間管理 + おうえんメッセージ統合）
	// #2201: ADR-0013 LP truth — 旧訴求「時間管理（使いすぎ防止タイマー） + おうえんメッセージ設定」は
	//   `/admin/settings` 画面に実 UI が存在しなかった (使いすぎ防止タイマーは `(child)/+layout` の
	//   runtime ロジック / おうえんメッセージは `/admin/messages` の独立画面)。
	//   実画面の事実 = ステータス減少設定 (4 段階で習慣化サポートの強さを調整) に合わせて rename。
	//   おうえんメッセージは feature-cheer-message カード (versus-row4) に集約。
	softFamilySupportTitle: 'ステータス減少設定（習慣化サポート）',
	softFamilySupportDesc: `ご家庭のリズムに合わせて、ステータス（${STATUS_AXIS_TERMS.examplePair}など ${STATUS_AXIS_TERMS.axisCount}）が時間とともに少しずつ減る強さを調整できます。「毎日少しずつでも続けるとお得」な仕組みで、習慣化を後押しします。`,
	// #2201: rename に伴い「ステータス減少設定」の家庭ベネフィットに刷新
	softBenefitFamilySupport:
		'<strong>家庭ごとにカスタマイズできること</strong>: ステータス減少の強さを 4 段階から選んで、習慣化のペースを家庭に合わせられる',
	// #1900 (UIUX-C-1) + #1901 統合 + #2057 (UIUX-F-13): hero carousel 4 枚を年齢帯 3 系統 (preschool / elementary / junior) + ご家族の見守り画面に再構成。
	//   旧構成は 4 枚すべて lower (elementary) 固定で alt「3〜18 歳の代表」と実体が乖離 (ADR-0013 LP truth 違反)。
	//   田中ゆかり persona 受容性検証「うちの幼児・小学生の画面が見えれば自分向けと判断できる」を踏まえ、
	//   carousel-1 = 幼児 (3-5 歳代表) / carousel-2 = 小学生 (6-12 歳代表) / carousel-3 = 中高生 (13-18 歳代表)
	//   / carousel-4 = ご家族の見守り画面 (子供管理 = /demo/admin/children) の 4 枚に再構成する。
	//   carousel-4 の URL は #1901 の物理重複解消で /demo/admin/children に確定済 (旧 /demo/admin/activities は
	//   feature-settings と URL/ETag 完全一致だったため)。ADR-0013 LP truth 整合のため alt / data-label
	//   も「子供管理 — 家族メンバーの登録と切替」で統一する。
	//   alt と data-label (carousel-label aria-live) は同一テキストを参照することで、可視テキスト・SR
	//   の両者で年齢帯整合を保つ。旧 k4 はリテラル維持（HTML 側参照なし、後方互換のため namespace 整合用に保持）。
	// #1913 (UIUX-E-1): 半角ハイフン (3-5 / 6-12 / 13-18) を波ダッシュ形に統一（AC2 = 「3-18」が 0 件）。
	//                   carouselSlide3Alt は AGE_RANGE_TERMS.juniorShort (= '13〜18 歳') を経由し全文一致を維持。
	carouselSlide1Alt: '幼児（3〜5 歳代表）のホーム画面 — ひらがな・大きなボタン',
	carouselSlide2Alt: '小学生（6〜12 歳代表）のホーム画面 — 活動記録とポイント獲得',
	// #4714: 旧 alt「自己管理ダッシュボード」に相当する UI は junior ホームに無い。実画面の内容に合わせる。
	carouselSlide3Alt: `中高生（${AGE_RANGE_TERMS.juniorShort}代表）のホーム画面 — 今日の活動とポイントの一覧`,
	// #2057: 「子供管理画面」は文脈上「お子さま管理タブ」を指すため、ADMIN_VIEW_TERMS をそのまま
	// 適用すると「子供ご家族の見守り画面」と不自然になる。原文意図 (家族メンバー管理) を保つ表現に書換。
	// #4714: 実画面 (/admin/children) のタイトルは ADMIN_SCREEN_TERMS.children。
	//   alt を画面名と一致させる (顧客が SS と画面を結び付けられるようにする)。
	// #4716 で画面名が「お子さま管理」になったため、説明側の「お子さまの」は重複になる
	carouselSlide4Alt: `${ADMIN_SCREEN_TERMS.children} — 登録と切り替え`,
	// #4644: ホーム画面への追加 (インストール) 訴求。アプリ内の案内 (PWA_INSTALL_LABELS) と
	// 同じ操作名を使うため PWA_TERMS.installAction を経由する (LP で読んだ操作名が
	// アプリ内で見つからない状態を作らない)。
	pwaTitle: `タブレットやスマホの${PWA_TERMS.installAction}しよう`,
	pwaDesc: `${PWA_TERMS.installAction}すると${PWA_TERMS.standalone}で起動します。${CHILD_TERMS.honorific}がブラウザのタブや URL 欄を誤って操作することがなくなり、記録に集中できます。`,
	pwaAndroidTitle: 'Android / Chrome',
	pwaAndroidSteps: `画面右上の「⋮」→「${PWA_TERMS.installAction}」または「アプリをインストール」→「追加」（見当たらないときは「${PWA_TERMS.chromeSaveShareMenu}」の中）`,
	pwaIosTitle: 'iPhone / iPad（Safari）',
	pwaIosSteps: `画面下の「${PWA_TERMS.iosShareButton}」（□に↑。無いときは「${PWA_TERMS.iosMoreButton}」の中）→「${PWA_TERMS.installAction}」→「追加」`,
	// #4979: この紹介ページ (別ドメイン) にはマニフェストが無く、ここで追加してもアプリとしては開かない
	pwaNote:
		'アプリストアからのダウンロードは不要です。追加はログインしたあとのアプリの画面で行ってください（この紹介ページからは追加できません）。あとからアプリの「設定」→「サポート」でも手順を確認できます。',
} as const;

export const LP_PRICING_PHASEB_LABELS = {
	k1: 'お子さまの登録：2人まで',
	k2: 'プリセット活動の利用',
	k3: 'オリジナル活動の作成：3個まで',
	k4: 'レベル・ポイント・おみくじ・スタンプカード',
	// #1912 (F-6): 「ログインボーナス・連続達成ボーナス」→「毎日のごほうび・続けるごほうび」へ日本語化
	k5: '毎日のごほうび・続けるごほうび',
	// #1710 R3-C: 旧「持ち物／毎日習慣」統合表現を「持ち物チェックリスト」に純化
	// #4713: 取込ぶんも同じ枠を消費することを明示 (plan-limit-service.maxChecklistTemplates)。
	k6: '持ち物チェックリスト 3個/子まで（取込を含む）',
	k7: `${PLAN_RETENTION_TERMS.free}間の履歴保持`,
	k8: 'メールサポート（標準）',
	// #4705: 無料プランで**できないこと**のうち、貯めたポイントの使い道に直結する制限を
	// 検討時点で見えるようにする (実ゲート = isCustomRewardUnlocked、#4584)。
	// #4915: 初期セットアップのプリセット取込には上限が無く、無料プランでもプリセットの
	// ごほうびをショップに並べられる (実装の事実)。ADR-0013 に基づき、無料でできること
	// (プリセットから追加) と、できないこと (オリジナルの自作登録) を両方明示する。
	// #4992: 取り込んだごほうびのポイント調整 (編集) も有料であることを atom の名前で言う。
	//   atom 自体が「（ポイントの調整を含む）」を持つため、外側を括弧にせず句点で区切る (括弧の入れ子を作らない)。
	k8b: `${REWARD_TERMS.canonical}: ${REWARD_TERMS.preset}から追加。${CUSTOM_REWARD_FEATURE_NAME}は${PLAN_TERMS.standard}以上`,
	k9: 'お子さまの登録人数：無制限',
	k10: 'オリジナル活動の作成：無制限',
	k11: 'チェックリスト自由作成（無制限）',
	k12: `家族メンバー招待：${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで（オーナーを含めご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}）`,
	// #4915: 無料でも使えるプリセット取込と対比するため「オリジナル」限定の名称に是正。
	// #4992: 編集 (ポイントの調整を含む) も有料であることを行名で言う。
	k13: `${CUSTOM_REWARD_FEATURE_NAME}`,
	k14: '家族のデータ預かり枠（同時保管 3 件・自分でダウンロード可）',
	k15: 'データのダウンロード',
	k16: `${PLAN_RETENTION_TERMS.standard}間の履歴保持`,
	k17: 'メールサポート',
	// #1947: k18 「スタンダードの全機能」のプラン名 atom (スタンダード) を terms.ts 参照化
	k18: `${PLAN_TERMS.standard}の全機能`,
	k19: '家族メンバー招待：無制限',
	k20: '✨ AI 自動提案（活動・ごほうび・チェックリスト）',
	k21: 'きょうだいランキング',
	k22: 'ひとことメッセージ（自由テキスト）',
	// #1912 (F-8): 「クラウド保管枠」→「家族のデータ預かり枠（自分でダウンロード可）」へ日本語化
	k23: '家族のデータ預かり枠（同時保管 10 件・自分でダウンロード可）',
	// #1911 (B-5): plan-card 3 種で項目数 8/9/8 不揃いの是正。Standard 継承機能を明示掲載で 9 項目に揃える
	k23b: 'データのダウンロード',
	k24: '無制限の履歴保持',
	k25: 'メールサポート',
	k26: '機能',
	// #1947: k27-k29 のプラン名 atom を terms.ts 参照化。「フリー」は UI 表記揺れのため直書き維持。
	k27: 'フリー',
	k28: `${PLAN_TERMS.standard}`,
	k29: `${PLAN_TERMS.premium}`,
	k30: '<td colspan="4">基本</td>',
	k31: '<td>お子さまの登録人数</td><td>2人まで</td><td class="check">無制限</td><td class="check">無制限</td>',
	k32: '<td>プリセット活動の利用</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k33: '<td>オリジナル活動の作成</td><td>3個まで</td><td class="check">無制限</td><td class="check">無制限</td>',
	k34: `<td>活動履歴の保持</td><td>${PLAN_RETENTION_TERMS.free}</td><td>${PLAN_RETENTION_TERMS.standard}</td><td class="check">無制限</td>`,
	k35: '<td colspan="4">カスタマイズ</td>',
	// #1708 R3-A: k37 (朝夜の習慣リスト / 旧ルーチン-CL) は削除（kind=routine 廃止に伴い）
	// #1710 R3-C: k38 を「持ち物チェックリスト自由作成」に純化（持ち物 = event-* プリセット 3 件 / 毎日 must = 活動マスタ priority 属性 への責務分離）
	// #4713: 旧 k36 (「登校・おでかけ」プリセットは全プラン ✓) と旧 k38 (「自由作成 3個/子まで」) を 1 行に統合。
	//   実装はプリセット取込ぶんも同じ枠を消費する「1 子あたりテンプレ合計 3 件」であり、
	//   2 行に分けると「プリセットは別枠で使い放題」と読めてしまう (plan-limit-service.maxChecklistTemplates)。
	k36: '<td>持ち物チェックリスト（登校・おでかけ等の取込を含む）</td><td>3個/子まで</td><td class="check">無制限</td><td class="check">無制限</td>',
	// #4915: 無料プランでも初期セットアップのプリセット取込には上限が無い (実装の事実、ADR-0013)。
	// 「プリセット活動の利用」(k32) と同じ対の構造で、オリジナル登録行 (k39) の直前に置く。
	k39a: `<td>${REWARD_TERMS.preset}${REWARD_TERMS.canonical}の利用</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>`,
	// #4705: 旧「特別なごほうび設定（即時付与）」は実ゲートと別機能に読めたため atom に統一
	// #4915: 無料でも使えるプリセット取込 (k39a) と対比するため「オリジナル」限定の名称に是正。
	// #4992: 取り込んだごほうびの編集 (ポイントの調整) も無料では — であることを行名で言う。
	k39: `<td>${CUSTOM_REWARD_FEATURE_NAME}</td><td class="dash">&#8212;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>`,
	k40: '<td>AI 自動提案（活動・ごほうび・チェックリスト）</td><td class="dash">&#8212;</td><td class="dash">&#8212;</td><td class="check">&#10003;</td>',
	k41: '<td colspan="4">レポート・家族機能</td>',
	// #4713: 旧「日次サマリー」に対応する画面名がアプリに無かった。管理ホームの実見出しに揃える。
	k42: `<td>${USAGE_SUMMARY_TERMS.today}・${USAGE_SUMMARY_TERMS.weekly}</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>`,
	// #4500: 招待できる人数 (owner の 1 枠を除く) と合計上限を区別する。
	k43: `<td>家族メンバー招待（別端末からアクセス）</td><td class="dash">&#8212;</td><td>${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで（オーナー含め${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}）</td><td class="check">無制限</td>`,
	k44: '<td>きょうだいランキング</td><td class="dash">&#8212;</td><td class="dash">&#8212;</td><td class="check">&#10003;</td>',
	k45: '<td>ひとことメッセージ（自由テキスト）</td><td class="dash">&#8212;</td><td class="dash">&#8212;</td><td class="check">&#10003;</td>',
	k46: '<td colspan="4">データ管理</td>',
	k47: '<td>データのダウンロード（手動エクスポート）</td><td class="dash">&#8212;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	// #1912 (F-8): 「クラウド保管枠」→「家族のデータ預かり枠（自分でダウンロード可）」へ日本語化。
	//   IT 用語「クラウド」「エクスポート」を撤廃し、IT リテラシーなし親 P1 が理解できる表現に。
	k48: '<td>家族のデータ預かり枠（自分でダウンロード同時保管数）</td><td class="dash">&#8212;</td><td>3 件</td><td>10 件</td>',
	k49: '<td colspan="4">サポート</td>',
	k50: '<td>メールサポート</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
} as const;

// #1896 (PO-4-10): k1 / k2 を LP_FAQ_TERMS.canonicalLong 参照化（用語 SSOT 集約）。
export const LP_FAQ_PHASEB_LABELS = {
	k1: `${LP_FAQ_TERMS.canonicalLong} - がんばりクエスト`,
	k2: `${LP_FAQ_TERMS.canonicalLong}`,
	k3: '保護者の皆さまから多くいただくご質問に、カテゴリ別にお答えします。ここにないご質問は、<a href="mailto:ganbari.quest.support@gmail.com?subject=FAQページからのお問い合わせ" data-contact-context="FAQ hero">お気軽にメール</a>でお問い合わせください。',
	k4: 'カテゴリ一覧',
	k5: '<a href="#trial">1. トライアル・解約</a>',
	k6: '<a href="#pricing">2. 料金・課金</a>',
	k7: '<a href="#privacy">3. プライバシー・データ</a>',
	k8: '<a href="#usage">4. 対応年齢・使い方</a>',
	k9: '<a href="#technical">5. 技術的なご質問</a>',
	k10: '<span class="faq-category-num">1</span>トライアル・解約について',
	// #1915 (TECH-F 中頻度 D-1): TRIAL_PERIOD_TERMS atom 経由 + #1914 (TECH-F): CANCEL_TERMS.canonical 経由
	k11: `${TRIAL_PERIOD_TERMS.full}と、いつでも${CANCEL_TERMS.canonical}できる仕組みについて。`,
	k12: '無料トライアルの申込にクレジットカードは必要ですか？',
	k13: `<strong>いいえ、不要です。</strong>メールアドレスと Google アカウント（またはメール認証）で${SIGNUP_TERMS.canonical}するだけで、クレジットカード情報を入力せずに 7 日間すべての有料機能をお試しいただけます。`,
	k14: `トライアル期間終了時は自動で${PLAN_FULL_TERMS.free}に戻ります。課金への切り替えは必ず${ADMIN_VIEW_TERMS.canonical}からお客さまご自身の操作で行っていただきます。`,
	k15: 'トライアル後は自動で課金されますか？',
	k16: `<strong>自動課金はされません。</strong>7 日間のトライアル終了時は、自動的に${PLAN_FULL_TERMS.free}へ戻ります。`,
	k17: `有料プランを継続したい場合のみ、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」から明示的にアップグレードしてください。クレジットカード情報の入力はアップグレード操作の中で初めて求められます。`,
	k18: `途中で${CANCEL_TERMS.canonical}するとどうなりますか？`,
	// #1943 (Phase 3 D3): 「いつでも解約」atom を CANCEL_TERMS.anytime 参照化。
	// #4496: 旧文言は退会 (アカウント削除) の猶予期間と物理削除を解約の説明に転用しており、
	//   同ページ k27 (期末まで利用可 = 正) と自己矛盾していた。解約はデータを削除しない。
	//   解約経路も実導線 (見守り画面「プラン・お支払い」→ Stripe の請求管理ページ) に統一する。
	// #4619: 「期末まで使える」だけでなく**日割り返金が無い**ことも手続き前に述べる
	//   (特商法「返品・キャンセル」/ CANCELLATION_LABELS.paidPlanNotice と同一の事実)。
	k19: `${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」→「${STRIPE_PORTAL_TERMS.short}を開く」（${STRIPE_PORTAL_TERMS.canonical}）から${CANCEL_TERMS.anytime}できます。${CANCEL_TERMS.canonical}しても<strong>データは削除されません</strong>。現在の請求期間の終了日までは有料プランをそのままご利用いただけ（日割り計算による返金はありません）、その後は${PLAN_FULL_TERMS.free}へ自動的に切り替わります。`,
	// #4619: 旧文言は「データは残ります」で止まっており、**移行後も記録・ポイント付与を続けられる**
	//   ことを述べていなかった。「読み取り専用になる」という誤読 (#4496 の旧文言が広めたもの) を
	//   打ち消すため、契約状態の告知と同じ WRITES_CONTINUE_ASSURANCE を共有する。
	k20: WRITES_CONTINUE_ASSURANCE,
	// #4619: 保持期間の日数と、超過分が復元不能であることを特商法と同じ 2 文で述べる。
	k21: FREE_PLAN_RETENTION_NOTICE,
	// #4709: 無料プランは /api/v1/export が canExport gate で 403。条件と代替手段を明記する。
	k22: `必要な記録がある場合は、有料プランのご利用期間中に${ADMIN_VIEW_TERMS.canonical}から書き出してください。記録の書き出し（エクスポート）は${PLAN_FULL_TERMS.standard}以上の機能です。${PLAN_FULL_TERMS.free}では、${CANCEL_TERMS.account}のお手続きの画面から${DELETION_EXPORT_TERMS.freeScopeSummary}のみ保存できます。`,
	k23: 'トライアル中に作ったデータは残りますか？',
	k24: `<strong>はい、残ります。</strong>トライアル終了後に${PLAN_FULL_TERMS.free}へ戻っても、お子さま・活動・ポイント・履歴などのデータは引き続き保存されます。`,
	k25: `ただし${PLAN_FULL_TERMS.free}の制限（お子さま 2 人まで、活動 3 個までなど）を超える分は一時的に非表示（アーカイブ）になります。削除はされず、保護者の管理画面で非表示中のお子さまを確認できますが、記録・編集はできません。有料プランにアップグレードすると自動で元に戻ります。`,
	k26: '解約後に再開することはできますか？',
	k27: `${CANCEL_TERMS.canonical}のお手続き後、現在の請求期間の終了日までは有料プランをそのままご利用いただけます。その間はいつでも${ADMIN_VIEW_TERMS.canonical}から${CANCEL_TERMS.canonical}を取り消して継続できます。`,
	// #4496: 旧文言は解約に猶予期間と全データ削除があるかのように述べていた。解約で消えるのは
	//   無料プランの保持期間を超えた履歴だけで、それは再契約でも戻らない。
	k28: `ただし${PLAN_FULL_TERMS.free}の保持期間（${PLAN_RETENTION_TERMS.freeSpaced}）を超えて削除された記録は、再契約しても復元できません。`,
	k29: '<span class="faq-category-num">2</span>料金・課金について',
	k30: `3 つのプラン（${PLAN_TERMS.freeCardName} / ${PLAN_TERMS.standard} / ${PLAN_TERMS.premium}）と、課金の仕組みについて。`,
	k31: `${PLAN_FULL_TERMS.free}と有料プランは何が違いますか？`,
	// #1912 (F-6): 「連続達成ボーナス」→「続けるごほうび」へ日本語化
	k32: `お子さまの冒険体験（活動記録・ポイント・レベル・スタンプ・チャレンジ・続けるごほうび）は、<strong>${PLAN_FULL_TERMS.free}でもすべてご利用いただけます</strong>。`,
	k33: '有料プランで解放される主な機能:',
	k34: `お子さま・活動の人数制限解除（${PLAN_TERMS.freeCardName}: お子さま 2 人 / 活動 3 個まで）`,
	// #4502 (GAMMA-FAQ-03): 「有料: 無期限」は誤り。スタンダードは 1 年で、無期限は
	// プレミアムのみ。値は #4477 の PLAN_RETENTION_TERMS atom から引く
	k35: `長期の履歴保持（${PLAN_TERMS.freeCardName}: 過去 ${PLAN_RETENTION_TERMS.freeSpaced}まで / ${PLAN_TERMS.standard}: ${PLAN_RETENTION_TERMS.standardSpaced} / ${PLAN_TERMS.premium}: 無期限）`,
	// #4502 (GAMMA-FAQ-04): AI 提案 / きょうだいランキングは premium 限定。「有料プランで
	// 解放される」の列に無印で並べるとスタンダードでも使えると読める
	k36: `AI 自動提案（活動案・ごほうび案）※${PLAN_TERMS.premium}のみ`,
	k37: `きょうだいランキング ※${PLAN_TERMS.premium}のみ / 家族メンバー招待`,
	k38: 'データのバックアップ',
	k39: '詳細は <a href="pricing.html">料金プランページ</a> の比較表をご覧ください。',
	k40: '子供が勝手に課金してしまう心配はありませんか？',
	k41: '<strong>ありません。</strong>課金操作は保護者権限のアカウントからのみ実行できるよう設計されています。',
	k42: 'プラン変更・アップグレードは「保護者ロール」のログインが必要',
	k43: 'お子さまアカウントはプラン変更ボタン自体が表示されない',
	k44: 'Stripe の決済画面は必ず保護者のカード情報と明示的な確認ステップを経る',
	k45: '「無断課金」が構造的に発生しない設計のため、お子さまに安心してデバイスを渡せます。',
	k46: '兄弟姉妹で使うと、どちらかだけがゲーミフィケーションされて不公平になりませんか？',
	k47: '同じ家族アカウント内で複数のお子さまをまとめて管理できます。ポイント・シール・レベル称号はお子さまごとに独立して蓄積され、<strong>片方だけが得をする構造にはなりません</strong>。',
	k48: `<strong>${PLAN_FULL_TERMS.free}</strong>: お子さま 2 人まで登録可能（招待機能なし、ご本人の端末のみ）`,
	k49: `<strong>${PLAN_FULL_TERMS.standard}</strong>: お子さま無制限で登録可能・ご家族は<strong>合計${FAMILY_MEMBER_LIMIT_TERMS.standardTotalSpaced}まで</strong>（オーナーを含むため、招待できるのは${FAMILY_MEMBER_LIMIT_TERMS.standardInvitesSpaced}まで。核家族でのご利用想定）`,
	k50: `<strong>${PLAN_FULL_TERMS.premium}</strong>: お子さま無制限で登録可能・家族メンバー招待は <strong>無制限</strong>（祖父母・おじおばなど拡張家族でのご利用想定）`,
	k51: `きょうだいランキング機能（${PLAN_FULL_TERMS.premium}）は「今週どれだけがんばったか」を並べるものです。ポイント・レベルはお子さまごとに独立しているため、順位が下でも積み上げた記録が減ることはありません。`,
	k52: '支払い方法は何が使えますか？',
	k53: 'クレジットカード（Visa / Mastercard / JCB / American Express）に対応しています。Stripe による安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。',
	k54: 'プランを途中で解約した場合の返金は？',
	k55: '途中解約された場合も、お支払い済みの残り期間は引き続きご利用いただけます（プレミアム機能は期間満了まで有効）。',
	k56: '日割りでの返金は行っておりません。詳細は <a href="tokushoho.html">特定商取引法に基づく表記</a> をご確認ください。',
	k57: `プランの変更（${PLAN_TERMS.standard}↔${PLAN_TERMS.premium}）はできますか？`,
	k58: `はい。${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」からお手続きいただけます。`,
	k59: 'アップグレード時は即座に反映され、ダウングレード時は次回更新日から新プランが適用されます。ご不明な点はお問い合わせください。',
	k60: '<span class="faq-category-num">3</span>プライバシー・データについて',
	k61: 'お子さまのデータの取り扱いと、サービス終了時の保証について。',
	k62: 'お子さまのデータが広告に使われることはありませんか？',
	k63: '<strong>ありません。</strong>広告配信自体を一切行っておらず、お子さまの行動データを第三者に提供することもありません。',
	k64: 'データは「お子さまの成長を家族内で共有する」目的のみに使用されます。詳細は <a href="privacy.html">プライバシーポリシー</a> をご参照ください。',
	k65: 'データのエクスポート（書き出し）はできますか？',
	k66: `はい。<strong>${PLAN_FULL_TERMS.standard}以上</strong>で、${ADMIN_VIEW_TERMS.canonical}から家族のデータを${BACKUP_TERMS.file}としてエクスポートできます。`,
	// #1815: 「シール、称号、」を削除（export-service.ts に実装がなく ADR-0013 LP truth 違反のため）
	k67: 'エクスポート対象: お子さま情報、活動、ポイント履歴、チェックリスト。',
	k68: 'お引越しや他のサービスへの移行、ご自身でのバックアップにご利用いただけます。',
	k69: 'サービスが終了したらデータはどうなりますか？',
	k70: 'サービス終了時は、<strong>30 日以上前までに</strong>登録メールアドレスへお知らせし、その間にデータのエクスポートが可能です。',
	k71: '通知: 終了日の 30 日以上前にメールでお知らせ',
	k72: 'エクスポート期間: 通知から終了日まで継続',
	k73: '終了後: すべてのデータを完全削除',
	// #4510: 第 14 条は「卒業」。サービス終了は第 15 条
	k74: '詳しくは <a href="terms.html">利用規約</a> 第 15 条をご覧ください。',
	k75: `${CANCEL_TERMS.account}・アカウント削除はすぐにできますか？`,
	// #4496: 旧文言は猶予を一律「申請後 30 日間」と述べていたが、猶予はプラン別 (無料は 0 日 =
	//   申請と同時に物理削除)。無料プランの顧客が「30 日間は取り消せる」と誤認したまま退会すると
	//   データが全損する。日数は DELETION_GRACE_TERMS (値 SSOT = deletion-grace.ts) から引く。
	k76: `${ADMIN_VIEW_TERMS.canonical}から${CANCEL_TERMS.account}（アカウント削除）を申請できます。猶予期間はご利用プランによって異なります（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）。`,
	k77: `${PLAN_FULL_TERMS.free}は申請と同時に削除されるため、取り消しもエクスポートもできません。有料プランは猶予期間中に申請の取り消しとデータのエクスポートができます。猶予期間の経過後、全データは完全に削除されます（復旧はできません）。`,
	k78: 'データはどこに保存されていますか？',
	// #4944: リンク先の条番号が誤っていた。privacy.html の第 8 条は「外部送信規律 公表」で、
	// 国外移転は第 10 条（外国にある第三者への提供）。不安になった読み手が踏むと別条に着地していた。
	k79: 'AWS 米国バージニア北部リージョン（us-east-1）のデータベースに暗号化して保存しています。AWS DPA および標準契約条項（SCC）に基づき、改正個人情報保護法第 28 条に整合する形で適切に管理しています。詳細は<a href="privacy.html#cross-border-transfer">プライバシーポリシー</a>第10条（外国にある第三者への提供）をご覧ください。',
	k80: '決済情報は Stripe（国際的な PCI DSS 準拠の決済プロバイダ）で管理されており、当サービスのサーバーにはカード番号等の秘匿情報を保持していません。',
	k81: '<span class="faq-category-num">4</span>対応年齢・使い方について',
	k82: '0〜18 歳までの年齢モードと、日々の運用のしかたについて。',
	k83: '何歳から何歳まで使えますか？',
	k84: '0 〜 18 歳まで、5 つの年齢モードをご用意しています:',
	k85: '<strong>乳幼児（0-2 歳）</strong>: 保護者の準備モード。記録と振り返り中心',
	k86: '<strong>幼児（3-5 歳）</strong>: ひらがな・大きなボタン・シンプルな色使い',
	k87: '<strong>小学生（6-12 歳）</strong>: 標準モード。漢字・情報密度を保ちつつ、ポイント・レベル称号・チャレンジで「自分から動く力」を育てます',
	k88: '<strong>中学生（13-15 歳）</strong>: 情報密度やや高め、漢字あり',
	k89: '<strong>高校生（16-18 歳）</strong>: 大人に近い UI、自己管理中心',
	k90: `お子さまが成長したら、${ADMIN_VIEW_TERMS.canonical}から年齢モードを切り替えるだけで UI が自動で変わります。`,
	k91: 'お子さまが成長して年齢モードが変わる時、データはどうなりますか？',
	k92: '年齢モードを切り替えても、<strong>ポイント・シール・レベル称号・履歴はすべて引き継がれます</strong>。見た目（UI）だけが切り替わる設計です。',
	k93: '例: 幼児モードで貯めた「ドラゴン」シールは、小学生モードに切り替えても同じコレクションに残ります。連続ログイン日数・レベルも継続します。',
	k94: '親が毎日設定する手間はどれくらいかかりますか？',
	k95: '初回セットアップ（5 分）と、日々の運用（1 日 30 秒〜）で回せるよう設計されています。',
	// #1912 (F-12): FAQ 本文「年齢に応じたプリセット活動を選ぶ」→
	//   「年齢に応じた、あらかじめ用意された活動を選ぶ」へ顧客語彙化（IT 用語「テンプレート」も含めて精査）。
	// #2057 (UIUX-F-13): 「管理画面」→ ${ADMIN_VIEW_TERMS.canonical} 経由化
	k96: `<strong>初日</strong>: ${SIGNUP_TERMS.canonical} → ${CHILD_TERMS.honorific}登録 → 年齢に応じた、あらかじめ用意された活動を選ぶ（${PRESET_ACTIVITY_TERMS.packCount}・${PRESET_ACTIVITY_TERMS.uniqueCount}の中から）`,
	k97: `<strong>毎日</strong>: お子さまが自分で活動を記録 → 保護者は${ADMIN_VIEW_TERMS.canonical}で結果を確認（所要時間 30 秒〜）`,
	k98: '<strong>週 1 回</strong>: レベルアップ・チャレンジ達成を家族で共有（お楽しみタイム）',
	k99: '親が毎日新しい活動を作る必要はありません。プリセットをそのまま使うか、年齢が変わった時にテンプレートを切り替えるだけで運用できます。',
	k100: 'スクリーンタイムが長くなる心配はありませんか？',
	k101: '「長く遊ばせる」設計にしていません。本サービスは「活動記録アプリ」であり、お子さまがアプリ内で過ごす時間は 1 回 1 〜 3 分が想定です。',
	k102: '活動記録 → ポイント獲得 → スタンプ獲得 → 結果確認で完了（1 〜 3 分）',
	k103: '動画視聴・無限スクロール・配信コンテンツは一切なし',
	// #4713: 実装は「15 分連続で使うと /switch へ戻る (無操作 1 分でカウントがリセット)」。
	k104: `${AUTO_SLEEP_TERMS.activeDuration}つづけて使うと自動で${AUTO_SLEEP_TERMS.returnScreen}に戻る使いすぎ防止タイマーで、長時間の滞在を防止 (${AUTO_SLEEP_TERMS.inactiveReset}操作がなければ計測はリセット)`,
	k105: '「スクリーンタイムを奪うのではなく、リアルの行動を促す」動機付けツールとしてお使いください。',
	k106: '祖父母や親戚も使えますか？',
	// #4500: 招待できる人数 (owner の 1 枠を除く) と合計上限を区別する。
	k107: `<strong>${PLAN_FULL_TERMS.premium}</strong>では、保護者側のメンバーを<strong>無制限</strong>に招待できます。祖父母・おじおば・離れて暮らす親御さまなどが、同じお子さまの成長を見守れます（${PLAN_FULL_TERMS.standard}はご家族合計${FAMILY_MEMBER_LIMIT_TERMS.standardTotalSpaced}まで＝オーナーを含むため招待は${FAMILY_MEMBER_LIMIT_TERMS.standardInvitesSpaced}までです）。`,
	// #4713: 招待ロールは 保護者 / こども の 2 択で「閲覧権限」ロールは存在しない。
	//   読み取り専用の共有は premium の閲覧リンク (別機能)。文面は #4500 の直近決定を採り、
	//   「閲覧リンク」だけ VIEWER_LINK_TERMS atom 経由に寄せる (値は同一)。
	k108: `招待されたメンバーは${PARENT_TERMS.honorific}として、${CHILD_TERMS.honorific}の記録の確認と活動の記録ができます（アカウントを持たずに記録を見せたい場合は、${PLAN_FULL_TERMS.premium}の${VIEWER_LINK_TERMS.name}をお使いください。閲覧専用です）。`,
	k109: '<span class="faq-category-num">5</span>技術的なご質問',
	k110: 'デバイス・ブラウザ対応と、ソースコードの公開について。',
	k111: 'スマホ・タブレット・PC、何台まで使えますか？',
	k112: 'デバイス数の制限はありません。Web ブラウザ（Chrome / Safari / Edge など）があれば、どのデバイスからでもログインしてお使いいただけます。',
	k113: 'PWA（Progressive Web App）としてホーム画面にも追加できます。iOS / Android どちらもサポートしています。',
	k114: 'オフラインでも使えますか？',
	k115: `記録には通信が必要です。オフラインでも、直前に開いた画面の表示はキャッシュから復元されますが、<strong>記録の保存はできません</strong>（電波が戻ってからお試しください）。新規${SIGNUP_TERMS.canonical}・決済も通信が必要です。`,
	k116: '旅行中や電波の弱い場所では記録の保存ができません。電波の届く場所に戻ってから記録してください。',
	k117: 'ソースコードは公開されていますか？',
	k118: 'はい。本サービスのアプリ部分は GitHub で <a href="https://github.com/Takenori-Kusaka/ganbari-quest">ソースコードを公開</a> しています。技術に詳しい方はご自宅のパソコンで同じアプリを動かすこともできます（<a href="selfhost.html">自前運用ガイド</a>）。',
	k119: 'これは「運営が終了してもアプリ自体は残り続ける」安心のための仕組みです。通常のご家庭はクラウド版をそのままお使いいただければ十分です。',
	k120: 'ほかにご質問はありますか？',
	// #4709: 同上。
	k121: `上記にないご質問や、ご要望・フィードバックは、メールでお気軽にお寄せください。初回のご返信は${SUPPORT_RESPONSE_TERMS.initialResponseTarget}を目標としています。`,
	k122: `${FREE_TERMS.tryFree}`,
	k123: 'デモを見る',
	// #4619: 解約 FAQ (k18-k22) の 3 番目の箇条書き。無料プランの上限を超えるリソースは
	//   削除ではなく archive され (resource-archive-service.archiveExcessResources)、
	//   有料プランへ戻すと復元される (restoreArchivedResources)。
	//   **どれを残すか「選べる」とは書かない** — 選択導線は #4585 で実装中であり、
	//   実装前の機能を顧客提示物に書かない (ADR-0013 LP truth)。
	//   本 key だけ末尾採番なのは、既存 k20-k123 の番号を動かすと全 LP HTML の
	//   data-lp-key を張り替えることになるため (番号は識別子であり順序ではない)。
	k124: `${PLAN_FULL_TERMS.free}の上限を超えるお子さま・活動・チェックリストは保管された状態になり、有料プランに戻すと元どおりご利用いただけます`,
} as const;

// #1956 (Phase 3 D11) + #1944 (Phase 3 D4) 統合:
//   terms.ts atom 参照化対象（PLAN_TERMS / PLAN_FULL_TERMS / FREE_TERMS / TRIAL_TERMS）。
//   char-by-char 一致厳守。
//   - #1956 D11: PLAN_TERMS.standard / PLAN_FULL_TERMS.premium / FREE_TERMS.start を atom 化。
//   - #1944 D4: '7 日間' (半角空白入り) を TRIAL_TERMS.durationSpaced 独立 atom として追加し、
//               k39 / k49 / k67 の 3 キー（計 4 occurrence、7 日間 x3 + ファミリープラン x1）を atom 化。
//               k47 'ファミリー' (短縮形) は PLAN_TERMS.premium と char-by-char 一致するが、
//               pamphlet.html プラン比較表ヘッダの短縮ラベルとして「ファミリー」表記設計のため別 Issue 扱い。
//   - 直書き継続: '&#xA5;500' / '&#xA5;780' (HTML エンティティ) は PRICE_TERMS.standard / family
//                 ('¥500' / '¥780', U+00A5) と char-by-char 一致しないため直書き継続（#2007 と同方針）。
export const LP_PAMPHLET_PHASEB_LABELS = {
	k1: 'がんばりクエスト パンフレット',
	k2: '&#x1F5A8; 印刷 / PDF保存',
	k3: 'ブラウザの「印刷」からPDFとして保存できます。用紙サイズはA4を選択してください。',
	k4: 'がんばりクエスト',
	k5: 'こどもの がんばりを ぼうけんに',
	k6: '「やりなさい」を',
	k7: '<span>「やりたい！」</span>に変える',
	k8: 'お子さまの毎日のがんばりをRPG風の冒険に変えて、',
	k9: 'ポイント、レベルアップ、チャレンジで',
	k10: '「自分から動く力」を育てる家庭向けWebアプリです。',
	k11: '&#x2728; 3 つの仕組みで、毎日のがんばりが本物の報酬になる',
	k12: '<span class="fi-layer-badge">活動</span> 毎日の活動 &#x2192; ポイント',
	// #1912 (F-12): pamphletB 本文「プリセット活動がそのまま使える」→
	//   「あらかじめ用意された活動がそのまま使える」へ顧客語彙化。
	k13: `「はみがきした」「宿題おわった」をタップするだけ。あらかじめ用意された ${PRESET_ACTIVITY_TERMS.uniqueCount}の活動がそのまま使えるので設定は最小限。記録のたびにポイントが積み上がります。`,
	k14: '<span class="fi-layer-badge">習慣</span> おみくじスタンプ &#x2192; 習慣',
	k15: '1 日 1 回までのおみくじスタンプ。週 5 日タップで 1 枚分のポイントに自動交換できます。三日坊主を防ぐ「毎日記録する習慣」を作ります。',
	k16: '<span class="fi-layer-badge">ごほうび</span> ごほうびショップ &#x2192; 交換',
	k17: '&#x1F308; 3歳から18歳まで — 2つの UI モード',
	k18: '&#x1F476; 0〜2歳のお子さまは「準備モード」でご登録いただけます',
	k19: '小学生以上',
	k20: '6&#x301C;18歳',
	// #1956 (Phase 3 D11): 'まずは無料' = FREE_TERMS.start 部分参照化
	k21: `&#x1F3AE; ${FREE_TERMS.start}で始めよう！`,
	k22: '登録は1分。お子さまの名前と年齢を入れるだけで、今日から冒険が始まります。',
	k23: '&#x1F310; アクセスはこちら',
	k24: 'がんばりクエスト &#x2014; &#x6599;&#x91D1;&#x30D7;&#x30E9;&#x30F3; &amp; &#x59CB;&#x3081;&#x65B9;',
	k25: '&#x1F4B0; 料金プラン',
	k26: 'すべてのプランで冒険の仕組み（レベル・おみくじ・スタンプカード等）が使えます',
	// #1913 (UIUX-E-7): k27 = FREE_PLAN_TERMS.planSelfNoun, k28 「ずっと無料」→「永久無料」(FREE_PLAN_TERMS.forever) で
	//                   AC8 統一（pamphlet pricing card 同パターン）。
	k27: `${FREE_PLAN_TERMS.planSelfNoun}`,
	k28: `${FREE_PLAN_TERMS.forever}`,
	k29: '<span class="check">&#x2713;</span>お子さまの登録：2人まで',
	k30: '<span class="check">&#x2713;</span>プリセット活動の利用',
	k31: '<span class="check">&#x2713;</span>オリジナル活動の作成：3個まで',
	k32: '<span class="check">&#x2713;</span>レベル・ポイント・おみくじ・スタンプカード',
	// #1912 (F-6): 「ログインボーナス・連続達成ボーナス」→「毎日のごほうび・続けるごほうび」へ日本語化
	k33: '<span class="check">&#x2713;</span>毎日のごほうび・続けるごほうび',
	// #1710 R3-C: 旧「持ち物／毎日習慣」統合表現を「持ち物チェックリスト」に純化
	// #4866 系 QM 監査 (consistency) / PO 差し戻し 2026-09-09: LP pricing だけが
	// 「（取込を含む）」に直り、パンフとアプリ内 /pricing が旧文言のまま残っていた。
	// 取込んだチェックリストも同じ 3 個/子の枠を消費する (#4713) ので、
	// **枠の数え方を面によって違う言い方にしない**。
	k34: '<span class="check">&#x2713;</span>持ち物チェックリスト 3個/子まで（取込を含む）',
	k35: `<span class="check">&#x2713;</span>${PLAN_RETENTION_TERMS.free}間の履歴保持`,
	k36: '&#x2B50; おすすめ',
	// #1956 (Phase 3 D11): 'スタンダード' = PLAN_TERMS.standard 参照化。
	// #1913 (UIUX-E-5): k38 を「&#xA5;500」HTML エンティティから「¥500」(PRICE_TERMS.standard) に統一。
	//   AC7 = `&#xA5;` HTML entity が 0 件、「¥」直書き統一。表示文字は同一 (U+00A5) で UI 影響ゼロ。
	k37: `${PLAN_TERMS.standard}`,
	k38: `${PRICE_TERMS.standard}<small>/月（税込）</small>`,
	// #1944 Phase 3 D4: '7 日間' を TRIAL_TERMS.durationSpaced 参照化。
	k39: `${TRIAL_TERMS.durationSpaced}無料トライアル`,
	k40: '<span class="check">&#x2713;</span>子供の登録：無制限',
	k41: '<span class="check">&#x2713;</span>オリジナル活動：無制限',
	k42: `<span class="check">&#x2713;</span>家族メンバー招待：${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで（オーナーを含めご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}）`,
	// #4928: 有料で増えるのはオリジナルの登録 (プリセットは全プラン可)
	// #4992: 編集 (ポイントの調整を含む) も有料側の機能
	k43: `<span class="check">&#x2713;</span>${CUSTOM_REWARD_FEATURE_NAME}`,
	k44: '<span class="check">&#x2713;</span>データのダウンロード',
	k45: `<span class="check">&#x2713;</span>${PLAN_RETENTION_TERMS.standard}間の履歴保持`,
	k46: '<span class="check">&#x2713;</span>メールサポート',
	// #1956 (Phase 3 D11): 'ファミリー' = PLAN_TERMS.premium、
	//   'スタンダードの全機能' = PLAN_TERMS.standard + 'の全機能' 部分参照化。
	// #1913 (UIUX-E-5): k48 を「&#xA5;780」HTML エンティティから「¥780」(PRICE_TERMS.family) に統一。
	//   AC7 = `&#xA5;` HTML entity が 0 件、「¥」直書き統一。表示文字は同一 (U+00A5) で UI 影響ゼロ。
	k47: `${PLAN_TERMS.premium}`,
	k48: `${PRICE_TERMS.family}<small>/月（税込）</small>`,
	// #1944 Phase 3 D4: '7 日間' を TRIAL_TERMS.durationSpaced 参照化。
	// #1956 Phase 3 D11: 'スタンダード' を PLAN_TERMS.standard 参照化。
	k49: `${TRIAL_TERMS.durationSpaced}無料トライアル`,
	k50: `<span class="check">&#x2713;</span>${PLAN_TERMS.standard}の全機能`,
	k51: '<span class="check">&#x2713;</span>家族メンバー招待：無制限',
	k52: '<span class="check">&#x2713;</span>AI 自動提案（活動・ごほうび・チェックリスト）',
	k53: '<span class="check">&#x2713;</span>きょうだいランキング',
	k54: '<span class="check">&#x2713;</span>ひとことメッセージ（自由テキスト）',
	k55: '<span class="check">&#x2713;</span>家族のデータ預かり枠（同時保管 10 件・自分でダウンロード可）',
	k56: '<span class="check">&#x2713;</span>無制限の履歴保持',
	k57: '<span class="check">&#x2713;</span>メールサポート',
	k58: '&#x1F680; かんたん3ステップで始められます',
	k59: 'アカウント登録（無料）',
	k60: 'メールまたはGoogleアカウントで。1分で完了します。',
	k61: 'お子さまの年齢を設定',
	k62: '年齢に合わせた活動が自動でセットアップ。',
	k63: '冒険スタート！',
	k64: '活動を記録するたびにポイント獲得 &amp; レベルアップ！',
	// #1896 (PO-4-10): 旧 k65: '&#x2753; よくある質問' を LP_FAQ_TERMS.canonicalLong 参照化
	//   ('&#x2753; よくあるご質問' に統一)。本 namespace は pamphlet.html Phase B FAQ 見出し。
	k65: `&#x2753; ${LP_FAQ_TERMS.canonicalLong}`,
	k66: '料金はかかりますか？',
	// #1956 (Phase 3 D11) + #1944 (Phase 3 D4) 統合:
	//   'スタンダード' = PLAN_TERMS.standard / 'ファミリープラン' = PLAN_FULL_TERMS.premium /
	//   '7 日間' = TRIAL_TERMS.durationSpaced（D4 で独立 atom 追加済）。
	k67: `基本機能は無料でずっとお使いいただけます。有料プランはより多くのお子さまの登録や高度な分析機能が必要な場合にご検討ください。${PLAN_TERMS.standard}・${PLAN_FULL_TERMS.premium}は ${TRIAL_TERMS.durationSpaced}無料トライアル付きです。`,
	k68: '何歳から使えますか？',
	k69: '3歳から18歳までのお子さま向けに設計しています。3歳からはお子さま自身がタップして記録、年齢に合わせて画面が自動で変わるので、きょうだいでも安心です。0〜2歳のお子さまは「準備モード」（保護者が記録するモード）で記録のみご利用いただけます（お子さま向けゲーミフィケーションは適用されません）。',
	k70: '子供のデータは安全ですか？',
	k71: 'はい。通信は常に暗号化し、データはお預かり時にも保護した状態で保管しています。お子さまの本名は不要で、ニックネームでご利用いただけます。データの第三者への販売・共有は一切行いません。',
	k72: '有料プランへの切り替えはどうしますか？',
	k73: `${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」からアップグレードしていただくと、その場で有料機能が有効になります。クレジットカード（Visa / Mastercard / JCB / American Express）に対応し、Stripe による安全な決済処理を使用しています。詳しくは <a href="https://www.ganbari-quest.com/pricing.html">料金プラン</a> をご覧ください。`,
	k74: '&#x2694;&#xFE0F; がんばりクエスト',
	k75: 'お子さまの「がんばり」を冒険に変える家庭向けWebアプリ',
	k76: 'お問い合わせ・コミュニティ',
	k77: '&#x2709;&#xFE0F; メール: ganbari.quest.support@gmail.com',
	k78: '&copy; 2026 がんばりクエスト（運営: 日下武紀／個人事業主）. All rights reserved.',
	k79: '利用規約',
	k80: 'プライバシーポリシー',
	k81: '特定商取引法に基づく表記',
	k82: 'お問い合わせ',
} as const;

// ============================================================
// LP /site/privacy.html SSOT (#1703 / #1683-C / ADR-0009 supersede / ADR-0025)
//
// 法的文書 (privacy.html) を data-lp-key 経由で SSOT 化。
// section 単位（h1 + intro + 13 sections + effective）でキー化し、
// applyLpKeys() の innerHTML + DOMPurify sanitize 経路で nested HTML
// (h2 / ol / li / strong / a / div.highlight 等) を保持して注入する。
//
// 命名規則: legalPrivacy.<key>
//   - articleHeader: h1 + meta（最終更新日）
//   - intro: 冒頭のリード文
//   - section1〜section13: 各条文
//   - section6_2: 第6条の2（卒業フローと事例公開承諾）
//   - effective: 末尾の制定日 / 最終改定日
// ============================================================
export const LP_LEGAL_PRIVACY_LABELS = {
	articleHeader: '<h1>プライバシーポリシー</h1><p class="meta">最終更新日: 2026年9月12日</p>',
	intro:
		'個人開発者である日下武紀（以下「運営者」）は、Webアプリケーション「がんばりクエスト」（以下「本サービス」）における利用者の個人情報の取扱いについて、個人情報の保護に関する法律（以下「個人情報保護法」）その他関連法令に基づき、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。本サービスは家庭内でお子さまが利用することを想定しており、お子さまの個人情報の保護には特に配慮しています。',
	// #4844 follow-up (PO 決定 2026-09-04): 旧文は 3 箇所とも「これらの情報はご契約期間中保存されます」
	// と述べていたが、履歴 (活動記録 / ポイント台帳 / ステータス履歴) は `retention-cleanup-service` が
	// **契約中でも**プラン別の保持期間で物理削除する (スタンダードプランなら 1 年より古い記録は消える)。
	// アカウント情報 / お子さまの情報は逆に保持期間の対象外で、アカウント削除まで残る。
	// 3 箇所を同じ文で書いていたため、両方向に事実と食い違っていた。
	// 日数は利用規約 第7条7項 と同じ atom (PLAN_RETENTION_TERMS) 経由で述べ、直書きしない。
	section1: `<h2>第1条（収集する情報）</h2><p>運営者は、本サービスの提供にあたり、以下の情報を収集します。</p><h3>1. アカウント情報</h3><p>認証および通知のためにメールアドレスを収集します。サービス内で表示する表示名をお預かりします。パスワードは不可逆のハッシュ化処理を施した状態で保存されます。これらの情報は、アカウントが存在するあいだ保存され、アカウント削除のお手続き後、利用規約第13条に定める猶予期間の経過をもって削除されます。</p><h3>2. お子さまの情報</h3><p>サービス内表示のためにニックネーム、年齢区分（表示の最適化に使用）、表示設定（テーマ・UIモード等）をお預かりします。また、お誕生日のお祝い機能のために生年月日を任意でご登録いただけます。これらの情報は、アカウントが存在するあいだ保存され、アカウント削除のお手続き後、利用規約第13条に定める猶予期間の経過をもって削除されます。</p><div class="highlight"><strong>お子さまの個人情報保護について</strong><ul><li>お子さまの本名の入力は必須ではありません。ニックネームでご利用いただけます。</li><li>お子さまが直接個人情報を入力する機能はありません。全ての登録は保護者が行います。</li><li>学校名、住所等の個人を特定できる情報は収集しません。生年月日は任意登録であり、お誕生日のお祝い機能にのみ使用します。</li></ul></div><h3>3. 活動データ</h3><p>サービス機能を提供するために、活動記録（ポイント、レベル等）、チャレンジ、チェックリスト記録をお預かりします。これらの情報は、ご利用中のプランに応じた履歴保持期間（${PLAN_FULL_TERMS.free}: ${PLAN_RETENTION_TERMS.free}間 / ${PLAN_FULL_TERMS.standard}: ${PLAN_RETENTION_TERMS.standard}間 / ${PLAN_FULL_TERMS.premium}: 無期限）のあいだ保存し、保持期間を超えた記録は順次削除します。削除された記録は復元できません（再度有料プランにご加入いただいた場合も戻りません）。詳細は利用規約第7条に定めます。</p><h3>4. 利用ログ</h3><p>セキュリティの確保および不正アクセス防止のために、アクセス日時、IPアドレス、アクセス先のURL、デバイス情報（ブラウザ種別等）を収集します。アクセスログは3日間保存した後、運営者が管理するAWS環境内のストレージへアーカイブして長期保存します。配信基盤（CDN）のアクセスログは同じ環境内に3日間のみ保存し、自動削除します。セキュリティインシデント調査に必要な場合は、当該ログを調査完了まで保持することがあります。</p><h3>5. 決済情報</h3><p>クレジットカード番号等の決済情報は、運営者のサーバーには保存されません。決済処理は全て外部の決済サービス（Stripe）を通じて行われ、当該サービスのプライバシーポリシーが適用されます。</p>`,
	section2:
		'<h2>第2条（情報の利用目的）</h2><p>運営者は、収集した情報を以下の目的で利用します。</p><ol><li>本サービスの提供・運営・維持</li><li>利用者の認証・本人確認</li><li>サービスの改善・新機能の開発</li><li>利用状況の分析・統計処理（個人を特定しない形式）</li><li>重要なお知らせ・サービス変更の通知</li><li>不正利用の防止・セキュリティの確保</li><li>利用者からの問い合わせへの対応</li></ol>',
	section3:
		'<h2>第3条（情報の第三者提供）</h2><p>本条に記載する外部サービスのうち、外国にある第三者に該当するもの（AWS / Stripe / Google、いずれも米国）への提供については、移転先の国名・当該国の個人情報の保護に関する制度・移転先が講ずる措置を<a href="#cross-border-transfer">第10条</a>に記載しています。お申し込み時（またはログイン後の同意画面）に、第10条の内容をご確認のうえ同意をいただきます。</p><ol><li>運営者は、以下の場合を除き、利用者の個人情報を第三者に提供しません。<ul><li>利用者の同意がある場合</li><li>法令に基づく場合</li><li>人の生命、身体または財産の保護のために必要がある場合であって、利用者の同意を得ることが困難な場合</li></ul></li><li>運営者は、サービス提供のために以下の外部サービスを利用しています。各サービスは、それぞれのプライバシーポリシーに基づきデータを取り扱います。<ul><li><strong>Amazon Web Services (AWS)</strong> — サーバーインフラ（アプリケーションの実行・データの保存）、認証基盤、メール送信。データは原則としてバージニア北部リージョン（us-east-1）に保存されます。<br>プライバシーポリシー: <a href="https://aws.amazon.com/jp/privacy/" target="_blank" rel="noopener">https://aws.amazon.com/jp/privacy/</a></li><li><strong>Google LLC</strong> — OAuth認証（Googleアカウントによるログイン）。認証時にメールアドレスおよび表示名を取得します。<br>プライバシーポリシー: <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">https://policies.google.com/privacy</a></li><li><strong>Stripe, Inc.</strong> — 決済処理（クレジットカード情報の安全な取扱い）。決済情報はStripeのサーバー（米国）で処理されます。<br>プライバシーポリシー: <a href="https://stripe.com/jp/privacy" target="_blank" rel="noopener">https://stripe.com/jp/privacy</a></li><li><strong>Discord Inc.</strong> — 運用監視通知（個人を特定できない形式のイベント情報の送信）<br>プライバシーポリシー: <a href="https://discord.com/privacy" target="_blank" rel="noopener">https://discord.com/privacy</a></li><li><strong>Amazon Web Services (AWS)</strong> — 生成 AI（AI 提案（活動・ごほうび・チェックリスト）のテキスト補助、および領収書画像の読み取り）。運営者が管理する AWS 環境内で処理され、AWS 以外の第三者には送信されません。利用者識別子（家族内一意 ID）を含まないリクエストのみ送信します。推論は米国内の複数リージョン（us-east-1 / us-east-2 / us-west-2）で処理される場合がありますが、いずれも運営者が管理する AWS 環境内であり、データの保存先は us-east-1 のままです。<br>プライバシーポリシー: <a href="https://aws.amazon.com/jp/privacy/" target="_blank" rel="noopener">https://aws.amazon.com/jp/privacy/</a></li></ul></li></ol>',
	section4:
		'<h2>第4条（データの安全管理）</h2><p>運営者は、個人情報への不正アクセス、紛失、破壊、改ざん、漏洩の防止のため、以下の安全管理措置を講じています。</p><ul><li>通信は全て TLS 1.2 以上で暗号化されます。</li><li>保存データは AES-256 で暗号化されます。</li><li>パスワードは不可逆のハッシュ化処理を施して保存されます。</li><li>データベースは定期的に自動バックアップされます。</li></ul>',
	section5:
		'<h2>第5条（利用者の権利）</h2><p>利用者は、自己の個人情報について、以下の権利を有します。</p><ol><li><strong>開示請求</strong> — 運営者が保有する自己の個人情報の開示を請求できます。</li><li><strong>訂正請求</strong> — 個人情報の内容が事実でない場合、訂正を請求できます。</li><li><strong>削除請求</strong> — 個人情報の削除を請求できます。</li><li><strong>利用停止請求</strong> — 個人情報の利用停止を請求できます。</li></ol><p>上記の請求は、本サービスの設定画面から行うか、下記のお問い合わせ先までご連絡ください。</p>',
	// #1948 Phase 4 E1: PLAN 名 / トライアル期間 atom を terms.ts 参照に統一
	// （文字列差分ゼロ維持、法的文書 char-by-char 一致厳守）
	section6: `<h2>第6条（データの削除）</h2><ol><li><strong>個別データの削除</strong>: 特定の活動記録やお子さまの情報の削除は、本サービスの${ADMIN_VIEW_TERMS.canonical}から即時実行できます。</li><li><strong>アカウント全体の削除</strong>: アカウント削除を申請後、ご利用プランに応じた猶予期間を設けます（${PLAN_FULL_TERMS.free}: 即時削除 / ${PLAN_FULL_TERMS.standard}: ${TRIAL_TERMS.duration} / ${PLAN_FULL_TERMS.premium}: 30日間）。猶予期間中は削除の取消しが可能です。</li><li><strong>バックアップからの完全消去</strong>: アカウント削除後90日以内に、バックアップデータからも完全に消去されます。</li></ol>`,
	section6_2:
		'<h2>第6条の2（卒業フローと事例公開承諾）</h2><p>本サービスは「お子さまが自律して使う必要がなくなった」ことを「卒業」と定義し、ポジティブな解約として扱います。卒業選択時に表示される専用ページで、ご家庭が任意で「事例として公開してもよい」旨を承諾された場合、以下の情報を保管します。</p><ol><li><strong>保管する情報</strong>: ご家庭が任意指定したニックネーム（実名禁止）、卒業時点の残ポイント数、ご利用期間（日数）、任意の卒業メッセージ。</li><li><strong>利用目的</strong>: サービス紹介ページ等での事例として公開し、他のご家庭の参考となる卒業ストーリーの提示に活用します。</li><li><strong>公開時の取り扱い</strong>: 実名は使用せず、お預かりしたニックネームのみを表示します。お子さまが特定されない形でのみ公開します。</li><li><strong>承諾の撤回</strong>: 公開承諾の撤回は、サービス問い合わせ窓口からご連絡いただくことで対応します。撤回後は当該事例を 30 日以内に非公開化します。</li><li><strong>承諾なしの場合</strong>: 公開を承諾されない場合も「卒業者数」「平均利用期間」等の集計値（個人を特定しない形式）には含まれます。</li></ol>',
	section7:
		'<h2>第7条（Cookieの使用）</h2><p>本サービスは、認証状態の維持および利用者の設定の保持のためにCookieを使用します。使用するCookieは機能に必須のもののみであり、広告目的のトラッキングCookieは使用しません。</p><ul><li><strong>認証Cookie</strong> — ログイン状態の維持（セッション終了時またはTTL経過時に削除）</li><li><strong>コンテキストCookie</strong> — 利用者のロール・テナント情報（セッション中のみ）</li><li><strong>利用設定Cookie</strong> — 前回選択されたお子さまのプロフィール（<code>selectedChildId</code>）。次回アクセス時に同じプロフィールを表示するため、最長1年間ブラウザに保持されます。プロフィールを選び直すと上書きされます。</li><li><strong>保護者確認Cookie</strong> — 保護者確認（おやカギ）の通過状態を保持するCookie（<code>gq_parent_session</code>、最長24時間。お子さまのプロフィールへ切り替えた時点でも削除されます）</li><li><strong>セキュリティCookie</strong> — 認証フロー中のみ使用されるCookie（フロー完了後に自動削除）<ul><li><code>oauth_state</code> — OAuth認証時のCSRF防止トークン</li><li><code>oauth_nonce</code> — OAuth認証時のリプレイ攻撃防止トークン</li><li><code>oauth_next</code> — OAuth認証後の戻り先ページの一時保持（認証完了後に削除）</li><li><code>oauth_plan</code> — ご登録時に選ばれたプランの一時保持（10分間）</li><li><code>pin_reset_otp</code> — PIN再設定の確認コードの一時保持（10分間）</li></ul></li><li><strong>招待Cookie</strong> — 招待リンク経由のアクセス時に招待コードを一時保持（招待受理後に削除）</li><li><strong>サービス提供・表示制御のためのCookie</strong> — 認証にも招待にも属さず、表示や案内の出し分けのために置くCookieです。<ul><li><code>trial_was_active</code> — 無料体験が終了したことを一度だけお知らせするための記録（最長30日間）</li><li><code>demo_plan</code> — デモ体験版で選ばれたプランの保持（デモ体験版のみ、最長30日間）</li></ul></li></ul><p>ブラウザの設定によりCookieを無効にすることができますが、本サービスの一部機能が利用できなくなる場合があります。</p>',
	section8:
		'<h2>第8条（外部送信規律 公表）</h2><p>電気通信事業法第27条の12に基づき、本サービスがサービス提供のために外部に送信する情報を公表します。<strong>お預かりしたデータを第三者へ提供したり、広告に利用したりすることはありません。</strong></p><p>運営者は、電気通信事業法第27条の12（外部送信規律）に基づき、利用者の端末から外部の第三者に送信される情報について、以下のとおり公表します。</p><ol><li><strong>送信される情報</strong>: ページ URL、リファラ、訪問時刻、画面解像度、ブラウザ言語、ユーザーエージェント等の通信ヘッダ情報。加えて、AI 提案をご利用いただいた場合はその入力内容（活動・ごほうび・チェックリストのテキスト）、領収書の読み取りをご利用いただいた場合は選択された領収書画像を送信します（いずれも利用者識別子を含みません）。</li><li><strong>送信先</strong>:<ul><li>Amazon Web Services, Inc.（運営者が管理する AWS 環境。アプリケーションの実行・データの保存・認証・生成 AI）</li><li>Stripe, Inc.（課金処理）</li></ul></li><li><strong>利用目的</strong>: ウェブサイトの機能提供および改善 / 課金処理 / AI 提案（活動・ごほうび・チェックリスト）のテキスト補助 / 領収書画像の読み取り</li><li><strong>個人を識別する情報</strong>: 上記の外部送信に際して、運営者は利用者本人を直接識別する情報（氏名・住所・電話番号等）を取得しません。利用者識別子は家族内一意 ID のみであり、外部第三者には送信しません。</li><li><strong>利用者の選択肢</strong>: 利用者は、ブラウザの設定により Cookie をブロックすることで、一部の外部送信を停止することができます。ただし、本サービスの一部機能が利用できなくなる場合があります。</li></ol>',
	section9:
		'<h2>第9条（未成年者の取扱い）</h2><p>本サービスは、お子さま（未成年者）が利用することを前提として設計されており、未成年者の保護のために以下の特別な措置を講じています。</p><ol><li><strong>全年齢で保護者同意フレームワーク運用</strong>: 年齢を問わず、すべてのお子さまの本サービス利用について、保護者（法定代理人）が本利用規約・本ポリシーに同意した上でアカウントを作成・管理します。お子さま本人がアカウントを作成することはできません。</li><li><strong>利用者識別子は家族内一意 ID のみ</strong>: お子さまを識別する情報は、家族グループ内でのみ一意に割り振られる ID であり、学校名・氏名・住所・電話番号等の本人を特定する情報は取得しません。</li><li><strong>利用者本人への直接接触の禁止</strong>: 運営者から、お子さま本人に対するアンケート・通知・メールマガジン等の直接的な接触は一切行いません。本サービスに関する連絡は、すべて保護者宛に行います。</li><li><strong>お子さまのデータを一括して生成 AI に渡さない</strong>: お子さまの活動記録・プロフィール等のデータベース上のデータを、生成 AI に送信することはありません。ただし、保護者ご自身が AI 提案機能（活動・チェックリスト・ごほうび）に入力した文章と、ポイント変換でアップロードされた領収書画像は、生成 AI に送信されます。送信先は、当社が提供するクラウド版では<strong>運営者が管理する AWS 環境内の生成 AI</strong>です（外部の生成 AI 事業者には渡りません）。ご自身のサーバーで運用されるセルフホスト版では、設定により<strong>運営者の環境外の生成 AI（Google LLC）</strong>が使われる場合があります。<strong>入力欄にお子さまのお名前など特定につながる情報を書かれた場合、その文章は上記の送信先に送られます</strong>のでご注意ください。</li><li><strong>保護者による削除請求の優先処理</strong>: 保護者からのお子さまデータ削除請求は、本ポリシー第5条・第6条の手続きに従って優先的に処理します。</li></ol>',
	section10: `<h2>第10条（外国にある第三者への提供）</h2><p>本サービスは、AWS（米国バージニア北部リージョン）/ Stripe / Google の各データセンターを利用してサービスを提供しています。これらは「外国にある第三者への提供」（個人情報保護法 §28）に該当しますが、以下の方針を厳守しています:</p><ul><li>お預かりしたデータは <strong>サービス提供のためだけに使用</strong> します</li><li><strong>広告利用・トラッキング・第三者への販売は一切行いません</strong></li><li><strong>運営者は、お預かりしたデータを機械学習・AI モデルの学習データに流用しません</strong>（セルフホスト版でご自身が設定された外部の生成 AI 事業者における取扱いは、その事業者の規約によります。運営者は関与せず、保証もできません）</li><li>${CHILD_TERMS.neutral}のニックネーム・活動記録などをデータベースから取り出して生成 AI に渡す機能はありません（生成 AI に送られるのは、保護者が AI 提案機能に入力した文章と、アップロードされた領収書画像だけです。詳細は第9条④）</li></ul><p>運営者は、個人情報保護法第28条に基づき、利用者の個人データを外国にある第三者へ提供することについて、以下のとおり情報を提供し、利用者の同意を取得します。</p><ol><li><strong>移転先国</strong>: 米国（データの保存先は AWS バージニア北部リージョン us-east-1。生成 AI の推論のみ、米国内の複数リージョン us-east-1 / us-east-2 / us-west-2 で処理される場合があります）</li><li><strong>第三者の名称</strong>: Amazon Web Services, Inc.（米国デラウェア州法人）</li><li><strong>当該国の個人情報の保護に関する制度</strong>: 米国には個人情報の保護に関する包括的な連邦法はなく、分野別の法律（金融・医療分野等）と州法（カリフォルニア州消費者プライバシー法等）により規律されています。日本の個人情報保護法と同等の水準にあると認められる外国（EU・英国）としては指定されていません。詳細は、個人情報保護委員会が公表する<a href="https://www.ppc.go.jp/personalinfo/legal/kaiseihogohou/#gaikoku" target="_blank" rel="noopener">外国における個人情報の保護に関する制度等の調査結果</a>（米国）をご参照ください。</li><li><strong>移転先が講ずる個人情報の保護のための措置</strong>: AWS との間で Data Processing Addendum (DPA) および標準契約条項 (Standard Contractual Clauses, SCC) を締結し、AWS は OECD プライバシーガイドラインに対応する措置（保存データの暗号化、アクセス制御、監査、再委託先の管理等）を講じています。これにより、日本の個人情報保護法に基づき運営者が講ずべき措置に相当する体制を継続的に確保しています。</li><li><strong>移転される情報の範囲</strong>: 保護者のメールアドレス（認証用）、利用者識別子（家族内一意 ID）、${CHILD_TERMS.neutral}のプロフィール（ニックネーム・年齢・表示モード）、活動記録、ステータス（レベル・ポイント・連続日数）、${CHILD_TERMS.neutral}のアバター画像（アップロードされた場合。過去に保存された画像を含みます）、課金関連情報（決済情報そのものは Stripe で処理され、運営者および AWS のサーバーには保存されません）。生成 AI の推論に送られるのは、保護者が AI 提案機能に入力した文章と、アップロードされた領収書画像だけです（第9条④）。</li><li><strong>本人同意の取得</strong>: 上記の外国にある第三者への提供については、本サービスの${SIGNUP_TERMS.canonical}時に、「${CROSS_BORDER_TERMS.consentLabel}」のチェックボックス（広告利用・第三者への販売・機械学習への流用を行わない旨の説明とともに表示）により、利用者から明示的に同意を取得します。Google アカウントでの登録など${SIGNUP_TERMS.canonical}フォームを経由しない場合は、ログイン後の同意画面で同じ同意を取得します。取得した同意は、同意日時・対象バージョンとともに記録されます。同意されない場合、本サービスをご利用いただくことができません。</li><li><strong>その他の外国にある第三者</strong>:<ul><li><strong>Stripe, Inc.</strong>（米国） — 決済の処理。運営者から Stripe に送るのは、お申し込みのプラン名と家族内一意 ID だけです。お名前・メールアドレス・カード番号は、利用者が Stripe の決済ページに直接入力し、運営者のサーバーを通りません。Stripe は PCI DSS Level 1 認証に加え、個人情報の越境移転に関する国際的な枠組みである<a href="https://www.globalcbpr.org/privacy-certifications/directory/" target="_blank" rel="noopener">グローバル CBPR システムの認証</a>（Stripe, LLC、TrustArc 認証、有効期限 2027 年 7 月）を取得しています。運営者は本条の同意を根拠として提供します。</li><li><strong>Google LLC</strong>（米国） — OAuth 認証。加えて、<strong>セルフホスト版で外部の生成 AI を使う設定にした場合</strong>は、AI 提案機能に入力された文章と領収書画像の送信先になります（第9条④）。当社が提供するクラウド版では生成 AI の送信先になりません。</li></ul></li></ol>`,
	section11:
		'<h2>第11条（本ポリシーの変更）</h2><ol><li>運営者は、法令の改正、社会情勢の変化、またはサービス内容の変更に伴い、本ポリシーを変更することがあります。</li><li>重要な変更を行う場合は、本サービス上での通知またはメールにより、変更内容と施行日をお知らせします。</li><li>本ポリシーの重要な変更後に本サービスを継続して利用される場合、利用者には変更後のポリシーに対する再同意を求める場合があります。</li></ol>',
	section12:
		'<h2>第12条（個人情報保護管理者）</h2><div class="contact"><p><strong>個人情報保護管理者</strong></p><p>氏名: 日下武紀</p><p>連絡先: <a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="プライバシー">ganbari.quest.support@gmail.com</a></p></div>',
	section13:
		'<h2>第13条（お問い合わせ）</h2><p>個人情報の取扱いに関するお問い合わせは、以下までご連絡ください。開示等の請求に対しては、ご本人確認のうえ、合理的な期間内に対応いたします。</p><div class="contact"><p>がんばりクエスト運営者 日下武紀</p><p>お問い合わせ: <a href="https://github.com/Takenori-Kusaka/ganbari-quest/issues">GitHub Issues</a> / <a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="プライバシー">メール</a></p></div>',
	effective: '<p>以上</p><p>制定日: 2026年3月27日</p><p>最終改定日: 2026年9月12日</p>',
} as const;

// ============================================================
// LP /site/terms.html SSOT (#1703 / #1683-C / ADR-0009 supersede / ADR-0025)
// 命名規則: legalTerms.<key>
//   - articleHeader / intro / section1〜section20 / effective
//
// #1949 (Phase 4 E2): PLAN 名 atom (PLAN_FULL_TERMS.free / standard / family) を
//   section8 / section12 / section13 で terms.ts 参照化。
//   section13 の retention 期間「7日間 / 30日間」は TRIAL_TERMS.duration（trial 専用）と
//   意味が異なる（data deletion grace period）ため、コンセプト混在を避けて文字列直書き維持。
// ============================================================
export const LP_LEGAL_TERMS_LABELS = {
	articleHeader: '<h1>利用規約</h1><p class="meta">最終更新日: 2026年9月10日</p>',
	intro:
		'本利用規約（以下「本規約」）は、個人開発者である日下武紀（以下「運営者」）が提供するWebアプリケーション「がんばりクエスト」（以下「本サービス」）の利用条件を定めるものです。本サービスは個人が開発・運営するものであり、企業が提供するサービスとは運営体制が異なります。本サービスをご利用いただくにあたり、本規約に同意いただく必要があります。',
	section1:
		'<h2>第1条（定義）</h2><ol><li>「利用者」とは、本規約に同意の上、本サービスを利用する全ての方をいいます。</li><li>「保護者」とは、本サービスにおいて管理者権限でアカウントを作成・管理する利用者をいいます。</li><li>「お子さま」とは、保護者が本サービスに登録した未成年の家族をいいます。</li><li>「家族グループ」とは、保護者が作成し、お子さまや他の保護者が所属するグループをいいます。</li><li>「コンテンツ」とは、利用者が本サービスに登録した活動、ポイント、実績等のデータをいいます。</li></ol>',
	section2:
		'<h2>第2条（サービスの内容）</h2><ol><li>本サービスは、家庭内でのお子さまの日常活動をゲーミフィケーション（ポイント、レベル、実績等）により動機づけすることを目的としたWebアプリケーションです。</li><li>運営者は、本サービスの内容を予告なく変更・追加・削減することがあります。</li><li>本サービスは教育効果や行動変容を保証するものではありません。</li></ol>',
	section3:
		'<h2>第3条（アカウントの管理）</h2><ol><li>利用者は、自己の責任においてアカウント情報を管理するものとします。</li><li>アカウント情報の不正利用により生じた損害について、運営者は一切の責任を負いません。</li><li>お子さまのアカウントは保護者が作成・管理するものとし、お子さま自身がアカウントを作成することはできません。</li><li>保護者は、お子さまのデータの入力内容および本サービスの利用について責任を負うものとします。</li><li>1つのメールアドレスにつき1つのアカウントのみ作成できます。</li></ol>',
	section4:
		'<h2>第4条（禁止事項）</h2><p>利用者は、本サービスの利用にあたり、以下の行為を行ってはなりません。</p><ol><li>法令または公序良俗に違反する行為</li><li>犯罪行為に関連する行為</li><li>運営者のサーバーまたはネットワークの機能を破壊・妨害する行為</li><li>本サービスの運営を妨害するおそれのある行為</li><li>他の利用者の個人情報を収集または蓄積する行為</li><li>不正アクセスまたはこれを試みる行為</li><li>他の利用者に成りすます行為</li><li>反社会的勢力に対して直接または間接に利益を供与する行為</li><li>本サービスの他の利用者または第三者の知的財産権、肖像権、プライバシー、名誉その他の権利または利益を侵害する行為</li><li>本サービスを商業目的で利用する行為（運営者が別途許諾した場合を除く）</li><li>その他、運営者が不適切と判断する行為</li></ol>',
	section5:
		'<h2>第5条（アカウントの停止・削除）</h2><ol><li>運営者は、利用者が前条の禁止事項に違反した場合、または本規約のいずれかの条項に違反した場合、事前の通知なくアカウントの停止または削除を行うことができます。</li><li>前項の措置により利用者に生じた損害について、運営者は一切の責任を負いません。</li><li>運営者は、アカウント停止または削除の理由について、開示する義務を負いません。</li></ol>',
	section6:
		'<h2>第6条（未成年者の利用）</h2><ol><li>本サービスは、保護者の管理のもとでお子さまが利用することを前提として設計されています。</li><li>未成年者が本サービスを利用する場合、法定代理人（保護者）の同意が必要です。</li><li>保護者は、お子さまの本サービスの利用に関して一切の責任を負うものとします。</li><li>保護者が本規約に同意してアカウントを作成した時点で、お子さまの本サービスの利用についても同意したものとみなします。</li><li>未成年者の個人情報の取扱いについて、運営者は<a href="privacy.html#under-age">プライバシーポリシー第9条（未成年者の取扱い）</a>に定める特別な保護措置を講じています。</li></ol>',
	section7: `<h2>第7条（料金および支払い）</h2><ol><li>本サービスの基本機能は無料でご利用いただけます。一部の機能は有料プランへの加入が必要です。料金の詳細は本サービス内の料金ページに記載します。</li><li>有料プランの支払いは、運営者が指定する決済サービスを通じて行われます。</li><li>有料プランは契約期間ごとに自動更新されます。自動更新の停止（解約）は、次回更新日の前日までに${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」→「${STRIPE_PORTAL_TERMS.short}を開く」（${STRIPE_PORTAL_TERMS.canonical}）から行うことができます。</li><li>解約後も、支払い済み期間の終了日まで有料プランの機能をご利用いただけます。</li><li>日割り計算による返金は行いません。</li><li><strong>解約とアカウント削除の違い</strong>: 解約はサブスクリプションの自動更新停止のみを行うものであり、利用者のデータは${PLAN_FULL_TERMS.free}へ移行して保持されます（保持期間は次項に定めます）。データを完全に削除したい場合は、本サービスにログインのうえ、設定画面の「アカウント削除」から本人が実施してください。詳細は第13条に定めます。</li><li><strong>プラン別の履歴保持期間</strong>: 活動記録等の履歴は、ご利用中のプランに応じて次の期間保持されます。${PLAN_FULL_TERMS.free}: ${PLAN_RETENTION_TERMS.free}間 / ${PLAN_FULL_TERMS.standard}: ${PLAN_RETENTION_TERMS.standard}間 / ${PLAN_FULL_TERMS.premium}: 無期限。保持期間を超えた履歴は削除され、復元できません（再度有料プランにご加入いただいた場合も戻りません）。</li><li><strong>プラン変更</strong>: 利用者はいつでもプランを変更できます。上位プランへの変更（アップグレード）は直ちに反映されます。下位プランへの変更（ダウングレード）および解約による${PLAN_FULL_TERMS.free}への移行では、<strong>変更後のプランの保持期間を超える履歴は削除されます</strong>。また、変更後のプランの上限を超えるお子さま・活動等は閲覧できない状態になります。プラン変更のお手続きをご自身で行う場合、削除される履歴があるときは手続きの前に画面上でお知らせします。解約により${PLAN_FULL_TERMS.free}へ移行する場合は、解約時点でこの案内は行われません。</li></ol>`,
	section8: `<h2>第8条（無料トライアル）</h2><ol><li>有料プランには無料トライアル期間が含まれる場合があります。期間の詳細は本サービス内に記載します。</li><li>無料トライアルのご利用にお支払い情報の登録は不要です。期間中・終了後を問わず、自動的に料金が発生することはありません。</li><li>無料トライアル期間終了後、自動的に${PLAN_FULL_TERMS.free}に移行します。有料プランへの移行はお客さまご自身で${ADMIN_VIEW_TERMS.canonical}より手続きしていただく必要があります。</li><li>無料トライアルは、<strong>ご家族（家族グループ）につき1回</strong>のみご利用いただけます。同一のご家族に属する複数のアカウントで重ねてご利用いただくことはできません。ただし、運営者が実施するキャンペーン等により、運営者の判断で再度ご提供する場合があります。</li></ol>`,
	section9:
		'<h2>第9条（知的財産権）</h2><ol><li>本サービスに関する知的財産権は全て運営者または正当な権利者に帰属します。</li><li>利用者が本サービスに登録したコンテンツの著作権は利用者に帰属しますが、運営者はサービスの提供および改善に必要な範囲で当該コンテンツを利用できるものとします。</li></ol>',
	section10:
		'<h2>第10条（個人情報の取扱い）</h2><p>利用者の個人情報の取扱いについては、別途定める<a href="privacy.html">プライバシーポリシー</a>に従うものとします。</p>',
	section11:
		'<h2>第11条（サービスの中断・停止）</h2><ol><li>運営者は、以下の場合、事前の通知なく本サービスの全部または一部を中断・停止することがあります。<ul><li>システムの保守・点検・更新を行う場合</li><li>地震、落雷、火災、停電、天災等の不可抗力により本サービスの提供が困難な場合</li><li>その他、運営者がサービスの中断・停止が必要と判断した場合</li></ul></li><li>サービスの中断・停止により利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、運営者は責任を負いません。</li></ol>',
	section12: `<h2>第12条（免責事項）</h2><ol><li>本サービスは個人開発者が運営するものであり、「現状有姿（AS IS）」で提供されます。運営者は、本サービスの正確性、完全性、信頼性、適時性、安全性、特定目的への適合性について、明示的または黙示的を問わず一切の保証をしません。</li><li>本サービスはお子さまの教育効果や行動変容を保証するものではなく、結果について運営者は責任を負いません。</li><li>運営者は、本サービスの利用により利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、一切の責任を負いません。</li><li>運営者は、以下に起因する損害について、一切の責任を負いません。<ul><li>データの消失、破損、改ざん、または復旧の不能</li><li>サービスの中断、遅延、停止、または終了</li><li>第三者サービス（AWS、Stripe、Google等）の障害、仕様変更、またはサービス停止</li><li>不正アクセス、コンピュータウイルス、その他のセキュリティ侵害</li><li>利用者間のトラブルまたは紛争</li><li>利用者の操作ミスまたはアカウント管理の不備</li></ul></li><li>運営者は、間接損害、特別損害、偶発的損害、結果的損害、逸失利益、およびデータの喪失について、たとえその可能性を事前に告知されていた場合であっても、責任を負いません。</li><li>前各項の規定にかかわらず、消費者契約法その他の強行法規の適用により運営者の責任が認められる場合、運営者が利用者に対して賠償する金額は、当該利用者が損害発生月を含む直近3ヶ月間に本サービスに対して実際に支払った利用料の総額を上限とします。${PLAN_FULL_TERMS.free}の利用者については、運営者の賠償額の上限は0円とします。</li></ol>`,
	section13: `<h2>第13条（利用者データの取扱い）</h2><ol><li>利用者は、自己のコンテンツについて、いつでも削除を申請することができます。</li><li><strong>アカウント削除はログインして行った時のみ全データの完全削除が実行されるもの</strong>であり、サブスクリプションの解約（第7条）とは別の手続きです。アカウント削除はご家族の見守り画面の設定から本人が実施してください。なりすまし防止のため、運営者がご本人に代わってアカウント削除を実施することはありません。</li><li>アカウント削除を申請した場合、ご利用プランに応じた猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standard}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premium}間）の後、全データが完全に削除されます。猶予期間中は削除の取消しが可能です（${PLAN_FULL_TERMS.free}は猶予期間がないため取消しできません）。</li><li>運営者はデータのバックアップを実施していますが、データの復旧を保証するものではありません。</li></ol>`,
	section14: `<h2>第14条（卒業 — ポジティブな解約について）</h2><ol><li><strong>哲学</strong>: 本サービスは、お子さまが日常活動を自律的に行えるようになった時点で、本サービスの継続利用を推奨しません。これを「卒業」と呼びます。卒業は、お子さまが成長し、本サービスの動機づけがなくても自分の力で日々の活動に取り組めるようになった、ポジティブな節目です。</li><li><strong>卒業時の手続き</strong>: 利用者は、本サービスの${ADMIN_VIEW_TERMS.canonical}から「卒業手続き」を行うことで、本契約を終了することができます。記録の書き出し（エクスポート）は、退会（アカウント削除）の手続き画面からいつでも行えます。</li><li><strong>残ポイントの取扱い</strong>: 本サービスのポイントは、保護者がお子さまに付与するご家庭内の仕組みであり、法定通貨・前払式支払手段その他の金銭的価値ではありません。<strong>運営者はポイントの換金・買取・払い戻しを行いません。</strong>卒業時に残っているポイントの扱いは、ご家庭内でお決めください（卒業ページでは参考例をご紹介しています）。</li><li><strong>通常の解約との関係</strong>: 卒業は、利用者の意思による契約終了の一形態であり、本規約第7条に定める通常の解約手続きと並存します。利用者は、卒業手続きの代わりに通常の解約手続きを選択することもできます。</li></ol>`,
	section15:
		'<h2>第15条（サービスの終了）</h2><ol><li>運営者は、運営者の判断により、本サービスの全部または一部を終了することがあります。</li><li>本サービスを終了する場合、運営者は終了日の30日前までに本サービス上または登録メールアドレスへの通知により利用者にお知らせします。</li><li>サービス終了時、利用者は終了日までに自己のデータをエクスポートすることができます。</li><li>サービスの終了により利用者に生じた損害について、運営者は一切の責任を負いません。</li></ol>',
	section16:
		'<h2>第16条（本規約の変更）</h2><ol><li>運営者は、利用者の一般の利益に適合する場合、または社会情勢の変化や法令の改正等に伴い合理的に必要と認められる場合、本規約を変更することがあります。</li><li>本規約を変更する場合、変更内容および施行時期を本サービス上で通知し、施行日の14日前までに利用者に周知します。</li><li>変更後の本規約の施行日以降に利用者が本サービスを利用した場合、当該利用者は変更後の本規約に同意したものとみなします。</li></ol>',
	section17:
		'<h2>第17条（反社会的勢力の排除）</h2><p>利用者は、自己が反社会的勢力（暴力団、暴力団員、暴力団関係企業、総会屋等）に該当しないこと、および今後も該当しないことを表明・保証するものとします。</p>',
	section18:
		'<h2>第18条（準拠法・管轄裁判所）</h2><ol><li>本規約の解釈にあたっては、日本法を準拠法とします。</li><li>本サービスに関して紛争が生じた場合、運営者の所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。</li></ol>',
	section19:
		'<h2>第19条（分離可能性）</h2><p>本規約のいずれかの条項が法令により無効または執行不能と判断された場合であっても、当該条項以外の規定の有効性には影響しないものとします。</p>',
	section20:
		'<h2>第20条（お問い合わせ）</h2><p>本規約に関するお問い合わせは、<a href="https://github.com/Takenori-Kusaka/ganbari-quest/issues">GitHubのIssuesページ</a>または<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="利用規約">メール</a>よりご連絡ください。</p>',
	effective: '<p>以上</p><p>制定日: 2026年3月27日</p><p>最終改定日: 2026年9月10日</p>',
} as const;

// ============================================================
// LP /site/sla.html SSOT (#1703 / #1683-C / ADR-0009 supersede / ADR-0025)
// 命名規則: legalSla.<key>
//   - articleHeader / intro / section1〜section8 / effective
//
// #1950 Phase 4 E3: terms.ts 参照化対象ゼロの記録
// ----------------------------------------------------------
// 本 namespace は法的文書（SLA）として、PLAN 名・価格・期間・解約・無料訴求の
// 具体的表現を**意図的に避け**、抽象的な「有料プラン」「月間可用性」「日次バックアップ」等の
// 一般訴求語に留めている。現 terms.ts (PLAN_TERMS / PLAN_FULL_TERMS / PRICE_TERMS /
// TRIAL_TERMS / CANCEL_TERMS / FREE_TERMS / CTA_TERMS) の各 atom と char-by-char 一致する
// 直書きは本 namespace 内に**1 件も存在しない**ことを #1950 で確認済（atom 突合表は PR 本文参照）。
//
// 将来 SLA 条文を改訂し、PLAN 名・価格・期間表現が直書きとして本 namespace に
// 現れた場合は terms.ts 経由で参照化すること（PLAN_FULL_TERMS.standard 等）。
// 改訂時は site/sla.html との char-by-char 一致厳守（法的文書のため）。
//
// 関連:
//   - #1948 LP_LEGAL_PRIVACY_LABELS (Phase 4 E1, terms.ts 参照化対象あり)
//   - #1949 LP_LEGAL_TERMS_LABELS (Phase 4 E2, 同上)
//   - #1951 LP_LEGAL_TOKUSHOHO_LABELS (Phase 4 E4, 同上)
// ============================================================
export const LP_LEGAL_SLA_LABELS = {
	articleHeader: '<h1>サービスレベル合意（SLA）</h1><p class="meta">最終更新日: 2026年8月13日</p>',
	intro:
		'本文書は、個人開発者である日下武紀が運営するがんばりクエスト（以下「本サービス」）のサービスレベル目標を定めるものです。本サービスは個人が開発・運営しているため、企業が提供するサービスとは運営体制が異なります。本SLAは、運営者が誠実に達成を目指す目標値を示すものであり、法的な保証ではありません。',
	section1:
		'<h2>第1条（適用範囲）</h2><ol><li>本SLAは、本サービスのSaaS版（https://ganbari-quest.com）に適用されます。</li><li>セルフホスト版（利用者自身の環境で動作するもの）には適用されません。</li><li>本SLAは、運営者が合理的な努力により達成を目指す目標であり、法的な保証を構成するものではありません。</li></ol>',
	section2:
		'<h2>第2条（サービス可用性）</h2><ol><li>運営者は、本サービスの月間可用性 <strong>99.5%</strong> を目標とします（月間約3.6時間の計画外ダウンタイムに相当）。</li><li>以下は計画外ダウンタイムに含みません。<ul><li>事前に通知された計画メンテナンス</li><li>天災・戦争等の不可抗力による停止</li><li>クラウド基盤の障害</li><li>利用者側の環境に起因する接続障害</li></ul></li></ol>',
	section3:
		'<h2>第3条（デプロイおよび計画メンテナンス）</h2><ol><li>本サービスは継続的デプロイ（CI/CD）を採用しており、通常のコードデプロイはゼロダウンタイムで実施されます。通常のデプロイにおいてサービスの中断は発生しません。</li><li>インフラストラクチャの変更（CDKスタック更新、データベースマイグレーション等）により、サービスの一時的な中断が見込まれる場合は「計画メンテナンス」として扱い、以下の対応を行います。<ul><li>事前通知: 24時間前までに本サービス内のお知らせにて告知します。あわせて、影響が大きいと運営者が判断した場合は登録メールアドレスへ順次ご連絡します</li><li>影響範囲および想定される中断時間の事前説明</li></ul></li><li>緊急のセキュリティパッチ等、事前通知なく実施する場合があります。この場合は可能な限り速やかに通知します。</li></ol>',
	section4:
		'<h2>第4条（データ保護）</h2><p>運営者は、利用者のデータを保護するために以下の措置を講じています。</p><ul><li>日次の自動バックアップを実施しています。</li><li>全ての通信はTLS 1.2以上で暗号化されます。</li><li>保存データはAES-256で暗号化されます。</li><li>障害発生時の復旧目標時間は4時間以内です。</li><li>データの復旧時点目標は24時間以内（日次バックアップ間隔）です。</li></ul>',
	// #4924: 「（準備中）」は本番稼働中の 1 時間ごとヘルスチェック (infra/lib/ops-stack.ts の
	// `HealthCheckSchedule`、`ganbari-quest-health-check` Lambda) と食い違う (ADR-0013 LP truth)。
	// 実装済みの機構を「準備中」と書いたまま放置しない。
	section5:
		'<h2>第5条（障害通知）</h2><ol><li>サービス障害が発生した場合、運営者は本サービス内のお知らせにて状況を通知します。重大な障害の際は、登録メールアドレスへご連絡する場合があります。</li><li>障害の検知はデプロイ時の自動検証および1時間ごとの定期ヘルスチェックにより行われ、異常を検知した場合は速やかに対応を開始し通知します。</li></ol>',
	// #4709: 応答目標は SUPPORT_RESPONSE_TERMS.initialResponseTarget が SSOT。
	section6: `<h2>第6条（サポート対応）</h2><p>お問い合わせは<a href="https://github.com/Takenori-Kusaka/ganbari-quest/issues">GitHub Issues</a>または<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="SLA">メール</a>にて24時間受け付けています。初回応答は${SUPPORT_RESPONSE_TERMS.initialResponseTarget}を目標としています。対応言語は日本語です。</p><p>個人運営のため、応答が遅れる場合があります。ご理解をお願いいたします。</p>`,
	section7:
		'<h2>第7条（SLA未達時の対応）</h2><ol><li>本SLAに定める目標値を達成できなかった場合、運営者は原因の調査と再発防止に努めます。</li><li>本SLAは法的な保証ではなく、目標未達に対するサービスクレジット（返金・減額）の提供は行いません。</li><li>重大な障害（連続24時間以上のサービス停止等）が発生した場合、有料プランの利用者は障害期間に相当する日数分のサービス期間延長を申請できます。申請は<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="SLA-期間延長">サポートメール</a>宛にご連絡ください（対象期間と発生事象をお知らせください）。延長の可否は運営者が判断し、個別にご対応します。</li></ol>',
	section8:
		'<h2>第8条（免責事項）</h2><ol><li>本サービスは個人開発によるものであり、エンタープライズ向けサービスと同等の可用性・冗長性を保証するものではありません。運営者1名での対応となるため、障害対応に時間を要する場合があります。</li><li>本SLAに定める目標値を達成できなかった場合でも、運営者は損害賠償義務を負いません。損害賠償については、<a href="terms.html">利用規約</a>第12条（免責事項）の定めに従います。</li><li>本SLAの内容は、サービスの改善に伴い変更される場合があります。重要な変更がある場合は14日前までに通知します。</li></ol>',
	effective:
		'<p>制定日: 2026年3月27日</p><p>最終改定日: 2026年8月13日</p><p>がんばりクエスト運営者 日下武紀</p>',
} as const;

// ============================================================
// LP /site/tokushoho.html SSOT (#1703 / #1683-C / ADR-0009 supersede / ADR-0025)
// 命名規則: legalTokushoho.<key>
//   - articleHeader: h1 + meta
//   - tableContent: 全 13 行のテーブルを 1 key に格納（table 構造保持）
//   - effective: 制定日 / 最終改定日
//
// #1951 (Phase 4 E4): atom (PLAN 名) は terms.ts (PLAN_FULL_TERMS) に移譲。
// scope: PLAN 名のみ置換 (8 箇所)。
//   - 価格 (`月額500円（税込）` 等)・期間 (`7 日間` スペース有り)・解約 (`いつでも可能` 等) は
//     terms.ts atom (PRICE_TERMS / TRIAL_TERMS / CANCEL_TERMS) と char 差異があり、
//     特商法表記の char-by-char 一致厳守 (AC2) のため本 PR scope 外。新 atom 追加は
//     他 LABELS への波及リスクがあるため別 Issue で検討する。
// ============================================================
export const LP_LEGAL_TOKUSHOHO_LABELS = {
	articleHeader: '<h1>特定商取引法に基づく表記</h1><p class="meta">最終更新日: 2026年9月10日</p>',
	tableContent: `<tr><th>販売業者</th><td>日下武紀</td></tr><tr><th>運営責任者</th><td>日下武紀</td></tr><tr><th>所在地</th><td>請求があり次第、遅滞なく開示します（<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法-所在地">ganbari.quest.support@gmail.com</a> までご連絡ください）<br><small>※特商法第 11 条 + 同法施行規則第 23 条に基づく省略表示。請求受付後、遅滞なく所在地を書面・メール等にて開示いたします</small></td></tr><tr><th>電話番号</th><td>請求があり次第、遅滞なく開示します（<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法-電話番号">ganbari.quest.support@gmail.com</a> までご連絡ください）<br>受付時間: 平日 10:00〜18:00（土日祝・年末年始を除く）<br>※お問い合わせはメールを推奨いたします（初回のご返信は${SUPPORT_RESPONSE_TERMS.initialResponseTarget}を目標としています）<br><small>※特商法第 11 条 + 同法施行規則第 23 条に基づく省略表示。請求受付後、遅滞なく電話番号を書面・メール等にて開示いたします</small></td></tr><tr><th>メールアドレス</th><td><a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法">ganbari.quest.support@gmail.com</a></td></tr><tr><th>URL</th><td><a href="https://www.ganbari-quest.com">https://www.ganbari-quest.com</a></td></tr><tr><th>販売価格</th><td>${PLAN_FULL_TERMS.free}: 無料<br>${PLAN_FULL_TERMS.standard}: 月額${PRICE_TERMS.standardYenFull}（税込）<br>${PLAN_FULL_TERMS.premium}: 月額${PRICE_TERMS.familyYenFull}（税込）</td></tr><tr><th>支払方法</th><td>クレジットカード（Stripe が対応する主要ブランド）<br>※Stripe決済サービス経由。ご利用いただけるブランドは決済画面でご確認いただけます</td></tr><tr><th>支払時期</th><td>お申し込み（決済手続き）の完了時に初回分を課金し、以後は毎月同じ日に自動課金します。<br>${TRIAL_TERMS.durationSpaced}の${CTA_TERMS.freeTrialNoun}はアプリ内で開始する機能で、課金を伴いません（お申し込みとは別の手続きで、${TRIAL_TERMS.noCreditCard}です）。</td></tr><tr><th>サービス提供時期</th><td>お申し込み後、即時ご利用いただけます。</td></tr><tr><th>返品・キャンセル</th><td>デジタルサービスのため返品はお受けしておりません。<br>有料プランの解約（中途解約）は、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」→「${STRIPE_PORTAL_TERMS.short}を開く」（${STRIPE_PORTAL_TERMS.canonical}）からいつでも可能です。<br>解約後は現在の請求期間の終了日まで引き続きご利用いただけます。日割り計算による返金は行いません。<br><br><strong>解約とデータの取扱い</strong>：解約によってお客様のデータが削除されることはありません。請求期間の終了後は${PLAN_FULL_TERMS.free}へ自動的に移行し、記録は保持されます。${PLAN_FULL_TERMS.free}の上限を超えるお子さま・活動・チェックリストはアーカイブされ、画面には表示されなくなります。アーカイブされたデータも削除はされず、有料プランに戻すと元どおりご利用いただけます。お支払いの失敗により契約が終了した場合も同じ取扱いです。${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。<br><br><strong>アカウント${CANCEL_TERMS.account}（データの完全削除）について</strong>：データそのものの削除をご希望の場合は、${ADMIN_VIEW_TERMS.canonical}の設定からアカウント${CANCEL_TERMS.account}をお申し込みください。ご利用プランに応じた猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）の経過後、すべてのお客様データが完全に削除されます（復旧不可）。有料プランは猶予期間中に${CANCEL_TERMS.account}の取消しとデータのエクスポートが可能ですが、${PLAN_FULL_TERMS.free}は猶予期間がなくお申し込みと同時に削除されます。</td></tr><tr><th>${CTA_TERMS.freeTrialNoun}</th><td>${ADMIN_VIEW_TERMS.canonical}から、ご家族（家族グループ）につき 1 回、${TRIAL_TERMS.durationSpaced}の${CTA_TERMS.freeTrialNoun}を開始できます。<br>${CTA_TERMS.freeTrialNoun}は課金を伴わず、${TRIAL_TERMS.noCreditCard}です。期間が終わると自動的に${PLAN_FULL_TERMS.free}へ戻り、自動課金は一切ありません。<br>有料プランのご利用は、${CTA_TERMS.freeTrialNoun}とは別に上記「支払時期」のお申し込み手続きが必要です（お申し込みの完了時に初回分を課金します）。</td></tr><tr><th>追加料金</th><td>表示価格以外の追加料金はございません。<br>（インターネット接続に必要な通信料等は利用者のご負担となります）</td></tr><tr><th>動作環境</th><td>Chrome, Safari, Firefox, Edge の最新版<br>インターネット接続が必要です</td></tr>`,
	effective: '<p>制定日: 2026年3月31日</p><p>最終改定日: 2026年9月10日</p>',
} as const;
