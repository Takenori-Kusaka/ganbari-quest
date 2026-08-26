// src/lib/domain/labels.ts
// 用語辞書 — UI表示ラベルの Single Source of Truth
// 全てのUIラベルはこのファイルからインポートすること。ハードコード禁止。
// #1304: baby=準備モード に表記変更済み（AGE_TIER_LABELS / AGE_TIER_SHORT_LABELS）

// #4268: マイルストーン (褒める軸) の ID 集合は domain 定数が SSOT
import { CATEGORY_NAME_LIST } from './categories';
import { PRAISE_MILESTONE_IDS, type PraiseMilestoneId } from './constants/habit-milestones';
// #4482: 保持日数の「整形」も SSOT を経由する。表示側で `${days}日` と独自整形すると、
// 保持日数を 365 の倍数に変えたときにここだけ「365日」と述べ、料金表の「1年」と食い違う。
import { formatRetentionPeriod } from './constants/plan-retention';
import { jstDayOfWeek } from './date-utils';
// #1916: 用語集（atom）は terms.ts に集約。labels.ts は compound 専用とする SSOT 2 階層化基盤。
// #1958 (Phase 7 H1): CTA_TERMS を ACTION_LABELS / TRIAL_LABELS から参照（freeTrial / freeTrialWord / freeTrialDesc）
// #1960 (Phase 7 H3): PRICING_PAGE_LABELS subtitle1 で FREE_TERMS を追加 import
// #1961 (Phase 7 H4): PRICE_TERMS を PREMIUM_MODAL_LABELS から参照
// #1963 (Phase 7 H6): SUBSCRIPTION_PAGE_LABELS (旧 LICENSE_PAGE_LABELS) で PRICE_TERMS を新規参照（plan / 期間 / 価格 atom 直書き撤廃）
// #1898 (PO-4-12): LP_FAQ_TERMS を LP_LEGAL_DISCLAIMER_LABELS から参照（liabilityBody / liabilityLinks / cancelDisclaimerLinks の「FAQ」直書きを atom 経由に置換）
// #1913 (UIUX-E): AGE_RANGE_TERMS / POINT_TERMS / CURRENCY_TERMS / FREE_PLAN_TERMS 追加（年齢レンジ / ポイント / 通貨 / 無料プラン訴求 atom 集約）
// #2058 (UIUX-F-16): AUTONOMY_TERMS 追加（「自律」「自走」→「自分から動きだす」「自分で計画する」LP リフレーム atom、法務文書は法務 review 後の別 PR で対応）
// #2057 (UIUX-F-13): ADMIN_VIEW_TERMS / STRIPE_PORTAL_TERMS 追加（「管理画面」→「ご家族の見守り画面」rename + Stripe portal 用語分離）
// #1914 (TECH-F): CHILD_TERMS / PARENT_TERMS / SIGNUP_TERMS / LOGIN_TERMS / CANCEL_TERMS 拡張 — 5 ドメイン用語多重表記 SSOT 集約
// #1915 (TECH-F 中頻度 8 ドメイン): TRIAL_PERIOD_TERMS / UPGRADE_TERMS / GRADUATION_TERMS / ADVENTURE_TERMS / MECHANISM_TERMS / LIFESTAGE_TERMS 追加
// （「7 日間無料トライアル」「アップグレード/プラン変更」「卒業/最終ゴール」「冒険/メインクエスト」「仕組み/設計/工夫」「年齢/年齢区分/学年」の atom 集約）
// #2276 (EPIC #2266): CHEER_TERMS / REWARD_TERMS / TEMPLATE_TERMS 追加（応援 / ごほうび管理 / みんなのテンプレート atom）
// EPIC #2362 PR-2: OVERFLOW_MENU_TERMS / CHILD_SELECTION_TERMS / VISIBILITY_CHIP_TERMS 追加
//   （admin route 共通 ⋮ menu / per-child 取込ダイアログ / family master visibility chip atom、UX 規約 SSOT）
// Phase 7 PR-2b (#2697): PLAN_CHANGE_TERMS / TOKUSHOHO_TERMS を追加 import
//   - PR-2a (#2689) で terms.ts に atom-only 6 / 7 / 9 key で配備済
//   - 本 PR-2b で SUBSCRIPTION_PAGE_LABELS /
//     PHASE4_REACTIVATION_FLOW_LABELS / LP_PRICING_LABELS 拡張の 5 compound で参照
//   - 補強 PR #2684 (代替案 D = 2 Product 各 1 Price + ダウン即時 + Stripe credit memo) を反映し、
//     (UPGRADE_FLOW_LABELS / IMMEDIATE_DOWNGRADE_CREDIT_BANNER_LABELS は #4502 で削除 — #4166 の Portal 委譲で自社確認 UI が不採用になり dead 化した)
//   - CHECKOUT_SUCCESS_TERMS の compound (CHECKOUT_SUCCESS_LABELS) は Phase 5 §4.6 SSOT で
//     「本 PR scope 外、Phase 3 #2572 関連 compound として別 PR (例: PR-2b 後続) で追加」と明示
//     されているため、本 PR では import 不要
import {
	ADMIN_VIEW_TERMS,
	ADVENTURE_TERMS,
	AGE_RANGE_TERMS,
	AI_TRANSFER_TERMS,
	AUTONOMY_TERMS,
	BACKUP_TERMS,
	CANCEL_TERMS,
	CHECKOUT_TERMS,
	CHEER_TERMS,
	CHILD_SELECTION_TERMS,
	CHILD_TERMS,
	CONCEPT_ICONS,
	CTA_TERMS,
	CURRENCY_TERMS,
	DELETION_GRACE_TERMS,
	FAMILY_MEMBER_LIMIT_TERMS,
	FREE_PLAN_TERMS,
	FREE_TERMS,
	GRADUATION_TERMS,
	LIFESTAGE_TERMS,
	LOGIN_TERMS,
	LP_FAQ_TERMS,
	MECHANISM_TERMS,
	NUC_EDITION_TERMS,
	OSS_LICENSE_TERMS,
	OVERFLOW_MENU_TERMS,
	OYAKAGI_TERMS,
	PARENT_TERMS,
	PIN_DEFAULT_TERMS,
	PLAN_CHANGE_TERMS,
	PLAN_FULL_TERMS,
	PLAN_RETENTION_TERMS,
	PLAN_TERMS,
	POINT_TERMS,
	PRICE_TERMS,
	PWA_TERMS,
	REWARD_TERMS,
	RULES_TERMS,
	SIGNUP_TERMS,
	STRIPE_PORTAL_TERMS,
	TEMPLATE_TERMS,
	TOKUSHOHO_TERMS,
	TRIAL_PERIOD_TERMS,
	TRIAL_TERMS,
	UPGRADE_TERMS,
	VISIBILITY_CHIP_TERMS,
} from './terms';
import type { UiMode } from './validation/age-tier-types';
// #980: age-tier-types.ts に型・正規化関数を集約し循環依存を解消
import { normalizeUiMode } from './validation/age-tier-types';

// ============================================================
// アプリ情報 (#1452 Phase B)
// ============================================================

export const APP_LABELS = {
	name: 'がんばりクエスト',
	tagline: '子供の活動をゲーミフィケーションで動機付けする家庭内Webアプリ',
	demoName: 'がんばりクエスト デモ',
	pageTitleSuffix: ' - がんばりクエスト',
	demoPageTitleSuffix: ' - がんばりクエスト デモ',
	setupPageTitleSuffix: ' - がんばりクエスト セットアップ',
	errorPageTitlePart: ' エラー - がんばりクエスト',
} as const;

// ============================================================
// ページタイトル（<title> タグ用、#1452 Phase B）
// ============================================================

export const PAGE_TITLES = {
	// ご家族の見守り画面 (#2057, 旧称: 管理画面)
	activities: '活動管理',
	activitiesIntroduce: '活動紹介スライド',
	reports: 'レポート',
	achievements: 'チャレンジ管理',
	growth: '成長記録ブック',
	points: 'ポイント管理',
	// #2270 (EPIC #2266): 旧 messages 廃止 → cheer (応援機能) に統合
	cheer: '応援',
	rewards: 'ごほうび',
	checklists: 'チェックリスト管理',
	// #2295 (EPIC #2294 ①): events 削除済 (2026-05-19)
	challenges: 'きょうだいチャレンジ',
	children: 'こども管理',
	members: 'メンバー管理',
	settings: '設定',
	// analytics: 削除 (#2284 EPIC #2283: /admin/analytics 撤去、運用者向け機能は /ops/analytics に移動)
	billing: '請求書・支払い管理',
	certificates: 'がんばり証明書',
	license: 'プラン・お支払い',
	statusBenchmark: 'ベンチマーク管理',
	// #2276 / Round 18 Cluster A (ADR-0045): 活動パック → TEMPLATE_TERMS atom 経由化
	packs: TEMPLATE_TERMS.userFacing,
	// 認証
	login: `${LOGIN_TERMS.canonical}`,
	signup: `${SIGNUP_TERMS.canonical}`,
	invite: '招待',
	forgotPassword: 'パスワードリセット',
	// セットアップ
	setup: 'セットアップ',
	// 子供用
	// #2175: 「実績システム」命名残存解消で childAchievements → childChallenges に rename
	childChallenges: 'チャレンジきろく',
	childStatus: 'つよさ',
	childHome: 'ホーム',
	childChecklist: 'もちものチェック',
	// デモ子供用
	// #2175: demoChildAchievements → demoChildChallenges (本番と同期 rename)
	demoChildChallenges: 'チャレンジきろく',
	demoChildStatus: 'つよさ',
	demoChildBattle: 'バトル',
	demoChildHome: 'ホーム',
	demoChildChecklist: 'もちものチェック (デモ)',
	// デモ ご家族の見守り画面 (#2057)
	demoAdminAchievements: 'チャレンジ履歴（デモ）',
	demoAdminActivities: '活動管理',
	demoAdminChallenges: 'きょうだいチャレンジ（デモ）',
	demoAdminChecklists: 'もちものチェックリスト',
	demoAdminChildren: 'こども管理',
	demoAdminEvents: 'イベント管理（デモ）',
	demoAdminLicense: 'プラン・お支払い（デモ）',
	demoAdminMembers: 'メンバー管理',
	demoAdminMessages: 'おうえんメッセージ',
	demoAdminPoints: 'ポイント管理',
	demoAdminReports: '週間レポート（デモ）',
	demoAdminRewards: '特別報酬',
	demoAdminSettings: '設定',
	// デモ
	demo: 'デモ体験',
	demoSignup: 'デモ体験ありがとうございます',
	demoChildHistory: 'きろく',
	// セットアップ完了・各ステップ
	setupComplete: 'ぼうけんのはじまり！',
	setupChildren: '子供登録',
	setupFirstAdventure: 'はじめてのぼうけん',
	// Round 18 Cluster A (ADR-0045): 活動パック → TEMPLATE_TERMS atom 経由
	setupPacks: `${TEMPLATE_TERMS.userFacing}を選ぶ`,
	// #2140 MP-5: setup wizard β 採用
	setupRewards: 'ごほうびセット選択',
	setupRules: 'おうちのルール選択',
	// #2298: 家族チャレンジ step
	setupChallenges: '家族チャレンジ選択',
	// #2322: 活動・ポイント初期設定 step
	setupActivitiesDefaults: '活動・ポイント初期設定',
	// ユーザー切替
	switchUser: 'だれがつかう？',
	// その他
	// #2276: TEMPLATE_TERMS atom 参照化
	marketplace: TEMPLATE_TERMS.short,
	consent: '規約への同意',
	consentUpdate: '規約に変更がありました',
	pricing: '料金プラン',
} as const;

// ============================================================
// 汎用 UI メッセージ (#1452 Phase B)
// ============================================================

export const UI_LABELS = {
	redirecting: 'リダイレクト中...',
	back: '戻る',
	backWithArrow: '← 戻る',
	loading: '読み込み中...',
	saving: '保存中...',
	saved: '保存しました',
	deleting: '削除中...',
	deleted: '削除しました',
	adding: '追加中...',
	added: '追加しました',
	error: 'エラー',
	close: '閉じる',
	cancel: 'キャンセル',
	confirm: '確認',
	delete: '削除',
	add: '追加',
	edit: '編集',
	save: '保存',
	update: '更新',
	send: '送信',
	register: '登録',
	next: '次へ',
	prev: '前へ',
	skip: 'スキップ',
	// #1915 (TECH-F 中頻度 D-2): UPGRADE_TERMS atom 経由参照。
	//   admin UI / FAQ 既存「アップグレード」ボタン文言は確立した UX 用語のため UPGRADE_TERMS.actionVerb
	//   (= 'アップグレード') を維持。「プラン変更」canonical 化は別 Issue で段階移行。
	upgrade: `${UPGRADE_TERMS.actionVerb}`,
	points: 'ポイント',
	level: 'レベル',
	status: 'ステータス',
	clear: 'クリア！',
	noData: 'データがありません',
	noStatus: 'ステータスがまだないよ',
	noHistory: 'きろくがまだないよ',
	all: 'すべて',
	required: '必須',
	optional: '任意',
} as const;

// ============================================================
// フォーマット関数 (#1452 Phase B)
// ============================================================

export function formatCount(n: number): string {
	return `${n}件`;
}
export function formatAge(n: number): string {
	return `${n}歳`;
}
export function formatAgeRange(min: number, max: number): string {
	return `${min}〜${max}歳`;
}
export function formatStreak(n: number): string {
	return `${n}日れんぞく`;
}
export function formatTimes(n: number): string {
	return `${n}回`;
}
export function formatPeople(n: number): string {
	return `${n}人`;
}
export function formatDateRange(start: string, end: string): string {
	return `${start} 〜 ${end}`;
}

// ============================================================
// セットアップフロー (#1452 Phase B)
// ============================================================

export const SETUP_LABELS = {
	layoutTitle: '初期セットアップ',
} as const;

// ============================================================
// ナビゲーションカテゴリ
// ============================================================

// #2177 (EPIC #2176): family カテゴリを subject-first 上位化で新設。
// admin-ia.md v1.0 (頻度ベース分類、#1395) を v2.0 (subject-first 上位化) に supersede。
// 配置順: family → activity → record → settings (Family Link / iOS HIG / Material 3 仕様準拠)。
export const NAV_CATEGORIES = {
	family: { label: '家族', icon: '👨‍👩‍👧' },
	activity: { label: '活動', icon: '🎮' },
	record: { label: '記録', icon: '📊' },
	settings: { label: '設定', icon: '⚙️' },
} as const;

export type NavCategoryId = keyof typeof NAV_CATEGORIES;

// ============================================================
// ナビゲーション項目ラベル
// ============================================================

export const NAV_ITEM_LABELS = {
	// #1396: ご家族の見守り画面 ホームタブ（直接遷移・dropdown なし）
	home: 'ホーム',
	reports: 'レポート',
	growthBook: 'グロースブック',
	achievements: 'チャレンジ履歴',
	// analytics: 削除 (#2284 EPIC #2283: /admin/analytics 撤去、運用者向け機能は /ops/analytics に移動)
	points: 'ポイント',
	// #2270 / #2274 (EPIC #2266): 旧 messages 廃止 → cheer (応援) に統合 + activity 配下へ移動
	// #2276: CHEER_TERMS / REWARD_TERMS atom 参照化 (ADR-0045)
	cheer: CHEER_TERMS.canonical,
	rewards: REWARD_TERMS.canonical,
	activities: '活動管理',
	// #1168: チェックリスト（ナビは単一、ページ内タブで「持ち物」「ルーティン」に分離）
	checklists: 'チェックリスト',
	itemChecklists: '持ち物チェックリスト',
	routineChecklists: 'ルーティン',
	// #2295 (EPIC #2294 ①): events 削除済 (2026-05-19)
	challenges: 'チャレンジ',
	// #1170: マーケットプレイス グローバルナビ昇格 → #1212-H ADR-0041 呼称変更（テンプレート）
	// #2276: TEMPLATE_TERMS atom 参照化 (ADR-0045)
	marketplace: TEMPLATE_TERMS.short,
	children: 'こども',
	settings: '設定',
	license: 'プラン',
	billing: '請求管理',
	members: 'メンバー',
} as const;

// ============================================================
// 年齢区分ラベル（ご家族の見守り画面用）
// ============================================================

/** ご家族の見守り画面で保護者に表示する年齢区分ラベル（#537: 日本の学校制度に準拠） */
export const AGE_TIER_LABELS: Record<UiMode, string> = {
	baby: '準備モード（0〜2歳）',
	preschool: '幼児（3〜5歳）',
	elementary: '小学生（6〜12歳）',
	junior: '中学生（13〜15歳）',
	senior: '高校生（16〜18歳）',
};

/** 年齢区分の短縮ラベル（一覧表示・コンパクト表示向け） */
export const AGE_TIER_SHORT_LABELS: Record<UiMode, string> = {
	baby: '準備モード',
	preschool: '3〜5歳',
	elementary: '6〜12歳',
	junior: '13〜15歳',
	senior: '16〜18歳',
};

/**
 * 年齢区分ラベルを安全に取得
 *
 * #573: 内部コード (kinder/baby/preschool 等) が UI に漏れる回帰防止のため
 * defensive normalization を実行する。legacy コード (kinder/lower/upper/teen)
 * も正しい日本語ラベルに変換される。未知のコードの場合は fallback ラベルを返し、
 * 内部コードを直接露出しない。
 */
export function getAgeTierLabel(mode: string | null | undefined): string {
	if (!mode) return AGE_TIER_LABELS.preschool;
	const normalized = normalizeUiMode(mode);
	return AGE_TIER_LABELS[normalized];
}

/** 年齢区分の短縮ラベルを取得（#573: defensive normalization） */
export function getAgeTierShortLabel(mode: string | null | undefined): string {
	if (!mode) return AGE_TIER_SHORT_LABELS.preschool;
	const normalized = normalizeUiMode(mode);
	return AGE_TIER_SHORT_LABELS[normalized];
}

// ============================================================
// プラン名
// ============================================================

// #1916: atom (プラン名) は terms.ts (PLAN_FULL_TERMS / PLAN_TERMS) に移譲
// 本 namespace は compound として terms.ts を template literal 参照する。
export const PLAN_LABELS = {
	free: `${PLAN_FULL_TERMS.free}`,
	standard: `${PLAN_FULL_TERMS.standard}`,
	family: `${PLAN_FULL_TERMS.premium}`,
} as const;

export const PLAN_SHORT_LABELS = {
	free: `${PLAN_TERMS.free}`,
	standard: `${PLAN_TERMS.standard}`,
	family: `${PLAN_TERMS.premium}`,
} as const;

export type PlanKey = keyof typeof PLAN_LABELS;

/** プラン制限メッセージで使う共通ラベル（「スタンダードプラン以上」） */
export const PAID_PLAN_LABEL = 'スタンダードプラン以上' as const;

// ============================================================
// PLAN_GATE_LABELS — プラン制限メッセージテンプレート (#1925 Phase 2 C0)
// ============================================================
//
// アプリ本体に直書きされた「機能 X はプラン Y 以上で…」エラーメッセージを
// 共通テンプレート化する compound 層。後続 C1-C15 の各実装箇所で本 namespace
// を import してリテラル置換する際に「char-by-char 変化ゼロ」を保証するため、
// 既存メッセージと完全一致するよう PLAN_FULL_TERMS から組み立てる。
//
// テンプレート選択指針 (既存 11+ 箇所のカバレッジ):
//   - standardOrAboveFor(feature)            : "{feature}はスタンダードプラン以上でご利用いただけます"
//   - familyOnlyFor(feature)                 : "{feature}はファミリープランでご利用いただけます"
//   - familyLimitedFor(feature)              : "{feature}はファミリープラン限定です"
//   - standardOrAboveGenericWithUpgrade      : "この機能はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。"
//   - familyLimitedWithUpgradeFor(feature)   : "{feature}はファミリープラン限定です。アップグレードすると利用できます。"
//   - viewerTokenFamilyOnly                  : "ファミリープラン限定の機能です"
//
// 参照: docs/DESIGN.md §6 / Issue #1925 / terms.ts (PLAN_FULL_TERMS atom)
export const PLAN_GATE_LABELS = {
	/**
	 * "{feature}はスタンダードプラン以上でご利用いただけます"
	 *
	 * カバー対象 (C1-C15 リテラル置換):
	 *   - errors.ts: 'AI 活動提案はスタンダードプラン以上でご利用いただけます'
	 *   - cloud-export-service.ts: 'クラウドエクスポートはスタンダードプラン以上でご利用いただけます'
	 *   - admin/reports/+page.server.ts: '週次メールレポートはスタンダードプラン以上でご利用いただけます'
	 *   - admin/rewards/+page.server.ts: '特別なごほうび設定はスタンダードプラン以上でご利用いただけます'
	 *   - api/v1/export/+server.ts: 'エクスポート機能はスタンダードプラン以上でご利用いただけます'
	 */
	standardOrAboveFor: (feature: string) =>
		`${feature}は${PLAN_FULL_TERMS.standard}以上でご利用いただけます`,

	/**
	 * "無料プランではお子さま1人あたり N 個までです。スタンダードプラン以上にアップグレードすると無制限に作成できます。"
	 *
	 * #4512: checklists の上限エラー 5 箇所が「フリープラン」を直書きしていた
	 * (プラン名の SSOT は「無料プラン」で、「フリー」はカード等の短縮名。#4502 の
	 *  使い分け決裁を server 面にも適用する)。文と数値の組み立てを 1 箇所に閉じる。
	 *
	 * #4622: 引数を `number` に狭める。上限に達しうるのは上限が具体値のプランだけなので、
	 * `PlanLimitCheck` の `allowed: false` 側は `max: number` に narrowing される。
	 * null を渡す呼び出しがコンパイルで落ちるため「1人あたり null 個」を出せない。
	 */
	perChildLimitReached: (max: number) =>
		`${PLAN_FULL_TERMS.free}ではお子さま1人あたり ${max} 個までです。${PLAN_FULL_TERMS.standard}以上にアップグレードすると無制限に作成できます。`,

	/** 同上の短い版 (上限値だけを述べ、アップグレード導線は呼び出し側が別に出す場合)。 */
	perChildLimitReachedShort: (max: number) =>
		`${PLAN_FULL_TERMS.free}ではお子さま1人あたり ${max} 個までです。`,

	/** 一括取込で一部だけ入った場合の結果通知。 */
	bulkImportPartiallyLimited: (added: number | string, rejected: number | string, note: string) =>
		`${added} 件取り込みました。${PLAN_FULL_TERMS.free}の上限に達したため ${rejected} 件は取り込めませんでした。${PLAN_FULL_TERMS.standard}以上で無制限。${note}`,

	/**
	 * "{feature}はファミリープランでご利用いただけます"
	 *
	 * カバー対象:
	 *   - suggest-plan-gate.ts: '${featureLabel}はファミリープランでご利用いただけます'
	 *   - admin/checklists/+page.server.ts: 'AI チェックリスト提案はファミリープランでご利用いただけます'
	 */
	familyOnlyFor: (feature: string) => `${feature}は${PLAN_FULL_TERMS.premium}でご利用いただけます`,

	/**
	 * "{feature}はファミリープラン限定です"
	 *
	 * カバー対象:
	 *   - admin/messages/+page.server.ts: '自由テキストメッセージはファミリープラン限定です'
	 */
	familyLimitedFor: (feature: string) => `${feature}は${PLAN_FULL_TERMS.premium}限定です`,

	/**
	 * "この機能はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。"
	 *
	 * カバー対象:
	 *   - server/errors.ts: 'この機能はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。'
	 */
	standardOrAboveGenericWithUpgrade: `この機能は${PLAN_FULL_TERMS.standard}以上でご利用いただけます。プランをアップグレードしてください。`,

	/**
	 * "{feature}はファミリープラン限定です。アップグレードすると利用できます。"
	 *
	 * カバー対象:
	 *   - admin/settings/+page.server.ts: 'きょうだいランキングはファミリープラン限定です。アップグレードすると利用できます。'
	 */
	familyLimitedWithUpgradeFor: (feature: string) =>
		`${feature}は${PLAN_FULL_TERMS.premium}限定です。アップグレードすると利用できます。`,

	/**
	 * "ファミリープラン限定の機能です"
	 *
	 * カバー対象:
	 *   - api/v1/admin/viewer-tokens/+server.ts: 'ファミリープラン限定の機能です'
	 */
	viewerTokenFamilyOnly: `${PLAN_FULL_TERMS.premium}限定の機能です`,

	/**
	 * "ご家族の人数が上限（オーナーを含めて {max} 人）に達しています。…"
	 *
	 * 家族メンバー招待の quota 上限 (maxFamilyMembers) 到達時の 403 文言 (#1111 / EPIC #3533 §10.7)。
	 * 旧 `api/v1/admin/invites/+server.ts` 内ハードコードを SSOT 経由に是正 (ADR-0045 / P5)。
	 *
	 * **上限は owner を含む合計**である (#4500)。「メンバー上限（4人）」とだけ言うと、LP で
	 * 「4 人まで招待できる」と読んだ顧客が 3 人目の招待でブロックされた時に不具合と誤認する。
	 * オーナーを含む数え方であることを、ブロックされたその場で明示する。
	 */
	memberLimitReached: (max: number | string) =>
		`ご家族の人数が上限（オーナーを含めて${max}人）に達しています。これ以上の招待はプランのアップグレードが必要です。`,

	/**
	 * "カスタム活動は最大{max}個まで作成できます。プランをアップグレードしてください。"
	 *
	 * 活動 quota 上限 (maxActivities) 到達時の 403 文言 (#4622)。
	 * 旧実装は routes 7 箇所に直書きされ、`checkActivityLimit` の `max: number | null` を
	 * そのまま埋めていたため「最大 null 個」を出しうる型の穴になっていた。
	 * 引数を `number` に狭めることで、null を渡す呼び出しがコンパイルで落ちる。
	 *
	 * @param max 上限値。`allowed: false` の分岐でのみ呼ぶこと (無制限プランは上限に達しない)
	 */
	activityLimitReached: (max: number) =>
		`カスタム活動は最大${max}個まで作成できます。プランをアップグレードしてください。`,

	/**
	 * "子供は最大{max}人まで登録できます。プランをアップグレードしてください。"
	 *
	 * 子供 quota 上限 (maxChildren) 到達時の 403 文言 (#4622)。activityLimitReached と同型。
	 */
	childLimitReached: (max: number) =>
		`子供は最大${max}人まで登録できます。プランをアップグレードしてください。`,

	/**
	 * プラン制限エラー banner / toast に併記するアップグレード導線リンクのラベル (#2894 AC3)。
	 *
	 * PlanLimitError (`upgradeUrl='/admin/subscription'`) を受領した admin 取込フローで、
	 * エラーメッセージの隣に表示する `<a>` のテキスト。NN/G #9 (error recovery) 整合で
	 * 「どこへ行けば解消できるか」を必ず提示する。
	 */
	upgradeLinkLabel: `${UPGRADE_TERMS.actionVerb}する`,

	/**
	 * dropdown / メニュー内の上限到達 add 項目に付ける lock マーカーアイコン (EPIC #3533 §10.2.3)。
	 *
	 * 上限到達時の add 系メニュー項目は完全 disabled にせず locked-but-active にし
	 * (NN/G: disabled + 説明なしは dead-end アンチパターン)、本アイコンで「制約あり」を最小表現する。
	 * 選択でプラン画面へ遷移させ、制約詳細はプラン画面に一元化する (P1)。
	 * standalone button / section の quota ゲートは FeatureGate の popover が担う (§10.2.1)。
	 */
	lockedItemIcon: '🔒',
} as const;

// ============================================================
// OWNER_GATE_LABELS — owner-gate 403 / 401 エラー文言 SSOT (#3561 ①③)
// ============================================================
//
// account / tenant / members 系 owner-gate endpoint (requireRole(locals, ['owner'])
// seam、#3528 fitness#3 / #3556) の {error} body 文言を PLAN_GATE_LABELS 同様に
// compound 層へ集約する (ADR-0062 §2 error body 統一の territory)。既存 client
// 互換のため、各値は置換前のハードコード文言とバイト一致で維持する。
// endpoint 側の変換 helper は src/lib/server/auth/owner-gate.ts (ownerGateResponse)。

/** "owner のみ{action}できます" — owner-gate 403 文言の共通テンプレート (#3561 ①) */
const ownerOnly = (action: string) => `owner のみ${action}できます`;

export const OWNER_GATE_LABELS = {
	/**
	 * 401: 認証コンテキスト欠落。requireRole が throw する HttpError(401) を
	 * endpoint 文言へ変換する際の body (#3561 ③)。各 endpoint 上流の
	 * `!context` 早期 return と同一文言（バイト一致）。
	 */
	authRequired: '認証が必要です',
	/** POST api/v1/admin/account/delete (owner 系 3 pattern 共通) */
	accountDelete: ownerOnly('実行'),
	/** GET api/v1/admin/account/deletion-info */
	deletionInfo: ownerOnly('取得'),
	/** POST api/v1/admin/tenant/cancel */
	tenantCancel: ownerOnly(`${CANCEL_TERMS.canonical}申請`),
	/** POST api/v1/admin/tenant/reactivate */
	tenantReactivate: ownerOnly(`${CANCEL_TERMS.canonical}キャンセル`),
	/** DELETE api/v1/admin/members/[userId] */
	memberDelete: ownerOnly('メンバーを削除'),
	/** POST api/v1/admin/members/[userId]/transfer-ownership */
	transferOwnership: ownerOnly('権限を移譲'),
	/** POST api/v1/admin/invites (#3726、置換前文言とバイト一致) */
	inviteCreate: ownerOnly('招待を作成'),
	/** DELETE api/v1/admin/invites/[code] (#3726、置換前文言とバイト一致) */
	inviteRevoke: ownerOnly('招待を取り消し'),
} as const;

export const SUBSCRIPTION_PLAN_LABELS: Record<string, string> = {
	monthly: 'スタンダード月額',
	yearly: 'スタンダード年額',
	'family-monthly': 'ファミリー月額',
	'family-yearly': 'ファミリー年額',
	lifetime: 'ライフタイム',
} as const;

/** プランラベルを取得 */
export function getPlanLabel(tier: string): string {
	return PLAN_LABELS[tier as PlanKey] ?? tier;
}

/** サブスクリプションプランラベルを取得 (subscription-plan.ts の値 → 表示ラベル) */
export function getSubscriptionPlanLabel(plan: string): string {
	return SUBSCRIPTION_PLAN_LABELS[plan] ?? plan;
}

// ============================================================
// テーマカラー
// ============================================================

export const THEME_LABELS = {
	pink: 'ピンク',
	blue: 'ブルー',
	green: 'グリーン',
	orange: 'オレンジ',
	purple: 'パープル',
} as const;

export const THEME_EMOJIS = {
	pink: '🩷',
	blue: '💙',
	green: '💚',
	orange: '🧡',
	purple: '💜',
} as const;

export type ThemeKey = keyof typeof THEME_LABELS;

/** テーマ名ラベルを安全に取得 */
export function getThemeLabel(theme: string): string {
	const key = theme as ThemeKey;
	const emoji = THEME_EMOJIS[key] ?? '🩷';
	const label = THEME_LABELS[key] ?? theme;
	return `${emoji} ${label}`;
}

/** テーマ選択肢一覧を取得 */
export function getThemeOptions(): { value: ThemeKey; label: string; emoji: string }[] {
	return (Object.keys(THEME_LABELS) as ThemeKey[]).map((key) => ({
		value: key,
		label: THEME_LABELS[key],
		emoji: THEME_EMOJIS[key],
	}));
}

// ============================================================
// 機能名
// ============================================================

export const FEATURE_LABELS = {
	report: 'レポート',
	growthBook: 'グロースブック',
	message: 'おうえんメッセージ',
	reward: 'ごほうび',
	// #1168: チェックリストを「持ち物」「ルーティン」に分離
	checklistItem: '持ち物チェックリスト',
	checklistRoutine: 'ルーティン',
	activity: '活動',
	points: 'ポイント',
	loginBonus: 'ログインボーナス',
	challenge: 'チャレンジ',
	event: 'イベント',
	certificate: 'がんばり証明書',
	stamp: 'スタンプ',
	// #1311: 「シールガチャ」語彙を撤回、実装実体 (日 1 回 cap login omikuji + 週次 stamp card) に合わせた SSOT
	// 旧: 'シールガチャ' → 新: 'おみくじ' + 'スタンプカード' の 2 mechanic 分離 (ADR-0012 / ADR-0013 準拠)
	omikuji: 'おみくじ',
	stampCard: 'スタンプカード',
	levelUp: 'レベルアップ',
	// #1912 (F-15): 「RPG バトル」→「ボスバトル」へ統一。LP machine-tour ②「冒険のクライマックス」
	//   と語彙整合（hero / growth-roadmap が「冒険」を主訴求とする中、「RPG」は外部 IT/ゲーム業界用語のため
	//   IT リテラシーなし親 P1 が認知ジャンプを起こす）。battle 機構の内部識別子 (battle-types.ts 等) は
	//   feature 識別子として scope 外。
	rpgBattle: 'ボスバトル',
	plan: 'プラン',
	members: 'メンバー',
	dataExport: 'データエクスポート',
	// #1660 R53: 実装は activities / special-rewards / checklists の 3 endpoint で family-only gate 完備のため
	// 内部 SSOT も外部訴求 (pricing.html / plan-features.ts) と並列に「活動・ごほうび・チェックリスト」を明示
	aiActivitySuggest: 'AI による活動・ごほうび・チェックリスト提案',
} as const;

// ============================================================
// 活動優先度ラベル（#1755 / #1709-A: 「今日のおやくそく」）
// ============================================================
//
// activities.priority に対応するラベル定義。
// - must: 「今日のおやくそく」（保護者がフラグ立てした活動 → 子供 UI 専用セクションで強調表示）
// - optional: 「ふつうの活動」（既定）
//
// ※ #1168 で導入された CHECKLIST_KIND_LABELS（'item' / 'routine'）は本 Issue で削除。
//   旧 'routine' は activities.priority='must' に役割移管され、チェックリストは「持ち物」純化。

export const ACTIVITY_PRIORITY_LABELS = {
	must: '今日のおやくそく',
	optional: 'ふつうの活動',
} as const;

export type ActivityPriority = keyof typeof ACTIVITY_PRIORITY_LABELS;

export function getActivityPriorityLabel(priority: string): string {
	return (
		ACTIVITY_PRIORITY_LABELS[priority as ActivityPriority] ?? ACTIVITY_PRIORITY_LABELS.optional
	);
}

// 活動編集画面 (admin/activities/[id]/edit) での must トグル関連 UI 文言
export const ACTIVITY_PRIORITY_FORM_LABELS = {
	toggleSectionTitle: '今日のおやくそく',
	toggleLabel: '「今日のおやくそく」にする',
	toggleHint:
		'ON にすると、子供画面で「今日のおやくそく」セクションに表示され、毎日全達成でボーナスポイントが加算されます。',
	mustBadge: '今日のおやくそく',
	optionalBadge: 'ふつう',
	editPageTitle: '活動を編集',
	editBackButton: '一覧へもどる',
	editSaveButton: '保存',
	editSavedMessage: '保存しました',
	editLoadFailed: '活動の読み込みに失敗しました',
	editNotFound: '活動が見つかりません',
} as const;

// ============================================================
// UI アクション共通ラベル（一括置換容易化のための SSOT）
// ============================================================

/**
 * UI アクションで頻出する動詞・CTA 文言の SSOT。
 * 「アップグレード」「プランを見る」「あとで」「無料体験」等、
 * プロダクト全体で一貫させたい用語をここに集約する。
 *
 * labels.ts 内でもハードコードせず ACTION_LABELS を参照することで、
 * 将来「アップグレード → プラン変更」等の一括置換がこのファイル 1 行の
 * 変更で済むようにする（#1166 + #1174）。
 */
// #1958 Phase 7 H1: freeTrial / freeTrialWord / freeTrialDesc は CTA atom (terms.ts CTA_TERMS) を参照。
// upgrade / viewPlans / later / submitting / viewDetail は本 Issue scope 外 (動詞 atom が未確立のため留保)。
// #1915 (TECH-F 中頻度 D-2): upgrade を UPGRADE_TERMS.actionVerb 経由参照に変更。
//   admin UI / FAQ 既存ボタン文言は確立 UX 用語のため「アップグレード」表記維持、canonical
//   「プラン変更」化は別 Issue で段階移行。
export const ACTION_LABELS = {
	upgrade: `${UPGRADE_TERMS.actionVerb}`,
	viewPlans: 'プランを見る',
	later: 'あとで',
	freeTrial: CTA_TERMS.freeTrialNoun,
	freeTrialWord: CTA_TERMS.freeTrialVerb,
	// #1383: タイトル文脈用の可能形 (「7日間、全機能を無料で試せます」)。
	// freeTrialWord (終止形) を「〜ます」に連結すると「試すます」と非文法になるため、
	// 完全活用済みの文言を個別定数化する。
	freeTrialDesc: CTA_TERMS.freeTrialDesc,
	submitting: '開始中...',
	// #1167: 詳細ページへの誘導 CTA。活動パック / マーケット一覧の「中身を確認する」導線に使用
	viewDetail: 'くわしく見る',
} as const;

// ============================================================
// トライアル関連ラベル（#1166 景品表示法準拠）
// ============================================================

/**
 * トライアル仕様の仕様書:
 *  - Stripe Checkout 側は trial_period_days を使用しない（stripe-service.ts #314）
 *  - アプリ内 trial-service で一元管理（DEFAULT_TRIAL_DAYS = 7）
 *  - ユーザーが /admin/license から明示的にボタンを押して開始
 *  - クレジットカード登録不要、7 日後の自動課金なし
 *  - 終了後は無料プランに自動移行（tokushoho.html / terms.html と整合）
 *
 * 上記仕様のため、登録 CTA の下に「付帯」表記を書くと「登録すれば自動で
 * トライアル付帯」と誤認させる景品表示法リスクがある（Issue #1166 参照）。
 * 登録・購入系 CTA には「付帯」「付き」などの表記を書かないこと。
 * CI: tests/e2e/trial-notice-consistency.spec.ts が登録 / 購入系 CTA 近傍に
 * 「付帯」表記が出ないことを検証する（#4322 で撤去された専用 lint の後継、#4482）。
 */
// #1916: atom (トライアル日数) は terms.ts (TRIAL_TERMS) に移譲
// #3033: TrialBanner を urgent 専用に縮小し not-started / expired / active 通常の compound を撤去
// (代替: header pill / /admin/subscription / TrialEndedDialog #770 / ロック機能接触時の文脈表示)
export const TRIAL_LABELS = {
	durationDays: TRIAL_TERMS.durationDays,
	bannerTitleUrgent: `${ACTION_LABELS.freeTrial}は明日で終了します`,
	bannerDescActive: '全機能をお試しいただけます。',
	bannerCtaNotStarted: ACTION_LABELS.viewPlans,
	// #2941 項目 2: startTrial action の negative path (trialUsed=true 再押下 → fail 400) を
	// ユーザーに見える形で表示する (NN/G #1 visibility of system status)。
	// startErrorAlreadyUsed は server (subscription +page.server.ts) が fail body に入れ、
	// startErrorFallback は client (#3033 で開始導線を SaasLicensePanel に一本化後は
	// 同 panel の startTrial form) が getActionErrorDisplay の fallback に使う。
	startErrorAlreadyUsed: `${ACTION_LABELS.freeTrial}はすでに使用済みです`,
	startErrorFallback: `${ACTION_LABELS.freeTrial}を開始できませんでした。時間をおいて再度お試しください。`,
	// trial active 中は body バナーでなく header pill で残日数を常時視認させる
	// (tap で /admin/subscription へ。urgent 残 1 日以下のみ body バナー併用)
	headerPillLabel: (days: number) => `残り${days}日`,
	headerPillTitle: `${ACTION_LABELS.freeTrial}中`,
} as const;

// ============================================================
// トライアル終了予告メール用ラベル（#4482）
// ============================================================
//
// トライアル終了後に移行する無料プランの制限を述べる行。
// 保持期間の整形は formatRetentionPeriod (constants/plan-retention.ts) が SSOT。
// service 側で `${days}日` と独自整形すると、保持日数を 365 の倍数に変えたときに
// このメールだけ「365日」と述べ、料金表・LP の「1年」と食い違う。

// #4507 (GAMMA 監査 R2 #1): 旧文面は 1 日前 / 当日メールで「データは削除されません」
// 「アップグレードすればいつでも復元できます」と**無条件に**約束していた。無料プラン復帰後の
// 記録は `retention-cleanup-service` が保持期間を過ぎた分を**物理削除**するため、これは虚偽である。
// アーカイブ (上限超過分の非表示化 — 復元可能) と 保持期間切れ (物理削除 — 復元不能) は
// 別事象なので、両方を同じ 1 通の中で言い分ける。
//
// 「復元できません（再契約でも戻りません）」まで述べ切るのは #4496 の解約 / 保持期間文言と
// 同一基準（「閲覧不可」等への弱化は禁止 — 実装は物理削除であり閲覧の可否の話ではない）。

export const TRIAL_EMAIL_LABELS = {
	/**
	 * 無料プランの履歴保持期間を述べる行。
	 *
	 * 「データ保持期間」ではなく「履歴（記録）の保持期間」と呼ぶ (#4507 AC1)。
	 * アカウントやお子さまの登録そのものが期限で消えると読めてしまうため
	 * (実際に期限で消えるのは活動記録などの履歴だけ)。
	 *
	 * @param days 無料プランの保持日数 (null = 無期限)
	 */
	freeRetentionLine: (days: number | null) =>
		`履歴（記録）の保持期間: ${formatRetentionPeriod(days)}`,
	/**
	 * 上限超過リソースのアーカイブについて述べる行。**こちらは復元できる**。
	 * 保持期間切れの物理削除 (retentionIrreversibleLine) と必ず対で使う。
	 */
	archiveRestorableLine: (planLabel: string) =>
		`${planLabel}の上限を超えるお子さま・活動・チェックリストは一時的に非表示（アーカイブ）になります（データは残っており、有料プランにアップグレードすると自動で元に戻ります）。`,
	/**
	 * 保持期間を過ぎた履歴が**物理削除され復元できない**ことを述べる行 (#4507 AC1)。
	 *
	 * @param days 無料プランの保持日数 (null = 無期限)
	 */
	retentionIrreversibleLine: (days: number | null) =>
		days === null
			? '履歴（記録）の保持期間に上限はありません。'
			: `${formatRetentionPeriod(days)}を超えた履歴（記録）は削除され、復元できません（再契約でも戻りません）。`,
} as const;

// ============================================================
// 支払い失敗のお知らせメール用ラベル（#4507 GAMMA 監査 R2 #2）
// ============================================================
//
// dunning (支払い失敗 → 7 日猶予 → suspended) の**唯一の顧客向け通知**。
//
// 旧実装はこの期間の連絡を期限前リマインド (LIFECYCLE_EMAIL_LABELS.renewalSubject
// 「次回更新予定日のお知らせ」) が兼ねており、(a) 件名が支払い失敗の事実を述べず
// (b) marketing 便として配信停止 / 年 6 回上限に抑止されるため、配信停止済みの顧客は
// **1 通も受け取らないまま 7 日後に suspended** になっていた。
//
// 本メールはトランザクション便 (削除予告メールと同区分 — List-Unsubscribe を付けず
// 年 6 回上限も消費しない)。ADR-0012 整合で煽らず、事実と復旧導線だけを述べる。

export const PAYMENT_FAILED_EMAIL_LABELS = {
	subject: (daysRemaining: number) => `お支払いを確認できませんでした（残り${daysRemaining}日）`,
	heading: 'お支払いを確認できませんでした',
	greeting: (ownerName: string) => `${ownerName} 様`,
	intro:
		'ご登録のお支払い方法で、有料プランの更新料をお引き落としできませんでした。カードの有効期限切れや限度額超過が主な原因です。',
	planLine: (planLabel: string) => `ご契約プラン: ${planLabel}`,
	graceLine: (deadline: string, daysRemaining: number) =>
		`${deadline}（残り${daysRemaining}日）までにお支払い方法を更新いただければ、これまでどおりご利用いただけます。`,
	consequenceLine: (freePlanLabel: string) =>
		`更新がないまま期限を過ぎると、有料プランの機能は停止し、${freePlanLabel}のご利用に切り替わります。`,
	ctaLabel: 'お支払い方法を更新する',
	transactionalNote:
		'本メールはご契約に関する重要なご連絡のため、メールの配信設定にかかわらずお送りしています。',
} as const;

// ============================================================
// 退会（アカウント削除）通知メール用ラベル（#4507 GAMMA 監査 R2 #3）
// ============================================================
//
// 旧実装は退会の両端が未配線だった: 予約 route はメールを 1 通も送らず、
// 削除完了メール (sendDeletionCompleteEmail) は production 呼び出しゼロの dead code。
// 無料プランの退会は即時物理削除のため、**通知 0 通でデータが消えていた**。
//
// 削除予告メール (DELETION_WARNING_EMAIL_LABELS) と同じくトランザクション便。

export const DELETION_RESERVED_EMAIL_LABELS = {
	subject: '退会（アカウント削除）のお申し込みを受け付けました',
	heading: '退会のお申し込みを受け付けました',
	greeting: (ownerName: string) => `${ownerName} 様`,
	intro: '退会（アカウント削除）のお申し込みを受け付けました。',
	scheduleLine: (deletionDate: string, graceDays: number) =>
		`お申し込みから${graceDays}日後の${deletionDate}に、すべてのデータを削除します。`,
	/**
	 * 物理削除が停止中の配備で使う版 (#4721)。**削除を断定しない。**
	 *
	 * 削除が走らない状態で「この日にすべてのデータを削除します」と書くのは事実に反する。
	 * 一方で**その日を過ぎるとご自身での取り消しができなくなるのは事実**
	 * (`restoreSoftDeletedTenant` が `isExpired` で拒否する) なので、期限そのものは伝える。
	 */
	scheduleLineRetentionOnly: (deletionDate: string, graceDays: number) =>
		`お申し込みから${graceDays}日後の${deletionDate}を過ぎると、ご自身でのお取り消しができなくなります。`,
	restoreLine: (adminViewLabel: string) =>
		`削除日までは${adminViewLabel}からお取り消しいただけます。削除後のデータは復元できません。`,
	/** 削除を断定しない版 (#4721)。取り消し期限だけを述べる。 */
	restoreLineRetentionOnly: (adminViewLabel: string) =>
		`期限までは${adminViewLabel}からお取り消しいただけます。`,
	exportLine: '記録を手元に残される場合は、削除日までに書き出しをお願いいたします。',
	/** 削除を断定しない版 (#4721)。 */
	exportLineRetentionOnly: '記録を手元に残される場合は、期限までに書き出しをお願いいたします。',
	ctaLabel: 'アカウント設定を開く',
	transactionalNote:
		'本メールはお手続きに関する重要なご連絡のため、メールの配信設定にかかわらずお送りしています。',
} as const;

export const DELETION_COMPLETE_EMAIL_LABELS = {
	subject: 'データの削除が完了しました',
	heading: 'データの削除が完了しました',
	intro: 'がんばりクエストにお預かりしていたデータの削除が完了しました。',
	irreversibleNote: '削除したデータは復元できません。',
	thanks: 'ご利用いただきありがとうございました。',
	signupAgainNote: '再びご利用いただく場合は、新しいアカウントとしてお申し込みください。',
} as const;

// ============================================================
// オーナー権限移譲の通知メール用ラベル（#4507 GAMMA 監査 R2 #6）
// ============================================================
//
// 旧実装は sendMemberJoinedEmail を流用しており、(a) 件名・本文が
// 「新しいメンバーが参加しました」という別事象の説明で (b) 差し込む role に
// 内部コード 'owner' が生のまま渡っていた（内部コード UI 露出禁止、DESIGN.md §6）。

export const OWNERSHIP_TRANSFER_EMAIL_LABELS = {
	subject: 'オーナー権限が移譲されました',
	heading: 'オーナー権限が移譲されました',
	// 宛先は**新オーナー本人**なので二人称で書く (第三者の話として読ませない)。
	greeting: (memberName: string) => `${memberName} 様`,
	body: (roleLabel: string) =>
		`家族グループの「${roleLabel}」権限があなたに移譲されました。メンバーの招待・削除や、プラン・お支払いのお手続きが行えます。`,
	ctaLabel: 'メンバー管理を開く',
} as const;

// ============================================================
// ライフサイクルメール用ラベル（#1601 / ADR-0023 §3.2 §3.3 §5 I11）
//
// 期限切れ前リマインド (renewal) + 休眠復帰 (dormant) + 配信停止 (unsubscribe) の
// メール文言 SSOT。Anti-engagement 原則（ADR-0012）に従い、煽り表現
// （「今すぐアップグレード」「失効します」等）を含めない中立的トーンとする。
//
// 親宛のみ送信されるため、敬語ベース（「ご利用ありがとうございます」「ご確認ください」）。
//
// #1961 (Phase 7 H4) atom 直書き監査:
//   - planLabel は呼び出し側 (renewal-reminder service) から引数注入され、PLAN_LABELS / PLAN_FULL_TERMS
//     経由で解決済みの compound を渡す設計のため本 namespace に直書きしない。
//   - daysRemaining / days / expiresAt も全て引数注入で計算ロジック側の責務。
//   - 件名・heading・本文は「次回更新予定日」「お元気でいらっしゃいますか」等の独自用語のみで
//     構成され、プラン名・価格・トライアル日数・解約期間の atom には依存しない。
//   - 検証: 範囲内に '無料' / 'スタンダード' / 'ファミリー' / '7日間' / '7 日間' / '¥\d+' /
//     '無料プラン' / 'スタンダードプラン' / 'ファミリープラン' リテラル 0 件。
// ============================================================

export const LIFECYCLE_EMAIL_LABELS = {
	// ---- 期限切れ前リマインド（renewal-reminder） ----
	renewalSubject: (daysRemaining: number) => `次回更新予定日のお知らせ（残り${daysRemaining}日）`,
	renewalHeading: '次回更新予定日のお知らせ',
	renewalGreeting: (ownerName: string) => `${ownerName} 様`,
	renewalIntro: 'いつも がんばりクエスト をご利用いただきありがとうございます。',
	renewalPlanLine: (planLabel: string) => `ご契約プラン: ${planLabel}`,
	renewalDateLine: (expiresAt: string, daysRemaining: number) =>
		`次回更新予定日: ${expiresAt}（残り ${daysRemaining} 日）`,
	renewalContinue: 'サービスを継続される場合は、お支払い情報をご確認ください。',
	renewalGraduate: `卒業（解約）をご希望の場合は、${ADMIN_VIEW_TERMS.canonical}から手続きできます。`,
	renewalCtaLabel: 'プラン管理ページを開く',

	// ---- 休眠復帰（dormant-reactivation） ----
	dormantSubject: 'お元気でいらっしゃいますか',
	dormantHeading: 'お元気でいらっしゃいますか',
	dormantGreeting: (ownerName: string) => `${ownerName} 様`,
	dormantIntro: 'がんばりクエスト の運営です。',
	dormantSinceLastActive: (days: number) => `最後にログインされてから ${days} 日が経過しました。`,
	dormantGraduationNote: 'お子さまが卒業されたなら、何よりの成果です。',
	dormantReturnNote: 'もし戻りたい場合は、いつでもログインできます。',
	dormantPasswordNote: 'お忘れの場合は、パスワードリセットも可能です。',
	dormantCtaLabel: 'ログイン画面を開く',

	// ---- 配信停止 (unsubscribe) ----
	unsubscribeFooter: '配信停止',
	unsubscribePageTitle: 'メール配信停止',
	unsubscribeHeading: 'メール配信を停止しました',
	unsubscribeIntro:
		'今後、期限切れ前リマインド・休眠復帰メールはお送りしません。トランザクションメール（解約受付など）は引き続き送信されます。',
	unsubscribeAlreadyTitle: 'メール配信停止について',
	unsubscribeAlreadyIntro:
		'このリンクはメール配信停止用のリンクです。下のボタンを押すと、ご登録メールアドレスへのマーケティングメール配信が停止されます。',
	unsubscribeConfirmCta: '配信を停止する',
	unsubscribeReturnCta: 'トップに戻る',
	unsubscribeInvalidTitle: '無効なリンクです',
	unsubscribeInvalidIntro:
		'このリンクは無効か、すでに使用済みです。メール本文に記載されたリンクを再度ご確認ください。',

	// ---- フッター ----
	footerNote: 'このメールは「がんばりクエスト」から自動送信されています。',
	footerCopyright: '© 2026 がんばりクエスト',
} as const;

// ============================================================
// アカウント削除予告メール（#2399）
// ============================================================

// 猶予期間中のテナントに送る「このままだとデータが消えます」の予告文言 SSOT。
//
// トーン方針:
//   - Anti-engagement (ADR-0012): 「今すぐ復元!」等の煽りを置かない。事実 (予定日 / 残日数) と
//     取れる行動 (復元 / 何もしない) だけを並べる
//   - 子供の名前・活動内容は載せない (runbook §2 中立トーン原則)。宛先は保護者であり、
//     削除予告に子供の記録内容を差し込むのは引き止め目的の情報利用になる
//   - 「配信停止しても届く」ことを本文で明示する。法務通知であり購読設定の対象外であるため
export const DELETION_WARNING_EMAIL_LABELS = {
	subject: (daysRemaining: number) => `データ削除予定日のお知らせ（あと ${daysRemaining} 日）`,
	heading: 'データ削除予定日のお知らせ',
	greeting: (ownerName: string) => `${ownerName} 様`,
	intro: `お申し出いただいたアカウント${CANCEL_TERMS.account}の手続きについてお知らせします。`,
	deletionDateLine: (deletionDate: string, daysRemaining: number) =>
		`データの削除予定日: ${deletionDate}（あと ${daysRemaining} 日）`,
	irreversibleNote: '削除予定日を過ぎるとデータは元に戻せません。',
	restoreNote: (adminView: string) =>
		`削除予定日までは、${adminView}の「アカウント」から取り消し（復元）ができます。`,
	noActionNote: 'このまま削除をご希望の場合、お手続きは不要です。',
	/**
	 * 物理削除が停止中の配備で使う版 (#4721)。**削除の断定をやめ、取り消し期限だけを述べる。**
	 *
	 * 送信自体は止めない — 猶予中に「まだ戻せる」ことを思い出す接点がこのメールしかなく、
	 * 止めると復元できるのに戻らない顧客を作る。嘘をやめるのに便を止める必要はない。
	 */
	subjectRetentionOnly: (daysRemaining: number) =>
		`お取り消し期限のお知らせ（あと ${daysRemaining} 日）`,
	headingRetentionOnly: 'お取り消し期限のお知らせ',
	deadlineDateLine: (deadlineDate: string, daysRemaining: number) =>
		`お取り消しができる期限: ${deadlineDate}（あと ${daysRemaining} 日）`,
	irreversibleNoteRetentionOnly: '期限を過ぎると、ご自身でのお取り消しはできなくなります。',
	restoreNoteRetentionOnly: (adminView: string) =>
		`期限までは、${adminView}の「アカウント」から取り消し（復元）ができます。`,
	noActionNoteRetentionOnly: 'このままお手続きを進める場合、操作は不要です。',
	ctaLabel: 'アカウント設定を開く',
	transactionalNote:
		'このお知らせはお手続きに関する大切なご連絡のため、メール配信設定にかかわらずお送りしています。',
} as const;

// ============================================================
// 削除前エクスポート JSON の但し書き（#4470 / #4450 follow-up）
// ============================================================

/**
 * 退会時に顧客へ手渡す JSON (`generateMinimalExport`) の `notes` 文言 SSOT。
 *
 * トーン方針:
 *   - 事実のみを書く。法務的主張 (「○○ 法に準拠しています」等) や弁明は書かない
 *   - 読み手は開発者ではない保護者。フィールド名は識別のため原文のまま出す
 */
export const DELETION_EXPORT_NOTE_LABELS = {
	/** 日付が JST 暦日であること (ISO の UTC 表記と 9 時間ずれるため明記する) */
	jstCalendarDate: 'firstRecordDate / lastRecordDate は日本標準時（JST）の暦日です（YYYY-MM-DD）。',
	/** null の意味 (記録 0 件のみ) */
	nullMeansNoRecord: '記録が 1 件もない場合、firstRecordDate / lastRecordDate は null になります。',
	/**
	 * retention 削除済みデータは開示対象外であること + 保存期間の実日数 (#4473)。
	 *
	 * 「上限を過ぎた記録は含まれない」だけでは、読み手は「いつまで遡って含まれているか」を
	 * 確定できない。日数は `PlanLimits.historyRetentionDays` が SSOT のため、
	 * ここでは **値を持たず引数で受ける** (labels 側に 90 / 365 を複製しない)。
	 */
	// #4482: 整形は formatRetentionPeriod が SSOT（365 の倍数なら「1年間」と述べる）。
	retentionLimited: (days: number) =>
		`記録の保存期間は${formatRetentionPeriod(days)}間です。それより古い記録は削除済みのため、この期間には含まれません。`,
	/**
	 * `historyRetentionDays: null` (保存期間の上限なし) のプラン向け。
	 * 「null日間」のような値の穴埋めにせず、上限がないという事実を別文で述べる。
	 */
	retentionUnlimited: '記録の保存期間に上限はないため、期間の上限による削除は行っていません。',
	/**
	 * 登録日の在り処。
	 * `children[].createdAt` は JST 暦日ではなく ISO 8601 の UTC 日時をそのまま出しているため、
	 * 形式を併記する (併記しないと上の JST 暦日と混同され、JST 00:00〜09:00 登録が前日に見える)。
	 */
	createdAtPointer: `${CHILD_TERMS.honorific}の登録日は children[].createdAt（協定世界時 UTC の日時）をご覧ください。`,
} as const;

// ============================================================
// PMF 判定アンケート（#1598 / ADR-0023 §3.6 §5 I7）
// ============================================================

/**
 * PMF 判定アンケート (Sean Ellis Test) の文言 SSOT。
 *
 * 半年に 1 度 (年 2 回) 親宛に配信し、以下 4 問で PMF 達成度を測る:
 *   Q1: 利用できなくなったらどう感じるか (4択 + N/A) ← Sean Ellis Score の指標
 *   Q2: 主要なベネフィット (自由記述)
 *   Q3: 認知経路 (6択)
 *   Q4: 使わなかった理由 (任意・自由記述)
 *
 * Anti-engagement 整合: 親宛のみ + 年 6 回上限 (#1601 lifecycle-emails と共有カウンタ) +
 * 「ぜひお答えください！」等の煽り表現は使わない。中立トーン。
 */
export const PMF_SURVEY_LABELS = {
	// ---- メール ----
	emailSubject: 'がんばりクエストに関するアンケートのお願い',
	emailHeading: 'アンケートのお願い',
	emailGreeting: (ownerName: string) => `${ownerName} 様`,
	emailIntro: 'いつも がんばりクエスト をご利用いただきありがとうございます。',
	emailBody:
		'サービス改善のため、半年に 1 度ご利用状況についてお伺いしております。回答は任意で、所要時間は 1〜2 分です。',
	emailRoundLabel: (round: string) => `今回のアンケート: ${round}`,
	emailCtaLabel: 'アンケートに回答する',
	emailNote: '回答内容は統計目的でのみ利用し、個別のお問い合わせには使用しません。',

	// ---- 回答ページ ----
	pageTitle: 'PMF 判定アンケート',
	pageHeading: 'がんばりクエストに関するアンケート',
	pageIntro:
		'下記の質問にご回答ください。所要時間は 1〜2 分です。回答内容は統計目的でのみ利用します。',
	requiredMark: '必須',
	optionalMark: '任意',

	q1Label: 'Q1. がんばりクエストが使えなくなったら、どう感じますか？',
	q1Options: {
		very: 'とても残念',
		somewhat: 'やや残念',
		not: '残念ではない',
		na: '使ったことがない／関係ない',
	},

	q2Label: 'Q2. このサービスから得られている、主なメリットは何ですか？',
	q2Placeholder: '例: こどもが自分から記録するようになった など',

	q3Label: 'Q3. このサービスをどこで知りましたか？',
	q3Options: {
		lp: '公式サイト（検索）',
		media: '育児関連メディア',
		friend: 'ママ友・パパ友からの紹介',
		google: 'Google 検索',
		sns: 'SNS（X / Instagram など）',
		other: 'その他',
	},

	q4Label: 'Q4. もし使わなくなったとしたら、どんな理由が考えられますか？',
	q4Placeholder: '記入は任意です',

	submitCta: '回答を送信する',
	submitting: '送信中…',

	// ---- 完了画面 ----
	thanksHeading: 'ご回答ありがとうございました',
	thanksBody: 'いただいたフィードバックは、サービス改善に活かしてまいります。',
	closeCta: '閉じる',

	// ---- エラー画面 ----
	invalidTitle: '無効なリンクです',
	invalidBody:
		'このリンクは無効か、すでに使用済みです。メール本文に記載されたリンクを再度ご確認ください。',
	alreadyAnsweredTitle: '回答済みです',
	alreadyAnsweredBody: 'この回の PMF 判定アンケートには既にご回答いただいています。',

	// ---- ops 画面 ----
	opsPageTitle: 'PMF 判定アンケート結果',
	opsHeading: 'PMF 判定アンケート結果（Sean Ellis Score）',
	opsDescription:
		'年 2 回親宛に配信した PMF 判定アンケート (Sean Ellis Test) の集計。「とても残念」が 40% を超えれば PMF 達成と判定する（ADR-0023 §3.6）。',
	opsThresholdLabel: 'PMF 判定ライン (40%)',
	opsRoundLabel: '対象ラウンド',
	opsTotalLabel: '回答総数',
	opsScoreLabel: 'Sean Ellis Score',
	opsAchievedLabel: 'PMF 達成',
	opsNotAchievedLabel: 'PMF 未達',
	opsNoDataLabel: 'まだ回答がありません',

	opsBreakdownHeading: '回答の内訳',
	opsBreakdownBars: {
		very: 'とても残念',
		somewhat: 'やや残念',
		not: '残念ではない',
		na: '関係ない',
	},

	opsAcquisitionHeading: '認知経路の内訳',
	opsAcquisitionTableChannel: '経路',
	opsAcquisitionTableCount: '回答数',
	opsAcquisitionTableShare: '割合',
	opsBenefitsHeading: '主なベネフィット (自由記述)',
	opsDisappointmentHeading: '離脱要因 (自由記述)',
	opsResponseEmpty: '回答なし',
	opsResponseTenantLabel: 'テナント',
	opsResponseDateLabel: '回答日時',

	// 自由記述検索 (AC12, PO 承認 2026-04-29)
	opsSearchHeading: '自由記述キーワード検索',
	opsSearchLabel: '検索キーワード',
	opsSearchPlaceholder: '例: 記録 / 続かない / テナント ID 先頭',
	opsSearchHint: 'Q2 ベネフィット・Q4 離脱要因の本文とテナント ID を対象に部分一致検索します。',
	opsSearchSubmitLabel: '検索',
	opsSearchClearLabel: 'クリア',
	opsSearchActiveLabel: (q: string) => `「${q}」で絞り込み中`,
	opsSearchResultCount: (matched: number, total: number) => `${total} 件中 ${matched} 件表示`,
	opsSearchNoMatch: '該当する回答がありません',
} as const;

/** PMF 判定アンケートの Q1 選択肢キー */
export type PmfSurveyQ1 = keyof typeof PMF_SURVEY_LABELS.q1Options;

/** PMF 判定アンケートの Q3 選択肢キー */
export type PmfSurveyQ3 = keyof typeof PMF_SURVEY_LABELS.q3Options;

// ============================================================
// PremiumModal 用ラベル（#1166 labels.ts SSOT 化 / #1961 Phase 7 H4: 価格 atom を terms.ts 参照化）
// ============================================================

export const PREMIUM_MODAL_LABELS = {
	dialogTitle: `⭐ プランを${ACTION_LABELS.upgrade}`,
	description: 'カスタマイズ機能でお子さまにぴったりの環境を作りましょう！',
	standardFeatures: [
		'✅ オリジナル活動の追加・編集',
		'✅ チェックリストのカスタマイズ',
		'✅ ごほうびリストの自由設定',
		'✅ 子供の登録無制限',
		'✅ データのエクスポート',
	],
	familyFeatures: [
		`✅ ${PLAN_SHORT_LABELS.standard}の全機能`,
		'✅ 無制限の履歴保持',
		'✅ きょうだいの比較',
		'✅ 年間サマリーレポート',
	],
	// #1961: 価格 atom は terms.ts (PRICE_TERMS) を SSOT として参照
	priceStandard: `${PRICE_TERMS.standard}`,
	priceFamily: `${PRICE_TERMS.family}`,
	priceUnit: '/月〜',
	ctaUpgrade: `${ACTION_LABELS.upgrade}する`,
	ctaLater: ACTION_LABELS.later,
} as const;

// ============================================================
// テンプレート関連ラベル（#1174 ADR-0037 SSOT 化 / #1212-H ADR-0041 呼称変更）
// ============================================================

/**
 * テンプレート (`src/routes/marketplace/**`) の UI 文言 SSOT。
 * ADR-0041 により旧称「マーケットプレイス」→「みんなのテンプレート」/「テンプレート」へ移行。
 * URL は `/marketplace` のまま維持（内部技術用語 / ADR-0001 後方互換）。
 *
 * 既存の `MARKETPLACE_TYPE_LABELS` (`src/lib/domain/marketplace-item.ts`) は
 * アイテム種別（activity-pack / reward-set / 等）のみを扱うため、
 * それ以外のページ内テキストをここに集約する。
 *
 * LP (`site/`) で同語を扱う場合は `site/shared-labels.js` 経由で同期すること。
 */
export const MARKETPLACE_LABELS = {
	pageTitle: TEMPLATE_TERMS.userFacing,
	navShort: TEMPLATE_TERMS.short,
	pageDescription: 'お子さまの年齢にぴったりの活動・ごほうび・チェックリストを見つけよう',
	// Round 18 Cluster A (ADR-0045): 活動パック → TEMPLATE_TERMS atom 経由
	metaDescription: `${TEMPLATE_TERMS.userFacing} — 活動・ごほうび・チェックリスト・特別ルールを探そう。がんばりクエストの公式${TEMPLATE_TERMS.short}集です。`,
	filterClear: 'フィルタをクリア',
	emptyState: '条件に合うコンテンツがありません',
	ctaHeading: `${TEMPLATE_TERMS.short}を使うには`,
	ctaSubheading: `アカウント登録後、${ADMIN_VIEW_TERMS.canonical}からワンタップで使ってみることができます`,
	ctaStart: '無料で はじめる',
	backToHome: 'トップページへ',
	// #2900: 認証済みの親が marketplace を開いた際の header 戻り導線
	// (AdminLayout の「← 子供画面へ」と同型。ADR-0045 atom 経由で SSOT 統一)
	backToAdmin: `← ${ADMIN_VIEW_TERMS.short}へ`,
	breadcrumbRoot: TEMPLATE_TERMS.short,
	// Round 18 Cluster A (ADR-0045): おすすめパック → TEMPLATE_TERMS atom 経由
	recommendedSection: `おすすめ${TEMPLATE_TERMS.short}`,
	importCta: '使ってみる',
	questsBadge: 'クエスト集',
	tabs: {
		activities: 'アクティビティ集',
		rewards: 'ごほうび集',
		checklists: '持ち物リスト',
		rules: 'ルール集',
	},
	detailIncludedActivities: 'ふくまれる活動',
	detailIncludedRewards: 'ふくまれるごほうび',
	detailChecklistItems: 'チェック項目',
	detailRuleContent: 'ルール内容',
	// #3227: challenge-set 詳細見出し / プレビュー label (detailIncludedChallenges /
	// detailChallengePeriod / detailChallengeMeta) は marketplace 詳細の isChallengeSet 到達不能
	// 分岐除去に伴い参照ゼロの dead label となったため削除。
	// #2558 bug-3: detailLegacyPackNote / detailLegacyPackLink / detailLegacyPackSuffix
	// は参照ゼロの dead label (内部語彙「パック」露出元) のため削除。marketplace 取込の
	// ユーザー向けラベルは TEMPLATE_TERMS (みんなのテンプレート / テンプレート) に統一。
	detailRulePointCost: '必要ポイント',
	detailRulePointBonus: 'ボーナス',
	detailCtaSignup: 'がんばりクエストに登録して使ってみる',
	// #4711: 取込 CTA 文言を取込 4 type (activity-pack / reward-set / checklist / rule-preset) で
	// 統一する。旧実装は type ごとに 4 様 (「ご家族の見守り画面で取り込む (N件を選択中)」/
	// 「🎁 このごほうびセットを一括追加 (N件)」/「一括追加」/「📜 このルールセットを一括追加 (N件)」)
	// で、一覧の type 名 (とくべつルール) と不一致な「ルールセット」も混ざっていた。
	/** 認証済 + 子供登録済: 件数付き統一 CTA */
	detailCtaImportUnified: (count: number) => `この${TEMPLATE_TERMS.short}を取り込む (${count}件)`,
	/** 未ログイン: login へ誘導する統一 CTA */
	detailCtaImportUnifiedSignedOut: `${LOGIN_TERMS.canonical}して${TEMPLATE_TERMS.short}を取り込む`,
	// #2362 PR-3 Phase 5: activity-pack 取込 CTA (CWE-598: marketplace 側で childId を扱わずご家族の見守り画面に delegate)
	/** activity-pack ログイン済 + 子供未登録 */
	detailCtaImportActivityPackNoChildren: 'まずはお子さまを登録してください',
	/** activity-pack 未ログイン CTA 説明 (誤新規登録防止) */
	detailCtaImportActivityPackSignedOut:
		'ログイン後、ご家族の見守り画面でお子さまを選んで取り込みます',
	/** activity-pack 説明 */
	detailCtaImportActivityPackDesc:
		'取り込む際はご家族の見守り画面で「どのお子さまに追加するか」を選びます',
	// Round 18 Cluster H (#13/#16/#20/#25/#28): activity-pack subset 選択 UI 用 labels
	/** Cluster H: subset 選択セクション見出し */
	detailActivityPackSelectHeading: '取り込む活動を選ぶ',
	/** Cluster H: 選択ヒント (preschool 親「30 件は多すぎる」「歯磨きとお片付けだけ欲しい」への直接回答) */
	// #4711: 「登録済み」判定は家族全体 (全員の活動名) なので、その旨を明記する。取込先の
	// お子さまに同名の活動があれば admin 側 (child 単位 dedup) でスキップされるため既定は全選択。
	detailActivityPackSelectHint:
		'チェックを外すと取り込みません。「ご家族のどなたかに登録済み」の活動も、取り込むお子さまにまだ無ければ追加されます（同じ名前の活動があるお子さまにはスキップされます）。',
	/** Cluster H: 既存活動と name 一致した場合のバッジラベル (family 全体判定) */
	detailActivityPackAlreadyExistsBadge: 'ご家族のどなたかに登録済み',
	/** Cluster H: 全て選択ボタン */
	detailActivityPackSelectAll: 'すべて選ぶ',
	/** Cluster H: 全て解除ボタン */
	detailActivityPackDeselectAll: 'すべて外す',
	/** Cluster H: 選択件数表示 (例: 「12件 / 30件 を取り込みます」) */
	detailActivityPackSelectedCount: (selected: number, total: number) =>
		`${selected}件 / ${total}件 を取り込みます`,
	/** Cluster H: 0 件選択時の inert 状態説明 */
	detailActivityPackSelectedZero: '取り込む活動を 1 件以上選んでください',
	// #4705: 無料プランは商品登録ができない。押す**前**に条件と次の行き先を示す
	// (子供を選ばせてから拒否しない)。実ゲートは isCustomRewardUnlocked (#4584)。
	detailImportLockedTitle: `${REWARD_TERMS.productRegistration}は${PLAN_FULL_TERMS.standard}以上でご利用いただけます`,
	detailImportLockedDesc: `${PLAN_FULL_TERMS.free}でも活動の記録・ポイント・レベルはそのままお使いいただけます。取り込んだごほうびをショップに並べるには、プランのアップグレードが必要です。`,
	detailImportLockedCta: 'プランを見る',
	/** #2136 MP-1: ログイン後の reward 取込誘導 */
	detailCtaImportRewardSignedOut: '一括追加するには登録 / ログインが必要です',
	/** #2136 MP-1: 取込先の子供選択ラベル */
	detailCtaSelectChild: 'お子さまを選択',
	/** #2136 MP-1: 重複ありの preview 文言 */
	detailRewardImportPreview: (newCount: number, dup: number) =>
		dup > 0
			? `新規 ${newCount} 件 / 重複 ${dup} 件（重複はスキップされます）`
			: `${newCount} 件のごほうびを追加します`,
	/** #2136 MP-1: 取込完了メッセージ */
	detailRewardImportSuccess: (count: number) => `✨ ${count} 件のごほうびを追加しました`,
	/** #2136 MP-1: 取込時に全件重複 */
	detailRewardImportAllDuplicates: 'このごほうびセットは既に追加済みです',
	/** #2136 MP-1: お子さま未登録時の誘導 */
	detailRewardImportNoChildren: 'まずはお子さまを登録してください',
	/** #2362 PR-4 (ADR-0055 / CWE-598): marketplace 取込ボタン下のヒント (admin 側でダイアログ) */
	detailRewardImportPerChildHint:
		'取り込む際はご家族の見守り画面で「どのお子さまに追加するか」を選びます',
	// #2137 (MP-2): event-checklist 取込 CTA 説明 (CTA 本体は detailCtaImportUnified、#4711)
	detailCtaImportChecklistDesc:
		'お子さまの「持ち物リスト」へまとめて追加します（重複時はスキップ）',
	detailChildSelectLabel: 'どのお子さまに追加しますか？',
	detailImportSuccess: (n: number) => `${n}件のチェック項目を追加しました`,
	detailImportDuplicate: (templateName: string) =>
		`「${templateName}」は既に取込済みのためスキップしました`,
	detailImportError: 'インポートに失敗しました',
	// #2138 (MP-3): rule-preset 取込 CTA 説明 (CTA 本体は detailCtaImportUnified、#4711)
	detailCtaImportRuleDescBonus:
		'ご家族の見守り画面の「ルール」セクションに追加されます（取込後 ON/OFF できます）',
	detailCtaImportRuleDescExchange:
		'お子さまの「ごほうび」一覧にポイント交換アイテムとして追加されます',
	// #4711: 顧客向け文言に統一 (内部語 penalty / special / ADR / no-op を出さない)
	detailCtaImportRuleDescPenalty:
		'⚠️ このルールは現在取り込めません（ペナルティ型のルールは慎重に検討中です）。',
	detailCtaImportRuleDescSpecial: '⚠️ このルールは現在取り込めません（今後追加予定の種類です）。',
	detailRuleImportSuccessBonus: (presetName: string) =>
		`✨ 「${presetName}」を追加しました。ご家族の見守り画面の「ルール」で ON/OFF できます。`,
	detailRuleImportSuccessExchange: (presetName: string, count: number) =>
		`✨ 「${presetName}」: ${count} 件のポイント交換アイテムを追加しました`,
	detailRuleImportDuplicate: (presetName: string) => `⚠️ 「${presetName}」は既に取込済みです`,
	detailRuleImportWarning: (msg: string) => `⚠️ ${msg}`,
	detailRuleImportNoChildrenExchange: 'まずはお子さまを登録してください',
	detailCtaImportRuleSignedOut: '一括追加するには登録 / ログインが必要です',
	detailRuleImportLinkToBonusList: '取込済ルール一覧へ →',
	detailRuleImportLinkToRewardsList: 'ごほうび一覧へ →',
	backToTypeListSuffix: '一覧に戻る',
	typeCountSuffix: '種',
} as const;

// ============================================================
// マーケットプレイス フィルタラベル（#1171 SSOT）
// ============================================================

/**
 * マーケットプレイスのフィルタ UI で使うラベルの SSOT。
 * #1171: フィルタ UI 刷新（年齢ラベル統一 / 性別 / 並び替え / モバイル bottom sheet）。
 * `src/routes/marketplace/+page.svelte` からハードコードを排除する。
 */
export const MARKETPLACE_FILTER_LABELS = {
	sectionTitle: 'しぼりこむ',
	age: '年齢',
	gender: '性別',
	tag: 'タグ',
	type: '種類',
	sort: 'ならべかえ',
	resultCount: (n: number) => `${n}件`,
	reset: 'フィルタをクリア',
	open: 'フィルタ',
	close: 'とじる',
	apply: 'この条件で探す',
	empty: '条件に合うコンテンツがありません',
	genderOptions: {
		all: 'すべて',
		boy: '男の子向け',
		girl: '女の子向け',
		neutral: 'どちらも',
	},
	sortOptions: {
		popularity: '人気順',
		newest: '新着順',
		ageFit: '年齢順',
	},
	// Round 18 Cluster C: 年齢 filter 既定 ON 化 (selectedChildId 経由) 時の hint + 解除動線
	// #4711: 名前 (nickname、「さくらちゃん」等の呼び名を含む) があるときは敬称を重ねない。
	autoAgeFilterApplied: (childName: string, ageTierLabel: string) =>
		childName
			? `${childName} (${ageTierLabel}) に合わせて表示中`
			: `${CHILD_TERMS.honorific} (${ageTierLabel}) に合わせて表示中`,
	clearAgeFilter: 'すべての年齢を表示',
	// Round 18 Cluster I (#11/#15/#19): 50+ 件 tag 並列が認知負荷過多のため、人気 N 件 default + expansion
	// Hick's Law (DESIGN.md §10) + ADR-0012 (Anti-engagement、user 意図的操作のみで展開) 整合
	expandTags: (remainingCount: number) => `もっと見る (残 ${remainingCount} 件)`,
	collapseTags: 'タグをたたむ',
} as const;

export type MarketplaceGender = 'boy' | 'girl' | 'neutral';
export type MarketplaceSortKey = keyof typeof MARKETPLACE_FILTER_LABELS.sortOptions;

// ============================================================
// チュートリアル関連ラベル（#961 QA: quickMode 対応）
// ============================================================

export const TUTORIAL_LABELS = {
	/** AdminHome 等から全チャプターを最初から見る導線 */
	viewFullGuide: 'くわしいガイドを最初から見る',
	viewFullGuideHint: 'すべてのチャプター（活動管理・報酬・レポートなど）を順番に確認できます',
	openGuide: 'ガイドを開く',
	/** クイック完了ダイアログのボタン */
	quickFinish: '使い始める',
	quickContinue: 'もっと詳しく見る',
	/** #1192: 再開プロンプト */
	resumeTitle: 'チュートリアルの続き',
	resumePrompt: '前回の途中から続けますか？',
	resumeCancel: 'キャンセル',
	resumeFromStart: '最初から',
	resumeContinue: '続きから',
	/** #1192: クイック完了ダイアログ本文 */
	quickCompleteTitle: '基本の使い方を確認しました！',
	quickCompleteBody: 'ここからは実際にお子さまを登録して使い始めましょう。',
	quickCompleteHint:
		'残りのガイド（活動管理・報酬・レポートなど）は、いつでもヘッダーの「❓」ボタンから確認できます。',
	/** #1192: 終了確認ダイアログ */
	exitConfirmAriaLabel: 'チュートリアル終了確認',
	exitConfirmPrompt: 'チュートリアルを終了しますか？',
	exitConfirmHint: '進捗は保存されるので、後から続きを再開できます。',
	exitConfirmCancel: '続ける',
	exitConfirmConfirm: '終了する',
} as const;

// ============================================================
// チュートリアル章・ステップのテキスト SSOT（#1465 Phase B Priority 2）
// tutorial-chapters.ts から移行。動的テキスト（NAV_CATEGORIES 参照等）は
// tutorial-chapters.ts 側で PLAN_LABELS 等と組み合わせて構築する。
// ============================================================

export const TUTORIAL_CHAPTER_LABELS = {
	chapters: {
		intro: { title: 'はじめに', icon: '🏠' },
		children: { title: 'こどもの登録', icon: '👧' },
		activities: { title: '活動の管理', icon: '📋' },
		rewards: { title: '報酬とポイント', icon: '🎁' },
		reports: { icon: '📊' },
		messages: { icon: '💬' },
		customize: { icon: '🎮' },
		settings: { title: '設定と日常の使い方', icon: '⚙️' },
		upgrade: { title: 'アップグレード', icon: '⭐' },
	},
	steps: {
		'intro-1': {
			title: 'ナビゲーション',
		},
		'intro-2': {
			title: 'ダッシュボード',
			description:
				'こどもの人数やポイントの合計がひと目で分かるサマリーです。「今こどもたちは合計何ポイント持っているかな？」を確認したい時にまずここを見てください。',
		},
		'intro-3': {
			title: '今月のがんばり',
			description:
				'こどもごとの今月の活動回数・レベル・実績がひと目で分かるサマリーです。「今月はどのくらい頑張ったかな？」を毎日チェックしてみましょう。詳しくはレポート画面で確認できます。',
		},
		'intro-4': {
			title: 'こども一覧（ホーム）',
			description:
				'登録したこどもの名前・年齢・ポイント残高が表示されます。「きょうだいそれぞれ今どのくらい頑張ってるかな？」をホーム画面から確認できます。',
		},
		'children-1': {
			title: 'こどもを追加',
			description:
				'まだこどもを登録していない場合はここから追加しましょう。ニックネーム・生年月日・テーマカラーを設定すると、こども専用の画面が作られます。きょうだいがいれば複数登録できます。',
		},
		'children-2': {
			title: 'こども一覧',
			description:
				'登録済みのこどもが一覧で並びます。「こどもの年齢設定を変更したい」「テーマカラーを変えたい」時は、名前をタップして編集画面へ進みましょう。',
		},
		'children-3': {
			title: 'こどもの詳細',
			description: `各こどもの名前・年齢・ポイント残高が表示されます。「こどもごとの進捗をざっくり把握したい」時にここを見てください。\n\n⭐ ${PLAN_FULL_TERMS.free}ではこどもを2人まで登録できます。3人以上のきょうだいがいる場合は${PLAN_FULL_TERMS.standard}以上で無制限に登録できます。`,
		},
		'activities-1': {
			title: '活動一覧',
			description:
				'こどもが記録できる活動の一覧です。各活動の獲得ポイントや1日の上限回数を確認・編集できます。「このポイント多すぎるかな？」と思ったらここで調整しましょう。',
		},
		'activities-2': {
			title: 'カテゴリで絞り込み',
			description:
				'活動は「うんどう」「べんきょう」「せいかつ」などのカテゴリに分かれています。「うんどう系の活動を見直したい」など、目的に合わせて絞り込めます。',
		},
		'activities-3': {
			title: '活動の追加',
		},
		'rewards-1': {
			title: '特別報酬',
			description:
				'「お手伝いを自分から進んでやった」「テストでいい点を取った」など、日常の活動記録とは別に特別なポイントを贈りたい時に使います。理由を添えてポイントを渡しましょう。\n\n⭐ ごほうびアイテムの設定はスタンダードプラン以上で利用できます。',
		},
		'rewards-2': {
			title: 'おこづかい変換',
			description:
				'貯まったポイントをおこづかいに交換する画面です。「500ポイント貯まったからおこづかいにしよう」という時に使います。変換履歴で月の合計額も確認できます。',
		},
		'reports-1': {
			title: 'レポート画面',
			description:
				'こどもの活動を月次・週次で振り返れるレポート画面です。上部のタブで「月次レポート」と「週次レポート」を切り替えられます。「今月はどんな活動が多かったかな？」を確認しましょう。',
		},
		'reports-2': {
			title: 'グロースブック',
			description:
				'こどもの1年間の成長をまとめた「成長記録ブック」も用意しています。レポート画面右上の「📖 記録ブック」リンクからアクセスできます。印刷してお子さまの記念にもなります。',
		},
		'messages-1': {
			title: 'メッセージ送信',
			description:
				'こどもにおうえんメッセージを送れる画面です。まず送りたいこどもを選んで、スタンプまたはテキストメッセージを選びましょう。こどもの画面にメッセージが届きます。',
		},
		'messages-2': {
			title: 'スタンプの送り方',
			description:
				'スタンプを選択して「送信」ボタンを押すだけで、こどもにおうえんの気持ちを伝えられます。「がんばったね！」「すごい！」など、お子さまが喜ぶスタンプが揃っています。',
		},
		'customize-1': {
			title: 'データ管理',
			description: `家族のデータを${BACKUP_TERMS.file}として書き出して保存したり、別の環境で${BACKUP_TERMS.restoreVerb}できます。機種変更やデータの引っ越しに便利です。`,
		},
		'settings-1': {
			title: 'こども画面へ切替',
		},
		'settings-2': {
			description: `${ADMIN_VIEW_TERMS.canonical}へのアクセスを保護する`,
			descriptionSuffix:
				'を変更できます。こどもに勝手にポイントを変えられないよう、定期的に変更するのがおすすめです。',
		},
		'settings-3': {
			title: 'フィードバック',
			description:
				'「こんな機能がほしい」「ここが使いにくい」など、何でもお聞かせください。いただいた声をもとにアプリを改善していきます。',
		},
		'settings-4': {
			title: 'チュートリアルの再開',
			description:
				'このチュートリアルは、ヘッダーの「？」ボタンからいつでも見直せます。使い方に迷った時はお気軽にどうぞ。お疲れさまでした！',
		},
		'premium-1': {
			title: 'プラン比較・アップグレード',
			description:
				'各機能のガイドで ⭐ マークが付いた機能はスタンダードプラン以上で利用できます。「⭐ アップグレード」ボタンからプラン比較ページへ進み、お子さまに最適なプランをお選びください。7日間の無料トライアル付きです。',
		},
	},
} as const;

// ============================================================
// ページ別オンデマンドガイド（PageGuide）の表示文言 SSOT
// #3264 (EPIC #3260 F3): 各 `_guide.ts` (admin 11 ページ) にインライン直書きしていた
// 表示文言 (title / what / how / goal / tips) を本 compound に集約。
// `_guide.ts` は本定数を参照するだけにし、構造フィールド (pageId / icon / selector /
// position / requiredTier / step id) は `_guide.ts` 側に残す（表示文言ではないため）。
// 構造は page → step → field のネスト（TUTORIAL_CHAPTER_LABELS と同型、ADR-0045 compound 層）。
// 本定数の文言を検査する linter は無い（機械強制は無い。レビューで担保する）。
// ============================================================

export const PAGE_GUIDE_LABELS = {
	adminHome: {
		title: 'ホーム（ダッシュボード）',
		steps: {
			'home-intro': {
				title: 'このページについて',
				what: `${ADMIN_VIEW_TERMS.canonical}のホームです。お子さま全員の「今日のがんばり」と各機能への入り口がここに集まっています。`,
				how: '毎日ここを開くだけで、お子さまの活動状況をまとめて確認できます。詳しい操作はこのあと順番にご案内します。',
				goal: '朝・夜のすきま時間にここを開けば、家族みんなのがんばりを 10 秒で把握でき、声かけのきっかけが見つかります。',
			},
			'home-summary': {
				title: '画面の見方（今日のサマリー）',
				what: '画面の上部には、お子さま全員の今日の活動回数・獲得ポイント・レベルの概要がカードで並びます。',
				how: '特に操作は不要です。ページを開くと自動的に最新の情報が表示されます。',
				goal: '「今日はたくさんやったね！」と声をかけるタイミングが、開いた瞬間に分かります。',
			},
			'home-nav': {
				title: 'よく使う操作（各機能へ移動）',
				what: '最もよく使うのが、各機能への移動です。画面下部のナビゲーションから「みまもり」「やること」「はげまし」「きろく」に移動できます。',
				how: '1. 画面下部のアイコンをタップします\n2. 目的のカテゴリを選びます\n3. サブメニューから該当する画面をタップします',
				goal: 'どの画面からでも 2 タップ以内で目的の機能にたどり着けます。',
				tips: ['デスクトップ版ではヘッダーのドロップダウンメニューから同じ機能に移動できます'],
			},
		},
	},
	adminActivities: {
		title: '活動管理',
		steps: {
			'activities-intro': {
				title: 'このページについて',
				what: 'お子さまが記録する「活動」を管理するページです。習い事・お手伝い・家庭ルールなど、ご家庭オリジナルのがんばりをポイント化できます。',
				how: '初期登録の活動に加えて、独自の活動を追加・編集できます。設定した活動はお子さまの画面にカードとして並びます。',
				goal: 'お子さまがタップして記録するたびにポイントが貯まり、「今月ピアノを何回練習したか」までレポートで見えるようになります。',
			},
			'activities-filter': {
				title: '画面の見方（カテゴリで絞り込み）',
				// #4512: 実在しない「おてつだい」を挙げ「こうりゅう」を落としていた。
				//   列挙は categories.ts (SSOT) から作る (手書きだとカテゴリ増減で取り残される)
				what: `活動は5つのカテゴリ（${CATEGORY_NAME_LIST}）に分かれています。上部のフィルターで表示を絞り込めます。`,
				how: '1. カテゴリボタンをタップして絞り込みます\n2. もう一度タップすると解除されます',
				goal: '活動が増えても「うんどう系だけ表示」のように、目的の活動を素早く見つけられます。',
			},
			'activities-add': {
				title: 'よく使う操作（活動の追加）',
				what: '最もよく使うのが活動の追加です。「＋ 追加」メニューから手動作成・AI 提案・みんなのテンプレートからの取り込みを選べます。',
				how: '1. 「＋ 追加」ボタンをタップ\n2. 追加方法を選びます\n3. 活動名・カテゴリ・アイコン・ポイント・1日の上限回数を設定\n4. 「保存」をタップ',
				goal: 'お子さまの画面に新しい活動カードが表示され、記録するとポイントが貯まり、月次レポートにも反映されます。',
				tips: [
					'ポイントは初期活動とのバランスを見て設定しましょう（高すぎるとインフレします）',
					'1日上限回数を設定すると、連打によるスパムを防げます',
				],
			},
		},
	},
	adminChallenges: {
		title: 'チャレンジ管理',
		steps: {
			'challenges-intro': {
				title: 'このページについて',
				what: 'チャレンジは、日々の活動とは別の「中期的なゴール」です。アプリが毎週、お子さまの記録の傾向にあわせて、苦手なことや得意なことを伸ばす目標を自動で用意します。このページでは、そのチャレンジを保護者が一覧で見守れます。',
				how: '設定や作成は不要です。お子さまがアプリを開くと今週のチャレンジが自動で用意され、ここに表示されます。すべてのプランでご利用いただけます。',
				goal: 'お子さまの画面に進捗バーが表示され、達成に近づく様子が見えます。期間内に達成すると特別な演出でお祝いされます。',
			},
			'challenges-view': {
				title: '画面の見方',
				what: '自動で用意された今週のチャレンジと、これまでの履歴が並びます。お子さまごとの進捗バーで達成までの道のりが見え、きょうだいで同じ目標に取り組むときはみんなの進捗が並んで表示されます。',
				how: '上に今週のチャレンジ、その下に過去の履歴が並びます。各カードの進捗バーで達成度を確認できます。',
				goal: 'どのお子さまが何にどれくらい取り組んでいるかを、設定の手間なく見守れます。',
			},
			'challenges-manage': {
				title: 'よく使う操作（絞り込みと削除）',
				what: 'お子さまが複数いるときは、上のタブで子ごとに絞り込めます。合わないチャレンジはカードから取り除けます。',
				how: '1. お子さまタブで見たい子に切り替えます\n2. 不要なチャレンジは各カードの「削除」で取り除きます',
				goal: '見たいお子さまの取り組みだけを表示でき、合わない目標を整理できます。削除しても翌週また自動で用意されます。',
				tips: ['チャレンジはアプリが自動で用意するので、保護者が目標を作る必要はありません'],
			},
		},
	},
	adminChecklists: {
		title: 'チェックリスト管理',
		steps: {
			'checklists-intro': {
				title: 'このページについて',
				what: 'お子さまが「学校の準備」「習い事の持ち物」「寝る前のしたく」などを自分で確認できるチェックリストを、お子さまごとに用意するページです。',
				how: 'テンプレートを取り込むか新しく追加して、配信するお子さまを選びます。有効にしたチェックリストはお子さまの画面に表示されます。',
				goal: 'お子さまが自分でタップして「できた！」を確認できるようになり、「ハンカチ持った？」と毎朝聞く必要がなくなります。',
			},
			'checklists-header': {
				title: '画面の見方（このページの役割）',
				what: 'ここはチェックリストの管理画面です。お子さまごとにチェックリストを作成・編集し、子供の画面への配信を切り替えます。',
				how: '1. 対象のお子さまを選びます\n2. 既存のテンプレートを編集するか、新しく追加します\n3. 有効化したテンプレートがお子さまの画面に表示されます',
				goal: '朝の支度や寝る前のルーティンを、声かけなしでお子さま自身が進められるようになります。',
			},
			'checklists-marketplace': {
				title: 'よく使う操作（テンプレートから取り込む）',
				what: '最も手軽なのが、みんなのテンプレートからの取り込みです。小学校の時間割・遠足・プールの日など、よくあるチェックリストをそのまま使えます。',
				how: '1. 「みんなのテンプレートを見る」をタップ\n2. マーケットプレイスでチェックリストを選びます\n3. 「使ってみる」から取り込み、配信するお子さまを選びます',
				goal: '選んだチェックリストがお子さまのチェックリストに追加されます。家庭に合わせて項目を足したり消したりして調整できます。',
				tips: [
					'まずはテンプレートを取り込んで、ご家庭に合わせて調整するのが近道です',
					'季節やイベントごとにテンプレートを切り替えると管理が楽になります',
				],
			},
		},
	},
	adminCheer: {
		title: '応援',
		steps: {
			'cheer-intro': {
				title: 'このページについて',
				what: 'お子さまのがんばりに、その場で応援を届けるページです。理由と任意のボーナスポイントを添えて、すぐに気持ちを伝えられます。',
				how: '送り先のお子さまを選び、応援する理由を入力して送るだけです。毎日の活動ポイントは活動タブから、その場でひと押ししたい応援はこちらから。',
				goal: '「親が見ていて、すぐに認めてくれる」体験になり、お子さまの継続のモチベーションを支えます。',
			},
			'cheer-select': {
				title: '画面の見方（送り先を選ぶ）',
				what: 'まず上部で、応援を送るお子さまを選びます。選んだお子さま宛てに応援が届きます。',
				how: '1. お子さまのボタンをタップして選びます\n2. 選んだお子さまが強調表示されます',
				goal: '兄弟姉妹がいても、応援したいお子さまを取り違えずに選べます。',
			},
			'cheer-reason': {
				title: 'よく使う操作（応援を送る）',
				what: '最もよく使うのが応援の送信です。応援する理由を入力し、ボーナスポイントやスタンプを添えて送ります。',
				how: '1. 応援する理由を入力（例:「うんどうかいで 1いに なったよ！」）\n2. ボーナスポイント・カテゴリ・アイコンを選択\n3. 必要なら付随のスタンプ／メッセージを添える\n4. 「応援する」をタップ',
				goal: 'お子さまの画面にメッセージとポイントが届きます。具体的に褒めると効果が高まります。',
				tips: [
					'すごい瞬間にはポイント多め、日常のがんばりには少なめ、と使い分けると価値が伝わります',
					'送った応援の履歴は、お子さまを選ぶと下部に表示されます（既読／未読も確認できます）',
				],
			},
		},
	},
	adminChildren: {
		title: 'こども管理',
		steps: {
			'children-intro': {
				title: 'このページについて',
				what: 'お子さまを登録・管理するページです。お子さまごとに専用の画面が作られ、活動・ポイント・レベルが個別に記録されます。',
				how: 'まずはお子さまを 1 人登録するところから始めます。登録すると、年齢に合わせて画面表示（ひらがな／漢字など）が自動で切り替わります。',
				goal: '兄弟姉妹それぞれの専用画面ができ、テーマカラーで取り違えることなく一人ひとりの成長を見守れます。',
			},
			'children-list': {
				title: '画面の見方（お子さま一覧）',
				what: 'このページには登録済みのお子さまのカードが並びます。各カードでポイント残高・レベル・カテゴリ別の活動状況を確認できます。',
				how: '1. お子さまのカードをタップします\n2. プロフィール詳細が表示されます\n3. 「編集」で名前やテーマカラーを変更できます',
				goal: 'お子さまが複数いても、それぞれの進捗や得意分野をひと目で見比べられます。',
			},
			'children-add': {
				title: 'よく使う操作（お子さまの追加）',
				what: '最初に行うのがお子さまの追加です。名前・生年月日・テーマカラーを登録します。',
				how: '1. 「＋ こどもを追加」ボタンをタップ\n2. ニックネームを入力（ひらがな推奨）\n3. 生年月日を設定\n4. テーマカラーを選択\n5. 「保存」をタップ',
				goal: 'お子さま専用の画面が作成され、活動の記録・ポイント管理・レベルアップが個別に追跡されます。',
				tips: [
					'年齢によって画面の文字表現が自動で変わります（3歳→全部ひらがな、小学生→漢字まじり）',
					'テーマカラーは後から変更できます',
				],
			},
		},
	},
	adminPoints: {
		title: 'ポイント交換',
		steps: {
			'points-intro': {
				title: 'このページについて',
				what: 'お子さまが活動で貯めたポイントを、おこづかいやご褒美に交換するページです。ポイントの「使い道」を見せることが、貯めるモチベーションになります。',
				how: 'お子さまを選んで交換ポイント数を指定し、交換を確定します。交換すると残高が引かれ、履歴に記録されます。',
				goal: '「500ポイント貯めたら交換しようね」という約束が実現でき、お子さまにお金の感覚も育ちます。',
			},
			'points-balances': {
				title: '画面の見方（残高の一覧）',
				what: '上部にお子さまごとのポイント残高カードが並びます。カードをタップすると、そのお子さまの交換フォームが下に開きます。',
				how: '1. 交換したいお子さまのカードをタップします\n2. 選んだお子さまの残高が強調表示されます',
				goal: '誰がどれだけ貯めているかをひと目で把握でき、交換の対象をすぐ選べます。',
			},
			'points-convert': {
				title: 'よく使う操作（ポイントの交換）',
				what: '最もよく使うのがポイントの交換です。残高カードをタップすると、その下に交換フォームが開き、「かんたん」「じぶんで」「レシート」の3つの方法から選べます。',
				how: '1. お子さまの残高カードをタップ\n2. 交換方法のタブを選択\n3. 交換ポイント数を指定（残高が足りない場合はグレーアウト）\n4. 「交換する」をタップで確定',
				goal: 'お子さまの残高から交換分が引かれ、交換履歴に記録されます。定額おこづかいにも、ご褒美交換にも使えます。',
				tips: [
					'交換レートは設定画面で変更できます（例: 100ポイント = 100円）',
					'画面下部の交換りれきで、月別の交換実績を確認できます',
				],
			},
		},
	},
	adminReports: {
		title: 'レポート',
		steps: {
			'reports-intro': {
				title: 'このページについて',
				what: 'お子さまのがんばりを、月ごと・週ごとにまとめて振り返るページです。活動回数・レベルアップ・前の期間との比較がひと目でわかります。',
				how: '「月次」「週次」のタブを切り替えて、見たい期間のレポートを表示します。',
				goal: '「今月はうんどうを20回頑張ったね！先月より5回多いよ」と、具体的な数字でお子さまを褒められます。',
			},
			'reports-tabs': {
				title: '画面の見方（月次／週次の切り替え）',
				what: 'タブで「月次」と「週次」を切り替えます。月次は1ヶ月の総まとめ、週次は曜日別・カテゴリ別の傾向が見られます。',
				how: '1. 「月次」「週次」タブをタップして切り替えます\n2. 月次は ◀ ▶ で月を移動できます\n3. 前の期間との差分が色付きで表示されます（赤=減少、緑=増加）',
				goal: '「平日は頑張っているけど土日が少ない」のような傾向に気づけ、次の声かけのヒントになります。',
			},
			'reports-growth-book': {
				title: 'よく使う操作（賞状・成長ブック）',
				what: 'レポートから、お子さまの頑張りを「修了証（賞状）」として印刷したり、長期的な成長を「成長ブック」で振り返ったりできます。',
				how: '1. このリンクから賞状・成長ブックのページを開きます\n2. 印刷・保存して、お子さまと一緒に振り返ります',
				goal: 'がんばりを形に残せるので、お子さまの達成感が大きくなり、次の目標への意欲につながります。',
			},
		},
	},
	adminRewards: {
		title: 'はげまし・ごほうび',
		steps: {
			'rewards-intro': {
				title: 'このページについて',
				what: 'お子さまを応援する「ごほうび」を管理するページです。子供のごほうびショップに並べるプレゼント（おこづかい・ゲーム時間・おやつなど）を用意できます。',
				how: 'プリセットから選ぶか、オリジナルのごほうびを作成して、お子さまごとに配信します。その場でひと押ししたい応援は応援ページをご利用ください。',
				goal: 'お子さまが貯めたポイントでごほうびと交換できるようになり、「がんばれば叶う」体験がモチベーションを支えます。',
			},
			'rewards-child-tabs': {
				title: '画面の見方（お子さまの切り替え）',
				what: '上部のタブで、ごほうびを管理するお子さまを切り替えます。タブの数字はそのお子さまに登録済みのごほうび数です。',
				how: '1. お子さまのタブをタップして選びます\n2. その下に、選んだお子さまのごほうび一覧が表示されます',
				goal: 'お子さまごとに別々のごほうびを用意できるので、年齢や興味に合わせた応援ができます。',
			},
			'rewards-add': {
				title: 'よく使う操作（ごほうびの追加）',
				what: '最もよく使うのがごほうびの追加です。テンプレートから選ぶか、下の作成フォームでタイトル・ポイント・アイコンを決めてオリジナルを作成します。',
				how: '1. テンプレートから選ぶか、オリジナルのごほうびを作成\n2. タイトル・ポイント・アイコンを設定\n3. 「追加する」をタップ',
				goal: '子供のごほうびショップにごほうびが並び、お子さまが貯めたポイントで交換できるようになります。',
				tips: ['ポイントは通常の活動の10〜50回分くらいが目安です（多すぎるとインフレします）'],
			},
		},
	},
	adminSettings: {
		title: '設定',
		steps: {
			'settings-intro': {
				title: 'このページについて',
				what: `${ADMIN_VIEW_TERMS.canonical}の各種設定をまとめたページです。アクセスを守る${OYAKAGI_TERMS.shortName}、ポイントの表示単位、データのバックアップなどをここから設定します。`,
				how: '設定したい項目のカードを選んで、その中の設定画面に進みます。',
				goal: `必要な設定にすぐたどり着けるので、${OYAKAGI_TERMS.shortName}の変更やバックアップなどの「念のための備え」を迷わず行えます。`,
			},
			// #3954: hub のカードが 6→7 枚になったため、件数と「上から順に」の並びを実装に合わせる。
			// ここが古いと、ガイドに従う保護者は列挙された 6 件の中に ごほうび・ボーナスルール を
			// 見つけられず、カードを追加しても到達できない (#2905 と同じ形)。
			// 件数と列挙数の一致は tests/unit/routes/settings-hub-coverage.test.ts [S5] / [S6] で gate 化。
			'settings-hub': {
				title: '画面の見方（7つの設定グループ）',
				what: '設定は目的別に7つのカードに分かれ、上から順に並びます。それぞれで何ができるかを上から見ていきます。',
				how: `上から順に:\n1. アカウント — ${OYAKAGI_TERMS.shortName}の変更や${CANCEL_TERMS.account}\n2. 活動・ポイント — やる気が続く設定\n3. 通知 — お知らせの受け取り\n4. データ — ${BACKUP_TERMS.exportNoun}と${BACKUP_TERMS.restoreVerb}\n5. ごほうび・ボーナスルール — 交換の承認要否とボーナス\n6. サポート — 感想・要望や規約\n7. プラン・課金 — 契約と支払い`,
				goal: '設定項目が多くても、目的のカードを1枚選ぶだけで迷わずたどり着けます。',
			},
			'settings-account': {
				title: 'よく使う操作と詳しいガイド',
				what: `最初に確認したいのはアカウントカードです。${OYAKAGI_TERMS.name}（4桁の数字）を変えられ、お子さまが誤って${ADMIN_VIEW_TERMS.short}に入るのを防げます。`,
				how: '1. 目的のカードをタップして開きます\n2. 各ページの「?」を押すと、そのページ専用の詳しい操作ガイドが見られます',
				goal: 'よく使う操作にすぐ進め、各ページのガイドで迷わず設定できます。',
				tips: [`${OYAKAGI_TERMS.shortName}の初期値やポイント表示は各カードの中で変更できます`],
			},
		},
	},
	// #3266 (EPIC #3260 C2): 設定サブ 6 ページの個別ガイド文言。親 adminSettings (ハブ) とは別に、
	// 各サブページの実セクションを上→下順に説明する (F0 guide-copy-rules 準拠、≤5 step / 3 部構成)。
	adminSettingsAccount: {
		title: 'アカウント',
		steps: {
			'settings-account-intro': {
				title: 'このページについて',
				// #3307: ログアウト / アカウント削除は cognito 環境限定 (NUC / demo は おやカギ カードのみ)。
				// 全環境共通の おやカギ変更 を主機能として先頭に置き、条件付き項目は明示的に hedge する
				// (実態に無い操作を全ユーザーに断定的に案内しない、NN/G #1 visibility / ADR-0013)。
				what: `${ADMIN_VIEW_TERMS.short}を守る${OYAKAGI_TERMS.name}を変更できるページです。ご利用環境によっては、ログアウトやアカウントの削除もここから行えます。`,
				how: `まず${OYAKAGI_TERMS.shortName}を変更するカードが表示されます。ログアウト・アカウント削除のカードは、ご利用環境によって表示される場合があります。`,
				goal: `${OYAKAGI_TERMS.shortName}をこまめに変えて、お子さまが誤って${ADMIN_VIEW_TERMS.short}に入るのを防げます。`,
			},
			'settings-account-pin': {
				title: `画面の見方（${OYAKAGI_TERMS.shortName}）`,
				what: `${OYAKAGI_TERMS.name}は${ADMIN_VIEW_TERMS.short}を開くときの4桁の数字です。このカードから変更できます。`,
				how: '1. 現在のコードを入力します\n2. 新しいコードを入力します',
				goal: '今のおやカギと、変更する場所がひと目で分かります。',
			},
			'settings-account-pin-change': {
				title: `よく使う操作（${OYAKAGI_TERMS.shortName}を変える）`,
				what: `${OYAKAGI_TERMS.shortName}を新しい数字に変えます。お子さまが誤って${ADMIN_VIEW_TERMS.short}に入るのを防げます。`,
				how: `1. 現在の${OYAKAGI_TERMS.shortName}を入力\n2. 新しい数字を入力\n3. 変更ボタンをタップ`,
				goal: '次回から新しいコードが必要になり、安心して使えます。',
				tips: [PIN_DEFAULT_TERMS.hintCompact],
			},
		},
	},
	adminSettingsActivities: {
		title: '活動・ポイント',
		steps: {
			'settings-activities-intro': {
				title: 'このページについて',
				what: 'お子さまの活動にまつわる設定をまとめたページです。やる気が続く仕組みや、ポイントの見せ方をここで調整します。',
				how: '上から順に、ステータス減少・ポイント表示・きょうだいの設定が並びます。',
				goal: 'ご家庭に合わせて、活動の続けやすさやポイントの見せ方を整えられます。',
			},
			'settings-activities-decay': {
				title: '画面の見方（ステータス減少）',
				what: '何日か活動しないとステータスが少しずつ下がる仕組みです。下がる強さを4段階で選べます。',
				how: '1. 強さの段階を選びます\n2. すぐに反映されます',
				goal: '毎日コツコツ続ける動機づけを、ご家庭の方針に合わせて調整できます。',
			},
			'settings-activities-point': {
				title: 'よく使う操作（ポイント表示）',
				what: 'ポイントの呼び方や単位を選んで、お子さまに分かりやすい見せ方にできます。',
				how: '1. 表示したい単位を選びます\n2. 子供の画面に反映されます',
				goal: 'お子さまの年齢に合った言葉でポイントが表示されます。',
			},
		},
	},
	adminSettingsNotifications: {
		title: '通知',
		steps: {
			'settings-notifications-intro': {
				title: 'このページについて',
				what: 'ブラウザのお知らせを使って、活動のリマインドや達成のお祝いを届ける設定ページです。',
				how: '上で通知のオン・オフを切り替え、下で届けるお知らせの種類を選びます。',
				goal: '声かけしなくても、お子さま自身が活動を思い出すきっかけを作れます。',
			},
			'settings-notifications-status': {
				title: '画面の見方（通知のオン・オフ）',
				what: '今このブラウザで通知が使えるかどうかと、オン・オフの切り替えボタンがここに出ます。',
				how: '1. 状態を確認します\n2. ボタンでオン・オフを切り替えます',
				goal: '通知が使える状態かどうかをひと目で確認できます。',
			},
			'settings-notifications-types': {
				title: 'よく使う操作（お知らせの種類）',
				what: 'リマインダーや連続記録のお祝い、サイレント時間帯など、届けるお知らせを選べます。',
				how: '1. 届けたいお知らせにチェックします\n2. 保存ボタンをタップします',
				goal: '必要なお知らせだけが届き、通知が多すぎる状態を避けられます。',
			},
		},
	},
	adminSettingsData: {
		title: 'データ',
		steps: {
			'settings-data-intro': {
				title: 'このページについて',
				what: `記録した活動やポイントなどのデータを${BACKUP_TERMS.exportNoun}・${BACKUP_TERMS.restoreVerb}できるページです。`,
				how: '上から順に、データの保存と読み込み・すべて消す操作が並びます。',
				// #3307: 読み込み (復元) は無料プランでも可、保存 (エクスポート) は canExport gate のため
				// PAID_PLAN_LABEL で hedge する (free に export を無条件約束しない、ADR-0013 LP truth / NN/G #1)。
				goal: `読み込みでの${BACKUP_TERMS.restoreVerb}はどなたでも使え、${BACKUP_TERMS.exportNoun}の保存は${PAID_PLAN_LABEL}で利用できます。`,
			},
			'settings-data-management': {
				title: `画面の見方（データの${BACKUP_TERMS.exportNoun}）`,
				// #3307: 保存 (エクスポート) は canExport gate。読み込みは無料プランでも可のため、
				// 「保存はファイル保存できます」を無条件に約束せず PAID_PLAN_LABEL で hedge する。
				what: `保存した${BACKUP_TERMS.file}の読み込みはどなたでも、ファイルへの保存（${BACKUP_TERMS.exportNoun}）は${PAID_PLAN_LABEL}でできます。`,
				how: '1. 保存か読み込みを選びます\n2. 画面の案内に従います',
				goal: '大切な記録を手元に残す方法がここに集まっています。',
			},
			'settings-data-export': {
				title: `よく使う操作（${BACKUP_TERMS.exportNoun}）`,
				what: 'ボタンひとつで、今までの記録を1つのファイルに保存できます。',
				how: `1. ${BACKUP_TERMS.exportVerb}ボタンをタップ\n2. ファイルが手元に保存されます`,
				goal: `機種変更や万一のときも、保存したファイルから${BACKUP_TERMS.restoreVerb}できます。`,
			},
		},
	},
	adminSettingsRules: {
		// #3954: 本ページは #3339 で「ごほうび交換の承認要否」を持つようになったが、ガイドは
		// 取り込んだボーナスルールしか案内しておらず、ガイドに従う保護者が承認要否に到達できなかった
		// (hub カード / サブナビと同じ取り落とし。導線を直してもガイドが古いままなら未達)。
		// title は ADMIN_RULES_PAGE_LABELS.pageTitle と同一文字列にする — 定数参照にしないのは
		// ADMIN_RULES_PAGE_LABELS が本定義より後方で宣言されるため。一致は
		// tests/unit/routes/settings-hub-coverage.test.ts [S7] で機械強制する。
		title: 'ごほうび・ボーナスルール',
		steps: {
			'settings-rules-intro': {
				title: 'このページについて',
				what: `ごほうび交換に保護者の承認が必要かどうかと、${TEMPLATE_TERMS.userFacing}から取り込んだボーナスのルールを決めるページです。`,
				how: '上でごほうび交換の承認を切り替え、下で取り込んだルールを管理します。',
				goal: '交換に承認を挟むかどうかと、効かせるボーナスをここでまとめて決められます。',
			},
			'settings-rules-approval': {
				title: '画面の見方（ごほうび交換の承認）',
				what: 'お子さまがごほうびを交換するときに、保護者の承認を必要とするかどうかをここで切り替えます。',
				how: '1. 切り替えを操作します\n2. 承認なしにすると、お子さまはその場で交換できます',
				goal: 'ご家庭の方針に合わせて、交換の承認を必要にするか選べます。',
			},
			'settings-rules-list': {
				title: 'よく使う操作（取り込んだルール）',
				what: '取り込んだボーナスルールがここに並びます。まだ無いときは、その案内が表示されます。',
				how: '1. ルールのオン・オフを切り替えます\n2. いらないルールは削除できます',
				goal: 'ご家庭に合うルールだけを残して、ボーナスを整理できます。',
			},
		},
	},
	adminSettingsSupport: {
		title: 'サポート・アプリ情報',
		steps: {
			'settings-support-intro': {
				title: 'このページについて',
				what: '感想や要望を送ったり、利用規約やバージョンなどのアプリ情報を確認できるページです。',
				how: '上にお問い合わせのフォーム、下に各種リンクとアプリ情報が並びます。',
				goal: '困ったときの相談先と、サービスの情報にここからたどり着けます。',
			},
			'settings-support-form': {
				title: 'よく使う操作（感想・要望を送る）',
				what: '使ってみた感想や「こうしてほしい」という要望を、開発者に直接送れます。',
				how: '1. 内容を入力します\n2. 送信ボタンをタップします',
				goal: 'いただいた声をもとに、サービスを改善していきます。',
			},
		},
	},
	adminSubscription: {
		title: 'プラン・課金',
		steps: {
			// ① ページ概要（selector 省略で画面中央 modal、全環境で表示）。NUC セルフホスト版では
			// 現在のプラン／プラン管理セクションが無いため、intro は両環境で正しい「契約・プランの
			// 状況を確認するページ」に留める（実装にない操作を案内しない、ADR-0013）。
			'subscription-intro': {
				title: 'このページについて',
				what: '今ご利用中のプランや契約の状況を確認するページです。プランに関する操作の入り口がここに集まっています。',
				how: '上から順に、現在の状況・プランの管理・支払い履歴への入り口が並びます。表示される項目はご利用環境によって変わります。',
				goal: `プランの状況をひと目で把握でき、必要なときに${PLAN_CHANGE_TERMS.changeNoun}や支払いの管理へ迷わず進めます。`,
			},
			// ② 画面の見方（現在のプラン）— SaaS 版のみ（NUC では本セクション非表示のため除外）。
			'subscription-current-plan': {
				title: '画面の見方（現在のプラン）',
				what: 'いま契約中のプランと、無料トライアル中ならその残り期間がここに表示されます。',
				how: '1. 上部で現在のプランを確認します\n2. 下の「プラン管理」で変更できます',
				goal: '今どのプランかをすぐ確認でき、変更前の状態を把握できます。',
			},
			// ③ 最頻操作（プラン管理）— SaaS 版 + Stripe 有効時のみ。実 UI は契約状況で分岐するため両分岐を記述する。
			'subscription-plan-management': {
				title: `よく使う操作（${PLAN_CHANGE_TERMS.changeNoun}）`,
				what: `プランの開始・変更をここから行います。まだ有料プランをご契約でないときはプランを選んでお申し込みでき、ご契約済みのときは${STRIPE_PORTAL_TERMS.canonical}での管理に進めます。`,
				how: `・未契約のとき: 1. プランを選びます 2. 申し込みボタンで手続きします\n・契約済みのとき: 1. ${STRIPE_PORTAL_TERMS.short}を開きます 2. プラン変更や支払い方法を手続きします`,
				goal: `${PLAN_CHANGE_TERMS.changeNoun}が反映され、支払い方法も${STRIPE_PORTAL_TERMS.short}で管理できます。`,
				tips: [`${CANCEL_TERMS.anytime}できます`],
			},
			// ②' 画面の見方（ご利用中の版）— NUC セルフホスト版のみ（#3296）。NucLicensePanel の
			// Edition badge を spotlight し、全機能が制限なく使える旨を案内する。
			'subscription-nuc-edition': {
				title: '画面の見方（ご利用中の版）',
				what: `このおうちのサーバーで動かす${NUC_EDITION_TERMS.selfHosted}です。${NUC_EDITION_TERMS.fullAccess}で、お子さまや活動の数に制限はありません。`,
				how: 'ここに版の名前と、使える範囲が表示されます。お申し込みや支払いの手続きは必要ありません。',
				goal: '追加の費用や手続きなしで、すべての機能をそのまま使えることが分かります。',
			},
			// ③' 画面の見方（利用状況）— NUC セルフホスト版のみ（#3296）。利用状況セクションを spotlight。
			'subscription-nuc-usage': {
				title: '画面の見方（利用状況）',
				what: '今このアプリに登録されているお子さまの人数や、これまでに作った活動の数を確認できます。',
				how: '1. 登録人数や活動数の一覧を見ます\n2. データの保存期間もあわせて確認できます',
				goal: 'どれくらい使っているかをひと目で把握できます。',
			},
		},
	},
	adminBilling: {
		title: 'お支払い',
		steps: {
			// ① ページ概要（selector 省略で画面中央 modal）。
			'billing-intro': {
				title: 'このページについて',
				what: `ご契約の状況確認と、${STRIPE_PORTAL_TERMS.short}での支払い管理・${CANCEL_TERMS.canonical}をまとめたページです。`,
				how: '上から「ご契約状況」「請求管理」の順に並びます。',
				goal: `支払いの状況を把握でき、必要なら${STRIPE_PORTAL_TERMS.short}や${CANCEL_TERMS.canonicalVerb}手続きに進めます。`,
			},
			// ② 画面の見方（ご契約状況）。
			'billing-overview': {
				title: '画面の見方（ご契約状況）',
				what: '契約中のプランの状態と、次回の請求予定がここに表示されます。',
				how: '1. 契約状況を確認します\n2. 下の「請求管理」で支払い方法を変えられます',
				goal: '今の契約と請求予定をひと目で確認できます。',
			},
			// ③ 最頻操作（請求管理ページ）。ご契約があるときに「請求管理ページを開く」ボタンが出る。
			'billing-portal': {
				title: `よく使う操作（${STRIPE_PORTAL_TERMS.short}）`,
				what: `支払い方法の変更や領収書の確認は${STRIPE_PORTAL_TERMS.canonical}から行います。ご契約があるときに開くボタンが表示されます。`,
				how: `1. ${STRIPE_PORTAL_TERMS.short}を開きます\n2. 支払い方法や${CANCEL_TERMS.canonical}を手続きします`,
				goal: `支払い方法を最新に保て、${CANCEL_TERMS.anytime}できます。`,
			},
		},
	},
	// #3268 (EPIC #3260 C4): 家族メンバー / パックページの個別ガイド。常在セクションのみを selector で
	// 指す（保留中の招待 / 閲覧リンク / 展開コンテンツは条件表示のため step 対象外）。
	adminMembers: {
		title: '家族メンバー',
		steps: {
			'members-intro': {
				title: 'このページについて',
				what: '家族で使う人を増やしたり、離れて暮らす家族に「見るだけ」のリンクを渡したりできるページです。',
				how: '上から順に、今のメンバー・招待リンクの作成・見るだけのリンクが並びます。表示される項目はご利用環境によって変わります。',
				goal: '家族みんなで使えるようになり、離れた家族にも成長を共有できます。',
			},
			'members-list': {
				title: '画面の見方（今のメンバー）',
				what: '今この家族で使っている人の一覧です。それぞれの権限もここで分かります。',
				how: '1. 一覧で今のメンバーを確認します\n2. 必要なら権限の変更や削除ができます',
				goal: '誰が使っているかをひと目で確認できます。',
			},
			'members-invite': {
				title: 'よく使う操作（招待リンクを作る）',
				what: '新しく使う人を招くリンクを作れます。リンクやQRコードを渡すだけで参加してもらえます。',
				how: '1. 役割（保護者か子供）を選びます\n2. 作成ボタンを押し、出てきたリンクを渡します',
				goal: '相手がリンクを開くだけで家族に参加でき、すぐ一緒に使い始められます。',
				tips: ['招待リンクには期限があり、参加が済むと自動で使えなくなります'],
			},
		},
	},
	adminPacks: {
		title: 'パック',
		steps: {
			'packs-intro': {
				title: 'このページについて',
				what: 'おすすめの活動がセットになった「パック」を選んで、まとめて取り込めるページです。',
				how: '一覧からパックを開いて中身を確認し、まとめて取り込みます。',
				goal: '1つずつ作らなくても、おすすめの活動をまとめて用意できます。',
			},
			'packs-overview': {
				title: '画面の見方（パック一覧）',
				what: 'テーマ別のパックが一覧で並びます。開くと中の活動を確認でき、まとめて取り込めます。',
				how: '1. 気になるパックを開いて中身を見ます\n2. 取り込むボタンでまとめて追加します',
				goal: 'お子さまに合うパックを選んで、活動を一気にそろえられます。',
			},
		},
	},
	adminStatus: {
		title: '成長レポート',
		steps: {
			'status-intro': {
				title: 'このページについて',
				what: `お子さまの活動を「${CATEGORY_NAME_LIST}」の5つの軸で可視化するページです。どの分野が得意で、どこが伸びしろかが分かります。`,
				how: 'レーダーチャートで5軸のバランスを見ます。同年代の目安（ベンチマーク）と重ねて表示されるので、平均との比較もできます。',
				goal: '「今月はうんどうが伸びた」「べんきょうが少なめ」といった傾向が数値とグラフで分かり、声かけや活動設計の参考になります。',
			},
			'status-radar': {
				title: '画面の見方（バランスチャート）',
				what: '上のレーダーチャートは5軸のポイント配分を面で表します。外側に広がっている軸ほど、よく取り組んでいる分野です。',
				how: '1. 外側に広がっている軸 = よく取り組んでいる分野\n2. へこんでいる軸 = 活動が少ない分野\n3. ベンチマーク（目安）との差を見比べます',
				goal: 'バランスの偏りにひと目で気づけるので、お子さまの今の状態を客観的に把握できます。',
			},
			'status-act': {
				title: 'よく使う操作（次の一手を決める）',
				what: 'このページの使いどころは「どの分野を伸ばすか」を決めることです。分析サマリーでへこんでいる軸を見つけ、活動管理で新しい活動を足してバランスを整えます。',
				how: '1. 分析サマリーで少ない分野（へこんでいる軸）を見つけます\n2. 活動管理ページで、その分野の活動を追加します\n3. 翌月以降のチャートで変化を確認します',
				goal: '「得意をもっと伸ばす」「苦手を少しだけ足す」など、お子さまに合った関わり方を選べます。',
				tips: ['無理に全軸を均等にする必要はありません。得意分野を伸ばす視点も大切です'],
			},
		},
	},
	// #3263 (EPIC #3260 F2) / #3269 (C5) / #4677 (EPIC #4650): みんなのテンプレート一覧ガイド。
	// AdminLayout 非使用ページのため marketplace/+layout.svelte が独自配線する。
	// 画面の「上から下」順に、公式テンプレートを探して取り込む CUJ を案内する
	// (概要 → 種類 → 年齢自動フィルタ → しぼりこむ → ならべかえ → カード / 0 件)。
	// 陳列物はがんばりクエスト公式 preset のみ (投稿機能は無い) — 「他のご家庭が作った」とは書かない。
	// ボタン名 / 見出し / 並び替え名は画面表記 (MARKETPLACE_FILTER_LABELS 等) と同じ定数を参照する。
	marketplace: {
		title: TEMPLATE_TERMS.userFacing,
		steps: {
			// ① ページ概要（画面中央 modal）
			'marketplace-intro': {
				title: 'このページについて',
				what: `がんばりクエストが用意した公式${TEMPLATE_TERMS.short}（活動セット・ごほうびセット・チェックリスト）を探して、${CHILD_TERMS.honorific}向けに取り込めるページです。ゼロから作らなくても、よくある活動セットをそのまま使えます。`,
				how: `気になる${TEMPLATE_TERMS.short}のカードをタップして詳細を開き、詳細ページの取り込み（一括追加）ボタンから取り込みます。取り込みにはログインと${CHILD_TERMS.honorific}の登録が必要です。`,
				goal: `選んだ${TEMPLATE_TERMS.short}が活動管理・ごほうび管理・チェックリストに追加され、ご家庭に合わせて項目を足したり消したりして調整できます。`,
				tips: [
					`ログイン中は左上の「${ADMIN_VIEW_TERMS.short}へ」で${ADMIN_VIEW_TERMS.canonical}に戻れます`,
					'ログインしていなくても一覧と詳細は見られます。取り込むときにログインを求められます',
				],
			},
			// ② 種類で絞り込む（type filter = 3 種類カード）
			'marketplace-browse': {
				title: '種類で絞り込む',
				what: `上部の 3 つのカードで、${TEMPLATE_TERMS.short}の種類（活動セット・ごほうびセット・チェックリスト）を切り替えられます。数字はその種類の${TEMPLATE_TERMS.short}数です。`,
				how: '1. 見たい種類のカードをタップします\n2. もう一度タップすると絞り込みが外れます',
				goal: '「まずは活動だけ」「ごほうびを足したい」のように、目的の種類だけを一覧にできます。',
			},
			// ③ 年齢に合わせた表示（ログイン + お子さま選択中のみ出る hint バナー、optional）
			'marketplace-age-auto': {
				title: '年齢に合わせた表示',
				what: `選択中の${CHILD_TERMS.honorific}の年齢に合わせて、一覧を自動で絞り込んで表示しています。表示件数が少ないのはこのためです。`,
				how: `1. バナーの「${MARKETPLACE_FILTER_LABELS.clearAgeFilter}」をタップすると絞り込みが外れ、全件が並びます\n2. 別の年齢で見たいときは「${MARKETPLACE_FILTER_LABELS.sectionTitle}」の${MARKETPLACE_FILTER_LABELS.age}から選び直します`,
				goal: `きょうだいの年齢差があっても、今選んでいる${CHILD_TERMS.honorific}にちょうどいい${TEMPLATE_TERMS.short}から探し始められます。`,
			},
			// ④ しぼりこむ（desktop = 左のパネル / mobile = ⚙️ フィルタ ボタン → ダイアログ。可視の方が光る）
			'marketplace-filter': {
				title: `${MARKETPLACE_FILTER_LABELS.sectionTitle}（${MARKETPLACE_FILTER_LABELS.age}・${MARKETPLACE_FILTER_LABELS.gender}・${MARKETPLACE_FILTER_LABELS.tag}）`,
				what: `${MARKETPLACE_FILTER_LABELS.age}・${MARKETPLACE_FILTER_LABELS.gender}・${MARKETPLACE_FILTER_LABELS.tag}で${TEMPLATE_TERMS.short}を絞り込めます。パソコンでは左の「${MARKETPLACE_FILTER_LABELS.sectionTitle}」パネル、スマホでは「⚙️ ${MARKETPLACE_FILTER_LABELS.open}」ボタンを押すと同じ項目が開きます。`,
				how: `1. スマホは「⚙️ ${MARKETPLACE_FILTER_LABELS.open}」をタップしてパネルを開きます（パソコンは左に常に表示）\n2. ${MARKETPLACE_FILTER_LABELS.age}・${MARKETPLACE_FILTER_LABELS.gender}・${MARKETPLACE_FILTER_LABELS.tag}を選びます（もう一度タップで解除）\n3. 「${MARKETPLACE_FILTER_LABELS.reset}」で全部外せます`,
				goal: `たくさんの${TEMPLATE_TERMS.short}の中から、${CHILD_TERMS.honorific}の年齢や興味にぴったりのものを素早く見つけられます。`,
				tips: [
					`${MARKETPLACE_FILTER_LABELS.tag}は人気の 8 件だけ表示され、「もっと見る」で全部出せます`,
				],
			},
			// ⑤ ならべかえ
			'marketplace-sort': {
				title: MARKETPLACE_FILTER_LABELS.sort,
				what: `一覧の並び順を「${MARKETPLACE_FILTER_LABELS.sortOptions.popularity}」「${MARKETPLACE_FILTER_LABELS.sortOptions.newest}」「${MARKETPLACE_FILTER_LABELS.sortOptions.ageFit}」から選べます。`,
				how: `1. 並び替えメニューを開きます\n2. ${MARKETPLACE_FILTER_LABELS.sortOptions.popularity}（まずはこれ）/ ${MARKETPLACE_FILTER_LABELS.sortOptions.newest} / ${MARKETPLACE_FILTER_LABELS.sortOptions.ageFit}（対象年齢が低い順）から選びます`,
				goal: '迷ったら人気順、幼児向けから探したいときは年齢順、と目的に合わせて一覧を並べ替えられます。',
			},
			// ⑥ テンプレートを開く（先頭カード。一覧 0 件時は出ない = optional）
			'marketplace-open': {
				title: `${TEMPLATE_TERMS.short}を開く`,
				what: `最もよく使うのが、${TEMPLATE_TERMS.short}のカードをタップして詳細を開く操作です。詳細ページで中身を確認してから取り込めます。`,
				how: `1. 一覧の${TEMPLATE_TERMS.short}のカードをタップします\n2. 詳細ページで含まれる内容を確認します\n3. 詳細ページの取り込み（一括追加）ボタンから、追加する${CHILD_TERMS.honorific}を選びます`,
				goal: '中身を確かめたうえで取り込めるので、「思っていたものと違った」を防げます。',
				tips: [
					`まずは${TEMPLATE_TERMS.short}を取り込んで、ご家庭に合わせて調整するのが近道です`,
					`取り込みにはログインと${CHILD_TERMS.honorific}の登録が必要です`,
				],
			},
			// ⑥' 0 件のとき（フィルタ不一致。カードが無いので empty state を案内）
			'marketplace-empty': {
				title: `${TEMPLATE_TERMS.short}が見つからないとき`,
				what: `今の絞り込み条件に合う${TEMPLATE_TERMS.short}がありません。条件を外すと一覧が戻ります。`,
				how: `1. 「${MARKETPLACE_FILTER_LABELS.reset}」をタップして条件を全部外します\n2. 年齢や種類を 1 つずつ選び直します`,
				goal: `条件を緩めれば、公式${TEMPLATE_TERMS.short}の全件から改めて探せます。`,
			},
		},
	},
	// #3269 (EPIC #3260 C5) / #4678 (EPIC #4650): みんなのテンプレート詳細ガイド（取込 CTA ページ）。
	// 一覧から開いた 1 件の詳細。概要 → 中身の一覧 → (活動セットの取り込む項目選択) → 取り込む、の順。
	// 取り込む step は CTA ブロックに出ている分岐 (data-cta-variant) ごとに optional step を用意し、
	// 画面に出ている分岐だけが step になる: per-child (お子さまを選ぶ) / family-rule (とくべつルールは
	// 家庭全体に 1 回) / rule-unavailable (penalty・special はボタン無し) / no-children (先にお子さま登録) /
	// login (ログイン画面へ)。ボタン名は画面表記 (取り込み / 一括追加) に合わせ「取り込み（一括追加）ボタン」と併記。
	marketplaceDetail: {
		title: `${TEMPLATE_TERMS.short}の詳細`,
		steps: {
			// ① ページ概要（画面中央 modal）
			'marketplace-detail-intro': {
				title: 'このページについて',
				what: `選んだ${TEMPLATE_TERMS.short} 1 件の詳細ページです。含まれる活動・ごほうび・チェック項目・ルールを確認してから、ご自身の家庭に取り込めます。`,
				how: `中身の一覧を確認し、ページ下部の取り込み（一括追加）ボタンから取り込みます。取り込みにはログインと${CHILD_TERMS.honorific}の登録が必要です（未ログインのときはボタンがログイン画面への案内に変わります）。`,
				goal: `中身を確かめたうえで取り込めるので、家庭に合う${TEMPLATE_TERMS.short}だけを安心して追加できます。`,
				tips: [
					`上部のタグや対象年齢をタップすると、似た${TEMPLATE_TERMS.short}を一覧で探せます`,
					`ログイン中は左上の「${ADMIN_VIEW_TERMS.short}へ」で${ADMIN_VIEW_TERMS.canonical}に戻れます`,
				],
			},
			// ② 内容プレビューの見方
			'marketplace-detail-preview': {
				title: '中身を確認する',
				what: `この${TEMPLATE_TERMS.short}に含まれる活動・ごほうび・チェック項目・ルールの一覧です。取り込む前に中身をひと通り確認できます。`,
				how: `1. 一覧をスクロールして含まれる項目とポイントを確認します\n2. 活動セットは取り込む項目をチェックで選べます（ログイン + ${CHILD_TERMS.honorific}登録済のとき）\n3. チェックリストは取り込み済みの項目を重複させずスキップします`,
				goal: `取り込む前に中身が分かるので、ご家庭に必要なものだけを選んで追加できます。`,
			},
			// ③ 活動セットの取り込む項目を選ぶ（活動セット + ログイン + お子さま登録済のみ描画 → optional）
			'marketplace-detail-select': {
				title: '取り込む活動を選ぶ',
				what: `活動セットでは、取り込む活動をチェックで選べます。すでに登録済みの活動（「登録済み」バッジ）は重複しないよう最初からチェックが外れています。`,
				how: `1. 「すべて選ぶ」「すべて外す」でまとめて切り替えます\n2. 個別にチェックを付け外しします（「N件 / M件 を取り込みます」に反映）\n3. 0 件のときは取り込みボタンが押せません。1 件以上選んでください`,
				goal: `「歯みがきとお片付けだけ」のように必要な活動だけを取り込め、既存の活動と二重になりません。`,
			},
			// ④-a 取り込む（活動セット / ごほうびセット / チェックリスト / 交換ルール = お子さまを選ぶ）
			'marketplace-detail-import': {
				title: '取り込む',
				what: `ページ下部の取り込み（一括追加）ボタンを押すと、${ADMIN_VIEW_TERMS.canonical}に移り、どの${CHILD_TERMS.honorific}に追加するかを選ぶ画面が開きます。`,
				how: `1. ページ下部の取り込み（一括追加）ボタンをタップします\n2. 開いた画面で、追加する${CHILD_TERMS.honorific}を選びます\n3. 確定すると、選んだ${CHILD_TERMS.honorific}に追加されます`,
				goal: `選んだ${CHILD_TERMS.honorific}の${PAGE_TITLES.activities}・${REWARD_TERMS.menu}・${PAGE_TITLES.checklists}に${TEMPLATE_TERMS.short}の内容が追加されます。`,
				tips: [
					`${CHILD_TERMS.honorific}ごとに取り込めるので、上の子・下の子で別々の${TEMPLATE_TERMS.short}を使い分けられます`,
				],
				relatedLinks: [
					{ label: PAGE_TITLES.activities, href: '/admin/activities' },
					{ label: REWARD_TERMS.menu, href: '/admin/rewards' },
					{ label: PAGE_TITLES.checklists, href: '/admin/checklists' },
					{
						label: `${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}`,
						href: '/admin/settings/rules',
					},
				],
			},
			// ④-b 取り込む（とくべつルール = ボーナス: 家庭全体に 1 回、お子さま選択なし）
			'marketplace-detail-import-rule': {
				title: '取り込む（とくべつルール）',
				what: `とくべつルール（ボーナス）は${CHILD_TERMS.honorific}ごとではなく、ご家庭全体に 1 回で追加されます。${CHILD_TERMS.honorific}を選ぶ画面は出ません。`,
				how: `1. ページ下部の取り込み（一括追加）ボタンをタップします\n2. そのまま「${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}」に移り、自動で追加されます\n3. 追加後は同じ画面で ON / OFF を切り替えられます`,
				goal: `ボーナスルールが家庭全体に効き、「${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}」でいつでも止められます。`,
				relatedLinks: [
					{
						label: `${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}`,
						href: '/admin/settings/rules',
					},
				],
			},
			// ④-c とくべつルール (penalty / special) は取り込みボタンが無い
			'marketplace-detail-rule-unavailable': {
				title: 'このルールは取り込めません',
				what: `ペナルティ型のとくべつルールは慎重に審査中、特別型は将来枠のため、いまは取り込みボタンがありません。ここにはその説明だけが出ます。`,
				how: `1. ボーナス型のとくべつルールや、活動セット・ごほうびセットから選び直します\n2. 一覧へ戻るには下の「…一覧に戻る」をタップします`,
				goal: `取り込めない理由が分かり、代わりに使えるボーナス型ルールへ迷わず移れます。`,
			},
			// ④-d お子さま未登録（ログイン済）
			'marketplace-detail-no-children': {
				title: `先に${CHILD_TERMS.honorific}を登録する`,
				what: `取り込み先になる${CHILD_TERMS.honorific}がまだ登録されていません。ボタンは${CHILD_TERMS.honorific}登録画面への案内に変わっています。`,
				how: `1. 「まずは${CHILD_TERMS.honorific}を登録してください」をタップします\n2. ${CHILD_TERMS.honorific}を登録したら、この${TEMPLATE_TERMS.short}に戻って取り込みます`,
				goal: `${CHILD_TERMS.honorific}を登録すると同じボタンが取り込み（一括追加）に変わり、どの${CHILD_TERMS.honorific}に追加するかを選べます。`,
			},
			// ④-e 未ログイン
			'marketplace-detail-login': {
				title: 'ログインして取り込む',
				what: `取り込みにはログインが必要です。ボタンを押すとログイン画面に移ります（新規の方はログイン画面の「新規アカウント作成」から登録できます）。`,
				how: `1. ページ下部のボタンをタップしてログインします\n2. ログイン後、この${TEMPLATE_TERMS.short}に戻って取り込み（一括追加）ボタンを押します\n3. ${CHILD_TERMS.honorific}が未登録なら先に登録します`,
				goal: `ログインと${CHILD_TERMS.honorific}登録がそろえば、${TEMPLATE_TERMS.short}をワンタップで${ADMIN_VIEW_TERMS.canonical}に取り込めます。`,
			},
		},
	},
	// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ（賞状コレクション / 成長記録ブック / ごほうび申請の承認）
	adminCertificates: {
		title: '賞状コレクション',
		steps: {
			// ① ページ概要（画面中央 modal）
			'certificates-intro': {
				title: 'このページについて',
				what: 'お子さまががんばって獲得した賞状を集めて見られるページです。連続記録・レベルアップ・月間や年間のがんばりなど、節目ごとに賞状が自動で贈られます。',
				how: '保護者が作る操作はありません。お子さまが活動を続けると条件を満たした賞状がここに増えていきます。',
				goal: 'お子さまの「ここまでがんばった」を賞状という形で振り返れて、ご家族で成長をお祝いできます。',
			},
			// ② 画面の見方（お子さまタブ + カテゴリ別の一覧）
			'certificates-view': {
				title: '画面の見方',
				what: '上のお子さまタブで子ごとに切り替えると、その子の賞状が「連続記録」「レベルアップ」「月間がんばり」などの種類ごとに並びます。',
				how: '1. お子さまタブで見たい子を選びます\n2. 種類ごとに並んだ賞状を見ていきます',
				goal: 'どのお子さまがどんな節目を達成したかが、ひと目で分かります。',
				tips: [
					`賞状は${PLAN_FULL_TERMS.free}でも閲覧でき、PDF保存は${PAID_PLAN_LABEL}で利用できます`,
				],
			},
		},
	},
	adminGrowthBook: {
		title: '成長記録ブック',
		steps: {
			// ① ページ概要（画面中央 modal）
			'growth-book-intro': {
				title: 'このページについて',
				what: 'お子さまの 1 年間のがんばりを、月ごと・分野ごとにまとめた記録ブックです。活動の積み重ねが一冊の成長の記録になります。',
				how: `保護者が入力する操作はありません。お子さまの記録から自動でまとめられ、${PAID_PLAN_LABEL}では印刷して手元に残すこともできます。`,
				goal: '1 年の成長をまとめて振り返れて、ご家族の思い出として保存できます。',
			},
			// ② 画面の見方 + 最頻操作（年度・お子さまの切り替えと印刷）
			'growth-book-view': {
				title: '画面の見方と印刷',
				what: `お子さまと年度を切り替えると、その子のその年の記録が月ごと・分野ごとに並びます。${PAID_PLAN_LABEL}では印刷ボタンで紙にも残せます。`,
				how: `1. お子さまと年度を選びます\n2. 月ごと・分野ごとの記録を見ていきます\n3. ${PAID_PLAN_LABEL}なら印刷ボタンで手元に残せます`,
				goal: '見たいお子さま・年度の成長を選んで振り返り、必要なら印刷して保存できます。',
				tips: [
					`成長記録ブックは${PLAN_FULL_TERMS.free}でも閲覧でき、PDF保存・印刷は${PAID_PLAN_LABEL}で利用できます`,
				],
			},
		},
	},
	adminRewardsRequests: {
		title: 'ごほうび申請の承認',
		steps: {
			// ① ページ概要（画面中央 modal）
			'rewards-requests-intro': {
				title: 'このページについて',
				what: 'お子さまが「このごほうびと交換したい」と申請したものを、保護者が確認して承認・却下するページです。お子さまの交換は保護者の承認を経て確定します。',
				how: '申請があるとここに一覧で並びます。中身を見て、承認するか却下するかを選びます。',
				goal: 'お子さまの交換申請を保護者が見守りながら、納得したうえでごほうびを渡せます。',
			},
			// ② 最頻操作（承認・却下する）
			'rewards-requests-act': {
				title: 'よく使う操作（承認・却下）',
				what: '最もよく使うのが、申請ごとの承認・却下です。却下するときは、お子さま宛てに理由を添えられます。',
				how: '1. 申請の内容を確認します\n2. よければ承認、見送るときは却下を押します\n3. 却下のときは理由を入力するとお子さまに伝わります',
				goal: `承認するとポイントが引かれて交換が確定します。ポイントは承認したときだけ引かれるので、却下してもお子さまの残高は変わりません。`,
				tips: ['却下の理由を添えると、お子さまが次にどうすればよいか分かります'],
			},
		},
	},
} as const;

// ============================================================
// デモ実行モード関連ラベル（#1180 / ADR-0039）
// ============================================================

/**
 * デモモード関連の文言 SSOT（ADR-0048 / #2189 PR-B4: env-only 判定で配信される）。
 * ハードコードせず本定数を介して参照すること（ADR-0037 準拠）。
 * baby / preschool モードではひらがな併記を優先する。
 *
 * #2097 Phase B (PO 報告 2026-05-17 12:00 JST): DemoBanner は demo Lambda
 * (demo.ganbari-quest.com) 上で大人 (保護者) 向けに表示されるため、漢字表記が適切。
 * リンク先は本番ドメイン (ganbari-quest.com) への absolute URL に変更し、
 * demo Lambda 上で /auth/signup や /demo/exit を叩いて 404 / 認証エラーになるのを防ぐ。
 */
export const DEMO_LABELS = {
	/** 上部バナーのメイン文言 */
	bannerTitle: 'おためしモード',
	bannerDescription: 'これはおためしです。記録やせっていはほぞんされません。',
	/** 「本当に始める」CTA — 大人 (保護者) 向けバナーなので漢字表記 (#2097 Phase B Bug 1) */
	ctaStart: '本当に始める',
	/** 退出ボタン */
	ctaExit: 'おためしをやめる',
	/**
	 * 退出先 (LP に戻す)。
	 * #2097 Phase B Bug 3: demo Lambda には `/demo/exit` route が存在しないため
	 * 本番 LP (https://www.ganbari-quest.com/) への absolute URL とする。
	 * NUC 本番 (local mode) からも同じ absolute URL でアクセス可能。
	 * #2261 (2026-05-19 PO 報告): apex (ganbari-quest.com) ではなく www. canonical
	 * に統一。CloudFront / Route53 の canonical は www. のため、apex 経由だと
	 * 301 リダイレクトが挟まり UX が劣化する。
	 */
	exitHref: 'https://www.ganbari-quest.com/',
	/**
	 * サインアップ CTA 先 (本当に始める)。
	 * #2097 Phase B Bug 2: demo Lambda では Cognito 未注入のため /auth/signup を
	 * relative で叩くと中途半端な signup 画面 (失敗確定) が表示される。本番 (Cognito)
	 * への absolute URL に固定する。
	 * #2261 (2026-05-19 PO 報告): exitHref と同じく www. canonical に統一。
	 */
	signupHref: 'https://www.ganbari-quest.com/auth/signup',
} as const;

// ============================================================
// おやカギコード関連ラベル（#1360）
// ============================================================

/**
 * 保護者の見守り画面ロック（旧称「PINコード」→「おやカギコード」）の UI 文言 SSOT。
 * ロジック定数（DEFAULT_PIN）は `$lib/domain/constants/oyakagi` を参照。
 *
 * #2353 (PR #2325 follow-up 設計欠陥 6 点総合改修):
 *   - 設計欠陥 2 (SSOT 違反): 「おやカギコード」「ご家族の見守り画面」直書きを
 *     `${OYAKAGI_TERMS.name}` / `${ADMIN_VIEW_TERMS.canonical}` template literal 経由化
 *   - 設計欠陥 5 (初期 PIN 5086 ヒント): `gateDefaultHint` を空文字に変更
 *     (子が見て即入力する脆弱性。setup 完了画面 / onboarding dialog でのみ伝達)
 *   - 設計欠陥 4 (PIN 忘れ救済導線): `gateForgotPinLink` 等 PIN reset 関連 compound 追加
 */
export const OYAKAGI_LABELS = {
	name: `${OYAKAGI_TERMS.name}`,
	shortName: `${OYAKAGI_TERMS.shortName}`,
	setupStep: `${OYAKAGI_TERMS.name}を変更する`,
	changeAction: `${OYAKAGI_TERMS.shortName}を変更`,
	changeSuccess: `${OYAKAGI_TERMS.name}を変更しました`,
	sectionTitle: `🔒 ${OYAKAGI_TERMS.name}変更`,
	inputLabel: `${OYAKAGI_TERMS.name}（4〜6桁）`,
	inputPlaceholder: `${OYAKAGI_TERMS.name}を入力`,
	defaultValueHint: `${PIN_DEFAULT_TERMS.hintFull}`,
	invalidError: `${OYAKAGI_TERMS.name}が正しくありません`,
	lockedError: `${OYAKAGI_TERMS.name}の入力に連続して失敗したため、しばらく待ってから再度お試しください`,
	formatError: `${OYAKAGI_TERMS.name}は4〜6桁の数字で入力してください`,
	numberOnlyError: `${OYAKAGI_TERMS.name}は数字のみです`,
	// EPIC #2310 子#2312: /switch PIN gate modal UI (Apple Screen Time 同設計)
	gateModalTitle: `${OYAKAGI_TERMS.name}を入力してください`,
	gateModalDescription: `${ADMIN_VIEW_TERMS.canonical}には${PARENT_TERMS.neutral}のみが入れます。${OYAKAGI_TERMS.name}を入力してください。`,
	gateModalSubmitting: 'かくにん中…',
	// #3089: PIN 認証成功後、親画面 (ハードナビ) 表示完了まで数秒かかる間の全画面 progress 文言。
	// 「認証は成功して読み込み中」を明示し、modal が閉じてから子供画面が静止して見える困惑を解消する
	// (NN/g heuristic #1 visibility of system status)。
	gateNavigating: `${ADMIN_VIEW_TERMS.canonical}をひらいています…`,
	// #3089: navigating overlay の timeout / error fallback 文言。ハードナビが unload しないまま
	// 一定時間 (CloudFront 429 / /admin 5xx / 通信断 / cookie 失効 等) 経過した際、spinner dead-end を
	// 解除して「読み込みに失敗した・再試行できる」ことを明示する (NN/g #1 visibility + #9 error recovery)。
	gateNavigatingError: `${ADMIN_VIEW_TERMS.canonical}の読み込みに時間がかかっています。もう一度お試しください。`,
	// #3089: navigating overlay error 状態の再試行ボタン文言。
	gateNavigatingRetry: 'もう一度ひらく',
	// #2991: ロック時は解除の絶対時刻を提示する (NIST SP 800-63B / iOS Security Lockout は残り時間明示、
	// NN/g heuristic #1 visibility)。秒カウントダウンは temporal vigilance で不安を増幅するため絶対時刻型を採用
	// (research: tmp/research/pin-gate-ux-ideal-state.md Q2)。timeStr は呼び出し側で「HH:MM」整形した文字列。
	gateLockedUntilNotice: (timeStr: string) =>
		`${OYAKAGI_TERMS.name}の入力に連続して失敗しました。${timeStr} まで待ってから再度お試しください`,
	gateFormatNotice: `${OYAKAGI_TERMS.name}は4〜6桁の数字です`,
	gateGenericError: `${OYAKAGI_TERMS.name}の確認に失敗しました。もう一度お試しください`,
	// Issue #2353 Fix 5 (Phase A): gateDefaultHint (= '初期値は 5086（がんばり）です') は子供が見て即入れる脆弱性のため modal 用 atom を削除
	// (#2992 以降は初回作成フローのため gate 経路に既定 PIN ヒント自体が不要。defaultValueHint は legacy local 文脈の PIN 変更画面のみで継続)
	gatePinRequiredBanner: `${ADMIN_VIEW_TERMS.canonical}に入るには${OYAKAGI_TERMS.name}が必要です`,
	// 親管理画面で一定時間操作がなく自動的に子供選択画面へ戻った旨の通知 (parent-gate inactivity redirect)
	gateTimedOutNotice: `しばらく操作がなかったため${ADMIN_VIEW_TERMS.canonical}を閉じました。もう一度入るには${OYAKAGI_TERMS.name}を入力してください`,
	// #2993: PIN 忘れ救済導線 (入力モード + cognito identity のみ表示、/auth/reset-pin = パスワード再入力方式へ遷移)
	gateForgotPinLink: `${OYAKAGI_TERMS.name}を忘れた方`,
	// #2994: local (self-host) では運用者向け reset 手順に誘導する (email/リンク導線なし)
	gateOperatorResetNotice: `${OYAKAGI_TERMS.name}を忘れた場合は、サーバー管理者向けのリセット手順で再設定できます`,
	// #2992 (EPIC #2990): 初回は「作る」フロー。PIN 未設定 tenant には login でなく
	// 新規作成 (入力→確認の 2 段) を表示する (Apple Screen Time / Google Family Link 同型)。
	// これにより既定 PIN を知らない保護者の初回 dead-end が構造的に解消する。
	gateCreateTitle: `${OYAKAGI_TERMS.name}をつくってください`,
	gateCreateDescription: `${ADMIN_VIEW_TERMS.canonical}に入るための${OYAKAGI_TERMS.name}（4〜6桁の数字）を、${PARENT_TERMS.neutral}が決めて入力してください。`,
	gateCreateConfirmTitle: `もう一度入力してください`,
	gateCreateConfirmDescription: `確認のため、同じ${OYAKAGI_TERMS.name}をもう一度入力してください。`,
	gateCreateMismatch: `入力が一致しませんでした。最初からやり直してください`,
	gateCreateAlreadyConfigured: `${OYAKAGI_TERMS.name}は設定済みです。入力画面からやり直してください`,
	gateCreateGenericError: `${OYAKAGI_TERMS.name}の作成に失敗しました。もう一度お試しください`,
	gateCreateSubmitting: 'つくっています…',
} as const;

/**
 * PIN reset 画面文言 SSOT (#2993、EPIC #2990)
 *
 * /auth/reset-pin (cognito 専用): アカウントパスワード再入力で本人確認し、その場で
 * 新しい PIN を設定する (Apple Screen Time 同型)。email はセッション既知のため手入力なし。
 */
export const PIN_RESET_LABELS = {
	resetPageTitle: `${OYAKAGI_TERMS.name}の再設定`,
	resetHeading: `${OYAKAGI_TERMS.name}を忘れた場合`,
	resetDescription: `ご本人確認のため、ログイン中のアカウントのパスワードを入力してください。そのまま新しい${OYAKAGI_TERMS.name}を設定できます。`,
	resetAccountLabel: 'ログイン中のアカウント',
	resetPasswordLabel: 'アカウントのパスワード',
	resetPasswordHint: `${LOGIN_TERMS.canonical}時に使っているパスワードです`,
	// #3070: federated (Google) ユーザ向け — Cognito パスワードを持たず、共有端末で silent SSO により
	// recent-login が無入力で通過し得るため、登録メールへ 6 桁コードを送る email-OTP で本人確認する。
	resetFederatedDescription: `ご本人確認のため、ログイン中のアカウントのメールに確認コードをお送りします。コードを入力すると新しい${OYAKAGI_TERMS.name}を設定できます。`,
	resetFederatedSendCodeButton: '確認コードを送る',
	resetFederatedSendingCode: '送信中…',
	resetFederatedCodeSent:
		'確認コードをメールにお送りしました。メールに記載の6桁のコードを入力してください。',
	resetFederatedCodeLabel: '確認コード（6桁の数字）',
	resetFederatedResendButton: 'コードを再送する',
	// エラー文言
	resetPinLabel: `新しい${OYAKAGI_TERMS.name}（4〜6桁の数字）`,
	resetSubmit: `${OYAKAGI_TERMS.name}を再設定する`,
	resetSubmitting: '設定中…',
	resetSuccessHeading: '再設定が完了しました',
	resetSuccessBody: `新しい${OYAKAGI_TERMS.name}で${ADMIN_VIEW_TERMS.canonical}に入れます。`,
	resetSuccessCta: `${ADMIN_VIEW_TERMS.canonical}へ`,
	resetBackToSwitch: `${ADMIN_VIEW_TERMS.canonical}に戻る`,
	// エラー文言
	errorInvalidPassword: 'パスワードが正しくありません',
	errorPasswordRequired: 'パスワードを入力してください',
	errorPinFormat: `${OYAKAGI_TERMS.name}は4〜6桁の数字で入力してください`,
	errorRateLimited: '試行回数が上限に達しました。しばらく時間をおいてからお試しください',
	errorNotSupported: 'この環境では本画面から再設定できません。管理者向け手順で再設定してください',
	errorGeneric: '再設定に失敗しました。時間をおいてもう一度お試しください',
	// #3070: federated email-OTP のエラー文言
	errorCodeRequired: '先に「確認コードを送る」からコードを受け取ってください',
	errorInvalidCode: '確認コードが正しくありません。メールに記載のコードをご確認ください',
	errorCodeExpired:
		'確認コードの有効期限が切れました。もう一度「コードを再送する」からやり直してください',
	errorTooManyAttempts:
		'確認コードの入力回数が上限に達しました。もう一度「コードを再送する」からやり直してください',
	errorCodeSendFailed: '確認コードの送信に失敗しました。時間をおいてもう一度お試しください',
} as const;

/**
 * #3070: federated PIN reset の確認コードメール文言 SSOT。
 * Anti-engagement (ADR-0012) 整合: 煽らず中立トーン。「心当たりがなければ無視してください」で
 * 不正送信時の安全側案内も含める。
 */
export const PIN_RESET_EMAIL_LABELS = {
	subject: `【がんばりクエスト】${OYAKAGI_TERMS.name}再設定の確認コード`,
	heading: `${OYAKAGI_TERMS.name}再設定の確認コード`,
	intro: `${OYAKAGI_TERMS.name}の再設定をご希望の場合は、以下の確認コードを入力してください。`,
	codeNote: 'このコードは10分間有効です。',
	ignoreNote: 'このメールに心当たりがない場合は、操作せずにこのまま無視してください。',
} as const;

/**
 * PIN gate 初心者導線 ダイアログ文言 SSOT (#2353 設計欠陥 6)
 *
 * setup 完了後の子供画面初回遷移時に 1 回だけ表示する onboarding dialog。
 * 「以降表示しない」checkbox で settings.pin_gate_onboarding_seen を 'true' に persist。
 */
export const PIN_GATE_ONBOARDING_LABELS = {
	dialogTitle: `${ADMIN_VIEW_TERMS.canonical}に入る方法`,
	dialogIntro: `子供の画面から${ADMIN_VIEW_TERMS.canonical}に戻るには、トップの「だれがつかう？」画面で 🔒 ${ADMIN_VIEW_TERMS.parent} のリンクをタップしてください。`,
	// #2992: 初回は既定 PIN の入力でなく新規作成 (入力→確認) フローになるため、
	// 旧「初回ログイン時の○○は 初期 5086…」の既定値案内から作成フロー案内に変更。
	dialogPinHint: `初めて${ADMIN_VIEW_TERMS.canonical}に入るときに、${PARENT_TERMS.neutral}が${OYAKAGI_TERMS.name}（4〜6桁の数字）を作成します。`,
	dialogChangePinHint: `${OYAKAGI_TERMS.name}は${ADMIN_VIEW_TERMS.canonical}の「せってい」 → 「${OYAKAGI_TERMS.name}」からいつでも変更できます。`,
	dontShowAgain: '今後表示しない',
	// Issue #2353 Phase D / E2E 衝突対策: 子供向け Dialog の「とじる」と strict mode 衝突するため
	// 親向け onboarding 文言として「わかった」を採用 (UI 上は unique、意味 = 「理解した、閉じる」)
	close: 'わかった',
} as const;

// ============================================================
// インポート関連（#1254）
// ============================================================

/**
 * 家族データインポート機能のラベル SSOT (#1254)
 * エラーメッセージ、ダイアログ文言、スキップ理由など
 */
export const IMPORT_LABELS = {
	// エラーメッセージ
	errorChecksumMismatch: 'ファイルが破損しているか改ざんされています',
	// #3201: parse 失敗 (= そもそもバックアップ形式でない) を checksum 不一致 (= 破損 / 改ざん) と
	// 区別できる文言に是正 + /api/v1/import の parse 失敗経路に配線 (旧: 'JSONの解析に失敗しました' 直書き)。
	// 内部フォーマット名 (JSON) は UI 露出しない (BACKUP_TERMS SSOT、#3198)。
	errorInvalidJson: `${BACKUP_TERMS.file}として読み込めませんでした（ファイルの形式が正しくありません）`,
	errorImportFailed: 'インポートに失敗しました',
	// #3325 AC3: 実行環境の実効上限 (AWS = Function URL 6MB 弱) 超過時のエラー + クラウド導線案内。
	// API (import/+server.ts) と UI (settings/data の送信前 pre-check) の双方で共有する。
	errorFileTooLargeCloudGuide: (maxMb: number | string) =>
		`ファイルサイズが大きすぎます（最大${maxMb}MB）。大きな${BACKUP_TERMS.canonical}はクラウド共有（PINコード）経由で${BACKUP_TERMS.restoreVerb}してください`,

	// 事前確認ダイアログ
	previewDialogTitle: 'インポート内容の確認',
	previewDialogConfirm: 'スキップして続行',
	previewDialogCancel: 'キャンセル',
	previewDialogDuplicatesHeading: '以下は既存と重複するためスキップされます',
	previewDialogPresetDuplicate: 'このプリセットは既にインポート済みです',
	previewDialogNameDuplicate: '名前が既存と同じため',
	previewDialogLogConstraint: '記録日時が既存と同じため',
} as const;

/**
 * スキップ理由 enum (#1254 G2)
 * - preset_duplicate: source_preset_id 一致
 * - name_duplicate: 名前一致
 * - log_constraint: 複合 unique 制約 (activity_logs, login_streaks, status_history)
 */
export type ImportSkipReason = 'preset_duplicate' | 'name_duplicate' | 'log_constraint';

// ============================================================
// 設定ページ関連ラベル（#1452 Phase B）
// ============================================================

export const SETTINGS_LABELS = {
	// #3991: `grace_period` の意味は「支払い失敗の猶予 (dunning)」に一意化された。
	// 旧文言は解約申請の猶予を指しており (#3986 の多重定義)、支払い失敗のテナントに
	// 「解約手続き中です」+ 解約取り消しボタンを見せていた。解約申請中の表示と取り消し導線は
	// `/admin/subscription` (SaasLicensePanel) が Stripe の `cancel_at_period_end` を SSOT に担う。
	gracePeriodTitle: 'お支払いを確認できていません',
	gracePeriodDesc:
		'カードの有効期限切れなどでお支払いが完了していない可能性があります。プラン・お支払い画面からお支払い方法をご確認ください。お子さまの記録はそのままご利用いただけます。',
	gracePeriodAction: 'プラン・お支払いを確認する',

	// #1781: 削除グレースピリオド（soft-delete）バナー
	deletionGraceTitle: 'アカウント削除のお手続き中です',
	// #4496: 呼び出し側 (admin/settings/account) が渡すのは `daysRemaining` (残日数) なのに、
	//   文言は「お手続きから N 日後」と経過日数として述べていたため、数日後に開くと
	//   値と説明が食い違っていた。引数名を実体に合わせ、文言も残日数として述べる。
	deletionGraceDesc: (daysRemaining: number, date: string) =>
		`あと ${daysRemaining} 日（${date}）ですべてのデータが完全に削除されます。それまでであれば「復元」ボタンで取り消せます。`,
	deletionGraceRestoreAction: 'アカウントを復元する',
	deletionGraceRestoreSubmitting: '復元中...',
	deletionGraceRestoreSuccess: 'アカウントを復元しました。通常通りご利用いただけます。',
	deletionGraceRestoreError:
		'アカウントの復元に失敗しました。猶予期間が終了している可能性があります。',

	// ステータス減少設定
	decaySectionTitle: '📊 ステータス減少設定',
	decaySectionDesc:
		'活動をお休みした日のステータス減少の強さを設定できます。どの設定でも最初の2日間は減少しません。',
	decaySaving: '保存中...',
	decaySaveAction: '設定を保存',
	decaySaved: 'ステータス減少設定を保存しました',

	// 既定の子供
	defaultChildSectionTitle: '🏠 既定の子供',
	defaultChildDesc: 'ホーム画面（/）を開いたときに自動で表示する子供を選べます。',
	defaultChildDescNote: 'これは',
	defaultChildDescNoteStrong: 'この端末ではなく、アカウント全体の既定',
	defaultChildDescNoteSuffix: 'です。未設定のときは選択画面が表示されます。',
	defaultChildUpdated: '既定の子供を更新しました',
	defaultChildNone: '未設定（毎回選択画面を表示）',
	defaultChildSaveAction: '既定を保存',

	// きょうだいチャレンジ設定
	siblingSectionTitle: '👥 きょうだいチャレンジ設定',
	siblingSaved: 'きょうだい設定を保存しました',
	siblingRankingLabel: 'きょうだいランキングを表示する',
	// #1960 Phase 7 H3: terms.ts atom 参照化
	siblingRankingUpsell: `きょうだいランキングは${PLAN_FULL_TERMS.premium}限定の機能です。`,
	siblingRankingUpsellLink: 'プランのアップグレード',
	siblingRankingUpsellSuffix: 'で利用できます。',
	siblingSaveAction: '設定を保存',

	// 通知設定
	notificationSectionTitle: '🔔 通知設定',
	notificationSaved: '通知設定を保存しました',
	notificationBrowserLabel: 'ブラウザ通知',
	notificationChecking: '確認中...',
	notificationEnableAction: '通知をオンにする',
	notificationEnableActionLoading: 'オンにしています…',
	notificationDisableAction: '通知をオフにする',
	// #3186: 通知ステータス UI の文言 SSOT 化。内部状態 (許可済み未登録 等) は出さず
	// ユーザ向けは ON / OFF + 異常系 (ブロック / 非対応) に集約する。
	notificationStatusOn: 'オン',
	notificationStatusBlocked: 'ブロック中',
	notificationUnsupportedNote: 'お使いのブラウザ・端末では通知を使えません',
	notificationBlockedNote: 'ブラウザのサイト設定で通知を許可してください',
	notificationEnableSuccess: '通知をオンにしました',
	notificationEnableFailure: '通知をオンにできませんでした。時間をおいて再度お試しください',
	notificationDisableSuccess: '通知をオフにしました',
	notificationDisableFailure: '通知をオフにできませんでした。時間をおいて再度お試しください',
	notificationReminderLabel: 'リマインダー通知（毎日の記録を促す）',
	notificationStreakLabel: 'ストリーク警告（連続記録が途切れそうな時）',
	notificationAchievementLabel: '達成通知（記録完了・レベルアップ時）',
	notificationQuietSeparator: '〜',
	notificationSaveAction: '通知設定を保存',

	// ポイント表示設定
	pointSectionTitle: '💰 ポイント表示設定',
	pointSaved: 'ポイント表示設定を保存しました',
	pointDisplayMode: '表示モード',
	pointModePoint: 'ポイント（P）',
	pointModeCurrency: '通貨で表示',
	pointPreviewLabel: (n: number) => `プレビュー（${n}P の場合）`,
	pointSaveAction: 'ポイント設定を保存',

	// データ管理 (#backup-terms: 内部フォーマット JSON/ZIP は UI 露出しない。BACKUP_TERMS 統一)
	dataSectionTitle: '💾 データ管理',
	dataExportDesc: `家族のデータを${BACKUP_TERMS.file}としてダウンロードできます。${BACKUP_TERMS.exportNoun}や別環境への移行に使用できます。`,
	dataExportTarget: `${BACKUP_TERMS.canonical}に含まれるもの:`,
	dataExportItem1: '子供プロフィール・活動記録・ポイント履歴',
	dataExportItem2: 'ステータス・実績・称号・ログインボーナス',
	dataExportItem3: 'チェックリスト・誕生日振り返り',
	dataExportItem4: '活動マスタ・きせかえアイテム',
	dataExportUpsellTitle: `🔒 データの${BACKUP_TERMS.exportNoun}は `,
	// #1960 Phase 7 H3: terms.ts atom 参照化
	dataExportUpsellPlan: `${PLAN_FULL_TERMS.standard}`,
	dataExportUpsellSuffix: ' 以上でご利用いただけます。',
	dataExportUpsellDesc: `家族のデータを${BACKUP_TERMS.file}としてダウンロードして、${BACKUP_TERMS.exportNoun}や引っ越しに利用できます。`,
	dataExportUpsellCta: 'プランを見る',
	dataExportLockedButton: `🔒 ${BACKUP_TERMS.canonical}をダウンロード（有料プラン限定）`,
	dataExportIncludeFiles: '画像・音声ファイルも含める',
	dataExportIncludeFilesHint:
		'画像・音声を含める場合は上のチェックをオンにしてください。ファイルサイズが大きくなる場合があります（最大100MB）。',
	// #3376 fail-closed: 同梱対象 (data.json + 画像・音声) の合計が上限を超えたとき、
	// 不完全な部分バックアップを黙って作らず明示エラーにする (再生成不能な avatar/voice の silent 欠落防止)。
	dataExportTooLarge: (maxMb: string) =>
		`バックアップ対象のデータが上限（${maxMb}MB）を超えています。不要な画像・音声を整理してから、もう一度お試しください。`,
	// #3405-3: 個々の画像・音声ファイル単体が per-entry 上限を超えたとき、build/parse 対称化のため
	// build 時点で明示エラーにする (25MB 超 entry を含む ZIP を作らせない = import で silent drop →
	// 復元不能になる dead-end を根治)。
	dataExportEntryTooLarge: (maxMb: string) =>
		`1つの画像・音声ファイルが上限（${maxMb}MB）を超えています。該当ファイルを小さくするか削除してから、もう一度お試しください。`,
	// #3694: AWS 本番の Function URL (BUFFERED) は response も 6MB hard cap。画像込み ZIP が
	// 直接ダウンロードの実効上限を超えると edge で沈黙切断されるため、明示エラー + クラウド共有
	// (PINコード、非同期・上限なし) への誘導を返す (ADR-0062)。
	dataExportTooLargeForDirectDownload: (maxMb: string) =>
		`画像・音声を含むファイルが直接ダウンロードの上限（${maxMb}MB）を超えています。「クラウド共有（PINコード）」から${BACKUP_TERMS.exportVerb}してください`,
	// #3775 ①: JSON export (テキストのみ、画像・音声は ZIP 同梱) も aws-prod では Function URL
	// 6MB response cap を超えると edge 沈黙切断される。JSON は画像・音声を含まないため専用文言で
	// クラウド共有 (PINコード、非同期・上限なし) へ誘導する (ADR-0062 / dataExportTooLargeForDirectDownload と対)。
	dataExportJsonTooLargeForDirectDownload: (maxMb: string) =>
		`${BACKUP_TERMS.canonical}が直接ダウンロードの上限（${maxMb}MB）を超えています。「クラウド共有（PINコード）」から${BACKUP_TERMS.exportVerb}してください`,
	// #3376: 画像込み ZIP ダウンロードはブラウザの安全性警告（保存の確認）が出ることがある。
	// 画像込みの完全バックアップは、警告の出ないクラウドバックアップを推奨する導線（SaaS 版専用）。
	dataExportZipCloudHint:
		'画像・音声を含むファイルのダウンロードは、ブラウザが安全性の確認を求めることがあります（壊れたファイルではありません）。画像も含めて安全に残すなら、下の「クラウドバックアップ」がおすすめです。',
	// #3867: セルフホスト版（authMode≠cognito）はクラウドバックアップ導線が無いため、
	// 「クラウドバックアップ」に言及しない代替文言。ブラウザ安全性警告は正常である旨の安心情報のみ残す
	// （下にクラウドセクションが無いのに「下のクラウドバックアップがおすすめ」と案内する dangling を防ぐ）。
	dataExportZipLocalHint:
		'画像・音声を含むファイルのダウンロードは、ブラウザが安全性の確認を求めることがあります（壊れたファイルではありません）。そのまま保存していただいて問題ありません。',
	dataExportCompact: 'ファイルサイズを小さくする（圧縮）',
	dataExporting: '書き出し中...',
	dataExportAction: `${BACKUP_TERMS.canonical}をダウンロード`,

	// インポート
	dataImportTitle: 'データのインポート',
	dataImportDesc: `保存した${BACKUP_TERMS.file}からデータを${BACKUP_TERMS.restoreVerb}できます（画像・音声を含むファイルはアバター画像・音声も${BACKUP_TERMS.restoreVerb}します）。`,
	dataImportMode: 'インポートモード',
	dataImportModeReplace: '置換（既存データを削除してインポート）',
	dataImportModeAdd: '追加（既存データを残して追加）',
	dataImportModeReplaceWarning:
		'既存の子供・活動ログ・ポイント等のデータをすべて削除してからインポートします。',
	dataImportModeAddNote: '新しい子供データとして追加されます（既存データは上書きされません）。',
	dataImportLoading: '読み込み中...',
	dataImportSelectFile: `${BACKUP_TERMS.file}を選択`,
	// #backup-terms: 不正ファイル選択時 (内部フォーマット名は出さず「バックアップファイル」で統一)
	dataImportInvalidFile: `${BACKUP_TERMS.file}を選択してください`,
	// #3285 uiux-3: settings/data の import 検証 / クラウド連携メッセージを SSOT 集約 (旧: 直書き)
	dataImportNoFile: `${BACKUP_TERMS.file}が選択されていません`,
	dataImportFileTooLarge: (maxMb: string) => `ファイルサイズが大きすぎます（最大${maxMb}MB）`,
	// #3324: import fetch の client timeout (AbortController) 発火時の明示エラー (無限ハング防止)
	dataImportTimeoutError:
		'処理がタイムアウトしました。通信状況をご確認のうえ、しばらくしてから再度お試しください',
	// #3372: registry (backup-entity-registry) 駆動の partial-backup 警告 (NN/G visibility)。
	// 未 export の source 実体が存在する間のみ表示し、export 実装が進むと自動で消える。
	dataImportPartialBackupWarning: (items: string) =>
		`この${BACKUP_TERMS.exportNoun}形式にはまだ含まれないデータがあります（${items}）。これらは${BACKUP_TERMS.restoreVerb}されません。`,
	cloudExportPinIssued: (pinCode: string, expiry: string) =>
		`PINコード: ${pinCode}（有効期限: ${expiry}）`,
	cloudImportNoChildren:
		'取込先のお子さまが登録されていません。先に /admin/children でお子さま登録をしてください。',
	dataImportChecksumOk: '✓ ファイルの整合性を確認しました',
	dataImportPreviewChildren: (n: number | string | undefined) => `子供: ${n}人`,
	dataImportPreviewActivityLogs: (n: number | string | undefined) => `活動ログ: ${n}件`,
	dataImportPreviewPointLedger: (n: number | string | undefined) => `ポイント履歴: ${n}件`,
	dataImportPreviewStatuses: (n: number | string | undefined) => `ステータス: ${n}件`,
	dataImportPreviewAchievements: (n: number | string | undefined) => `実績: ${n}件`,
	dataImportPreviewLoginBonuses: (n: number | string | undefined) => `ログインボーナス: ${n}件`,
	dataImportPreviewChecklists: (n: number | string | undefined) => `チェックリスト: ${n}件`,
	dataImportMoreItems: (n: number) => `...他 ${n}件`,
	dataImportReplaceConfirm:
		'既存データをすべて削除してからインポートします。この操作は取り消せません。',
	dataImportAddConfirm:
		'インポートすると新しい子供データとして追加されます。この操作は取り消せません。',
	dataImportCancel: 'キャンセル',
	dataImporting: 'インポート中...',
	dataImportAction: 'インポートを実行',
	dataImportComplete: 'インポート完了',
	dataImportResultChildren: (n: number | string) => `子供: ${n}人 作成`,
	dataImportResultActivities: (n: number | string) => `活動マスタ: ${n}件 新規作成`,
	dataImportResultActivityLogs: (imported: number | string, skipped: number | string) =>
		`活動ログ: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultPointLedger: (imported: number | string, skipped: number | string) =>
		`ポイント: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	// #3095: silent-skip 可視化 — 静的ファイル / チェックリスト履歴 / ごほうび の復元・skip 件数を surface
	dataImportResultSpecialRewards: (imported: number | string, skipped: number | string) =>
		`ごほうび: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultChecklistLogs: (imported: number | string, skipped: number | string) =>
		`チェックリスト履歴: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultStaticFiles: (restored: number | string, skipped: number | string) =>
		`画像・音声ファイル: ${restored}件復元${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	// #3490: childVoices (お子さまの音声) / 各種設定の復元・skip 件数を summary に surface (silent-skip 可視化)
	dataImportResultChildVoices: (imported: number | string, skipped: number | string) =>
		`お子さまの音声: ${imported}件復元${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultSettings: (imported: number | string, skipped: number | string) =>
		`各種設定: ${imported}件復元${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportWarningsTitle: (n: number | string) => `警告 (${n}件):`,
	dataImportErrorsTitle: (n: number | string) => `エラー (${n}件):`,
	// #3095: partial-restore の data-integrity 可視化 — errors があれば「完了」でなく部分復元として警告する。
	// とくに置換 (replace) は既存データをクリア後に復元するため、部分失敗が成功扱いになると家族データが半損する。
	dataImportPartialTitle: '一部のデータを復元できませんでした',
	dataImportPartialBodyReplace:
		'既存データはクリア済みのため、復元できなかった項目は失われています。下記の内容をご確認のうえ、バックアップから再度インポートしてください。',
	dataImportPartialBodyAdd:
		'復元できなかった項目があります。下記の内容をご確認のうえ、必要に応じて再度インポートしてください。',
	dataImportClose: '閉じる',
	// #3386: バックアップ ZIP の整合性検証失敗メッセージ (ADR-0062 — 内部 reason コード / 生パスを露出しない
	// ユーザー向け文言。内部 reason は logger のみに残す)。checksum/size/missing 破損は共通の破損文言で、
	// unexpected-file (混入) のみ別文言にして「作り直し」の次アクションを促す。
	dataImportManifestCorrupt:
		'バックアップファイルが壊れているため復元できません。もう一度エクスポートしてください',
	dataImportBackupCorrupt:
		'バックアップファイルの内容が壊れているため復元できません。もう一度エクスポートしてください',
	dataImportBackupUnexpectedFile:
		'バックアップファイルに想定外のデータが含まれているため復元できません。もう一度エクスポートしてください',
	dataImportBackupCountMismatch:
		'バックアップファイルの一部が欠けているため復元できません。もう一度エクスポートしてください',

	// クラウドエクスポート
	cloudSectionTitle: '☁️ クラウド共有',
	cloudSlotCounter: (current: number, max: number) => `保管枠 ${current} / ${max}`,
	cloudUpsellTitle: '🔒 クラウド共有は ',
	// #1960 Phase 7 H3: terms.ts atom 参照化
	cloudUpsellPlan: `${PLAN_FULL_TERMS.standard}`,
	cloudUpsellSuffix: ' 以上でご利用いただけます。',
	cloudUpsellDesc: `家族のデータをクラウドに保管して、PINコードで別端末や他のアカウントと共有できます（${PLAN_TERMS.standard}: 3枠 / ${PLAN_TERMS.premium}: 10枠）。`,
	cloudUpsellCta: 'プランを見る',
	cloudExportDesc: '設定やデータをクラウドに保管してPINコードで他のアカウントと共有できます。',
	cloudExportType: 'エクスポートタイプ',
	cloudExportTypeTemplate: 'テンプレート（活動・チェックリスト）',
	cloudExportTypeFull: 'フルバックアップ',
	cloudExportTypeTemplateDesc: '活動設定やチェックリストのみ共有します（個人データは含みません）。',
	cloudExportTypeFullDesc: '子供データ・活動ログ等すべてのデータを含みます。環境移行用です。',
	cloudSaving: '保管中...',
	cloudSaveAction: 'クラウドに保管',
	cloudStoredTitle: '保管済みデータ',
	cloudStoredExpiry: (date: string) => `期限: ${date}`,
	cloudStoredDownloads: (count: number | string, max: number | string) => `DL: ${count}/${max}回`,
	cloudStoredDelete: '削除',
	// #3324 / #3509: 非同期 build 状態 (pending/building/ready/failed) の可視フィードバック
	cloudStatusPending: '受付済み・生成待ち',
	cloudStatusBuilding: '生成中…',
	cloudStatusFailed: (reason: string) => `作成に失敗しました${reason ? `（${reason}）` : ''}`,
	cloudDownloadAction: 'ダウンロード',
	cloudImportTitle: 'PINコードでインポート',
	cloudImportDesc: '共有されたPINコードを入力してデータを取り込みます。',
	cloudImportPinPlaceholder: 'PINコード（6桁）',
	cloudImportChecking: '確認中...',
	cloudImportConfirmAction: '確認',
	cloudImportPreviewTitle: 'インポート内容の確認',
	cloudImportPreviewActivities: (n: number | string | unknown) => `活動マスタ: ${n}件`,
	cloudImportPreviewChecklists: (n: number | string | unknown) => `チェックリスト: ${n}件`,
	cloudImportTemplateNote: '既存の設定に追加されます（重複はスキップ）。',
	cloudImportFullNote: 'フルバックアップデータです。追加インポートされます。',
	cloudImportCancel: 'キャンセル',
	cloudImporting: 'インポート中...',
	cloudImportAction: 'インポート実行',
	cloudImportComplete: 'インポート完了',
	cloudImportResultActivities: (n: number | string | unknown) => `活動マスタ: ${n}件 追加`,
	cloudImportResultChecklists: (n: number | string | unknown) => `チェックリスト: ${n}件 追加`,
	cloudImportResultChildren: (n: number | string | unknown) => `子供データ: ${n}人 追加`,
	cloudImportClose: '閉じる',

	// データクリア
	clearSectionTitle: '🗑️ データクリア',
	clearDesc:
		'すべての家族データ（子供・活動ログ・ポイント・ステータス等）を一括削除します。活動マスタ・カテゴリなどのシステムデータは保持されます。',
	clearCurrentDataTitle: '現在のデータ件数',
	clearIrreversibleWarning:
		'この操作は取り消せません。事前にデータをエクスポートすることをお勧めします。',
	clearCompleted: 'データクリアが完了しました。ページを再読み込みしてください。',

	// フィードバック (#support-unify: 1 フォーム統合 — intent 2 軸 + 内容分類併用。研究: 単一フォーム + intent セレクタ)
	feedbackSectionTitle: '💬 サポート・ご意見',
	feedbackSectionDesc:
		'個人開発のため、開発者本人がひとつずつ目を通します。ご感想・ご要望も、導入や使い方・解約のご相談もこちらからどうぞ。',
	feedbackIntentLabel: 'ご用件',
	feedbackIntentFeedback: '感想・要望を送る（返信は不要）',
	feedbackIntentConsult: '相談・困りごと（返信を希望）',
	feedbackCategoryLabel: '種類',
	feedbackCategoryFeature: '機能要望',
	feedbackCategoryBug: 'バグ報告',
	feedbackCategoryOther: 'その他',
	feedbackChildAgeLabel: 'お子さまの年齢（任意）',
	feedbackChildAgePlaceholder: '例: 7 歳、3 歳と 6 歳など',
	feedbackChildAgeHint: 'お子さまに合うかどうかをご一緒に考えるための参考にします。',
	feedbackReplyEmailLabel: '返信先メールアドレス',
	feedbackReplyEmailOptionalSuffix: '（任意）',
	feedbackReplyHintFeedback: '読ませていただきますが、個別の返信はできない場合があります。',
	feedbackReplyHintConsultWithAccount: (account: string) =>
		`${account} に返信します（通常 1〜2 日以内）。別のアドレスを希望する場合は入力してください。`,
	feedbackReplyHintConsultNoAccount:
		'返信のためメールアドレスを入力してください（通常 1〜2 日以内）。',
	feedbackConsultReplyRequiredError: '相談・困りごとは返信先メールアドレスを入力してください',
	feedbackInvalidIntentError: 'ご用件の選択が不正です',
	feedbackSubmitButton: '送信する',
	feedbackSubmittingText: '送信中...',
	feedbackSuccessConsult: (inquiryId: string) =>
		`ご相談を受け付けました。受付番号: ${inquiryId}。内容を確認のうえ、入力いただいたメールアドレスにご返信します。`,
	feedbackSuccessFeedbackWithId: (inquiryId: string) =>
		`お問い合わせを受け付けました。受付番号: ${inquiryId}。`,
	feedbackSuccessFeedbackEmailNote: '入力いただいたメールアドレスに確認メールをお送りしました。',
	feedbackSuccessFeedbackNoId: 'お問い合わせありがとうございます。今後の参考とさせていただきます。',
	feedbackContentLabel: '内容',
	feedbackContentPlaceholder: 'ご意見・ご要望をお聞かせください...',
	feedbackContactNote: '技術的なご質問・使い方の相談は',
	feedbackContactLinkLabel: 'メール',
	feedbackContactSuffix: 'でも受け付けています',

	// アプリ情報
	// #4087 (E3 / EPIC #4119): バックアップ状態を**家族 (非エンジニア) が見られる場所**に出す。
	// 2026-07-31 の実害では、バックアップが 18 日止まっていたのに気づく手段が
	// `curl /api/health | jq` しかなかった。ADR-0012 整合で常時表示の煽りにはせず、
	// 設定画面内の静的表示に留める (子供画面には一切出さない)。
	backupSectionTitle: '🗄️ バックアップの状態',
	backupOkTitle: '正常に取れています',
	backupWarnTitle: '確認してください',
	backupCriticalTitle: 'バックアップが取れていません',
	backupLastSuccessLabel: '最後に成功した日時: ',
	backupNeverSucceeded: '一度も成功していません',
	backupConsecutiveFailuresLabel: '連続で失敗した回数: ',
	backupNotificationMissing:
		'失敗しても通知が届かない設定です。いま止まっても気づけません (DISCORD_ALERT_WEBHOOK_URL 未設定)。',
	backupActionHint: 'うまくいっていないときは、下のフォームから相談してください。',
	// #4162: ローテーション保留だけが起きている状態の案内。
	// **「取れていない」ではなく「片付いていない」**であることが伝わる文言にする。
	// 汎用の backupActionHint (相談してください) だけだと、必要な行動が分からないまま
	// 「job が壊れた」と読まれ、再起動や再インストールに向かってしまう。
	// #4162 昇格時 (rotation-blocked-critical) の見出し。
	// **`backupCriticalTitle`（「バックアップが取れていません」）を使ってはいけない** —
	// この状態では毎晩正常に取れており、世代はむしろ増え続けている。断定形で「取れていない」と
	// 出すと、#4162 が直したはずの「診断が真逆」を条件付きで作り直すことになる (同 class 3 回目)。
	backupRotationBlockedCriticalTitle: '急いで片づけてください',
	backupRotationBlockedHint:
		'バックアップは取れていますが、古い控えが増えすぎたため、自動での削除を止めています。古い控えを別の場所へ移してから、いらないものを消してください。',
	// 昇格後 (7 晩放置) の本文。取れている事実は変えずに、放置の危険だけを足す。
	backupRotationBlockedCriticalHint:
		'バックアップは取れていますが、古い控えが増えすぎた状態が 1 週間以上続いています。このままでは保存する場所がなくなり、いずれ本当に取れなくなります。古い控えを別の場所へ移してから、いらないものを消してください。',
	appInfoSectionTitle: 'ℹ️ アプリ情報',
	appInfoTermsLink: '📄 利用規約',
	appInfoPrivacyLink: '🔒 プライバシーポリシー',
	appInfoContactLink: '💬 お問い合わせ',
	appInfoGithubLink: '🐙 GitHub',
	appInfoVersionLabel: 'バージョン: ',

	// アカウント削除
	accountDeleteSectionTitle: 'アカウント削除',
	accountDeleteOwnerDesc:
		'オーナーとしてアカウントを削除すると、家族グループ全体のデータが影響を受けます。',
	accountDeleteOwnerItem1: '子供のプロフィール・活動記録・ポイント履歴',
	accountDeleteOwnerItem2: 'アバター画像・音声ファイル',
	accountDeleteOwnerItem3: '設定・チェックリスト・キャリアプラン',
	accountDeleteOwnerItem4: 'メンバーシップ・招待情報',
	// #4496: 猶予の有無はプランで異なる (無料は 0 日 = 申請と同時に削除) ため、本文で猶予に
	//   言及しない。プラン別の事実は accountDeleteGraceNotice が述べる (直下に並ぶので、
	//   ここで「猶予期間の経過後は」と書くと無料プランの案内と正面から矛盾する)。
	accountDeleteOwnerWarning:
		'削除が確定するとデータは復旧できません。事前にデータをエクスポートすることを強くお勧めします。',
	// #4496: 退会 (アカウント削除) の猶予はプラン別 (無料は 0 日 = 申請と同時に物理削除)。
	//   「削除後の復旧はできません」だけでは、同一画面の復元バナー (deletionGraceDesc) や
	//   削除予告メールと矛盾し、無料プランの顧客は取り消せないことを知らないまま申し込む。
	//   手続き**前**にプラン別の猶予を述べる。日数は DELETION_GRACE_TERMS (値 SSOT) から引く。
	accountDeleteGraceNotice: (graceDays: number) =>
		graceDays === 0
			? `ご利用中の${PLAN_FULL_TERMS.free}には猶予期間がありません。お申し込みと同時にすべてのデータが完全に削除され、取り消しはできません。必要なデータは事前に持ち出してください。`
			: `お申し込みから ${graceDays} 日間は「復元」ボタンで取り消せます。${graceDays} 日を過ぎるとすべてのデータが完全に削除され、復旧できません。`,
	accountDeleteChildDesc: 'アカウントを削除すると、あなたのログイン情報が削除されます。',
	accountDeleteChildDesc2:
		'活動記録やポイントは家族グループに残りますが、このアカウントでのログインはできなくなります。',
	accountDeleteChildWarning: '削除後の復旧はできません。',
	accountDeleteMemberDesc:
		'アカウントを削除すると、家族グループから離脱し、ログイン情報が削除されます。',
	accountDeleteMemberDesc2: '家族グループのデータは引き続き保持されます。',
	accountDeleteMemberWarning: '削除後の復旧はできません。',
	accountDeleteTransferTitle: '家族グループに他のメンバーがいます',
	accountDeleteTransferDesc:
		'オーナー権限を別のメンバーに移譲するか、家族グループを全て削除するか選択してください。',
	accountDeleteTransferOption: `オーナー権限を移譲して${CANCEL_TERMS.account}する`,
	accountDeleteFullOption: '家族グループを全て削除する',
	accountDeleteFullOptionDesc: '全メンバーの所属が解除され、全データが削除されます。',
	accountDeleteCancelAction: 'キャンセル',

	// ログアウト
	logoutSectionTitle: 'ログアウト',
	logoutDesc:
		'このデバイスからがんばりクエストのアカウントからログアウトします。再度ログインするにはメールアドレスとパスワードが必要です。',
	logoutAction: 'アカウントからログアウト',

	// #2319 Phase Settings-Audit: hub page (6 グループへのナビ集約)
	hubTitle: '設定',
	hubDesc: '下のカードから設定したい項目を選んでください。',
	groupAccountTitle: 'アカウント',
	groupAccountDesc: 'おやかぎコード変更・ログアウト・アカウント削除',
	groupActivitiesTitle: '活動・ポイント',
	groupActivitiesDesc: 'ステータス減少・ポイント表示・既定の子供・きょうだいチャレンジ',
	groupNotificationsTitle: '通知',
	groupNotificationsDesc: 'リマインダー・ストリーク警告・サイレント時間帯',
	groupDataTitle: 'データ',
	groupDataDesc: 'エクスポート・クラウド共有・データクリア',
	groupSupportTitle: 'サポート・アプリ情報',
	groupSupportDesc: 'お問い合わせ・フィードバック・利用規約・バージョン',
	// #3954: /admin/settings/rules への導線。実装済み (#3339 ごほうび交換の承認要否) に
	// 保護者が到達できず「どこから変更できますか」と問い合わせが来たため hub にカードを追加する。
	groupRulesTitle: RULES_TERMS.settingsMenu,
	groupRulesDesc: 'ごほうび交換の承認要否・ボーナスポイントの ON / OFF',
	groupPlanTitle: 'プラン・課金',
	groupPlanDesc: 'プラン変更・請求履歴 (別ページ)',
	backToHub: '← 設定トップへ',

	// Danger Zone (#2319 子#2 / #4 GitHub パターン)
	dangerZoneTitle: '危険な操作 (Danger Zone)',
	dangerZoneDesc: '以下の操作は元に戻せません。実行前に内容を必ず確認してください。',
	dangerStep1Label: '手順 1: 確認テキストを入力',
	dangerStep2Label: '手順 2: 同意チェック',
	dangerStep3Label: '手順 3: 実行ボタン',
	clearDangerConsentLabel: 'すべてのデータを削除することに同意します',
	// #4524: 同意チェックの文言は猶予 notice (accountDeleteGraceNotice) と **同じ事実**を述べる。
	//   旧実装はプランに依らない固定文で「元に戻せません」と断定しており、猶予のある有料プラン
	//   では直上の notice (「N 日間は復元で取り消せます」) と正面から矛盾していた。最も不可逆性の
	//   高い操作の直前で 2 文が食い違うと、警告全体が信用されなくなる。
	//
	//   graceDays が null (プラン未解決) のときに `?? 'free'` 相当へ倒さない: 猶予のある親に
	//   「元に戻せません」を見せるのは事実と異なる誤誘導になるため、断定しない中立文にする
	//   (accountDeleteGraceNotice / deletionGraceDays の扱いと同じ、#4517)。
	accountDeleteDangerConsentLabel: (graceDays: number | null) =>
		graceDays === null
			? 'このアカウントを削除することに同意します'
			: graceDays === 0
				? 'このアカウントを削除することに同意します（元に戻せません）'
				: `このアカウントを削除することに同意します（${graceDays} 日以内なら「復元」ボタンで取り消せます）`,
	// 削除前のデータ持ち出し (#740 API / #4472 導線)。プランに関係なく提供する
	accountDeleteExportTitle: `${CANCEL_TERMS.account}する前にデータを持ち出す`,
	accountDeleteExportAction: 'データをダウンロード',
	accountDeleteExportSubmitting: '準備しています…',
	accountDeleteExportScopeMinimal:
		'お子さまの名前と、記録した件数・期間のまとめを JSON ファイルで保存します。',
	accountDeleteExportScopeFull:
		'活動記録・スタンプ・ごほうびを含む全データを JSON ファイルで保存します。',
	accountDeleteExportScopeFamily: '全データときょうだいの比較データを JSON ファイルで保存します。',
	accountDeleteExportSuccess: (filename: string) => `${filename} を保存しました。`,
} as const;

/**
 * #2319 settings サブナビ用ラベル (AdminLayout 統合不要、settings 専用 +layout.svelte で参照)
 */
export const SETTINGS_NAV_LABELS = {
	ariaLabel: '設定サブナビゲーション',
	hub: '設定トップ',
	account: 'アカウント',
	activities: '活動・ポイント',
	notifications: '通知',
	data: 'データ',
	// #3954: hub カードと同じ経路をサブナビにも出す (どちらか片方だけだと、
	// hub 経由で来た人はサブナビのタブが 1 つも選択されていない状態になる)。
	// #4024: 当初は「サブナビは幅が限られる」として短縮形にしたが、**短縮しても 1280px で
	// サブナビは 2 行に折り返しており、短縮の目的を達成していなかった** (#3996 の SS が反証)。
	// 折り返しが避けられない以上、同じ画面に名前を 2 つ持つ対価に見合わないため長い名前に統一する。
	rules: RULES_TERMS.settingsMenu,
	support: 'サポート',
	plan: 'プラン・課金',
	externalIndicator: '別ページ',
	externalIndicatorHub: '別ページへ',
} as const;

// ============================================================
// SUBSCRIPTION_PAGE_LABELS — /admin/subscription プランページ (旧 LICENSE_PAGE_LABELS)
// ============================================================
//
// Phase 7 PR-2c (#2699): 旧 LICENSE_PAGE_LABELS を本 namespace に rename + Phase 3 #2567
// §文言 atom 確定済 9 key を統合 (105 key)。Phase 5 SSOT §4.1 整合。
// rename 後の正本として `SaasLicensePanel.svelte` 等 96 件から参照される。
// 旧 LICENSE_PAGE_LABELS は本ファイル末尾で alias export として残存 (共存期間)。

// #4619: 解約の説明で「記録は残ります」だけを述べると、**無料プランの保持期間を超えた記録が
// 物理削除される**事実が抜ける。特商法「解約とデータの取扱い」(LP_LEGAL_TOKUSHOHO_LABELS
// .tableContent) と同じ 2 文をここで 1 度だけ組み立て、解約を説明する文言が共有する。
//
// 数値の SSOT は `constants/plan-retention.ts` の PLAN_HISTORY_RETENTION_DAYS ただ 1 箇所。
// 本文言は PLAN_RETENTION_TERMS (terms.ts atom) 経由でしか参照せず、日数を直書きしない。
//
// 注: 同名・同内容の定数を PR #4596 (#4540 Q4、解約導線の告知) も導入する。先に merge された
//   側が正となり、後から rebase する側は同一宣言が 2 つになって TypeScript が即座に落ちる
//   (silent な二重定義にはならない)。その時点で片方を削り、参照をこの 1 本に寄せること。
const FREE_PLAN_RETENTION_NOTICE = `${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。`;

// #4156: 書き込みが許可されている契約状態 (猶予 / 停止 / 解約済み) の告知に必ず添える保証文。
// 3 つの告知が同じ事実を語るため、文言をここで 1 度だけ組み立てて共有する
// (`SUBSCRIPTION_PAGE_LABELS.writesContinueAssurance` として export もする)。
const WRITES_CONTINUE_ASSURANCE = `お子さまの記録はそのまま残り、${PLAN_FULL_TERMS.free}の範囲で記録・ポイント付与を続けられます。`;

// #4585-4: アーカイブされたものが「消えた」のか「戻せる」のかを述べる保証文。
// `restoreArchivedResources` は 3 reason (体験終了 / 顧客の選択 / 支払い失敗) すべてを復元する
// (#4585-3) ため、**どの経路でアーカイブされても再契約で戻る**。これを書かないと、実際には
// 戻せるのに諦める顧客が出る (PO 決裁 4 本目)。解約画面 (`CANCELLATION_LABELS`) と
// 契約終了の告知 (`SUBSCRIPTION_PAGE_LABELS.cancelledDesc`) で**同一の文**を共有する。
const ARCHIVE_RESTORE_ASSURANCE = `アーカイブしたデータは削除しません。再度${SIGNUP_TERMS.canonical}いただくと元に戻せます。`;

export const SUBSCRIPTION_PAGE_LABELS = {
	// Phase 3 #2567 §文言 atom 確定 9 key (PR-2b で先行配備、本 PR で統合)
	pageTitle: 'ご家族のプラン管理',
	currentPlan: '現在のプラン',
	// アップグレード CTA (Kinde 「what happens when clicked」原則、Phase 4 #2624 §2.1 整合)
	upgradeCta: `${PLAN_FULL_TERMS.premium}にする`,
	// CTA 直下「いつでも解約」併記 (frictionless、Kinde 整合)
	cancelAnytime: CANCEL_TERMS.anytimeOk,
	// trial CTA 直下「クレカ登録不要」(Phase 3 #2571 整合)
	noCreditCard: TRIAL_TERMS.noCreditCardMid,
	// 請求情報リンク (BILLING_LABELS と隣接)
	billingLink: 'ご請求情報を確認',
	// 解約リンク (frictionless 控えめ表示、Kinde 整合)
	cancelLink: `${CANCEL_TERMS.canonical}をご検討の方`,
	// V4 framing 軸 decoy bait (standard 推奨バッジ、Phase 1 補強 2 F9 解消)
	standardRecommendBadge: '✓ お勧め',

	// === 旧 LICENSE_PAGE_LABELS 統合 (96 key) ===
	// 現在のプラン
	currentPlanTitle: '現在のプラン',
	currentPlanLabel: 'プラン',
	currentPlanStatus: 'ステータス',
	currentPlanExpiry: '有効期限',
	currentPlanFamilyName: '家族名',
	currentPlanCreatedAt: '登録日',

	// 注: ライセンスキー適用 / 確認ダイアログ系 key (licenseKey* / currentPlanLicenseKey) は
	//     Epic #2525 Phase 7 PR-L4 (#2836) license key 全廃に伴い撤去済。entitlement は Stripe
	//     Subscription (tenant.status=ACTIVE) が唯一 SSOT で、キー入力 UI / 適用ダイアログは存在しない。

	// プランラベル
	// #1963: atom (PLAN_TERMS / PRICE_TERMS) を terms.ts から参照
	planLabelMonthly: `${PLAN_TERMS.standard}月額（${PRICE_TERMS.standard}/月）`,
	planLabelYearly: `${PLAN_TERMS.standard}年額（${PRICE_TERMS.standardYearly}/年）`,
	planLabelFamilyMonthly: `${PLAN_TERMS.premium}月額（${PRICE_TERMS.family}/月）`,
	planLabelFamilyYearly: `${PLAN_TERMS.premium}年額（${PRICE_TERMS.familyYearly}/年）`,
	planLabelLifetime: '永久ライセンス',
	planLabelFree: `${PLAN_FULL_TERMS.free}`,

	// ステータスラベル
	statusActive: '有効',
	statusGracePeriod: '猶予期間',
	statusSuspended: '停止中',
	/** S5 契約終了 (#4156)。S6 `terminated` (退会) を表す statusTerminated とは別状態 */
	statusCancelled: `${CANCEL_TERMS.canonical}済み`,
	// #4496: S6 は退会 (アカウント削除) 済みの状態。S5 (解約済み) と同じ「解約済み」を出すと
	//   2 状態が区別できず、CANCEL_TERMS.account ('退会') の使い分けにも反する。
	statusTerminated: `${CANCEL_TERMS.account}済み`,

	// 無料トライアル
	// #1963: atom (PLAN_FULL_TERMS / TRIAL_TERMS) を terms.ts から参照
	trialActiveTitle: `${PLAN_FULL_TERMS.premium} トライアル中`,
	trialActiveDays: (days: number | string) => `残り ${days}日`,
	// #4628: トライアル中にしか出ない文なので期限は必ず具体値。旧 `date ?? ''` は
	// null のとき日付の無い「 まで」を出す band-aid だった (#4622 の `?? 0` と同一 class)。
	trialActiveUntil: (date: string) => `${date} まで`,
	trialStartTitle: `${TRIAL_TERMS.duration} 無料でお試し`,
	trialStartDesc: `${PLAN_FULL_TERMS.premium}の全機能を体験できます`,
	trialStartButton: '無料トライアルを開始する',
	trialStartNote: 'クレジットカード不要 — 自動で課金されることはありません',
	trialUsed: '無料トライアルは使用済みです',

	// #3991: 期末解約 (cancel_at_period_end) の予約中バナー。
	// 「解約申請中か」「いつまで使えるか」は Stripe が SSOT のため、load で都度取得した値を表示する。
	cancelPendingTitle: `${CANCEL_TERMS.canonical}手続き中です`,
	cancelPendingDesc: (date: string) =>
		`${date} まで現在のプランをそのままご利用いただけます。この日を過ぎると${PLAN_FULL_TERMS.free}に切り替わります（お子さまの記録は残ります）。`,
	cancelPendingDescUnknownDate: `現在の請求期間の終了日まで現在のプランをそのままご利用いただけます。その後は${PLAN_FULL_TERMS.free}に切り替わります（お子さまの記録は残ります）。`,
	cancelPendingRevertAction: `${CANCEL_TERMS.canonical}を取り消して継続する`,
	cancelPendingRevertSubmitting: '取り消しています…',
	cancelPendingRevertError: `${CANCEL_TERMS.canonical}の取り消しに失敗しました。時間をおいて再度お試しください`,
	cancelPendingExpiryLabel: 'ご利用いただける最終日',

	// ステータス別メッセージ
	//
	// #4156: 文言は認可の実挙動 (`authorization.ts`) を SSOT とする (ADR-0013)。
	// #3993 の PO 判断により、支払い停止中も解約後も**無料プラン相当で書き込みは許可される**
	// (上限は free tier の plan limit が担う)。したがって「記録やポイントの付与はできません」
	// と書いてはならない。対応表と検証は `contract-state-view.ts` / 同名 test にある。
	/** 書き込みが許可されている契約状態の告知に必ず添える保証文 */
	writesContinueAssurance: WRITES_CONTINUE_ASSURANCE,
	gracePeriodTitle: '⚠️ 猶予期間中',
	gracePeriodDesc: `お支払いの確認が取れていません。猶予期間内にお支払いを完了してください。期間を過ぎると有料プランの機能が止まります。${WRITES_CONTINUE_ASSURANCE}`,
	/** S4 停止 (契約は残り復帰しうる) — 旧 suspendedTitle / suspendedDesc */
	paymentSuspendedTitle: '⏸️ 有料プランの機能を止めています',
	paymentSuspendedDesc: `お支払いを確認できないため、有料プランの機能を止めています。${WRITES_CONTINUE_ASSURANCE}お支払い方法を更新すると元に戻ります。`,
	/** S5 契約終了 (解約確定) */
	cancelledTitle: `✅ ${CANCEL_TERMS.canonical}が完了しました`,
	// #4585-4: S5 は**支払い失敗で契約が終わった顧客が着く唯一の画面**でもある。この経路は
	// 顧客本人が操作していないため解約画面 (#4585-1 の fallback 提示 + 選択 UI) を一度も通らず、
	// 上限超過分がアーカイブされること (#4585-3 で dunning にも適用) をここでしか知れない。
	// 「記録はそのまま残り」だけで止めると、超過分が見えなくなった顧客に対して事実と食い違う。
	cancelledDesc: `有料プランは終了しました。${WRITES_CONTINUE_ASSURANCE}${PLAN_FULL_TERMS.free}の上限を超える分はアーカイブします。${ARCHIVE_RESTORE_ASSURANCE}`,
	terminatedTitle: `❌ ${CANCEL_TERMS.account}のお手続きが完了しています`,
	terminatedDesc: `このアカウントはアカウント${CANCEL_TERMS.account}（アカウント削除）のお手続きが済んでいます。データはご利用プランに応じた猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）のあいだ保持され、その経過後にすべて削除されます。`,

	// 請求履歴 (#4156)
	//
	// 契約が終わっても**過去の取引**は残る。請求書・領収書は特商法の表示義務に接続するため、
	// 契約の有無ではなく `stripeCustomerId` の有無で到達可能にする。解約理由の送信を
	// 経由させて領収書に辿り着かせる導線 (統合直後の唯一の退路) は取らない。
	billingHistoryTitle: '請求履歴',
	billingHistoryDesc: `契約は終了していますが、これまでのお支払いの記録は残っています。Stripe の${STRIPE_PORTAL_TERMS.short}でご確認いただけます。`,
	billingHistoryFeatureInvoices: '過去の請求書・領収書の確認とダウンロード',
	billingHistoryFeatureReceipts: 'お支払い履歴の確認',
	billingHistoryButton: (loading: boolean) => (loading ? '読み込み中...' : '請求履歴を確認する'),
	billingHistoryNote: `Stripe の安全な${STRIPE_PORTAL_TERMS.short}に移動します`,
	billingHistoryPinNote: (usesPin: boolean) =>
		`⚠️ お支払い情報を開くには${usesPin ? '親 PIN' : '確認フレーズ'}の入力が必要です`,
	/** 請求履歴から開くときの確認ダイアログ (操作の目的がプラン変更ではないため文言を分ける) */
	portalConfirmTitleBillingHistory: '請求履歴を開く確認',
	portalConfirmDescBillingHistory: `Stripeの${STRIPE_PORTAL_TERMS.short}に移動します。過去の請求書・領収書をご確認いただけます。`,
	portalConfirmSubmitBillingHistory: `${STRIPE_PORTAL_TERMS.short}へ`,

	// プラン管理
	planManagementTitle: 'プラン管理',
	planManagementUnavailable: '決済機能は現在準備中です',
	// #4257 / #4166 AC5: 着地 (portal トップ = 支払い方法・請求履歴) と名前を一致させる。
	// 「プラン変更・支払い管理」はプラン変更画面へ直行するように読めるが、実際に開くのは
	// portal トップであり、名前と着地がずれていた。プラン変更の直行導線は
	// PlanStatusCard のアップグレード CTA が、解約は下の解約リンクが担う (入口は増やさない)。
	portalButton: (loading: boolean) =>
		loading ? '読み込み中...' : `${STRIPE_PORTAL_TERMS.short}を開く`,
	portalNote: `Stripeの${STRIPE_PORTAL_TERMS.short}でプラン変更・支払い方法の更新・解約ができます`,
	// #4270: portal の flow が Stripe に拒否されて home に倒れたときの案内。
	// 原因 (Dashboard 設定 / Stripe の拒否) は顧客に説明せず、次の操作だけを示す (ADR-0062)。
	portalFallbackCancel: `${CANCEL_TERMS.canonical}のお手続きは、この画面の「${STRIPE_PORTAL_TERMS.short}を開く」から続けてください。`,
	portalFallbackPlanChange: `${PLAN_CHANGE_TERMS.changeNoun}のお手続きは、${STRIPE_PORTAL_TERMS.short}から続けてください。`,
	// #4548: 上の 2 つは「時間をおけば直りうる」一時障害 (#4270) 用。ご契約情報が確認できない
	// 状態 (#4537) は**何度押しても同じ結果**になるため、同じ文言で再試行させると顧客は
	// 出口の無いループに入る (特商法上の解約導線の実効性)。できないことを正直に伝え、
	// こちらで手続きを承ると約束する。原因の内部詳細は出さない (ADR-0062)。
	portalFallbackCancelUnavailable: `ご契約情報を確認できないため、この画面から${CANCEL_TERMS.canonicalVerb}ことができません。お手数ですが、サポート窓口までご連絡ください。こちらで${CANCEL_TERMS.canonical}のお手続きを承ります。`,
	portalFallbackPlanChangeUnavailable: `ご契約情報を確認できないため、この画面から${PLAN_CHANGE_TERMS.changeNoun}のお手続きができません。お手数ですが、サポート窓口までご連絡ください。`,
	/** 恒久的に自力で完了できないときの唯一の出口 (設定 > サポートの単独 SSOT、#2904) */
	portalFallbackSupportLink: 'サポート窓口に連絡する',
	/** fallback 時に、作成済みの portal セッションへそのまま進むための導線 (PIN を再入力させない) */
	portalFallbackContinueButton: `${STRIPE_PORTAL_TERMS.short}へ進む`,
	portalPinNote: (usesPin: boolean) =>
		`⚠️ プラン変更には${usesPin ? '親 PIN' : '確認フレーズ'}の入力が必要です`,
	billingMonthly: '月額',
	// #3208: billingYearly は年額廃止 (#2719) で撤去 (LP-truth、checkout が yearly を reject)
	// #3204: checkout 失敗時のユーザ向けフィードバック (silent no-op 撲滅)
	checkoutFailed: '決済を開始できませんでした。時間をおいて再度お試しください',
	checkoutFailedToastTitle: '決済を開始できませんでした',
	// #4286: STRIPE_DISABLED (決済機能自体が無効な配備) と PRICE_UNRESOLVED (price ID 解決失敗という
	// 別種の設定不備) が同一文言 ('決済機能は現在利用できません') だったため、顧客が「設定不備」と
	// 「機能停止」を区別できず、再試行導線も無いまま離脱していた問題を是正。原因の内部詳細
	// (price ID 未解決等) は出さず、次に取るべき行動だけを示す (ADR-0062、内部例外の非露出)。
	checkoutErrorPriceUnresolved:
		'ただいま決済の準備ができていません。時間をおいて再度お試しください',
	// #4329 ②: checkout 失敗時に顧客が読む文言の SSOT (route 側の直書き禁止、DESIGN.md §6)。
	// 分類は「顧客が次に何をできるか」で分ける。**サーバー側の異常を顧客の入力ミスとして
	// 表示しない** — 原因の所在を偽ると、顧客は直しようのない操作を繰り返す (ADR-0062)。
	checkoutErrorStripeDisabled: '決済機能は現在利用できません',
	checkoutErrorAlreadySubscribed: '既にサブスクリプションに加入済みです',
	/** 配備・設定側の異常。顧客に取れる手は「時間をおく」だけなのでそれだけを示す */
	checkoutErrorServer: 'ただいまお申し込みを受け付けられません。時間をおいて再度お試しください',
	/** 受け取ったリクエストが現行の申込内容と噛み合わない (古い画面のまま操作した等) */
	checkoutErrorStaleRequest:
		'お申し込みを開始できませんでした。ページを再読み込みしてから、もう一度お試しください',
	/** #4329: portal session 自体を作れなかったとき。原因は出さず次の行動だけを示す (ADR-0062) */
	portalErrorCreateFailed: `${STRIPE_PORTAL_TERMS.short}を開けませんでした。時間をおいて再度お試しください`,
	checkoutErrorUnauthenticated: '認証が必要です',
	checkoutErrorForbidden: 'サブスクリプションの管理は保護者のみ可能です',
	// #4161: 決済が未設定の配備 (セルフホスト / 設定不備) でアップグレード操作を押したときの説明。
	// 確認ダイアログを開いてから失敗させる dead-end を作らず、押した時点で理由を提示する。
	billingUnavailable:
		'この環境では決済機能が有効になっていないため、プランの変更手続きに進めません',
	billingUnavailableToastTitle: 'プランの変更手続きに進めません',

	// スタンダードプラン
	// #1963: atom (PLAN_TERMS / PRICE_TERMS) を terms.ts から参照
	standardPlanName: `${PLAN_TERMS.standard}`,
	standardPlanDesc: `子供無制限・活動無制限・${PLAN_RETENTION_TERMS.standard}保持`,
	standardPriceMonthly: `${PRICE_TERMS.standard}`,
	standardPerMonth: '/月',
	// #3208: standardPriceYearly / standardPerYear / standardYearlyMonthlyEquiv は
	// 年額廃止 (#2719) で撤去 (LP-truth、pricing.html の年額 UI は #3212 で撤去済)

	// ファミリープラン
	// #1963: atom (PLAN_TERMS / PRICE_TERMS) を terms.ts から参照
	familyPlanName: `${PLAN_TERMS.premium}`,
	familyPlanDesc: '家族みんなで見守る+永久保持',
	familyPriceMonthly: `${PRICE_TERMS.family}`,
	// #3208: familyPriceYearly / familyYearlyMonthlyEquiv は年額廃止 (#2719) で撤去 (LP-truth)
	familyRecommendBadge: 'おすすめ',

	// 購入ボタン
	// #1963: tier 分岐内 atom (PLAN_TERMS) を terms.ts から参照
	checkoutButton: (tier: string, loading: boolean) =>
		loading
			? '処理中...'
			: `${tier === 'family' ? PLAN_TERMS.premium : PLAN_TERMS.standard}プランで始める`,
	checkoutNote: `いつでも${CANCEL_TERMS.canonical}・プラン変更可能`,

	// 支払い履歴
	paymentHistoryTitle: '支払い履歴',
	paymentHistoryPortalNote: `支払い履歴はStripeの${STRIPE_PORTAL_TERMS.short}でご確認いただけます`,
	paymentHistoryPortalButton: '支払い履歴を確認',
	paymentHistoryEmpty: '支払い履歴はまだありません',
	paymentHistoryBillingLink: '🧾 請求書・支払い方法の管理',

	// Portal 確認ダイアログ
	portalConfirmTitle: 'プラン変更の確認',
	portalConfirmDesc: `Stripeの${STRIPE_PORTAL_TERMS.short}に移動します。この画面からプラン変更・解約・ダウングレードが可能です。`,
	portalConfirmWarning: '⚠️ 誤操作による解約・ダウングレードを防ぐため、',
	portalConfirmWarningPin: 'を入力してください。',
	portalConfirmWarningPhrase: '確認フレーズ',
	portalConfirmCancel: 'キャンセル',
	portalConfirmLoading: '確認中…',
	portalConfirmSubmit: 'プラン変更画面へ',

	// ダウングレードエラー
	downgradeInfoError: 'ダウングレード情報の取得に失敗しました',
	downgradeArchiveError: 'リソースのアーカイブに失敗しました',
	portalFetchError: 'プラン変更の確認に失敗しました',
	portalConfirmPhraseError: (phrase: string) => `「${phrase}」と入力してください`,
	portalConfirmPhraseLabel: (phrase: string) => `確認のため「${phrase}」と入力してください`,

	// Churn prevention
	churnLostItemMonthly: (months: number | string) => `月替わり限定アイテム ${months}個`,
	churnLostItemTickets: (count: number | string) => `思い出チケット ${count}枚`,
	// #4502 (GAMMA-K2-09): 語彙は #1912 で「毎日のごほうび」に統一済み。解約画面にだけ
	// 旧語彙が残っていた
	churnLostItemBonus: (multiplier: number | string) => `毎日のごほうび ×${multiplier}倍`,
	churnLostItemTitle: (title: string) => `「${title}」称号`,
	// #4482: 整形は formatRetentionPeriod が SSOT（365 の倍数なら「1年以前」と述べる）。
	// #4496: 「アクセス」だけだと閲覧できなくなるだけに読めるが、実装 (retention-cleanup-service) は
	//   物理削除であり再契約でも戻らない。失うものの一覧なので、その事実をそのまま述べる。
	churnLostRetentionDays: (days: number | null) =>
		`${formatRetentionPeriod(days)}以前の記録（削除され、復元できません）`,

	// デモ版固有ラベル
	demoNotice: 'これはデモ画面です',
	demoNoticeOperationsDisabled: '実際の操作はできません',
	demoNoticeToast: (notice: string) => `${notice} - 実際の操作はできません`,
	demoNoticeToastText: 'デモでは実際の操作はできません',
	demoCurrentPlanTitle: '現在のプラン（デモ）',
	demoPlanUsageTitle: 'プラン利用状況',
	demoPlanUsageActivity: 'カスタム活動',
	demoPlanUsageChildren: 'こども',
	demoPlanUsageRetention: 'データ保持',
	demoPlanUsageRetentionValue: (days: number | null) => (days === null ? '無制限' : `${days}日間`),
	demoPlanUsageMaxValue: (max: number | null) => (max === null ? '無制限' : String(max)),
	demoTrialNote: 'デモではトライアルは開始できません',
	// 注: demoLicenseKey* / demoApplySuccess* / demoNoticeDesc 等のライセンスキー適用デモ UI 文言は
	//     Epic #2525 Phase 7 PR-L4 (#2836) license key 全廃に伴い撤去済 (キー適用 UI 不存在)。
	// #1963: tier 分岐内 atom (PLAN_TERMS) を terms.ts から参照
	demoCheckoutButton: (tier: string) =>
		`${tier === 'family' ? PLAN_TERMS.premium : PLAN_TERMS.standard}プランで始める`,
	demoCheckoutNote: 'デモでは実際の決済は行われません',
	demoPlanManagementTitle: 'プラン管理',
	demoPaymentHistoryTitle: '支払い履歴',
} as const;

// ============================================================
// CHECKOUT_RECONCILIATION_LABELS — checkout 完了照合の結果表示 (#3958)
// ============================================================
//
// Stripe checkout の success_url (`/admin/subscription?session_id=cs_…`) から戻ったときに、
// サーバー側で照合した結果を顧客に伝える文言。webhook 未達時の救済経路であることは
// 顧客の関心事ではないため、内部事情 (webhook / session_id / Stripe API) を露出させない。

export const CHECKOUT_RECONCILIATION_LABELS = {
	/** 反映できた (webhook 未達の救済が成立したケースを含む) */
	applied: 'お支払いを確認しました。プランを反映しました。',
	/** 既に反映済み (webhook 先着 / 同じ URL の再訪) */
	alreadyApplied: 'お支払いは反映済みです。',
	/** Stripe 側でまだ支払いが確定していない */
	pending: 'お支払いの確認をしています。少し時間をおいて「最新の状態を確認」を押してください。',
	/** 照合できなかった (期限切れ / 不正な値 / 一時的な障害)。現在のプラン表示にフォールバック */
	unresolved:
		'お支払い状況を確認できませんでした。反映されない場合はサポートまでお問い合わせください。',
	/** 再確認ボタン */
	recheckButton: '最新の状態を確認',
	/** 再確認中 (進行中である旨の可視化、NN/G #1) */
	rechecking: '確認しています…',
} as const;

// ============================================================
// LICENSE_PAGE_LABELS — 旧名称 alias (共存期間、Phase 7 PR-2c #2699 で rename)
// ============================================================
//
// 旧 `LICENSE_PAGE_LABELS` (96 key) は本 PR で `SUBSCRIPTION_PAGE_LABELS` に rename + 統合済 (上記)。
// 既存参照を段階的に置換する共存期間中、本 alias export で後方互換性を維持する。
// Phase 7 後続 PR (PR-2d 以降) で全参照が `SUBSCRIPTION_PAGE_LABELS` に移行完了後、本 alias を削除する。
//
// 設計意図:
//   - Phase 5 SSOT §4.1: `LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS` 統合 (105 key、新規 9 key + 旧 96 key)
//   - `/admin/license` → `/admin/subscription` URL rename (Phase 4 #2620 LEGACY_URL_MAP) と compound 命名整合
//   - V4 framing 軸 decoy (standard 「✓ お勧め」+ premium 最右配置) で 1 人っ子家庭の除外感回避
//     (Phase 1 補強 2 F9 / Phase 3 #2567 §FR-4)
//
// 関連 ADR:
//   - ADR-0058 (family → premium rename): Phase 7 PR-2e 以降で `PLAN_TERMS.premium` を `.premium` に rename
//   - ADR-0045 (terms.ts 2 階層): atom 直書き禁止、`${PLAN_FULL_TERMS.*}` template literal 経由
//   - ADR-0013 (LP truth): 実装事実と LP の整合、月額のみ (Phase 1 補強 2 FR-2)

export const LICENSE_PAGE_LABELS = SUBSCRIPTION_PAGE_LABELS;

// ============================================================
// NUC_LICENSE_LABELS — NUC セルフホスト版 license panel (EPIC #2327 / #2329)
// ============================================================
//
// NucLicensePanel.svelte 専用 compound。Edition badge + 利用状況 + サポート link の
// 3 セクション表示用ラベル SSOT。NUC_EDITION_TERMS atom (terms.ts) と組み合わせて
// 「セルフホスト版」「全機能利用可能」「無制限」を伝播させる (ADR-0045 準拠)。
//
// Mattermost Team Edition / Bitwarden self-hosted / GitLab CE 業界整合。
// LICENSE_PAGE_LABELS とは独立 SSOT (NUC は冗長セクション削除のため別名 namespace)。

export const NUC_LICENSE_LABELS = {
	// Edition badge セクション (Mattermost "Team Edition" 整合)
	editionTitle: `${NUC_EDITION_TERMS.editionEmoji} ${NUC_EDITION_TERMS.selfHosted}`,
	editionDesc: `ご家族の NUC でセルフホストされている、${NUC_EDITION_TERMS.fullAccess}版です。インターネット接続なしでもすべての機能をご利用いただけます。`,

	// 利用状況セクション
	usageTitle: 'ご家族の利用状況',
	usageChildrenLabel: 'こども',
	usageChildrenUnit: (count: number) => `${count} 人`,
	usageActivitiesLabel: 'カスタム活動',
	usageActivitiesValue: (count: number) => `${count} 件 (${NUC_EDITION_TERMS.unlimited})`,
	usageRetentionLabel: 'データ保持',
	usageRetentionValue: NUC_EDITION_TERMS.unlimited,

	// サポート link セクション
	supportTitle: 'サポート',
	supportDesc: 'お困りの際は以下をご活用ください。',
	contactLabel: 'お問い合わせ',
	docsLabel: 'ドキュメント',
} as const;

export const REPORTS_LABELS = {
	// #4512: カテゴリ名は categories.ts (SSOT) から引く。ここに持つのは
	//   「SSOT に無い id が来たとき」の表示だけ (旧実装は 5 カテゴリを漢字で並行実装していた)
	categoryUnknown: 'その他',
	// ページヘッダー
	pageTitle: '📊 レポート',
	certificatesLink: '📜 証明書',
	growthBookLink: '📖 記録ブック',

	// 設定更新完了
	settingsUpdated: '設定を更新しました',

	// アップセルバナー
	weeklyEmailUpsellTitle: '✉️ 週次メールレポートはスタンダードプラン以上の特典です',
	weeklyEmailUpsellDesc:
		'毎週設定した曜日に、お子さまのがんばりをまとめたレポートがメールで届きます。週次レポートタブでプレビューはいつでもご覧いただけます。',
	weeklyEmailUpsellLink: 'プランを見る →',

	// タブ
	tabMonthly: '月次レポート',
	tabWeekly: '週次レポート',

	// 月次レポート
	monthlyEmpty: (monthLabel: string) => `${monthLabel}のレポートがありません`,
	monthlyEmptyNote: '活動を記録すると、月次レポートが生成されます',
	monthlyChildReport: (childName: string) => `${childName}の がんばりレポート`,
	monthlyActivityLabel: '活動',
	monthlyActivityUnit: '回',
	monthlyPointsLabel: 'ポイント',
	monthlyPointsUnit: 'pt',
	monthlyLevelLabel: 'レベル',
	monthlyStreakLabel: '連続',
	monthlyStreakUnit: '日',
	monthlyAchievementsLabel: '実績',
	monthlyAchievementsUnit: '獲得',
	monthlyActiveDaysLabel: '活動日数',
	monthlyActiveDaysOf: (total: number | string) => `/ ${total}日`,
	monthlyAvgLabel: '1日平均',
	monthlyAvgUnit: '回',
	monthlyPrevMonth: '先月比',
	monthlyCategoryTitle: '📈 カテゴリ別の様子',
	monthlyCategoryCount: (count: number | string) => `${count}回`,

	// 週次レポート - 設定セクション
	weeklySettingsTitle: '⚙️ レポート設定',
	weeklySettingsUpgradeNote: 'スタンダードプラン以上でメール配信設定を変更できます',
	weeklySettingsEnableLabel: '週次レポートを有効にする',
	weeklySettingsDayLabel: '配信曜日',
	weeklySettingsSave: '保存',

	// 週次レポート - 空状態
	weeklyEmpty: 'レポートがありません',
	weeklyEmptyNote: `${CHILD_TERMS.honorific}を登録すると、毎週レポートが生成されます`,

	// 週次レポート - カード
	weeklyChildReport: (childName: string) => `${childName}の 週間レポート`,
	weeklyActivityLabel: '活動',
	weeklyActivityUnit: '回',
	weeklyPointsLabel: 'ポイント',
	weeklyPointsUnit: 'pt',
	weeklyAchievementsLabel: '実績',
	weeklyAchievementsUnit: '獲得',
	weeklyHighlightsTitle: '🏆 今週のハイライト',
	weeklyCategoryTitle: '📈 カテゴリ別の様子',
	weeklyAchievementsTitle: '🎖️ 獲得した実績',
	weeklyAdviceTitle: '💡 アドバイス',
	weeklyCategoryCount: (count: number | string) => `${count}回`,

	// きょうだいランキング
	rankingTitle: '👫 きょうだいランキング',
	rankingWeekSummaryTitle: '📊 今週のまとめ',
	rankingMostActive: (childName: string, count: number | string) =>
		`🏆 もっとも活発: ${childName}（${count}回）`,
	rankingWeekTrendTitle: '📈 週別 活動数のうつりかわり',
	rankingWeekCategoryTitle: '📊 今週のカテゴリ別くらべっこ',
	rankingMonthCategoryTitle: '📊 今月のカテゴリ別くらべっこ',
	rankingMonthMostActive: (childName: string, count: number | string) =>
		`🏆 今月もっとも活発: ${childName}（${count}回）`,
} as const;

export const OPS_LABELS = {
	// #4118 手 3: 契約状態監査 (contract-state-matrix.md §7 の 3 手目)。
	// 手 2 (webhook 適用後の行が S1-S6 に収まる) は「これから入る変更」を止めるが、
	// **すでに本番に存在する不正行**は検出しない。本セクションはその在庫を出す。
	contractStateTitle: '契約状態の監査',
	contractStateDesc:
		'契約 4 列 (状態 / プラン / 契約 ID / 期限) の組み合わせを分類し、表に無い状態の行を出します。',
	contractStateHealthy: (total: number) => `${total} 件すべて正常な状態です`,
	contractStateFound: (n: number) => `要確認 ${n} 件`,
	contractStateTruncated: (n: number) => `他 ${n} 件は表示を省略しています (集計には含みます)`,
	contractStateColTenant: 'テナント',
	contractStateColClassification: '分類',
	contractStateColStatus: '状態',
	contractStateColColumns: 'プラン / 契約 ID / 期限',
	contractStateHas: 'あり',
	contractStateNone: 'なし',

	// #4269 ①: 継続月キーの滞留在庫。prefix 無しの旧値が残っていると継続月数の加算が
	// 「基準不明」として skip され続けるため、その件数を同じ在庫に 1 行出す。
	// **0 件でも出す** (行が消えると「見ていない」と区別がつかない)。
	loyaltyMonthKeyLabel: '基準不明の継続月キー',
	loyaltyMonthKeyCount: (legacy: number, total: number) => `${legacy} 件 / 保存済み ${total} 件`,
	loyaltyMonthKeyDesc:
		'値の基準が判別できない古い保存値です。残っている間、その家族の継続月数の加算は安全側に見送られます。',

	// ページタイトル
	pageTitle: 'OPS - KPI サマリー',

	// フェッチ時刻
	fetchedAt: (dateStr: string) => `${dateStr} 時点`,

	// KPI カード
	kpiLabelTotal: '総テナント数',
	kpiLabelActive: 'アクティブ',
	kpiLabelGracePeriod: '猶予期間',
	kpiLabelSuspended: '停止中',
	kpiLabelTerminated: `${CANCEL_TERMS.account}済み`,
	kpiNewThisMonth: (n: number | string) => `+${n} 今月`,

	// プラン別内訳
	planBreakdownTitle: 'プラン別内訳（アクティブテナント）',
	planColPlan: 'プラン',
	planColTenants: 'テナント数',
	planColMrr: 'MRR 概算',
	planMonthly: `月額 (${PRICE_TERMS.standard}/月)`,
	planYearly: `年額 (${PRICE_TERMS.standardYearly}/年)`,
	// #4505: プレミアム (legacy family monthly/yearly 含む) は集計済みでも描画行が無く
	// テナントが不可視だった。他行と同じ表記形式 + terms.ts 単価 atom 参照で追加する。
	planPremiumMonthly: `${PLAN_TERMS.premium}月額 (${PRICE_TERMS.family}/月)`,
	planPremiumYearly: `${PLAN_TERMS.premium}年額 (${PRICE_TERMS.familyYearly}/年)`,
	planLifetime: 'ライフタイム',
	planNone: '未設定（トライアル等）',
	planTotalMrr: '合計 MRR',

	// 価格見直しトリガー
	triggerTitle: '価格見直しトリガー',
	triggerFired: (n: number | string) => `${n}件発動中`,
	triggerSkipped: 'スキップ',
	triggerNormal: '正常',
	triggerFiredBadge: '発動',
	triggerCurrentValue: (val: string, threshold: string, months: string, required: string) =>
		`現在値: ${val}% / 閾値: ${threshold}% (${months}/${required}ヶ月)`,
	triggerRecommendation: (rec: string) => `推奨: ${rec}`,
	triggerEvaluatedAt: (dateStr: string, paidUsers: string) =>
		`評価日時: ${dateStr} | 有料ユーザー: ${paidUsers}人`,

	// admin bypass メトリクス
	bypassTitle: 'admin bypass merge メトリクス',
	bypassEvidenceMissing: (n: number | string) => `${n}件 証跡欠落`,
	bypassNormal: '正常',
	bypassUnavailable: 'データ未取得',
	bypassUnavailableReason: (reason: string | null | undefined) =>
		`${reason ?? 'GitHub API に接続できませんでした'}（GITHUB_TOKEN 未設定時は非表示。ADR-0044 参照）`,
	bypassEmpty: (months: number | string) =>
		`直近 ${months} ヶ月の admin bypass merge は 0 件です。`,
	bypassColMonth: '月',
	bypassColTotal: 'merge 総数',
	bypassColBypass: 'admin bypass',
	bypassColMissing: '証跡欠落',
	bypassSummaryTotal: '合計',
	bypassFetchedAt: (dateStr: string) => `取得日時: ${dateStr} | 運用ルール:`,
	bypassAdrLink: 'ADR-0044 (archive)',

	// plan 逆引き不能の滞留 (#4128)
	planDriftTitle: 'プラン判定できていない契約',
	planDriftDesc:
		'Stripe の Price と env / lookup_key が食い違うと、課金額と使える機能がずれたまま滞留します。',
	planDriftHealthy: (n: number | string) => `${n} 件の契約すべてでプランを判定できています。`,
	planDriftFound: (n: number | string) => `${n}件 要対応`,
	planDriftDisabled: 'Stripe 連携が無効な環境のため検査していません。',
	planDriftError: (name: string) =>
		`Stripe への照会に失敗したため確認できませんでした（${name}）。詳細は CloudWatch ログを参照してください。`,
	planDriftTruncated: (n: number | string) =>
		`取得上限 ${n} 件に達しました。表示は一部の可能性があります。`,
	planDriftColTenant: 'テナント',
	planDriftColSubscription: 'サブスクリプション',
	planDriftColStatus: '状態',
	planDriftColPrice: 'Price / lookup_key',
	planDriftColCurrentPlan: '保持中のプラン',
	planDriftUnknownTenant: '（テナント未特定）',
	planDriftUnknownValue: '—',
	planDriftMultiItem: (n: number | string) => `item ${n} 件`,

	// システム状態
	systemTitle: 'システム状態',
	stripeLabel: 'Stripe 連携:',
	stripeEnabled: '有効',
	stripeDisabled: '無効（ローカルモード）',
} as const;

export const POINTS_LABELS = {
	// ページヘッダー
	pageTitle: '⭐ ポイント',
	displaySetting: (isCurrencyMode: boolean, currency: string) =>
		`表示: ${isCurrencyMode ? currency : 'ポイント（P）'}`,

	// 残高カード
	convertableLabel: (amount: string) => `変換可能: ${amount}`,

	// 変換フォーム
	convertFormTitle: (childName: string) => `${childName}のおこづかいにかえる`,
	currencyModeHint: '💡 変換した金額を実際にお子さまへお渡しください',

	// モードタブ
	tabPreset: 'かんたん',
	tabManual: '自由入力',
	tabReceipt: '領収書',

	// プリセットモード
	presetLabel: (unit: string, minAmount: string) => `変換${unit}数（${minAmount}単位）`,
	presetMinAmountNote: (minAmount: string, current: string) =>
		`${minAmount}以上で変換できます（現在 ${current}）`,

	// 手動モード
	manualLabel: (unit: string) => `変換${unit}数（自由入力）`,
	manualOverBalanceError: '残高を超えています',
	manualMinError: '1P以上を入力してください',
	manualHintCurrency: (current: string) => `残高: ${current}`,
	manualHintPoints: (current: string) => `1P = 1円 / 残高: ${current}`,
	manualPlaceholder: '金額を入力',
	manualMaxButton: '全額変換',

	// 領収書モード
	// #3694: OCR 画像は base64 JSON body で送るため、AWS 本番は Function URL 6MB request cap に
	// 整合した実効上限をサーバが返す (デコード後上限は runtime で下方整合される)。
	receiptImageTooLarge: (maxMb: string) => `画像サイズは${maxMb}MB以下にしてください`,
	receiptLabel: '領収書を撮影して金額を読み取り',
	receiptCaptureButtonTitle: '領収書を撮影 / 画像を選択',
	// #3775 ②: 表示上限 (MB) は実行環境で異なる (aws-prod ~4.1MB / NUC・local 5MB)。静的 5MB 表記は
	// aws-prod の実効 reject 閾値と乖離し「5MB と書いてあるのに 4.5MB が弾かれる」UX 齟齬を生むため、
	// server が実際に reject する実効値 (resolveMaxBase64DecodedBytes → toDisplayMb) を load で解決して渡す。
	receiptCaptureButtonNote: (maxMb: string) => `JPEG, PNG, WebP（${maxMb}MB以下）`,
	receiptPreviewAlt: '領収書プレビュー',
	receiptPreviewClose: 'プレビューを閉じる',
	receiptScanningText: '金額を読み取り中...',
	receiptRetakeButton: '再撮影する',
	receiptResultLabel: '読み取り結果',
	receiptAmountHint: '金額が違う場合は修正できます',
	receiptCurrencyUnit: '円',
	receiptOverBalance: (balance: string) => `残高（${balance}）を超えています`,
	receiptConfirmButton: 'この金額で変換する',
	receiptConfirmedLabel: '金額確定済み',
	receiptRetakeOtherButton: '別の領収書を撮影する',
	// #4366: AI 側の事情 (未設定 / 権限なし) と画像が読めなかったことを言い分ける。前者で撮り直しを
	// 促すと顧客は自分の写真が悪いと誤解する。どちらも次アクション (手入力) を必ず示す (ADR-0062)。
	//
	// オーナー決裁 2026-08-07 (PO 提示の文言は「例示」であり、そのまま採用しない): 出すのは
	// (1) 顧客のせいではないこと (2) 運営が把握していること (3) いま何ができるか の 3 点。
	// (1) を先頭に置くのは、#4366 の実害が「自分の写真が悪い」と誤解して撮り直すことだから。
	//
	// (2) は事実として書ける — 観測経路 (`[ai-alert] ai-provider-unavailable` log → alarm
	// `ganbari-quest-ai-provider-unavailable`) が `ALARM_NOTIFY_POLICY` で `notify: true` =
	// Discord の障害通知に届く (同決裁「アラートは Discord の障害通知へ webhook で飛ばす」)。
	//
	// 復旧を待たせる一文は置かない。手入力で今すぐ進めるので、待機を要求する理由がない。
	// 文言と通知方針の整合は `tests/unit/domain/receipt-ai-unavailable-message.test.ts` が固定する。
	//
	// **配備で 2 本に分ける。** (2) が成り立つのは運営が運用しているクラウド配備だけで、
	// alarm は AWS の `OpsStack` にしか無い。自宅 NUC のセルフホスト家庭に「運営が検知済み」と
	// 出すのは事実として嘘であり、しかも本当に直せるのは目の前の親自身なのに「誰かが対応中」と
	// 告げて設定を直す動機を奪う。`not-configured` (env が配られていない) は、まさにその家庭が
	// 最も踏みやすい経路。選択は `src/lib/server/ai/unavailable-message.ts` が実行モードから行う。
	receiptAiUnavailableManaged:
		'写真ではなくシステム側の不具合で、運営が検知済みです。金額を手入力してください。',
	// セルフホスト (NUC / ローカル) 版。実体は設定・資格情報の欠落なので「システム障害」とは
	// 書かない (過剰な障害宣言は親の不安と問い合わせを不必要に増やす)。直せる場所
	// (サーバーの AI 設定) を示しつつ、いま手入力で完了できることを併記する。
	receiptAiUnavailableSelfHosted:
		'写真ではなくサーバーのAI設定が原因です。設定を直すか金額を手入力してください。',
	receiptOcrFailed: '画像から金額を読み取れませんでした。撮り直すか、金額を手入力してください。',
	receiptAmountNotFound: '金額を読み取れませんでした',

	// 変換プレビュー
	convertPreviewBalance: (current: string, after: string) => `残高: ${current} → ${after}`,
	convertPreviewMonthTotal: (current: string, after: string) =>
		`／今月の合計: ${current} → ${after}`,
	convertPreviewYenUnit: '円',
	convertPreviewSuffix: '分のおこづかい',
	convertSubmitLoading: '変換中...',
	convertSubmitCurrency: (amount: string) => `${amount} を渡す`,
	convertSubmitPoints: (amount: string) => `${amount} を変換する`,

	// 空状態
	noConvertable: (unit: string) => `変換可能な${unit}がありません`,

	// 変換結果
	resultBalance: (balance: string) => `残高: ${balance}`,

	// 変換履歴
	historyTitle: 'おこづかい変換りれき',
	historySummaryThisMonth: '今月の合計',
	historySummaryAllTime: '累計',
	historyFilterThisMonth: '今月',
	historyFilterLastMonth: '先月',
	historyFilterAll: '全期間',
	historyEmpty: 'この期間の変換履歴はありません',
} as const;

export const SIGNUP_LABELS = {
	// 確認コード入力ステップ
	confirmEmailSent: (email: string) => `${email} に確認コードを送信しました。`,
	confirmEmailNote: 'メールに記載された6桁のコードを入力してください。',
	confirmCodeExpiry: (minutes: number | string) => `確認コードは${minutes}分以内に入力してください`,
	confirmCodeLabel: '確認コード',
	confirmSubmitLoading: '確認中...',
	confirmSubmitButton: '確認する',
	resendSuccess: '確認コードを再送しました',
	resendLoading: '再送中...',
	resendCooldown: (seconds: number | string) => `コードを再送する（${seconds}秒後に再試行可能）`,
	resendButton: 'コードを再送する',

	// サインアップフォーム
	googleSignupLabel: 'Google で登録',
	dividerOr: 'または',
	emailLabel: 'メールアドレス',
	emailPlaceholder: 'example@email.com',
	passwordLabel: 'パスワード',
	passwordPlaceholder: '8文字以上（大小英字・数字を含む）',
	passwordHint: '8文字以上、大文字・小文字・数字を含む',
	passwordConfirmLabel: 'パスワード（確認）',
	passwordConfirmPlaceholder: 'パスワードを再入力',
	passwordMismatchError: 'パスワードが一致しません',
	passwordMatchHint: 'パスワードが一致しました',
	// 注: signup のライセンスキー入力欄 / ヘルプ / 同意 (licenseKey* / submitWithLicenseKey /
	//     licenseConfirm* / blockLicense*) は Epic #2525 Phase 7 PR-L1 (#2810) でキー入力経路を
	//     削除済 + PR-L4 (#2836) で残存 label を撤去。サインアップは無料 / トライアル経路のみ。
	termsAgreePrefix: '',
	termsAgreeLink: '利用規約',
	termsAgreeSuffix: 'に同意します',
	termsAgreeError: '利用規約への同意が必要です',
	privacyAgreePrefix: '',
	privacyAgreeLink: 'プライバシーポリシー',
	privacyAgreeSuffix: 'に同意します',
	privacyAgreeError: 'プライバシーポリシーへの同意が必要です',
	// #1638: 個人情報保護法 §28 — 外国にある第三者（米国 AWS バージニア北部リージョン）への提供同意
	// 個人開発配慮版（DPIA §5 の実態を transparent に明示）
	crossBorderNotice:
		'本サービスは AWS（米国バージニア北部）/ Stripe / Google の各データセンターを利用し、お預かりするデータをサービス提供のためだけに保存・処理します。',
	crossBorderNoNoUse: '広告利用・第三者への販売・機械学習への流用はありません。',
	crossBorderAgreePrefix:
		'上記を理解し、サービス提供に必要な範囲でのデータ保存・処理に同意します（',
	crossBorderAgreeLink: '詳細',
	crossBorderAgreeSuffix: '）',
	crossBorderAgreeError: 'サービス提供に必要なデータ保存・処理への同意が必要です',
	parentalConsentNote: '※ 本サービスは子供のデータを扱います。保護者として上記に同意してください。',
	submitLoading: '登録中...',
	submitWithTrial: `${TRIAL_TERMS.duration} 無料体験をはじめる`,
	submitFree: '無料ではじめる',
	// #4501: トライアルは常に premium tier (FR-2)。プラン名を差し込む形だと
	// 「standard のトライアル」と読めてしまい、実挙動 (全機能開放) と食い違う。
	trialPlanNote: `セットアップ後に${PLAN_FULL_TERMS.premium}のトライアルが開始され、${TRIAL_TERMS.duration}すべての有料機能をお試しいただけます`,
	loginLink: '既にアカウントをお持ちの方はこちら',
	legalNote: '有料プランをご利用の前に',
	legalTokushoho: '特定商取引法に基づく表記',
	legalSlaAnd: 'および',
	legalSla: 'SLA',
	legalNoteEnd: 'をご確認ください',

	// submitBlockReason (JS, shown in template)
	blockEmailRequired: 'メールアドレスを入力してください',
	blockPasswordRequired: 'パスワードを入力してください',
	blockPasswordConfirmRequired: 'パスワード（確認）を入力してください',
	blockPasswordMismatch: 'パスワードが一致しません',
	blockTermsRequired: '利用規約への同意が必要です',
	blockPrivacyRequired: 'プライバシーポリシーへの同意が必要です',
	blockCrossBorderRequired: '米国への個人データ移転への同意が必要です',
} as const;

// ANALYTICS_LABELS: 削除 (#2284 EPIC #2283)
// /admin/analytics 全面撤去 (PO 指摘 2026-05-19 4 構造問題: 内部用語 UI 露出 /
// SaaS マーケ専門用語 / on-demand 実行コスト / 運用者向け画面の親露出) を解消。
// 運用者向け機能は /ops/analytics に集約 (Activation Funnel は #2285 で移動済)。

export const BILLING_LABELS = {
	pageHeading: '請求書・支払い管理',

	// Subscription overview
	subscriptionOverviewTitle: 'サブスクリプション状況',
	statusLabel: 'ステータス',
	statusActive: '有効',
	statusGracePeriod: '猶予期間',
	statusSuspended: '停止中',
	statusTerminated: '解約済み',
	stripeConnectionLabel: 'Stripe 連携',
	stripeConnected: '✅ 連携済み',
	stripeNotConnected: '未連携',
	expiresLabel: '有効期限',

	// Billing portal section
	billingPortalTitle: '請求書・支払い方法',
	billingPortalDesc: `Stripe の${STRIPE_PORTAL_TERMS.short}で以下の操作ができます:`,
	featureInvoices: '過去の請求書の確認・ダウンロード',
	featurePaymentMethod: '支払い方法（クレジットカード）の変更',
	featurePlanSwitch: `${PLAN_FULL_TERMS.standard} / ${PLAN_FULL_TERMS.premium}の切り替え`,
	featureNextBilling: '次回請求日の確認',
	notReadyAlert: '決済機能は現在準備中です',
	openPortalError: `${STRIPE_PORTAL_TERMS.short}を開けませんでした`,
	openPortalLoading: '読み込み中...',
	openPortalButton: `${STRIPE_PORTAL_TERMS.short}を開く`,
	openPortalNote: `Stripe の安全な${STRIPE_PORTAL_TERMS.short}に移動します`,
	openPortalPinRequired: (label: string) => `⚠️ ${label}の入力が必要です`,
	openPortalPinRequiredPin: '親 PIN',
	openPortalPinRequiredPhrase: '確認フレーズ',
	noCustomerAlert: 'サブスクリプションが未開始のため、請求情報はまだありません。',
	noCustomerAlertSelectPlan: 'プランを選択',
	noCustomerAlertSuffix: 'すると利用可能になります。',
	noSubscriptionAlert: 'Stripe Customer Portal を利用するには、サブスクリプションが必要です。',

	// Nav link
	navLinkTitle: 'プラン管理',
	navLinkHint: 'プランの選択・変更・トライアル開始',

	// 解約フローへの導線 (#1596)
	cancelLinkTitle: '解約手続き',
	cancelLinkHint: '解約理由をお聞かせください（必須）',

	// Dialog
	dialogTitle: `${STRIPE_PORTAL_TERMS.short}を開く`,
	dialogDesc: `Stripeの${STRIPE_PORTAL_TERMS.short}に移動します。この画面から支払い方法の変更・プラン切り替えが可能です。`,
	dialogPinRequired: (label: string) => `⚠️ 誤操作を防ぐため、${label}を入力してください。`,
	dialogPinOrPhrase: '確認フレーズ',
	dialogConfirmPhraseLabel: (phrase: string) => `確認のため「${phrase}」と入力してください`,
	dialogCancelButton: 'キャンセル',
	dialogConfirmLoading: '確認中…',
	dialogConfirmButton: `${STRIPE_PORTAL_TERMS.short}へ`,
} as const;

// ============================================================
// ARCHIVED_RESOURCE_LABELS — 無料プランの上限で archive 中のリソースの告知 / 一覧 (#4708)
// ============================================================
//
// トライアル終了 / 解約 / 支払い失敗で無料プランに戻ったとき、上限を超えるお子さま / 活動 /
// チェックリストは archive (一時非表示) される。FAQ / pricing は「削除されず、管理画面で確認でき、
// 有料プランで元に戻る」と約束しているので、その 3 点を画面で成立させる文言。
//   - banner: admin 全画面の本文上部 (TrialBanner と同階層、flow、CTA 以外はタップ不可)
//   - listing: /admin/children の archive 一覧 (読み取り専用、復元操作は置かない)
// ADR-0012: 「失う / 消える」を使わず、事実 (非表示) + 復元可能性のみ。煽り CTA は置かない。
export const ARCHIVED_RESOURCE_LABELS = {
	// banner
	bannerTitle: (breakdown: string) => `${breakdown}が非表示になっています`,
	bannerDesc: `${PLAN_FULL_TERMS.free}の上限を超えた分を一時的に${PLAN_CHANGE_TERMS.archive}しています。データは削除されません。有料プランにすると自動で元に戻ります。`,
	/** 件数の内訳。0 件の資源は省略 (例: 活動のみなら「活動 5 件」) */
	breakdown: (c: { children: number; activities: number; checklists: number }) =>
		[
			c.children > 0 ? `${CHILD_TERMS.honorific} ${c.children}人` : null,
			c.activities > 0 ? `活動 ${c.activities}件` : null,
			c.checklists > 0 ? `チェックリスト ${c.checklists}件` : null,
		]
			.filter((x): x is string => x !== null)
			.join(' / '),
	bannerCta: ACTION_LABELS.viewPlans,
	bannerListLink: `非表示の${CHILD_TERMS.honorific}を見る`,
	// /admin/children の archive 一覧 (読み取り専用)
	childrenSectionTitle: `非表示になっている${CHILD_TERMS.honorific}`,
	/** 一覧見出し + 件数 (「非表示になっているお子さま（2）」) */
	childrenSectionTitleWithCount: (count: number) =>
		`非表示になっている${CHILD_TERMS.honorific}（${count}）`,
	childrenSectionDesc: `${PLAN_FULL_TERMS.free}の上限を超えたため一時的に非表示になっています。記録・編集はできませんが、データは残っています。有料プランにすると自動で表示に戻ります。`,
	childrenSectionReadOnlyTag: '非表示中',
	childrenSectionCta: ACTION_LABELS.viewPlans,
} as const;

// ============================================================
// PHASE4_REACTIVATION_FLOW_LABELS — reactivation banner 動線文言 (Phase 4 #2623 / Phase 7 PR-2b)
// ============================================================
//
// Phase 4 #2623 §文言 atom + Phase 5 子 5 #2656 §4.4 SSOT 配置確定。
// archived → reactivation 動線で全 admin 画面で banner 常時表示 (Phase 4 #2623 §2 原則 1)、
// `?from=reactivation-banner` / `?from=reactivation-listing` クエリ重畳で context-passing。
//
// 設計意図:
//   - Phase 3 #2575 archived listing UI と表裏 (アーカイブ → 復活 動線の SSOT 文言)
//   - 補強 PR #2684 (代替案 D) の影響なし: 本 compound は archived データの再 reactivation 文言で、
//     ダウン即時 / credit memo とは独立 (archived は 90 日 retention 経由の物理削除前救済動線)
//
// 関連 ADR:
//   - ADR-0049 (retention 90 日): free plan archived データの 90 日保持 → 物理削除前の救済動線
//   - ADR-0045 (terms.ts 2 階層): `${PLAN_CHANGE_TERMS.restore}` 経由参照
//   - ADR-0012 (Anti-engagement): 「失う / 消える / 使えなくなる」atom 含めず、「復活させる」事実説明

export const PHASE4_REACTIVATION_FLOW_LABELS = {
	// banner dismiss 関連 (session storage で次タブ open まで非表示、ADR-0012 連続演出回避)
	bannerDismissAriaLabel: 'バナーを閉じる',
	bannerDismissHint: '次回タブを開くまで表示されません',
	// subscription page 上部 context line (?from=reactivation-banner 時)
	contextFromBanner: (total: number) =>
		`${total}件のデータを${PLAN_CHANGE_TERMS.restore}させるために、プランをご検討ください`,
	// subscription page 上部 context line (?from=reactivation-listing 時、archived listing 経由)
	contextFromListing: (total: number) =>
		`${total}件のデータを${PLAN_CHANGE_TERMS.restore}させて、お子さまの記録を引き継ぎませんか`,
	// /confirm 画面 (Phase 3 #2573) 上部 context line
	confirmContext: (total: number) =>
		`お申し込み後、${total}件のアーカイブデータが自動的に${PLAN_CHANGE_TERMS.restore}します`,
	// reactivation 完了 toast (Phase 3 #2572 success polling 経路、Toast.svelte primitive 流用、3s 自動消失)
	toastReactivationSuccess: (total: number) =>
		`${total}件のデータを${PLAN_CHANGE_TERMS.restore}しました`,
} as const;

// ============================================================
// CANCELLATION_LABELS - 解約フロー (#1596 / ADR-0023 §3.8 / I3)
// 全プラン強制の解約理由ヒアリング (3 分類 + 自由記述)
// Anti-engagement 原則 (ADR-0012): 「離脱トリガー」にしない設計（煽り無し・引き止め無し）
// ============================================================

/** 解約理由カテゴリ ID (DB 保存値) */
export const CANCELLATION_CATEGORY = {
	GRADUATION: 'graduation', // 卒業: 子供が自律した
	CHURN: 'churn', // 離反: 不満があった
	PAUSE: 'pause', // 中断: 家庭事情等で一時停止
} as const;

export type CancellationCategory =
	(typeof CANCELLATION_CATEGORY)[keyof typeof CANCELLATION_CATEGORY];

export const CANCELLATION_CATEGORIES: ReadonlyArray<CancellationCategory> = [
	CANCELLATION_CATEGORY.GRADUATION,
	CANCELLATION_CATEGORY.CHURN,
	CANCELLATION_CATEGORY.PAUSE,
];

/** #4585-1: 「選ばずに進めた場合」の見出し。同一画面の複数箇所から参照するため 1 箇所に置く */
const ARCHIVE_FALLBACK_HEADING = '選ばずに進めた場合';

export const CANCELLATION_LABELS = {
	pageHeading: '解約手続き',
	pageDesc: '解約の前に、ぜひ理由をお聞かせください。今後の改善に活用させていただきます（必須）。',

	// Form fields
	reasonSectionTitle: '解約理由',
	reasonRequired: '必須',
	freeTextLabel: 'ご意見・ご要望（任意）',
	freeTextPlaceholder:
		'差し支えなければ、もう少し詳しく教えていただけると嬉しいです（最大 1000 文字）',
	freeTextMaxLength: 1000,
	freeTextHint: (current: number, max: number) => `${current} / ${max} 文字`,

	// 3 categories - radio button options
	categoryGraduationLabel: '卒業',
	categoryGraduationHint:
		'子供が自分で計画できるようになった・がんばりクエストを使う必要がなくなった',
	categoryChurnLabel: '離反',
	categoryChurnHint: '機能が合わない・期待と違った',
	categoryPauseLabel: '中断',
	categoryPauseHint: '家庭事情・引っ越し・一時的に離れる（再開予定あり）',

	// Plan-context messaging (free / standard / family 共通)
	// #1959: 無料プラン → PLAN_FULL_TERMS.free 参照化 (atom 直書き撤廃)
	// #4496: 旧 freePlanNotice は「解約後はアカウント自体を削除する必要があります」と、事実でない
	//   義務を提示して退会 (無料プランは猶予なし = 即時物理削除) へ誤誘導していた。
	//   旧 paidPlanNotice は「決済停止を行います」だけで、期末まで使えることと日割り返金が
	//   ないことを手続き前に示していなかった (#3991 期末解約モデルの不告知)。
	freePlanNotice: `${PLAN_FULL_TERMS.free}をご利用中のため、お支払いは発生しておらず${CANCEL_TERMS.canonical}のお手続きは必要ありません。データを消したい場合はアカウント${CANCEL_TERMS.account}（設定 > アカウント削除）が別途必要です。差し支えなければ、その前に理由をお聞かせください。`,
	// #4585-1 QM: 体験中の顧客は「請求は無い」が「無料プランの上限でもない」。freePlanNotice を
	// そのまま出すと、同じ画面で「無料プランをご利用中」と「無料プランに戻ると」が並び、
	// 前者が事実でないまま矛盾する (実測: 体験中アカウントの解約画面)。
	trialPlanNotice: `お支払いは発生していないため、請求を止めるお手続きは必要ありません。ただし、いまは有料プランと同じ上限でご利用いただいているため、${PLAN_FULL_TERMS.free}に戻ると上限を超える分の扱いが決まります。データを消したい場合はアカウント${CANCEL_TERMS.account}（設定 > アカウント削除）が別途必要です。`,
	paidPlanNotice: `${CANCEL_TERMS.canonical}のお手続きを進めても、現在の請求期間の終了日までは有料プランをそのままご利用いただけます（日割り計算による返金はありません）。期間の終了後は${PLAN_FULL_TERMS.free}へ切り替わり、お子さまの記録は残ります。次回以降の請求は発生しません。`,

	// Submit
	submitButton: '解約手続きへ進む',
	submitLoading: '送信中…',
	submitButtonNoStripe: '解約理由を送信する',
	cancelButton: '前のページに戻る',

	// Errors
	errorCategoryRequired: '解約理由を選択してください',
	errorFreeTextTooLong: 'ご意見は 1000 文字以内で入力してください',
	errorSubmitFailed: '送信に失敗しました。時間をおいて再度お試しください',

	// Success
	successHeading: 'ご回答ありがとうございました',
	// #4329: 旧 successDesc は無料プランの顧客にも「Stripe で解約手続きを完了してください」と
	// 表示していた (無料プランに Stripe 契約は無い)。回答の受領だけを述べ、以降の手続きの
	// 説明は「手続きが残っている場合」の枠 (portalUnavailable*) に寄せる。
	successDesc: 'いただいたご意見は、サービス改善に活用させていただきます。',
	successFreeProceed: 'アカウント削除はこちら',

	// #4329 ①: portal を作れなかったときの回復導線。
	// 旧実装は「Stripe ${STRIPE_PORTAL_TERMS.short}で解約を完了する」と名乗るボタンが
	// 自アプリのプラン画面へ戻すだけで、顧客は解約したつもりのまま課金が続いていた
	// (特商法の解約導線の実効性)。失敗した事実・残っている手続き・代替手段を出す。
	// 原因の内部詳細 (Stripe API エラー等) は顧客に出さない (ADR-0062)。
	portalUnavailableHeading: `${CANCEL_TERMS.canonical}のお手続きが残っています`,
	portalUnavailableDesc: `ご回答は受け付けましたが、${STRIPE_PORTAL_TERMS.canonical}を開けませんでした。${CANCEL_TERMS.canonical}はまだ完了していません。`,
	portalRetryButton: `${STRIPE_PORTAL_TERMS.short}を開いて${CANCEL_TERMS.canonicalVerb}`,
	portalRetryFailed: `${STRIPE_PORTAL_TERMS.short}を開けませんでした。時間をおいて再度お試しいただくか、下記のサポート窓口までご連絡ください`,
	portalSupportHint: `うまくいかない場合は、サポート窓口からご連絡ください。こちらで${CANCEL_TERMS.canonical}のお手続きを承ります。`,
	portalSupportLink: 'サポート窓口に連絡する',

	// #4585-1: 解約フローも「どの記録を残すか」の選択 UI に合流させる (PO 決裁 = 案 A)。
	// #4585-3: fallback 規則を子供だけ「直近の利用順」に変更 (PO 決裁 Q1 / Q3)。
	// 顧客に伝えるのは「お子さまは最近記録がある方を残す」ところまで。活動・チェックリストの
	// 並び順 (登録順) までは書かない — 復元でき、かつ選択 UI で顧客自身が選べるため。
	archiveFallbackHeading: ARCHIVE_FALLBACK_HEADING,
	archiveFallbackRule: (maxChildren: number, maxActivities: number, maxChecklists: number) =>
		`${PLAN_FULL_TERMS.free}に戻ると、${CHILD_TERMS.neutral}は${maxChildren}人・活動は${maxActivities}個・チェックリストは${CHILD_TERMS.neutral}1人あたり${maxChecklists}個までになります。残すものを選ばないまま手続きが完了した場合は、この数だけ残して超えた分をアーカイブします。${CHILD_TERMS.honorific}は、最近記録がある${CHILD_TERMS.honorific}から順に残します。`,
	// #4585-4: 契約終了の告知 (`SUBSCRIPTION_PAGE_LABELS.cancelledDesc`) と同一文を共有する。
	// 解約画面を通る顧客と通らない顧客 (支払い失敗) で「戻せるかどうか」の説明を分けない。
	archiveFallbackRestore: ARCHIVE_RESTORE_ASSURANCE,
	selectionButton: '残すデータを選ぶ',
	selectionLoading: '確認しています…',
	selectionUnavailable: `残すデータの選択画面を開けませんでした。このまま${CANCEL_TERMS.canonical}のお手続きを続けると、「${ARCHIVE_FALLBACK_HEADING}」の扱いになります。もう一度お試しになる場合は下のボタンから、このまま進める場合は送信ボタンを押してください。`,
	// #4585-1 QM: 選択ダイアログを閉じた顧客の出口。確定ボタンは超過分を選ぶまで押せないため、
	// 「どれも手放したくない」顧客の唯一の操作が「閉じる」になる。ここで手続きを再開できないと
	// 解約そのものが行き止まりになる (#4329 / #4548 / #4560 と同じ class)。
	selectionSkipped: `残すデータを選ばずに閉じました。このまま${CANCEL_TERMS.canonical}のお手続きを続けると、「${ARCHIVE_FALLBACK_HEADING}」の扱いになります。選び直すこともできます。`,
	// #4585-1 QM: 閉じた / 取得に失敗した顧客が選択に戻る唯一の導線。これが無いと、
	// 誤って閉じた 1 クリックで「自分で選ぶ」機会を恒久的に失う (子供の記録は取り返しが難しい)。
	selectionReopen: '残すデータを選び直す',
} as const satisfies Record<string, unknown>;

/** 表示用ラベル取得 */
export function getCancellationCategoryLabel(category: CancellationCategory): string {
	switch (category) {
		case CANCELLATION_CATEGORY.GRADUATION:
			return CANCELLATION_LABELS.categoryGraduationLabel;
		case CANCELLATION_CATEGORY.CHURN:
			return CANCELLATION_LABELS.categoryChurnLabel;
		case CANCELLATION_CATEGORY.PAUSE:
			return CANCELLATION_LABELS.categoryPauseLabel;
	}
}

// ============================================================
// GRADUATION_LABELS - 卒業フロー (#1603 / ADR-0023 §3.8 / §5 I10)
// 解約フローで「卒業」を選んだ親向けの専用ページ。
// Anti-engagement 原則 (ADR-0012): ポジティブだが煽らない。引き止め CTA 禁止。
//
// #1961 (Phase 7 H4) atom 直書き監査:
//   - 卒業フローは「卒業」「ご利用期間」「事例公開」「ニックネーム」等の独自用語のみで構成され、
//     プラン名 (PLAN_TERMS / PLAN_FULL_TERMS) / 価格 (PRICE_TERMS) / トライアル日数 (TRIAL_TERMS) /
//     解約期間 (CANCEL_TERMS) / 無料訴求 (FREE_TERMS) の atom には依存しない。
//   - yenAmount / days / current / max は全て引数注入で計算ロジック側の責務。
//   - 検証: 範囲内に '無料' / 'スタンダード' / 'ファミリー' / '7日間' / '7 日間' / '¥\d+' /
//     '無料プラン' / 'スタンダードプラン' / 'ファミリープラン' リテラル 0 件。
// ============================================================

export const GRADUATION_LABELS = {
	pageHeading: '卒業おめでとうございます',
	pageDesc:
		'お子さまの自律をともに見守れたこと、心より嬉しく思います。残ポイントの活用例と、もしよければ事例として共有していただけるかをお伺いします。',

	// 残ポイントセクション
	pointsSectionTitle: '残ポイント',
	pointsSectionHint: '卒業時点での合計ポイントです',
	pointsUnit: 'pt',
	pointsZero: 'ポイント残高はありません',

	// 還元提案セクション
	rewardSuggestionTitle: 'お子さまへのポイント還元アイデア',
	rewardSuggestionHint: `${CHILD_TERMS.honorific}ががんばって貯めたポイントを、ご家庭で意味のある形に変えていただくための参考例です。`,
	rewardCashLabel: '現金換算の目安',
	rewardCashDesc: (yenAmount: number) =>
		`100 pt = 100 円換算 (目安) で、約 ${yenAmount.toLocaleString('ja-JP')} 円相当`,
	rewardItemsLabel: '物品の例',
	rewardItemsDesc: 'お小遣い帳・図書カード・本人の欲しがっていたグッズ・文房具 など',
	rewardExperienceLabel: '体験の例',
	rewardExperienceDesc: '家族での外食・遊園地・映画・お子さま主役の小旅行 など',
	rewardNoteLabel: '注意',
	rewardNote:
		'金額換算はあくまで参考です。ご家庭の方針に合わせて、お子さまが「がんばってよかった」と感じられる形で還元してあげてください。',

	// 利用期間表示
	usagePeriodLabel: 'ご利用期間',
	usagePeriodDays: (days: number) => `${days} 日間 ご利用いただきました`,

	// 事例公開承諾セクション
	consentSectionTitle: '事例として共有していただけますか？（任意）',
	consentSectionHint:
		'公開させていただく場合は、お子さまの実名は使いません。下記のニックネームで掲載させていただきます。',
	consentCheckboxLabel: '卒業事例として、当サービスで紹介させていただいてもよい',
	nicknameLabel: '公開時のニックネーム',
	nicknameRequired: '必須',
	nicknamePlaceholder: '例: たろうくん家',
	nicknameHint: '実名禁止。お子さまや家族が特定されない範囲でご記入ください（最大 30 文字）',
	nicknameMaxLength: 30,
	messageLabel: '卒業のひとことメッセージ（任意・公開可）',
	messagePlaceholder:
		'もしよろしければ、卒業のお気持ちをひとことお寄せください（公開時に他のご家庭の参考になります、最大 500 文字）',
	messageMaxLength: 500,
	messageHint: (current: number, max: number) => `${current} / ${max} 文字`,

	// Submit
	submitButton: '卒業を完了する',
	submitConsentButton: '事例として共有して卒業を完了する',
	submitLoading: '送信中…',
	skipButton: '事例共有はせず卒業のみ完了する',

	// Errors
	errorNicknameRequired: '公開時のニックネームをご入力ください',
	errorNicknameTooLong: 'ニックネームは 30 文字以内でご入力ください',
	errorMessageTooLong: 'メッセージは 500 文字以内でご入力ください',
	errorSubmitFailed: '送信に失敗しました。時間をおいて再度お試しください',

	// Success (after consent recorded)
	successHeading: '卒業を見届けました',
	successDesc:
		'長い間ありがとうございました。お子さまのこれからの自律した日々が、ますます充実することを願っています。',
	successConsentThanks:
		'事例公開のご快諾ありがとうございました。サービス改善・他のご家庭への参考に活用させていただきます。',
	// #4498: 課金プランの卒業送信ボタン。押した先は Stripe の解約フローであり、
	// 「卒業を完了する」系の名乗りだと解約が終わったと誤認される。
	successProceedButton: '解約手続きへ進む',
	successProceedFreeButton: `${ADMIN_VIEW_TERMS.canonical}に戻る`,
} as const satisfies Record<string, unknown>;

/** ops dashboard 卒業統計セクション (#1603) */
export const OPS_GRADUATION_LABELS = {
	sectionTitle: '卒業フロー集計（#1603）',
	sectionHint: '直近 90 日の卒業者数 / 卒業率 / 平均利用期間 / 公開可能な事例',
	colMetric: '指標',
	colValue: '値',
	metricTotalGraduations: '卒業者数',
	metricConsentedCount: '事例公開承諾数',
	metricAvgUsagePeriod: '平均利用期間（日）',
	metricGraduationRate: '卒業率（卒業 / 全解約）',
	metricTotalCancellations: '直近 90 日の全解約数',
	noData: '直近 90 日の卒業データはありません',
	publicSamplesTitle: '公開可能な卒業事例',
	publicSampleEmpty: '公開承諾された卒業事例はまだありません',
	publicSampleNickname: (nickname: string) => `${nickname} さん`,
	publicSampleUsagePeriod: (days: number) => `ご利用期間: ${days} 日`,
	publicSamplePoints: (pt: number) => `残ポイント: ${pt} pt`,
	graduationRateLabel: (rate: number) => `${(rate * 100).toFixed(1)}%`,
} as const satisfies Record<string, unknown>;

/** ops dashboard 解約理由集計セクション */
export const OPS_CANCELLATION_LABELS = {
	sectionTitle: '解約理由集計（#1596）',
	sectionHint: '直近 90 日の解約理由カテゴリ別比率と件数',
	colCategory: 'カテゴリ',
	colCount: '件数',
	colPercentage: '比率',
	noData: '直近 90 日の解約理由データはありません',
	totalLabel: (n: number) => `合計: ${n} 件`,
	freeTextSearchLabel: '自由記述検索',
	freeTextSearchPlaceholder: 'キーワードで自由記述を絞り込み（最低限機能）',
	freeTextEmpty: '自由記述はまだありません',
	freeTextDate: (date: string) => `${date} 投稿`,
	freeTextCategory: (category: string) => `カテゴリ: ${category}`,
} as const satisfies Record<string, unknown>;

// 注: OPS_LICENSE_ISSUE_LABELS (旧 /ops/license/issue キャンペーンキー発行) は Epic #2525 Phase 7
//     PR-L4 (#2836) license key 全廃に伴い撤去済 (route は PR-L3 #2818 で物理削除)。割引配布は
//     Stripe Dashboard の Coupon / Promotion Code 運用に代替 (Phase 1 補強 3 #2788 §3.6 OQ-2)。

export const OPS_REVENUE_LABELS = {
	pageTitle: 'OPS - 収益',
	mockModeBadge: 'MOCK MODE: ダミーデータを表示中 (STRIPE_MOCK=true)',

	// Stripe KPI section
	stripeKpiTitle: 'Stripe 収益指標',
	kpiLabelPaidUsers: '有料ユーザー数',
	kpiLabelConversionRate: '転換率 (90日)',
	kpiLabelChurnRate: '月次解約率',

	// Trend chart
	trendTitle: '(過去6か月)',
	trendChartAriaLabel: 'MRR トレンドグラフ',
	kpiTrendTitle: 'KPI トレンド',
	tableColMonth: '月',
	tableColPaidCount: '有料数',
	tableColChurnRate: '解約率',

	// DB-based revenue section
	dbRevenueTitle: 'Stripe 請求書ベース収益',
	kpiLabelMrrDb: 'MRR (DB)',
	kpiLabelArrDb: 'ARR (DB)',
	kpiLabelPeriodRevenue: '期間売上合計',
	kpiLabelStripeFeeTotal: 'Stripe手数料合計',

	// Monthly breakdown
	monthlyBreakdownTitle: '月次推移',
	monthlyBreakdownSuffix: (months: number | string) => `(過去${months}か月)`,
	tableColRevenue: '売上',
	tableColCount: '件数',
	tableColFee: '手数料',
	tableColNetIncome: '純収入',

	// Invoices
	invoicesTitle: '請求書一覧',
	invoicesTitleSuffix: '直近',
	invoicesTitleSuffix2: '件',
	invoicesEmpty: '請求書データがありません (Stripe未設定 or 期間内に決済なし)',
	tableColPaidAt: '支払日',
	tableColCustomer: '顧客',
	tableColContent: '内容',
	tableColAmount: '金額',
	tableColFeeLabel: '手数料',

	// Footer
	fetchedAt: (dateStr: string) => `最終取得: ${dateStr}`,
	cacheNote: '(1時間キャッシュ)',
} as const;

export const OPS_BUSINESS_LABELS = {
	pageTitle: 'OPS - 事業採算性',
	mockModeBadge: 'MOCK MODE: ダミーデータを表示中 (STRIPE_MOCK=true)',

	// Breakeven progress card
	breakevenProgressTitle: '損益分岐点 進捗',
	breakevenUsersUnit: (current: number | string, target: number | string) =>
		`${current} / ${target} 名`,
	breakevenUsersUnitSuffix: '名',
	breakevenAchievedBadge: '黒字達成',
	breakevenRemainingUsers: (n: number | string) => `あと ${n} 名`,
	breakevenProgressLabel: '損益分岐点達成率',

	// KPI cards
	kpiLabelRevenue: '今月の収益',
	kpiLabelAwsCost: 'AWS 原価',
	kpiAwsCostUsdSuffix: (usd: string) => `(${usd} USD)`,
	kpiLabelStripeFee: 'Stripe 手数料',
	kpiStripeFeeNote: '(売上 x 3.6%)',
	kpiLabelFixedCosts: '固定費',
	kpiLabelMonthlyProfit: '月間利益',
	kpiProfitLoss: '赤字',

	// Warning card
	warningTitle: '月間利益がマイナスです',
	warningDesc: (n: number | string) => `損益分岐点達成まで有料ユーザー ${n} 名の追加が必要です。`,

	// Breakdown table
	breakdownTitle: '損益内訳',
	tableColItem: '項目',
	tableColAmount: '金額',
	tableRowRevenue: '売上 (Stripe)',
	tableRowAwsCost: '- AWS 原価',
	tableRowStripeFee: '- Stripe 手数料 (3.6%)',
	tableRowMonthlyProfit: '月間利益',

	// Scale tiers
	scaleTiersTitle: '規模帯比較',
	scaleTiersCurrentBadge: '現在',
	scaleTiersUsersRange: (min: number | string, max: string) => `${min}${max} 名`,
	scaleTiersMonthlyRevenue: (yen: string) => `¥${yen}/月`,
	scaleTiersMonthlyRevenueSuffix: '/月',

	// KPI summary
	kpiSummaryTitle: 'Stripe KPI',
	kpiLabelMrr: 'MRR',
	kpiLabelArr: 'ARR',
	kpiLabelArpu: 'ARPU',
	kpiLabelConversionRate: '転換率',
	kpiLabelChurnRate: '解約率',

	// Footer
	fetchedAt: (dateStr: string) => `最終取得: ${dateStr}`,
} as const;

/**
 * #4313: 年齢帯 UI が誕生日で切り替わったことを次回ログインで伝えるダイアログの文言。
 *
 * key は **切替後 (to)** の uiMode。文面は「成長した」枠組みで書き、機能が減ったと
 * 読ませない (Issue #4313 §感情演出 / ADR-0012 — 静かに 1 回だけ)。
 * 年齢別の語彙整合 (DESIGN.md §6): preschool はひらがなのみ、elementary は漢字最小限、
 * junior / senior は漢字を含む。
 *
 * `parentNote` / `settings*` は全モード共通で保護者宛て (敬体)。3 歳の baby → preschool は
 * 切替前の画面が親向け準備モード (ADR-0011) であり、読み手が保護者であるため、この
 * 保護者向け節が主たる説明になる。
 */
export const UI_MODE_CHANGE_LABELS = {
	dialogAriaLabel: '年齢区分の変更のお知らせ',
	emoji: '🎈',
	heading: {
		baby: 'がめんが かわったよ',
		preschool: 'おおきく なったね！',
		elementary: '大きくなったね！',
		junior: 'ひとつ大きくなりましたね',
		senior: 'ひとつ大きくなりましたね',
	} as Record<UiMode, string>,
	body: {
		baby: 'おたんじょうびが きたから、がめんが かわったよ。',
		preschool:
			'おたんじょうびが きたから、がめんが すこし かわったよ。ボタンや もじの おおきさが かわって いるよ。',
		elementary:
			'おたんじょう日がきたので、画面が小学生むけにかわりました。ボタンや文字の大きさがかわっています。',
		junior:
			'誕生日を迎えたので、画面が中学生向けに切り替わりました。ボタンや文字の大きさが変わっています。',
		senior:
			'誕生日を迎えたので、画面が高校生向けに切り替わりました。ボタンや文字の大きさが変わっています。',
	} as Record<UiMode, string>,
	closeLabel: {
		baby: 'わかった',
		preschool: 'わかった！',
		elementary: 'わかった！',
		junior: 'OK',
		senior: 'OK',
	} as Record<UiMode, string>,
	parentNote:
		'保護者の方へ: お子さまの年齢区分が変わったため、画面が自動で切り替わりました。生年月日の確認・修正はお子さま管理から行えます。',
	settingsLabel: 'お子さま管理をひらく',
} as const;

/**
 * #4261 ③: 月間の習慣化証明書で増えた残高の理由を、子に**次回起動で 1 回だけ**伝える文言。
 *
 * ADR-0012 との両立条件 (PO 決裁 2026-08-06) を文言側でも守る:
 * **煽らない / 次を促さない / 演出語を足さない。** 起きた事実だけを静かに置く。
 * baby は親向けの準備モードで子供向けホームを持たない (ADR-0011) ため対象外。
 */
export const HABIT_CERTIFICATE_NOTICE_LABELS: Record<
	Exclude<UiMode, 'baby'>,
	{ title: string; body: (amount: string) => string }
> = {
	preschool: {
		title: 'こんげつ よく つづいたね',
		body: (amount) => `${amount} を うけとったよ`,
	},
	elementary: {
		title: '今月は しゅうかんに できたね',
		body: (amount) => `つづけられたので ${amount} をうけとりました`,
	},
	junior: {
		title: '今月は習慣にできました',
		body: (amount) => `継続の記録として ${amount} を受け取りました`,
	},
	senior: {
		title: '今月は習慣にできました',
		body: (amount) => `継続の記録として ${amount} を受け取りました`,
	},
};

export const CHILD_HOME_LABELS = {
	// Baby mode: completed card aria-label
	completedAriaLabel: (name: string) => `${name}（きろくずみ）`,

	// Baby mode: inline form submit button states
	babyCardMainQuestBadge: '⚔️ 2ばい!',
	babyCardPendingText: 'まってね！',

	// Baby mode: aria-label for submit button
	babyCardRecordAriaLabel: (name: string) => `${name}をきろくする`,
	babyCardRecordMainQuestSuffix: '（メインクエスト×2）',
	babyCardRecordMissionSuffix: '（ミッション）',

	// Pin context menu
	pinActionUnpin: '📌 ピンどめをはずす',
	pinActionPin: '📌 ピンどめする',
	pinCloseButton: 'とじる',

	// Confirm dialog
	confirmTitle: (name: string) => `${name}を\nきろくする？`,
	confirmTitleBr: (name: string) => `${name}を`,
	confirmTitleBrLine2: 'きろくする？',
	confirmCancelButton: 'やめる',
	confirmSubmitLoading: 'まってね！',
	confirmSubmitButton: 'きろく！',

	// Record result overlay
	resultCancelledIcon: '↩️',
	resultCancelledTitle: 'とりけしました',
	resultCancelledClose: 'とじる',
	resultFirstRecord: '🌟 はじめての いっぽ！ 🌟',
	resultActivityRecorded: (name: string) => `${name}をきろくしたよ！`,
	resultStreakBonus: (days: number | string, bonus: number | string) =>
		`${days}にちれんぞく！ +${bonus}ボーナス`,
	resultMasteryBonus: (bonus: number | string, level: number | string) =>
		`📗 なれてきたボーナス +${bonus} (Lv.${level})`,
	resultMasteryLevelUp: (name: string, level: number | string) =>
		`🎖️ ${name}が Lv.${level} になった！`,
	resultComboCategoryCombo: (name: string, catName: string) => `${name}コンボ！（${catName}）`,
	/**
	 * #4686: コンボは tier 名を「状態」として出し、金額は今回の純増 (台帳増分) だけを出す。
	 * tier 満額を毎回出すと同日 2 回目以降に「ダイアログの合計 ≠ 残高の増分」になるため。
	 */
	resultComboCategoryState: (name: string, catName: string) =>
		`${name}コンボ たっせい中（${catName}）`,
	resultComboCrossState: (name: string) => `${name}！ たっせい中`,
	resultComboNewBonus: 'コンボボーナス',
	/** #4686: フォーカスモード おすすめ 3 件全完了ボーナス (台帳 type=focus_bonus) の結果ダイアログ表記 */
	resultFocusBonus: '🎯 きょうのクエスト コンプリート！',
	resultXpLabel: 'けいけんち',
	/**
	 * #4509 ⑤: きょうだいの名前が引けなかったときの汎用語。
	 * 内部 ID (`#<childId>`) を子供の画面に出さないためのフォールバック (DESIGN.md §6)。
	 */
	siblingUnknownName: 'きょうだい',
	/** #4509 ①: 経験値行のレベルアップ併記。増分の数値そのものは実データから導出する */
	resultXpLevelUp: (level: number | string) => ` → Lv.${level} ↑`,
	resultMissionComplete: '🎯 ミッションたっせい！',
	resultMissionAllClear: '🎉 ぜんぶクリア！',
	resultTodayCount: (n: number | string) => `きょう ${n}かいめ！`,
	resultCancelButton: (s: number | string) => `とりけし (${s}s)`,
	resultConfirmButton: 'やったね！',
	crossComboBang: '！',

	// #1757 (#1709-C) 「今日のおやくそく」N/M バー
	// preschool は mustTitleKana（ひらがな）、それ以外は mustTitle（漢字）を出し分け
	mustTitle: '今日のおやくそく',
	mustTitleKana: 'きょうのおやくそく',
	/** N/M 形式（labels 側で形成、コンポーネント側でテンプレ直書き禁止） */
	mustProgressText: (logged: number | string, total: number | string) => `${logged}/${total}`,
	/** 部分達成時の残数表示（preschool/それ以外で語彙差なし — 数 + 「こ」のみ） */
	mustRemaining: (n: number | string) => `あと ${n}こ`,
	mustAllComplete: 'ぜんぶできた！',
	mustAllCompleteEmoji: '✨',
	mustBonusGranted: (pts: number | string) => `+${pts}pt`,
	mustBonusGrantedAriaLabel: (pts: number | string) =>
		`今日のおやくそく ぜんぶできた ボーナス ${pts}ポイント`,
} as const;

// ============================================================
// admin/challenges ページ (#1452 Phase B)
// ============================================================

export const CHALLENGES_LABELS = {
	// #3239: チャレンジ一本化 (#3195/#3231: アプリ週次自動生成 + 読み取り専用ビュー) に伴い、
	// manual 作成フォーム / 一括 import 確認 UI / カテゴリ重複 (GROWTH_BOOK_LABELS と重複) の
	// dead label (参照ゼロ) を削除。残すのは admin/challenges + setup/challenges が実参照する
	// 13 key のみ (ADR-0045 labels SSOT 整合)。sectionTitle 等の訴求文言の現モデル整合は別途 PO 判断。
	familyStreakTitle: (days: number) => `家族ストリーク: ${days}日`,
	sectionTitle: '👥 きょうだいチャレンジ',
	deletedNotice: 'チャレンジを削除しました',
	noChallengeTitleIcon: '👥',
	noChallengeTitle: 'チャレンジはまだありません',
	badgeAllCompleted: '全員クリア！',
	badgeActive: '開催中',
	rewardLabel: (points: number) => `報酬${points}P`,
	deleteButton: '削除',
	dateSeparator: ' 〜 ',
	periodLabelWeekly: '週間',
	periodLabelMonthly: '月間',
	periodLabelCustom: 'カスタム',
} as const;

// ============================================================
// auth/login ページ (#1452 Phase B)
// ============================================================

export const LOGIN_LABELS = {
	mfaBadge: 'MFA認証',
	passwordResetSuccess: 'パスワードがリセットされました。新しいパスワードでログインしてください。',

	// Confirm code step
	confirmBadge: 'メール認証',
	confirmDesc1Suffix: ' に確認コードを送信しました。',
	confirmDesc2: 'メールに記載された6桁のコードを入力してください。',
	confirmCodeLabel: '確認コード',
	confirmLoading: '確認中...',
	confirmButton: '確認する',
	confirmResendSuccess: '確認コードを再送しました',
	confirmResendLoading: '再送中...',
	confirmResendCooldown: (seconds: number) => `コードを再送する（${seconds}秒後に再試行可能）`,
	confirmResendButton: 'コードを再送する',

	// MFA step
	mfaDesc: '認証アプリに表示されている6桁のコードを入力してください。',
	mfaCodeLabel: '認証コード',
	mfaLoading: '認証中...',
	mfaButton: '認証する',

	// Login form
	dividerLabel: 'または',
	emailLabel: 'メールアドレス',
	emailPlaceholder: 'example@email.com',
	passwordLabel: 'パスワード',
	passwordPlaceholder: '8文字以上',
	forgotPasswordLink: 'パスワードを忘れた方はこちら',
	loginLoading: 'ログイン中...',
	loginButton: 'ログイン',
	signupLink: 'アカウントをお持ちでない方はこちら',

	// Dev mode test accounts
	devAccountsSummary: 'テスト用アカウント',
	devAccountOwnerRole: '(管理者)',
	devAccountParentRole: '(親)',
	devAccountChildRole: '(子供)',
} as const;

// ============================================================
// admin/members ページ (#1452 Phase B)
// ============================================================

export const MEMBERS_LABELS = {
	// Role labels
	roleOwner: 'オーナー',
	roleParent: `${PARENT_TERMS.honorific}`,
	roleChild: `${CHILD_TERMS.hiragana}`,

	// Current members section
	currentMembersTitle: '現在のメンバー',
	noMembersText: 'メンバーがいません',
	transferButton: '移譲',
	removeButton: '削除',
	leaveGroupButton: '家族グループを離れる',

	// Invite section
	inviteSectionTitle: 'メンバーを招待',
	inviteRoleLabel: '招待ロール',
	// #3549 判断2: 宛先 email 束縛 (任意入力。設定時は招待リンクをその email のアカウントでのみ受諾可能)
	inviteEmailLabel: '宛先メールアドレス（任意）',
	inviteEmailHint: '入力すると、このメールアドレスのアカウントだけが招待を受諾できます',
	inviteChildLabel: '対象の子供（任意）',
	inviteChildNone: '-- 後で紐づけ --',
	inviteCreateLoading: '作成中...',
	inviteCreateButton: '招待リンクを作成',
	inviteSuccessMsg: '招待リンクが作成されました（7日間有効）',
	inviteQrAlt: '招待QRコード',
	inviteQrNote: 'スマートフォンのカメラでスキャンして参加できます',
	inviteUrlLabel: '招待URL',
	inviteCopied: 'コピー済み',
	inviteCopy: 'コピー',

	// Pending invites section
	pendingInvitesTitle: '保留中の招待',
	inviteExpiresPrefix: '期限: ',
	// #3555 ①: 宛先 email 束縛付き招待の宛先を owner に見せる (タイプミスに気づき
	// 取消し → 再発行できる修正導線)
	inviteEmailBoundPrefix: '宛先: ',
	inviteRevokeButton: '取消し',
	// #3552 ③: 招待の発行・取消は owner 専用 (#3549 PO 決裁 (a))。parent には保留中招待
	// リストは見えるが取消ボタンは非表示のため、「なぜ操作できないか + 誰に依頼するか」を
	// 案内し「認知的宙吊り」(操作が消えて理由も導線も無い状態) を解消する。
	inviteOwnerOnlyNote:
		'招待の発行・取り消しはオーナーのみ行えます。変更が必要な場合はオーナーにご依頼ください。',

	// Error messages
	inviteCreateError: '招待リンクの作成に失敗しました',
	networkError: '通信エラーが発生しました',
	removeError: '削除に失敗しました',
	transferError: '移譲に失敗しました',
	leaveError: '離脱に失敗しました',

	// Confirm dialogs
	revokeConfirm: 'この招待リンクを取り消しますか？',
	removeMemberConfirm: (email: string) =>
		`${email} をメンバーから削除しますか？この操作は取り消せません。`,
	transferConfirm: (email: string) =>
		`${email} にオーナー権限を移譲しますか？\n移譲後、あなたは「保護者」ロールになります。この操作は取り消せません。`,
	leaveGroupConfirm: '家族グループを離れますか？この操作は取り消せません。',

	// Viewer link section
	viewerSectionTitle: '閲覧リンク',
	viewerSectionDesc: '祖父母や家族に、お子さまの成長を読み取り専用で共有できます',
	viewerLabelField: 'ラベル（任意）',
	viewerLabelPlaceholder: '例: おばあちゃん用',
	viewerDurationLabel: '有効期限',
	// #4500: viewerDuration7d は `TRIAL_TERMS.duration` (無料体験の期間) を流用していた。
	// 閲覧リンクの有効期限とトライアル期間は無関係で、トライアルを 14 日に変えた瞬間に
	// 閲覧リンクの選択肢が「14日間」と表示される (誤流用)。閲覧リンク自身の値として持つ。
	viewerDuration7d: '7日間',
	viewerDuration30d: '30日間',
	viewerDurationUnlimited: '無期限',
	viewerCreateLoading: '作成中...',
	viewerCreateButton: '閲覧リンクを作成',
	viewerSuccessMsg: '閲覧リンクが作成されました',
	viewerQrAlt: '閲覧QRコード',
	viewerQrNote: 'スマートフォンのカメラでスキャンして閲覧できます',
	viewerUrlLabel: '閲覧URL',
	viewerCopied: 'コピー済み',
	viewerCopy: 'コピー',
	viewerNoLabel: '(ラベルなし)',
	viewerStatusInvalid: '無効',
	viewerStatusExpired: '期限切れ',
	viewerStatusValid: '有効',
	viewerExpiresPrefix: '期限: ',
	viewerExpiresNone: '無期限',
	viewerRevokeButton: '無効化',
	viewerDeleteButton: '削除',
	viewerRevokeConfirm: 'この閲覧リンクを無効にしますか？',
	viewerDeleteConfirm: 'この閲覧リンクを削除しますか？',
	viewerCreateError: '閲覧リンクの作成に失敗しました',

	// Button titles
	transferTitle: 'オーナー権限を移譲',
	removeTitle: 'メンバーを削除',
} as const;

/**
 * メンバー role の内部コードを日本語ラベルにする (#4507)。
 *
 * 内部コード ('owner' / 'parent' / 'child') を顧客に見せないための SSOT
 * (DESIGN.md §6「内部コード露出禁止」)。メール本文 / 画面のどちらからも本関数を通す。
 * 未知の role は内部コードを露出させず空文字を返さないよう、汎用語にフォールバックする。
 */
export function getMemberRoleLabel(role: string): string {
	switch (role) {
		case 'owner':
			return MEMBERS_LABELS.roleOwner;
		case 'parent':
			return MEMBERS_LABELS.roleParent;
		case 'child':
			return MEMBERS_LABELS.roleChild;
		default:
			return MEMBERS_LABELS.roleParent;
	}
}

// ============================================================
// demo/+page.svelte (#1452 Phase B)
// ============================================================

export const DEMO_TOP_LABELS = {
	// Hero
	heroSubtitle: 'デモ体験',
	heroDesc: 'がんばり家のみんなと一緒に、アプリの機能を体験してみましょう！',

	// Guide section
	guideDismissedTitle: 'ガイドをとじました',
	guideDismissedDesc: 'もう一度はじめから体験できます',
	guideRestartButton: 'ガイドを再開する',
	guideFirstTimeTitle: 'はじめてですか？',
	guideStepsDesc: (n: number) => `${n}ステップで主な機能をご案内します`,
	guideStartButton: 'ガイド付きデモを はじめる',

	// Family section
	familyTitle: 'がんばり家のこどもたち',
	childAgeLabel: (age: number) => `${age}さい`,
	childAgeModeLabel: (age: number, modeLabel: string) => `${age}さい・${modeLabel}`,

	// Mode labels
	modeBaby: 'はじめの一歩',
	modePreschool: 'じぶんでタップ',
	modeElementary: '冒険スタート',
	modeJunior: 'チャレンジ',
	modeSenior: 'みらい設計',

	// Admin link section
	adminTitle: `おやの${ADMIN_VIEW_TERMS.canonical}`,
	adminDesc: '活動の追加、こどもの管理、ポイント確認などの管理機能を体験できます。',
	adminButton: `${ADMIN_VIEW_TERMS.canonical}をみる`,

	// Feature highlights
	featuresTitle: '体験できる機能',
	feature1Title: '活動きろく',
	feature1Desc: '— お子さまの日々のがんばりをワンタップで記録',
	feature2Title: 'ステータス',
	feature2Desc: '— 5軸のレーダーチャートで成長を可視化',
	feature3Title: '週間チャレンジ',
	feature3Desc: '— アプリが毎週、苦手・得意に合わせた目標を自動で提案',
	feature4Title: 'デイリーミッション',
	feature4Desc: '— 毎日の目標で継続をサポート',

	// Conversion CTA
	ctaTitle: 'お子さまの冒険、はじめませんか？',
	ctaNote: `7日間無料 ・ いつでも${CANCEL_TERMS.canonical}OK`,
	ctaButton: '無料で はじめる',
} as const;

// ============================================================
// admin/growth-book ページ (#1452 Phase B)
// ============================================================

export const GROWTH_BOOK_LABELS = {
	pageHeading: '📖 成長記録ブック',
	backToReports: '← レポートへ',
	printButton: '🖨️ 印刷 / PDF',
	premiumNotePrefix: 'PDF保存は',
	premiumNoteLink: 'スタンダードプラン以上',
	premiumNoteSuffix: 'で利用できます。',

	// Cover
	titleSuffix: 'がんばり記録',
	fiscalYearRange: (year: number) => `${year}年度（${year}年4月〜${year + 1}年3月）`,
	currentLevel: (level: number, title: string) => `現在レベル: ${level}（${title}）`,

	// Annual summary
	annualSummaryTitle: '📊 年間サマリー',
	statActivities: '活動回数',
	statPoints: '獲得ポイント',
	statMaxStreak: 'さいちょうストリーク',
	statCertificates: 'しょうめいしょ',
	bestMonthLabel: 'いちばんがんばった月: ',
	bestCategoryLabel: 'とくいなカテゴリ: ',

	// Monthly pages
	monthlyTitle: '📅 月別の記録',
	monthlyActivities: (count: number) => `${count}回`,
	monthlyDays: (days: number) => `${days}日活動`,
	monthlyStreak: (days: number) => `🔥 ${days}日連続`,

	// Certificate link
	certificateLink: '📜 証明書一覧を見る →',

	// Empty states
	noChildrenEmoji: '👧',
	noChildrenText: '子供が登録されていません',
	noDataEmoji: '📖',
	noDataText: 'データがありません',

	// Activity category names
	categoryUndou: 'うんどう',
	categoryBenkyou: 'べんきょう',
	categorySeikatsu: 'せいかつ',
	categoryKouryuu: 'こうりゅう',
	categorySouzou: 'そうぞう',
} as const;

// ============================================================
// ops/analytics ページ (#1452 Phase B)
// ============================================================

export const OPS_ANALYTICS_LABELS = {
	pageTitle: 'OPS - 分析基盤',
	fetchedAt: (dateStr: string) => `${dateStr} 時点`,

	// LTV section
	ltvSectionTitle: 'LTV 推計',
	ltvEstimatedLabel: '推定 LTV',
	ltvEstimatedNote: '= ARPU x 平均継続月',
	ltvArpuLabel: '月次 ARPU',
	ltvArpuNote: (count: number) => `有料会員 ${count} 名`,
	ltvAvgMonthsLabel: '平均継続月数',
	ltvAvgMonthsUnit: 'ヶ月',
	ltvChurnRateLabel: 'チャーンレート',
	ltvChurnedNote: (count: number) => `解約 ${count} 件`,

	// Plan breakdown section
	planBreakdownTitle: 'プラン別 MRR 内訳',
	planColPlan: 'プラン',
	planColTenants: 'テナント数',
	planColMrr: 'MRR',
	planColShare: '割合',
	planNone: '未設定（トライアル等）',

	// Monthly acquisitions section
	acquisitionTitle: '月次ユーザー獲得数（過去 12 ヶ月）',
	acquisitionColMonth: '月',
	acquisitionColNew: '新規登録',

	// Cohort section
	cohortTitle: 'コホート残存分析（入会月別）',
	cohortColMonth: '入会月',
	cohortColSignups: '登録数',
	cohortNote: 'M0 = 入会月、M1 = 1ヶ月後の残存数（残存率%）。現時点のステータスベースの簡易推計。',

	// Data source section
	dataSourceTitle: 'データソース',
	stripeLabel: 'Stripe 連携:',
	stripeEnabled: '有効',
	stripeDisabled: '無効（ローカルモード）',
	pipelineLabel: 'データパイプライン:',
	pipelineDesc: 'DB 直接集計（リアルタイム、追加コストなし）',
	costNote:
		'コスト試算: DB 直接クエリのため追加 AWS コストは $0。DynamoDB Streams + Athena への移行はユーザー数 1,000+ で検討（推定 $5-10/月）。',

	// Activation Funnel section (#2285 EPIC #2283: /admin/analytics 撤去で消失する機能を ops 側へ移動)
	// 内部基盤名 (DynamoDB / Pre-PMF Bucket A) UI 露出禁止 (AN-5 #2180 整合)、「テナント」→「家庭」置換
	activationFunnelTitle: 'Activation Funnel (直近 30 日)',
	activationFunnelDesc: 'signup から 7 日継続までの家庭単位ユニーク件数と遷移率。',
	activationFunnelStepCol: 'ステップ',
	activationFunnelCountCol: '件数',
	activationFunnelConversionCol: '遷移率',
	activationFunnelStepLabels: {
		activation_signup_completed: '① signup',
		activation_first_child_added: '② 初回家庭メンバー登録',
		activation_first_activity_completed: '③ 初回活動完了',
		activation_retained_7d: '④ 7日継続',
	},
	activationFunnelEmpty: 'データがありません',
	activationFunnelHouseholdSuffix: '世帯',
} as const;

// ============================================================
// ops/analytics — setup プリセット選択分布 (#1602, ADR-0023 I13)
// ============================================================

/**
 * #1602: setup challenges (3 軸プリセット) 選択分布セクションのラベル。
 * 内部運営（PO / 運営）が四半期見直し時にプリセット改良の判断に使う。
 */
export const OPS_PRESET_DISTRIBUTION_LABELS = {
	sectionTitle: 'setup チャレンジ選択分布',
	sectionDesc:
		'#1592 で 3 軸に簡素化した setup challenges のうち、各プリセットがどの程度選ばれているかの分布。偏りがあれば残り 2 軸の改良余地を示すサイン。',
	colKey: 'プリセット',
	colCount: '選択数',
	colShare: '割合',
	colBar: '分布',
	totalsLabel: (answered: number, total: number) => `回答 ${answered} 名 / 全テナント ${total} 名`,
	emptyMessage:
		'回答テナントがまだいません。setup を完了したテナントが増えるとここに表示されます。',

	// Bucket labels (#1743: 内部キー露出を排除し顧客語彙に完結)
	bucketHomeworkDaily: '宿題ルーティン',
	bucketChores: '家事のお手伝い',
	bucketBeyondGames: 'ゲーム以外のチャレンジ（読書 / 外遊び / 工作 / 音楽）',
	bucketOther: 'その他（旧キー後方互換）',
	bucketNone: '未回答（setup 未到達 / skip）',

	// Note for ratio interpretation
	ratioNote:
		'割合は「回答テナント数」ベース（複数選択あり、合計 100% を超える）。「未回答」のみ全テナント数ベース。',
} as const;

// ============================================================
// デモ版設定ページ (#1452 Phase B)
// ============================================================

export const DEMO_SETTINGS_LABELS = {
	pageTitle: '設定',

	// おやカギ section
	oyakagiDesc1: `${ADMIN_VIEW_TERMS.canonical}にアクセスするための`,
	oyakagiDesc2: 'を変更できます。',
	oyakagiDesc3: '。',
	oyakagiConfirmLabel: '確認',

	// ポイント表示設定 section
	pointSectionTitle: '&#x2B50; ポイント表示設定',
	pointSectionDesc: 'ポイントの表示方法を「ポイント (P)」または「通貨」に切り替えられます。',
	pointModeTitle: '&#x1F4CA; ポイントモード',
	pointModeExample: (val: string) => `例: ${val}`,
	currencyModeTitle: '&#x1F4B0; 通貨モード',
	currencyModeExample: (val: string) => `例: ${val}`,
	currencyListTitle: '対応通貨',

	// 減衰設定 section
	decaySectionTitle: '&#x1F4C9; ステータス減衰設定',
	decaySectionDesc:
		'活動をサボるとステータスがゆっくり下がります。お子さまに合った強度を選べます。',

	// データ管理 section
	dataSectionTitle: '&#x1F4BE; データ管理',
	dataSectionDesc: '登録すると、データのエクスポート・インポート・初期化が利用できます。',
	dataExport: 'エクスポート',
	dataImport: 'インポート',
	dataReset: '初期化',

	// フィードバック section
	feedbackSectionTitle: '&#x1F4AC; フィードバック',
	feedbackSectionDesc: 'ご意見・ご要望・バグ報告をお寄せください。登録後に利用可能です。',

	// CTA
	ctaTitle: 'すべての設定を利用しませんか？',
	ctaDesc: '登録すると、PIN設定・ポイント表示・減衰設定などが自由にカスタマイズできます。',
} as const;

// ============================================================
// エラーページ (#1452 Phase B)
// ============================================================

export const ERROR_PAGE_LABELS = {
	// Page titles (by status code)
	title404: 'ページが みつかりません',
	title429: 'アクセスが こんでいます',
	title403: 'アクセスが きょか されていません',
	titleDefault: 'エラーが はっせいしました',

	// Descriptions
	desc404Child: 'おうちの がめんに もどります…',
	desc404Parent: 'お探しのページは存在しないか、移動した可能性があります。',
	desc429: 'しばらくしてから再度お試しください。',
	desc403Child: 'おうちの がめんに もどります…',
	desc403Parent: 'このページにアクセスする権限がありません。ログインし直してください。',
	descGenericChild: 'おうちの がめんに もどります…',
	descGenericParent: '予期しないエラーが発生しました。時間をおいて再度お試しください。',

	// Action buttons
	btnBackNow: 'いますぐ もどる',
	btnLoginAgain: 'ログインし直す',
	btnRetry: 'もう一度試す',
	btnBackToTop: 'トップページへ戻る',

	// Error ID
	errorIdPrefix: 'エラーID: ',
} as const;

/**
 * #4282 AC5: `/ops` が MFA 未設定で拒否されたときに出す復旧導線の文言。
 *
 * 運営者専用画面のため顧客には出ない。ここで手順まで出し切るのは、
 * 「拒否されたが何をすれば入れるのか分からない」状態を作らないため
 * (リンク先を読まないと復旧できない導線は導線として成立しない)。
 */
export const OPS_MFA_SETUP_LABELS = {
	title: '多要素認証（MFA）の設定が必要です',
	description:
		'運営ダッシュボードは、ログイン時に多要素認証を通ったセッションだけが利用できます。認証アプリ（TOTP）の設定が済んでいないか、設定後にログインし直していない状態です。',
	stepsTitle: '入れるようにする手順',
	steps: [
		'スマートフォンに認証アプリ（TOTP 対応のもの）を用意する',
		'運営管理者が Cognito ユーザープールで、このアカウントの認証アプリ（TOTP）を有効にする',
		'いったんログアウトし、認証アプリのコードを入力してログインし直す',
	],
	/** 再ログインは MFA チャレンジを経て `amr` を載せ直す唯一の出口。汎用 403 と同じ文言を再利用する */
	loginAgainLabel: ERROR_PAGE_LABELS.btnLoginAgain,
	/**
	 * #4335 follow-up: 旧文言はリポジトリ内ファイルパス（`docs/runbooks/ops-mfa-setup.md`）を
	 * そのまま出しており、403 画面を見ている運営者がその場で開けなかった（クローンを持たない
	 * 環境 / スマートフォンからの閲覧では特に）。依頼先を画面内で完結させる（runbook の詳細手順
	 * は変えず、画面には「自分でできない場合に誰に頼むか」だけを直接書く）。
	 */
	runbookHint: '自分で設定できない場合は、AWS アカウントのオーナーに設定を依頼してください。',
} as const;

// ============================================================
// 注: OPS_LICENSE_KEY_LABELS (旧 /ops/license/[key] 詳細ページ) は Epic #2525 Phase 7 PR-L4
//     (#2836) license key 全廃に伴い撤去済 (route は PR-L3 #2818 で物理削除)。
// ============================================================

// ============================================================
// ベンチマーク管理ページ (#1452 Phase B)
// ============================================================

export const STATUS_LABELS = {
	// Navigation link
	childrenEditLink: 'こども管理でステータス編集 →',

	// Growth report
	growthReportTitle: (nickname: string) => `📊 ${nickname}の成長レポート`,
	radarChartNote: '※ 参考値です。お子さまの個性やペースを大切にしてください',
	analysisSummaryTitle: '📋 分析サマリー',
	monthlyChangeTitle: '📈 先月からの変化',
	comparisonLabel: '同年齢の平均',

	// Level title customization
	levelTitleSectionTitle: '🏷️ レベル称号カスタマイズ',
	levelTitleDesc:
		'各レベルの称号を家庭オリジナルに変更できます。空欄にするとデフォルトに戻ります。',
	levelTitleSaveButton: '保存',
	levelTitleResetButton: 'リセット',
	levelTitleResetTooltip: 'デフォルトに戻す',
	levelTitleResetAllButton: '全ての称号をデフォルトに戻す',
	levelTitleSaveSuccess: '称号を更新しました',
	levelTitleOpenLabel: '▼ 開く',
	levelTitleCloseLabel: '▲ 閉じる',

	// Benchmark info box
	benchmarkInfoTitle: 'ベンチマークとは？',
	benchmarkInfoDesc1:
		'子供のステータスを「同じ年齢の目安値」と比べて偏差値を計算するためのデータです。',
	benchmarkInfoDesc2:
		'設定すると、子供画面に「みんなよりすごい！」などの比較メッセージが表示されます。',

	// Preview label
	previewLabel: 'プレビュー:',

	// Benchmark guide
	benchmarkGuide: (age: number, meanLow: number, meanHigh: number, sdLow: number, sdHigh: number) =>
		`${age}歳の目安: 平均 ${meanLow}〜${meanHigh} XP、SD ${sdLow}〜${sdHigh}（XPベース）`,
	benchmarkUnsetWarning: (age: number) =>
		`${age}歳のベンチマークが未設定のカテゴリがあります。設定すると子供画面の比較メッセージが正しく機能します。`,
	benchmarkSaveButton: '保存',
	benchmarkSaveSuccess: 'ベンチマークを更新しました',

	// Deviation preview
	deviationPreview: (nickname: string, deviation: number, emoji: string, text: string) =>
		`${nickname}: 偏差値 ${deviation}（${emoji} ${text}）`,

	// Form labels
	meanLabel: '平均（目安値）',
	sdLabel: 'SD（ばらつき）',
} as const;

// ============================================================
// 料金プランページ (#1452 Phase B)
// ============================================================

export const PRICING_PAGE_LABELS = {
	heading: '料金プラン',
	// #1960 Phase 7 H3: terms.ts atom 参照化 (FREE_TERMS / PLAN_TERMS / TRIAL_TERMS / PLAN_FULL_TERMS)
	subtitle1: `${FREE_TERMS.base}ではじめられます。${PLAN_TERMS.standard}・${PLAN_TERMS.premium}プランはすべて`,
	subtitleTrialDays: `${TRIAL_TERMS.duration}の無料体験`,
	subtitle2: '付き',
	// #1912 (F-6): LP 訴求文の「ログインボーナス」「連続達成ボーナス」がギャンブル系語彙のため
	//   日本語の素朴な表現に置換（IT リテラシーなし親 P1 の認知ジャンプ防止）。
	//   内部実装識別子 (login-bonus-service / loyalty-service) は識別子として scope 外。
	featureNote:
		'お子さまが楽しめる冒険の仕組み（レベル・おみくじ・スタンプカード・毎日のごほうび・続けるごほうびなど）は',
	featureNoteStrong: '全プラン共通',
	featureNoteSuffix: 'で制限なし',
	// #1896 PO-4-10: 旧 'faqTitle: よくある質問' は LP_FAQ_TERMS.faqHtmlTitle 経由に統一
	//   ('よくあるご質問' に長形式化)。key 名も compound 役割を明示する 'faqHeading' に rename
	//   し atom と key 名の混同を防ぐ（src/routes/pricing/+page.svelte 参照を同期更新）。
	faqHeading: `${LP_FAQ_TERMS.faqHtmlTitle}`,
	faqFreePlanQ: `${PLAN_FULL_TERMS.free}でも十分使えますか？`,
	faqFreePlanA:
		'はい。プリセットの活動とチェックリストで基本的な機能はお使いいただけます。お子さまの冒険体験は無料でも一切制限ありません。',
	faqCancelTrialQ: `無料体験中に${CANCEL_TERMS.canonical}できますか？`,
	// #4496: 旧文言「無料体験期間中に解約すれば一切課金されません」は「解約しなければ課金される」
	//   という誤含意を持っていた。トライアルは自動課金なしが仕様 (FR-5 / NFR-1) なので、
	//   「何もしなくても課金されない」ことを先に述べる。
	faqCancelTrialA: `はい。無料体験は自動で課金される仕組みではありません。体験期間が終わると自動的に${PLAN_FULL_TERMS.free}へ切り替わり、料金は発生しません（体験中に${CANCEL_TERMS.canonicalVerb}手続きをしなくても課金されません）。`,
	faqCancelQ: '解約したらデータはすぐに削除されますか？',
	// #4496: 旧文言は**退会 (アカウント削除) の猶予期間**を解約の説明に転用しており、
	//   「解約するとデータが削除される」という事実と異なる記述になっていた。
	//   実装事実 (#3991 期末解約モデル / cancel_at_period_end=true):
	//     - 解約はデータを削除しない。期末まで有料プランを使え、その後無料プランへ自動移行する
	//     - 無料プランの保持期間 (PLAN_HISTORY_RETENTION_DAYS.free) を超えた記録は
	//       retention-cleanup-service が**物理削除**する (閲覧不可ではなく復元不能)
	//     - データそのものの削除は退会の手続きで、猶予は DELETION_GRACE_PERIOD_DAYS
	//   アプリ内 /pricing と LP /site/pricing.html / faq.html / index.html / 特商法で同一の
	//   事実を述べる (数値は terms.ts atom 経由で値 SSOT から引く)。
	faqCancelA: `いいえ。${CANCEL_TERMS.canonical}してもデータは削除されません。現在の請求期間の終了日までは有料プランをそのままご利用いただけ、その後は${PLAN_FULL_TERMS.free}へ自動的に切り替わります（お子さまの記録は残ります）。${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。必要な記録は保持期間内にエクスポートしてください。データそのものを消すのはアカウント${CANCEL_TERMS.account}のお手続きで、プラン別の猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free} / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）の経過後にすべてのデータが完全に削除されます。`,
	faqBillingDateQ: '課金日はいつですか？',
	// #4502: 年額は #2719 で廃止済み。LP 側は #3212 で是正済みで、ここだけ残っていた
	faqBillingDateA: 'お申し込み日を起算日として毎月自動更新されます。',
	faqPaymentQ: '支払い方法は？',
	faqPaymentA:
		'クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しています。',
	faqPlanChangeQ: 'プランの変更はできますか？',
	faqPlanChangeA: `はい。${PLAN_TERMS.standard}↔${PLAN_TERMS.premium}の切り替えがいつでも可能です。${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」から変更できます。`,
	faqSelfHostQ: 'セルフホスト版はありますか？',
	faqSelfHostA:
		'はい。全機能を無料でお使いいただけるオープンソース版があります。DockerとNode.jsの基本的な知識が必要です。',
} as const;

// ============================================================
// 同意ページ (#1452 Phase B)
// ============================================================

export const CONSENT_LABELS = {
	// Page titles
	titleUpdated: '規約に変更がありました',
	titleNew: '規約への同意',

	// Section headings
	headingUpdated: '規約が更新されました',
	descUpdated: 'サービスの利用を続けるには、更新された規約への同意が必要です。',
	headingNew: '規約への同意',
	descNew: 'サービスの利用を開始するには、規約への同意が必要です。',

	// Previous consent info
	previousConsentPrefix: '前回同意: ',
	previousConsentArrow: ' → ',
	previousConsentLatest: '最新: ',
	previousConsentNone: '未同意',

	// Terms
	termsSectionTitle: '利用規約',
	termsVersionPrefix: 'バージョン: ',
	termsReadLink: '利用規約を確認する ↗',
	termsCheckLabel: '利用規約に同意します',

	// Privacy
	privacySectionTitle: 'プライバシーポリシー',
	privacyVersionPrefix: 'バージョン: ',
	privacyReadLink: 'プライバシーポリシーを確認する ↗',
	privacyCheckLabel: 'プライバシーポリシーに同意します',

	// Submit button
	submitLoading: '同意中...',
	submitButton: '同意して続ける',

	// Error messages (used in +page.svelte and +page.server.ts)
	errors: {
		loginRequired: 'ログインが必要です',
		bothRequired: '利用規約とプライバシーポリシーの両方に同意してください',
		recordFailed: '同意の記録に失敗しました。もう一度お試しください。',
		termsRequired: '利用規約への同意が必要です',
		privacyRequired: 'プライバシーポリシーへの同意が必要です',
	},
} as const;

// ============================================================
// デモ版ベンチマーク管理ページ (#1452 Phase B)
// ============================================================

export const DEMO_STATUS_LABELS = {
	ctaTitle: 'ベンチマークを自由に設定しませんか？',
	ctaDesc: '登録すると、年齢別の目安値を自由に設定して成長レポートをカスタマイズできます。',
	levelTitleLabel: '称号',
	meanLabel: '平均',
	sdLabel: 'SD',
} as const;

// ============================================================
// Ops AWS費用ページ (#1452 Phase B)
// ============================================================

export const OPS_COSTS_LABELS = {
	pageTitle: 'OPS - AWS費用',
	prevMonthLink: '← 前月',
	nextMonthLink: '翌月 →',
	yearMonthDisplay: (year: number, month: number) => `${year}年${month}月`,
	currentCostLabel: '当月 AWS 費用',
	prevMonthDiffLabel: '前月比',
	serviceCountLabel: 'サービス数',
	serviceBreakdownTitle: 'サービス別費用内訳',
	noCostData: '費用データがありません（AWS Cost Explorer API が利用不可、またはデータなし）',
	colService: 'サービス',
	colCostUsd: '費用 (USD)',
	colCostJpy: '概算 (JPY)',
	colRatio: '割合',
	totalRow: '合計',
	lastFetchedPrefix: '最終取得: ',
	cacheNote: '（24時間キャッシュ、API費用: $0.01/リクエスト）',
} as const;

// ============================================================
// ごほうびページ (#1452 Phase B)
// ============================================================

export const REWARDS_LABELS = {
	// #2268: CRUD 整備 + 命名訂正 + 検索 + grant→add リネーム
	// 応援系語彙（とくべつなごほうび / ボーナス贈与 / ボーナスポイントを贈れます）は削除済
	sectionTitle: '🎁 ごほうび管理',
	// EPIC #3533: 旧 premiumBadge (ヘッダー「有料限定」バッジ) は §10.2 P3/P4 で撤去。
	tabRewards: 'ごほうび',
	// #2998 fix: pageDescTitle / pageDescText1 は AdminResourceHeader の title / description と
	// 二重表示になっていたため撤去。応援機能との区別案内 (pageDescText2) と messages クロスリンク
	// (pageDescHint*) のみ page-description カードに残す。
	pageDescText2: '応援機能（突発のごほうび）は /admin/cheer をご利用ください。',
	pageDescHintPrefix: '💌 スタンプやメッセージは',
	pageDescHintLink: 'おうえんメッセージ',
	pageDescHintSuffix: 'から送れます',
	// EPIC #3533: 旧 free 向けアップグレード誘導バナー文言 (upgradeBannerTitle/Desc/Button) は
	//   §10.2 P1/P3 で撤去 (画面内 CTA バナーを廃止、制約詳細はプラン画面へ一元化)。
	selectChildTitle: 'こどもを選択',
	selectTemplateTitle: 'プリセットを選択',
	presetToggle: (open: boolean) => `${open ? '▼' : '▶'} プリセットから追加`,
	// #2268: 検索 UI
	searchLabel: 'ごほうびを検索',
	searchPlaceholder: 'ごほうび名で検索...',
	searchEmptyMessage: '該当するごほうびがありません',
	confirmGrantTitle: '内容を確認して追加',
	titleLabel: 'タイトル',
	pointsLabel: 'ポイント',
	iconLabel: 'アイコン',
	categoryLabel: 'カテゴリ',
	// #2268: grant → add リネーム（実態は special_rewards INSERT、子供 shop に並べる商品の追加）
	grantButton: (icon: string, title: string, points: number) =>
		`${icon} ${title || 'ごほうび'} (${points}P) を追加する`,
	grantSuccess: 'ごほうびを追加しました！',
	// #2268: overflow menu / 申請承認導線（子#3 で /admin/rewards/requests へ分離）
	overflowMenuAriaLabel: 'その他の操作',
	requestsMenuLabel: (count: number) => `申請承認 (${count} 件)`,
	requestsMenuLabelEmpty: '申請承認',
	/** #2136 MP-1: マーケットプレイス一括追加セクション */
	marketplaceSectionTitle: 'みんなのごほうびから追加',
	marketplaceSectionDesc: 'おすすめのごほうびセットを一括追加できます（重複はスキップ）',
	marketplaceImportButton: (count: number) => `${count} 件を一括追加`,
	marketplaceImportSuccess: (count: number) => `✨ ${count} 件のごほうびを追加しました`,
	marketplaceImportAllDuplicates: 'このごほうびセットは既に追加済みです',
	marketplaceImportError: 'インポートに失敗しました',
	marketplaceItemCountSuffix: '件',
	marketplaceImportToggle: (open: boolean) => `${open ? '▼' : '▶'} みんなのごほうびから追加`,
} as const;

// ============================================================
// デモメンバー管理ページ (#1452 Phase B)
// ============================================================

export const DEMO_MEMBERS_LABELS = {
	sectionTitle: '👥 メンバー管理',
	sectionDesc:
		'QRコードでご家族をかんたんに招待できます。パートナーやおじいちゃん・おばあちゃんもお子さまの成長を一緒に見守れます。',
	qrPlaceholder: '登録するとQRコードが生成されます',
	invitedMembersTitle: '招待済みメンバー',
	demoMember1Name: 'がんばり太郎',
	demoMember1Role: 'オーナー',
	demoMember2Name: 'がんばり花子',
	demoMember2Role: 'メンバー',
	memberStatusActive: 'アクティブ',
	permissionsTitle: '権限について',
	permissionOwner: 'オーナー',
	permissionOwnerDesc: 'すべての設定変更・メンバー管理が可能',
	permissionMember: 'メンバー',
	permissionMemberDesc: '活動記録・閲覧が可能（設定変更は不可）',
	inviteLimit: '招待は最大5名まで（オーナー含む）',
	ctaTitle: 'ご家族みんなで使いませんか？',
	ctaDesc: '登録すると、QRコードで簡単にご家族を招待できます。',
} as const;

// ============================================================
// OPS エクスポートページ (#1452 Phase B)
// ============================================================

export const OPS_EXPORT_LABELS = {
	pageTitle: 'OPS - エクスポート',
	exportTitle: '確定申告用CSVエクスポート',
	salesTitle: '売上台帳',
	salesDesc: 'Stripe 請求書ベースの収入記録。青色申告決算書 第1面「収入金額」に対応。',
	salesDownload: 'CSV ダウンロード',
	expensesTitle: '経費台帳',
	expensesDesc: 'AWS 費用 + Stripe 手数料。勘定科目付き。青色申告決算書「必要経費」に対応。',
	expensesDownload: 'CSV ダウンロード',
	summaryTitle: '収支サマリー',
	summaryDesc: '売上・経費・差引利益の一覧。確定申告前の概要確認用。',
	summaryDownload: 'テキスト ダウンロード',
	notesTitle: '注意事項',
	note1: 'AWS 費用は Cost Explorer API から取得（USD→JPY はレート ¥150/$ で概算）',
	note2: 'Stripe 手数料は 3.6% + ¥40/件 の概算値です',
	note3: '消費税区分はインボイス登録状況に応じて調整が必要です',
	note4: '本データは概算値です。正式な申告は税理士に相談してください',
} as const;

// ============================================================
// おうえんメッセージページ (#1452 Phase B)
// ============================================================

// MESSAGES_LABELS: #2270 (EPIC #2266) で /admin/messages 廃止に伴い削除。
// 応援機能 (/admin/cheer) に統合: CHEER_LABELS を使う。
// 既読/未読表示など共通用途は CHEER_LABELS.msgRead / msgUnread 等で継承。

// ============================================================
// 応援機能 (/admin/cheer) (#2267 / EPIC #2266)
// ============================================================
// PO 報告 (2026-05-19) 「応援 = 任意の理由で直接子供にポイント付与 (運動会一位等)、
// スタンプ/メッセージは P 付与に付随する理由表現」
// #2276: CHEER_TERMS / REWARD_TERMS atom 参照化 (ADR-0045 §3.3)。
// atom 1 行修正で 「応援」「ごほうび」のリブランディング時に全 UI 伝播する。
export const CHEER_LABELS = {
	pageDescTitle: `🎉 ${CHEER_TERMS.canonical}`,
	pageDescText1: `お子さまのがんばりに、理由とポイントで${CHEER_TERMS.canonical}を届けます。`,
	pageDescText2: '「運動会で1位」「むずかしい問題ができた」など、その場で気持ちを形にできます。',
	pageDescHintPrefix: `スタンプやひとことメッセージも添えられます。日常の${REWARD_TERMS.menu}は`,
	pageDescHintLink: REWARD_TERMS.canonical,
	pageDescHintSuffix: 'から行えます',
	selectChildTitle: '1. こどもを選択',
	reasonTitle: `2. ${CHEER_TERMS.action}理由`,
	reasonPlaceholder: '例: うんどうかいで 1いに なったね！',
	reasonHint: '100文字以内',
	pointsTitle: '3. ボーナスポイント',
	pointsHint: '1〜10000の範囲で入力',
	categoryTitle: '4. カテゴリ',
	iconTitle: '5. アイコン',
	iconHint: '絵文字を入れてください',
	extraTitle: '6. 付随スタンプ / メッセージ（任意）',
	extraDescription: 'いつものスタンプや、ひとことメッセージも一緒に届けられます',
	// #4504: 自由テキストは premium 限定 (LP の訴求どおり)。定型スタンプは全プランで使える。
	/** プランゲートのエラー文言 / ロック表示に使う機能名 */
	freeTextFeatureName: 'ひとことメッセージ（自由テキスト）',
	/** premium 以外に出す説明。スタンプは使えることを同時に伝える (全否定しない) */
	freeTextLockedNote: `ひとことメッセージ（自由テキスト）は${PLAN_FULL_TERMS.premium}の機能です。スタンプは今のプランでも送れます。`,
	freeTextPlaceholder: 'ひとことメッセージを足す（任意）',
	confirmTitle: `7. 内容を確認して${CHEER_TERMS.action}`,
	grantButton: CHEER_TERMS.action,
	grantButtonDisabled: '理由とポイントを入力してください',
	grantSuccess: `${CHEER_TERMS.canonical}を送りました！`,
	grantSuccessDesc: (points: number) => `+${points}P をプレゼントしました`,
	historyTitle: `最近の${CHEER_TERMS.canonical}`,
	recentMessagesTitle: '最近のメッセージ（旧履歴含む）',
	msgRead: '既読',
	msgUnread: '未読',
	noChildrenTitle: 'まずこどもを登録してください',
	noChildrenDesc: '「こども」タブから登録できます',
	// プリセット理由（よく使う応援の例、 1 タップで reason に流し込む）
	presetTitle: `よくある${CHEER_TERMS.canonical}`,
	// 日本ローカライズ reason テンプレ (#2300、EPIC #2294 ⑥)
	// 親が現実イベント後に承認する 1 タップ操作（ADR-0012 anti-engagement / 滞在ゼロ）。
	// シーズン期間中の自動配信は不採用、家族コミュニケーション wedge 強化。
	reasonTemplates: [
		{
			reason: 'ひな祭りのお手伝い ありがとう',
			recommendedPoints: 30,
			icon: '🎎',
			category: 'せいかつ',
		},
		{
			reason: 'こどもの日のプロジェクト完成',
			recommendedPoints: 50,
			icon: '🎏',
			category: 'そうぞう',
		},
		{
			reason: '七夕の短冊、ステキだったね',
			recommendedPoints: 20,
			icon: '🎋',
			category: 'そうぞう',
		},
		{
			reason: '敬老の日にじいじ/ばあばへメッセージ ありがとう',
			recommendedPoints: 50,
			icon: '💌',
			category: 'こうりゅう',
		},
	],
	// ボタン操作系
	cheerAgainBack: 'ホームへ戻る',
	// 確認用ラベル
	confirmReasonLabel: '理由',
	confirmPointsLabel: 'ポイント',
	confirmCategoryLabel: 'カテゴリ',
	confirmIconLabel: 'アイコン',
	// エラーメッセージ
	errorReasonRequired: `${CHEER_TERMS.canonical}の理由を入力してください`,
	errorReasonTooLong: '理由は100文字以内で入力してください',
	errorPointsRequired: 'ポイントは1〜10000の範囲で入力してください',
	errorCategoryRequired: 'カテゴリを選択してください',
	errorChildRequired: 'こどもを選択してください',
} as const;

// ============================================================
// OPS コホート分析ページ (#1452 Phase B)
// ============================================================

export const OPS_COHORT_LABELS = {
	pageTitle: 'OPS - コホート分析',
	monthlyChurnRateLabel: '月次解約率',
	theoreticalLtvLabel: '理論値 LTV',
	theoreticalLtvNote: 'ARPU / 月次解約率',
	retentionTableTitle: (monthsBack: number) =>
		`月次コホート別リテンション（過去${monthsBack}ヶ月）`,
	noDataMessage: 'コホートデータがありません',
	colCohort: 'コホート',
	colTenantCount: 'テナント数',
	colPaid: '有料',
	insufficientSampleBadge: 'サンプル不足',
	ltvCompareTitle: 'コホート別 LTV 比較',
	theoreticalLtvSummary: (ltv: number) => `理論値 LTV (ARPU/月次解約率): ¥${ltv.toLocaleString()}`,
	lastFetchedPrefix: '最終取得: ',
} as const;

// ============================================================
// はじめてのぼうけんページ (#1452 Phase B)
// ============================================================

export const SETUP_FIRST_ADVENTURE_LABELS = {
	successTitle: (nicknameVocative: string) => `${nicknameVocative}すごい！`,
	recordedDesc: (activityName: string) => `「${activityName}」をきろくしたよ！`,
	pointsGetLabel: 'ポイントゲット！',
	levelUpLabel: 'レベルアップ！',
	startAdventureButton: 'ぼうけんをはじめる！',
	selectActivityTitle: 'はじめてのぼうけん！',
	selectActivityDescPart1: 'さいしょのがんばりを',
	selectActivityDescPart2: 'いっしょにきろくしよう！',
	noActivitiesMsg: `まだ活動が登録されていません。あとから${ADMIN_VIEW_TERMS.canonical}で追加できます。`,
	nextButton: '次へすすむ',
	recordingLabel: 'きろくちゅう...',
	recordButton: 'タップしてきろく！',
	selectActivityHint: 'がんばりをえらんでね！',
	skipButton: 'あとでやる（スキップ）',
} as const;

// ============================================================
// デモポイント変換ページ (#1452 Phase B)
// ============================================================

export const DEMO_POINTS_LABELS = {
	currentBalanceLabel: (unit: string) => `現在の${unit}残高`,
	convertSectionTitle: 'ポイント変換',
	modeSimple: 'かんたん',
	modeFreeInput: '自由入力',
	modeOcr: '領収書OCR',
	demoConvertDisabled: 'デモでは変換できません',
	thisMonthConvertLabel: '今月の変換合計',
	totalConvertLabel: '累計変換合計',
	aboutTitle: 'ポイント変換について',
	aboutNote1: 'お子さまが活動で貯めたポイントを、おこづかいに変換できます',
	aboutNote2: '変換レートは設定画面で自由にカスタマイズ可能です',
	aboutNote3: '3つの変換モード: かんたん / 自由入力 / 領収書OCR',
	aboutNote4: '変換履歴も記録されるので、安心して管理できます',
	ctaTitle: 'ポイントをおこづかいに変換しませんか？',
	ctaDesc: '登録すると、ポイント変換やレート設定が自由にできます。',
} as const;

// ============================================================
// 実績ページ (#1452 Phase B)
// ============================================================

// ACHIEVEMENTS_LABELS: 実績機能廃止 (#1782 / #1816) で全 keys 参照ゼロのため namespace 削除 (#1833)

// ============================================================
// 活動紹介ページ (#1452 Phase B)
// ============================================================

export const ACTIVITIES_INTRODUCE_LABELS = {
	noActivitiesTitle: '表示できる活動がありません',
	noActivitiesDesc: 'まず活動を追加してください',
	backButton: 'もどる',
	progressSuffix: 'の活動',
	triggerHintGuide: 'つかいかたを みせてあげてね',
	triggerHintOpen: '「',
	triggerHintClose: '」',
	activityDescLabel: '活動の説明',
	noHintMessage: 'ヒントはまだ設定されていません',
	noHintEditNote: '活動編集画面で「トリガーヒント」を設定できます',
	prevButton: '← まえへ',
	nextButton: 'つぎへ →',
	finishButton: 'おわる',
} as const;

// ============================================================
// デモメッセージページ (#1452 Phase B)
// ============================================================

// DEMO_MESSAGES_LABELS: #2270 (EPIC #2266) で /demo/admin/messages dir 削除 (PR-B3 #2188 で既に削除済) +
// /admin/messages 廃止に伴い、demo 専用 messages ラベルも参照ゼロのため削除。応援機能 (/admin/cheer) に統合。

// #2295 (EPIC #2294 ①): EVENTS_LABELS 削除済 (2026-05-19) — シーズンイベント機構撤去

// ============================================================
// パスワードリセットページ (#1452 Phase B)
// ============================================================

export const FORGOT_PASSWORD_LABELS = {
	pageSubtitle: 'パスワードリセット',
	step2ConfirmSentPrefix: 'に確認コードを送信しました。',
	step2ConfirmEnterInstruction: 'メールに記載されたコードと新しいパスワードを入力してください。',
	step2CodeExpiryPrefix: '確認コードは',
	step2CodeExpirySuffix: '分間有効です。届かない場合は再送してください',
	resettingLabel: 'リセット中...',
	resetButton: 'パスワードをリセット',
	step1Instruction1: '登録済みのメールアドレスを入力してください。',
	step1Instruction2: 'パスワードリセット用の確認コードを送信します。',
	sendingLabel: '送信中...',
	sendButton: '確認コードを送信',
	backToLoginLink: 'ログインに戻る',
} as const;

// ============================================================
// デモごほうびページ (#1452 Phase B)
// ============================================================

export const DEMO_REWARDS_LABELS = {
	upgradeBannerDesc: `${PLAN_FULL_TERMS.free}ではプリセット閲覧のみ可能です。${PLAN_FULL_TERMS.standard}以上にアップグレードすると、カスタムのボーナスごほうびを作成・付与できます。`,
	// #2272 AC2: 「テンプレート」UI 露出を REWARD_TERMS.preset 経由「プリセット」に置換
	selectTemplateTitleDemo: `2. ${REWARD_TERMS.preset}を選択（またはカスタム）`,
	confirmGrantTitleDemo: '3. 内容を確認して付与',
	demoGrantDisabled: 'デモでは報酬を付与できません',
	ctaTitle: `特別報酬で${CHILD_TERMS.honorific}をもっと応援しませんか？`,
	ctaDesc: `${SIGNUP_TERMS.canonical}すると、テンプレートやカスタム報酬を自由に付与できます。`,
} as const;

// ============================================================
// セットアップ完了ページ (#1452 Phase B)
// ============================================================

export const SETUP_COMPLETE_LABELS = {
	title: 'ぼうけんのはじまり！',
	descPart1: 'ぼうけんじゅんびが',
	descPart2: 'かんりょうしたよ！',
	childCountUnit: '人',
	childCountLabel: 'こども',
	activityCountUnit: 'こ',
	activityCountLabel: 'かつどう',
	nextMissionLabel: 'つぎのミッション',
	nextMissionText: '「きょうの がんばりを 3つ きろくしよう！」',
	ctaPrimary: 'こどもがめんをひらく',
	ctaSecondary: 'おやのせっていをみる',
	pinHintPrefix: `💡 ${ADMIN_VIEW_TERMS.canonical}の「せってい」から`,
	pinHintMiddle: 'を変更すると、おやの画面を守れるよ。',
	// #2992: 初回は既定 PIN 入力でなく新規作成フローのため、旧 5086 注記 (defaultValueHint) を置換
	pinHintSuffix: '初めて入るときに作成します。',
} as const;

export const CERTIFICATE_DETAIL_LABELS = {
	pageTitle: 'がんばり証明書',
	backLink: '一覧に戻る',
	previewTitle: '📜 証明書プレビュー',
	printButton: '🖨️ 印刷 / PDF保存',
	pdfUpgradeNote: 'PDF保存はスタンダードプラン以上',
	upgradeLink: 'アップグレード',
	shareCardTitle: '🎉 がんばりカード',
	shareCardDesc: '達成を画像でダウンロードして、LINEやSNSでシェアできます',
	downloadButton: '📥 画像をダウンロード',
	closeButton: '閉じる',
	showShareCardButton: '🎉 シェアカードを表示',
} as const;

export const DEMO_CHILD_HOME_LABELS = {
	checklistTitle: 'もちものチェック',
	checklistDone: '✅ かんりょう！',
	dailyMissionTitle: 'きょうのミッション',
	missionComplete: (pts: string) => `🎉 ミッションコンプリート！ ${pts}`,
	activitiesEmpty: 'かつどうがまだありません',
	recordingLabel: 'きろくちゅう...',
	recordButton: 'きろくする！',
	resultStreakSuffix: '！',
	resultTodayPrefix: 'きょう',
	resultTodaySuffix: 'かいめ！',
	demoDataNote: '（デモモード：データは保存されません）',
	signupCta: 'お子さまの名前で はじめる →',
	closeButton: 'とじる',

	// #1757 (#1709-C) 「今日のおやくそく」N/M バー（demo 同期）
	mustTitle: '今日のおやくそく',
	mustTitleKana: 'きょうのおやくそく',
	mustProgressText: (logged: number | string, total: number | string) => `${logged}/${total}`,
	mustRemaining: (n: number | string) => `あと ${n}こ`,
	mustAllComplete: 'ぜんぶできた！',
	mustAllCompleteEmoji: '✨',
	mustBonusGranted: (pts: number | string) => `+${pts}pt`,
} as const;

export const DEMO_ADMIN_HOME_LABELS = {
	planSwitcherAriaLabel: 'デモ用プラン切替',
	planSwitcherLabel: 'デモ: プランを切り替えて体験',
	freePlanButton: `${PLAN_FULL_TERMS.free}`,
	standardPlanButton: `⭐ ${PLAN_TERMS.standard}`,
	familyPlanButton: `⭐⭐ ${PLAN_TERMS.premium}`,
	statsActivityLabel: 'カスタム活動',
	statsChildLabel: 'こども',
	statsRetentionLabel: 'データ保持',
	trialCtaTitle: '7日間の無料体験',
	trialCtaDesc: 'スタンダードプランの全機能を7日間無料で体験できます。',
	trialCtaButton: 'プランを見る',
} as const;

export const SETUP_CHILDREN_LABELS = {
	pageTitle: '子供を登録しよう',
	pageDesc: 'がんばりクエストを使う子供を登録してください（1人以上）。',
	registeredTitle: (count: number) => `登録済み（${count}人）`,
	ageModeSuffix: 'モード',
	addFormTitle: '子供を追加',
	themeColorLabel: 'テーマカラー',
	themePink: 'ピンク',
	themeBlue: 'ブルー',
	submittingLabel: '登録中...',
	addButton: '追加する',
	nextButton: '次へ',
	backToHome: 'ホームに戻る',
	addSuccessMessage: '子供を登録しました！',
} as const;

export const ADMIN_CHILDREN_LABELS = {
	addButton: '+ こどもを追加',
	backToList: '← 一覧に戻る',
	statAgeLabel: '年齢',
	statAgeTierLabel: '年齢区分',
	statBalanceSuffix: '残高',
	statLevelLabel: 'レベル',
	statusTabEmpty: 'ステータス詳細は登録後にご覧いただけます',
	logsTabEmpty: '活動ログは登録後にご覧いただけます',
	achievementsTabEmpty: '実績一覧は登録後にご覧いただけます',
	voiceTabEmpty: 'おうえんボイスは登録後にご利用いただけます',
} as const;

/**
 * ActivityCreateForm / ActivityEditForm 用共有ラベル (#1465 Phase D)
 */
export const ACTIVITY_FORM_LABELS = {
	createTitle: '活動を追加',
	nameLabel: '活動名',
	namePlaceholder: '例: おさんぽ、ピアノれんしゅう',
	categoryLabel: 'カテゴリ',
	mainIconLabel: 'メインアイコン',
	directInputLabel: '直接入力:',
	subIconLabel: 'サブアイコン（任意）',
	subIconNoneOption: 'なし',
	previewLabel: 'プレビュー:',
	pointsLabel: 'ポイント',
	ageRangeLabel: '対象年齢（省略可）',
	ageMinAria: '最小年齢',
	ageMaxAria: '最大年齢',
	ageRangeSeparator: '〜',
	ageUnit: '歳',
	dailyLimitLabel: '1日の回数制限',
	dailyLimitHint: '「無制限」なら何回でも記録できます',
	nameKanaLabel: 'ひらがな表記（省略可）',
	nameKanaPlaceholder: '例: おかたづけした',
	nameKanaHint: '6歳未満の子供に表示する名前',
	nameKanjiLabel: '漢字表記（省略可）',
	nameKanjiPlaceholder: '例: お片付けをした',
	nameKanjiHint: '6歳以上の子供に表示する名前',
	triggerHintLabel: 'トリガーヒント（省略可）',
	triggerHintPlaceholder: '例: はみがきが終わったら押してね',
	triggerHintHint: 'カードに小さく表示される声かけ文（30文字以内）',
	createSubmitDefault: '活動',
	createSubmitSuffix: ' を追加する',
	// Edit-specific
	editNameLabel: '名前',
	editIconLabel: 'アイコン',
	editIconJoiner: '+',
	editIconSubPlaceholder: 'サブ',
	editPointsLabel: 'ポイント',
	editAgeMinLabel: '対象年齢（下限）',
	editAgeMaxLabel: '対象年齢（上限）',
	editAgePlaceholderNone: 'なし',
	editNameKanaLabel: 'ひらがな表記',
	editNameKanjiLabel: '漢字表記',
	editKanaPlaceholderOptional: '省略可',
	editTriggerHintLabel: '子供へのヒント（いつ押すか）',
	editTriggerHintPlaceholder: 'はみがきが終わったら押してね',
	editTriggerHintNote: 'カードの下に小さく表示されます（30文字まで）',
	editSaveButton: '保存',
	editDeleteButton: '削除',
	deleteHasLogsTitle: (count: number) => `この活動には ${count} 件の記録があります`,
	deleteHasLogsExplain:
		'記録を保護するため、完全削除ではなく「非表示」にします。非表示の活動は子供の画面に表示されなくなりますが、過去の記録はそのまま残ります。',
	deleteNoLogsConfirm: '本当に削除しますか？',
	deleteNoLogsExplain: 'この活動は完全に削除されます。この操作は取り消せません。',
	deleteHideButton: '非表示にする',
	deleteFullButton: '削除する',
	deleteCancelButton: 'キャンセル',
	deleteAutoHidMessage: '記録があるため非表示にしました',
} as const;

/**
 * marketplace 取込 feedback の type 横断共通 compound (#2955)
 *
 * partial-failure (一部保存失敗) の表示文言は 5 type (activities / rewards / checklists /
 * challenges / rules) で同一にする (DESIGN.md §10 NN/G #4 consistency)。
 * 各 admin page は `resolveImportFeedback()` ($lib/marketplace/ui/import-feedback) 経由で
 * 本 compound を既定参照する。
 */
export const MARKETPLACE_IMPORT_FEEDBACK_LABELS = {
	// #2818: 一部 (または全件) が保存できなかったとき正直に出す。
	//   「N 件登録しました」と偽らず、追加できた件数と保存できなかった件数を分けて表示する。
	partialFailure: (imported: number, failed: number) =>
		imported > 0
			? `${imported} 件を追加しましたが、${failed} 件は保存できませんでした`
			: '保存に失敗しました。もう一度お試しください',
} as const;

/**
 * admin/activities ページ用ラベル (#2362 PR-3 Phase 4)
 * 子供別タブ切替 + 兄弟共通化 UX (copy / 一括追加) の SSOT。
 */
export const ADMIN_ACTIVITIES_PAGE_LABELS = {
	// #3097 (EPIC #3096): 検索ラベルを SSOT 化 (旧 inline hardcoded `活動名で検索` を labels へ移管)
	searchLabel: '活動を検索',
	searchPlaceholder: '🔍 活動名で検索...',
	// 子供別タブ
	childTabsAriaLabel: `${CHILD_TERMS.honorific}を選択`,
	childCountSuffix: '件',
	// 兄弟共通化 actions
	copyFromChildButton: `📋 他の${CHILD_TERMS.neutral}から copy`,
	bulkCreateButton: '👨‍👩‍👧‍👦 一括追加',
	// 選択中 child banner
	childContextActivitiesSuffix: (count: number) => `の活動 (${count} 件)`,
	childContextHint: `タブを切り替えると、他の${CHILD_TERMS.honorific}の活動を表示します`,
	// copy dialog
	copyDialogTitle: `他の${CHILD_TERMS.honorific}から活動をコピー`,
	copyDialogDescPrefix: 'コピー元の',
	copyDialogDescSuffix: 'を選んでください (コピー先: ',
	copyDialogDescCloseParen: ')',
	copyDialogSelectedPlaceholder: '—',
	copyDialogAgeSuffix: '歳',
	copyDialogCountSuffix: '件',
	copyDialogEmpty: `他の${CHILD_TERMS.honorific}がいません`,
	copyDialogCancel: 'キャンセル',
	copyDialogConfirm: 'コピーする',
	// bulk dialog
	bulkDialogTitle: `複数の${CHILD_TERMS.honorific}に一括追加`,
	bulkFormName: '活動名',
	bulkFormPoints: 'ポイント',
	bulkFormCategory: 'カテゴリ',
	bulkFormIcon: 'アイコン (絵文字)',
	bulkTargetsLegend: `追加する${CHILD_TERMS.honorific}`,
	bulkTargetAll: '👨‍👩‍👧‍👦 全員に追加',
	bulkTargetChildAgeSuffix: '歳',
	bulkDialogCancel: 'キャンセル',
	bulkDialogConfirm: '追加する',
	// 取込ダイアログ後の result メッセージ (#2558: imported 件数で正直に出し分ける)
	importSuccess: (count: number) => `✨ ${count} 件の活動を追加しました`,
	// imported=0 (選んだ子に全て追加済み) — generic な「完了」で誤魔化さない
	importAllDuplicates: `選んだ${CHILD_TERMS.honorific}にはすでに追加済みです`,
	importFailed: '取込に失敗しました',
	importDemo: 'デモではお試し用です（実際の追加は行われません）',
	// #2818: 一部 (または全件) が保存できなかったとき正直に出す。
	// #2955: 文言の SSOT は MARKETPLACE_IMPORT_FEEDBACK_LABELS (3 admin page 横展開で共通化)。
	importPartialFailure: MARKETPLACE_IMPORT_FEEDBACK_LABELS.partialFailure,
	// Round 18 Cluster G (per-child scope badge): 英語内部語彙「per-child」UI 露出撤去 (ADR-0045 §9)
	// 「お子さま別」= per-child scope (個別 child に紐付く activity) を親向けに明示する短い表示
	scopeBadgePerChild: `${CHILD_TERMS.honorific}別`,
	// #2744 AC4 Delete UI (family scope): 一覧から活動を削除する確認 Dialog + 完了 Toast
	// #2754 Fix Round 1 B2: undo 経路不在の business risk を文言で明示
	// (ログ有 → 非表示で活動履歴は保全 / ログ無 → 物理削除でレコード復元不能)
	deleteBtn: '削除',
	deleteConfirmTitle: (name: string) => `${name} を削除しますか?`,
	deleteConfirmBody:
		'この操作は取り消せません。活動ログがある場合は「非表示」になり履歴は保全されますが、ログがない場合は完全に削除され復元できません。続行しますか?',
	deleteConfirmAction: '削除する',
	deleteCancel: 'キャンセル',
	deleteProcessing: '削除中...',
	deleteSuccess: '✨ 活動を削除しました',
	deleteFailed: '削除に失敗しました',
	// Round 18 Cluster J (#1870 評価 Round 3): family master activity の年齢適合フィルタ hint。
	// preschool 児童 context で「アルバイト」「大学受験」等 senior 向け activity が混在表示される
	// per-child scope 不整合を解消し、選択中 child の age に合う活動のみ既定表示する旨を明示。
	ageFilterAppliedHint: (name: string, age: number, visible: number, total: number) =>
		`${name}${CHILD_TERMS.honorific} (${age}歳) の年齢に合う ${visible} 件を表示中 (全 ${total} 件)`,
	ageFilterShowAll: '全件を表示',
	ageFilterBypassedHint: (name: string, age: number) =>
		`年齢フィルタ無効 (${name}${CHILD_TERMS.honorific} ${age}歳)。全 family scope activity を表示中`,
	ageFilterReapply: '年齢フィルタを再適用',
} as const;

/**
 * admin リソース画面の「選択中の子と操作対象」共通ラベル (#4692)
 *
 * 復元 / エクスポート / すべて削除 / 取込 は per-child 主軸 (ADR-0055、DESIGN.md §10) に従い
 * 「選択中の子」だけを対象にする。対象範囲を書かない確認文 (旧「本当に全削除しますか？」) や
 * 子供 0 人での空 dialog は「操作対象がどこか分からない」状態を作るため、
 * 3 画面 (活動 / ごほうび / チェックリスト) で同一文言を使う。
 */
export const ADMIN_CHILD_SCOPE_LABELS = {
	childRequired: `${CHILD_TERMS.honorific}を選んでください`,
	childNotFound: `指定された${CHILD_TERMS.honorific}が見つかりませんでした`,
	/** 子供 0 人で取込 URL (`?import=`) を開いたときの案内 (空 dialog の代わり) */
	noChildrenTitle: `まずは${CHILD_TERMS.honorific}を登録してください`,
	noChildrenDesc: `取り込み先の${CHILD_TERMS.honorific}がまだ登録されていません。登録すると、みんなのテンプレートを取り込めます。`,
	noChildrenCta: `${CHILD_TERMS.honorific}を登録する`,
	/** ︙「すべて削除」の確認文 — 対象の子と件数を必ず出す */
	clearAllScopedConfirm: (childName: string, count: number) =>
		`${childName}の活動 ${count} 件をすべて削除します（他の${CHILD_TERMS.honorific}の活動は消えません）`,
	/** 復元 / エクスポートの対象範囲を dialog / menu で明示する短い注記 */
	scopedToChildHint: (childName: string) => `対象: ${childName}のみ`,
} as const;

/**
 * 個別 backup/restore 共通ラベル (#3079、DESIGN.md §10 consistency)
 *
 * 活動 (ActivitiesHeader) と同型の「エクスポート」+「バックアップから復元」を、ごほうび・
 * チェックリストでも UX 同型に出すための共通ラベル SSOT。overflow menu item ラベル / アイコンは
 * OVERFLOW_MENU_TERMS atom を参照 (ADR-0045)。preview → 実行の 2 段フロー文言もここに集約する。
 *
 * resourceNoun は呼出側で渡す (「ごほうび」/「チェックリスト」)。同一概念を 2 箇所にハードコード
 * しないため、文を組み立てる関数は引数で resourceNoun を受け取る形にする。
 */
export const BACKUP_RESTORE_LABELS = {
	restoreLabel: OVERFLOW_MENU_TERMS.itemRestore,
	restoreIcon: OVERFLOW_MENU_TERMS.itemRestoreIcon,
	exportLabel: OVERFLOW_MENU_TERMS.itemExport,
	exportIcon: OVERFLOW_MENU_TERMS.itemExportIcon,
	restoreDialogTitle: `📥 ${OVERFLOW_MENU_TERMS.itemRestore}`,
	restoreDialogDesc: (resourceNoun: string) =>
		`以前書き出した${resourceNoun}の${BACKUP_TERMS.file}を読み込んで復元します。みんなのテンプレートの取り込みとは別の機能です。`,
	fileRequired: 'ファイルを選択してください',
	fileFallbackName: 'ファイル',
	checkButton: '内容を確認',
	checking: '確認中…',
	restoreSubmitBtn: '復元する',
	restoreProcessing: '復元中…',
	cancelButton: 'キャンセル',
	backButton: '選び直す',
	previewHeading: '復元する内容',
	previewSummary: (total: number, newItems: number, duplicates: number) =>
		`全 ${total} 件（新規 ${newItems} 件 / 既存のためスキップ ${duplicates} 件）`,
	previewAllDuplicates: (resourceNoun: string) => `この${resourceNoun}はすべて既に登録済みです`,
	restoreSuccess: (name: string, imported: number, skipped: number) =>
		skipped > 0
			? `✨ 「${name}」から ${imported} 件を復元しました (${skipped} 件は既存のためスキップ)`
			: `✨ 「${name}」から ${imported} 件を復元しました`,
	restoreAllDuplicatesResult: (name: string, resourceNoun: string) =>
		`「${name}」の${resourceNoun}はすべて既に登録済みです`,
	restoreFailed: '復元に失敗しました',
	exportFailed: 'エクスポートに失敗しました',
	exportEmpty: (resourceNoun: string) => `エクスポートする${resourceNoun}がありません`,
} as const;

/**
 * /admin/rewards (per-child UX 整備) 用ラベル (#2362 PR-4、ADR-0055)
 *
 * PR-3 の ADMIN_ACTIVITIES_PAGE_LABELS と同型 (子供別タブ + 兄弟共通化 + 取込ダイアログ)。
 * CHILD_TERMS atom を template literal で参照し ADR-0045 整合。
 */
export const ADMIN_REWARDS_PAGE_LABELS = {
	// 子供別タブ
	childTabsAriaLabel: `${CHILD_TERMS.honorific}を選択`,
	childCountSuffix: '件',
	// 兄弟共通化 actions
	copyFromChildButton: `📋 他の${CHILD_TERMS.neutral}から copy`,
	// 選択中 child banner
	childContextRewardsSuffix: (count: number) => `のごほうび (${count} 件)`,
	childContextHint: `タブを切り替えると、他の${CHILD_TERMS.honorific}のごほうびを表示します`,
	// copy dialog
	copyDialogTitle: `他の${CHILD_TERMS.honorific}からごほうびをコピー`,
	copyDialogDescPrefix: 'コピー元の',
	copyDialogDescSuffix: 'を選んでください (コピー先: ',
	copyDialogDescCloseParen: ')',
	copyDialogSelectedPlaceholder: '—',
	copyDialogAgeSuffix: '歳',
	copyDialogCountSuffix: '件',
	copyDialogEmpty: `他の${CHILD_TERMS.honorific}がいません`,
	copyDialogCancel: 'キャンセル',
	copyDialogConfirm: 'コピーする',
	// 取込ダイアログ後の result toast
	importSuccess: (count: number) => `✨ ${count} 件のごほうびを追加しました`,
	importAllDuplicates: 'このごほうびセットは既に追加済みです',
	importFailed: '取込に失敗しました',
	// #2558 bug-1: デモ環境では書き込みが no-op 化される。成功偽装せず明示する。
	importDemo: 'デモではお試し用です（実際の追加は行われません）',
	copySuccess: (count: number) => `📋 ${count} 件のごほうびをコピーしました`,
	copyFailed: 'コピーに失敗しました',
	copySameChild: `違う${CHILD_TERMS.honorific}を選んでください`,
	// 互換: importPresetId が無効な場合の guidance
	importInvalidPreset: '取込対象のプリセットが見つかりませんでした',
	// #4705: 無料プランで marketplace の取込 CTA から着地したとき (子供を選ばせる前に条件を出す)
	importLockedMessage: `${REWARD_TERMS.productRegistration}は${PLAN_FULL_TERMS.standard}以上でご利用いただけます`,
	// #2998 (EPIC #2897): ヘッダー + 「+ 追加」dropdown 統一 (activities / checklists と同型)。
	//   AI 提案パネル本文直置きを撤去し、dropdown 内の選択肢 (手動 / AI / みんなのテンプレートから探す)
	//   → Dialog 起動に統一する (DESIGN.md §10 add 経路 ≤ 4 / NN/G #4 consistency)。
	//   icon / 文言は activities header (FEATURES_LABELS.activitiesHeader.add*) と同一語彙で揃え、
	//   3 画面の add 経路構成 (種類・順序) 一致を E2E (admin-add-path-isomorphism.spec.ts) で固定する。
	headerDescription: '子供 shop に並べるごほうび（おこづかい・ゲーム時間・おやつなど）を管理します',
	addMenuButton: '+ 追加',
	addMenuAriaLabel: 'ごほうびを追加するメニューを開く',
	addManualLabel: '手動で1つ追加',
	addManualIcon: '✏️',
	addAiLabel: 'AI で提案してもらう',
	addAiIcon: '✨',
	addBrowseTemplatesLabel: `${TEMPLATE_TERMS.userFacing}から探す`,
	addBrowseTemplatesIcon: '🔍',
	// add dialog title (mode 別、activities の addDialogTitle* / checklists の addDialogTitleAi と同型)
	addDialogTitleManual: '+ 手動でごほうびを追加',
	addDialogTitleAi: 'AI で提案してもらう',
	// #2832: reward 一覧の編集 / 削除 (pending redemption ガード)
	rewardListEmpty: `この${CHILD_TERMS.honorific}にはまだごほうびがありません`,
	rewardEditButton: '編集',
	rewardDeleteButton: '削除',
	rewardPendingBadge: '交換申請 処理待ち',
	editDialogTitle: 'ごほうびを編集',
	// AC2 (案 b): 編集許容 + snapshot 仕様 (申請時点値) の明示 note
	editPendingNote: '申請済みの交換は申請時点の内容（名前・ポイント）で処理されます',
	editSaveButton: '保存する',
	editSavingButton: '保存しています…',
	editCancelButton: 'キャンセル',
	editSuccess: 'ごほうびを更新しました',
	editFailed: '更新に失敗しました',
	deleteDialogTitle: 'ごほうびを削除',
	deleteConfirmMessage: (title: string) => `「${title}」を削除しますか？`,
	deleteIrreversibleNote: 'この操作は取り消せません。このごほうびの交換履歴も削除されます。',
	deleteConfirmButton: '削除する',
	deleteDeletingButton: '削除しています…',
	deleteCancelButton: 'キャンセル',
	deleteSuccess: 'ごほうびを削除しました',
	deleteFailed: '削除に失敗しました',
	// AC1: pending redemption ガード (hasPendingByReward) の削除拒否メッセージ
	deletePendingBlocked:
		'交換申請が処理待ちのため削除できません。申請を承認または却下してから削除してください',
	// #3147: ショップ陳列系統 (physical/money/privilege) の登録時セレクト。
	// RewardCategory(6値) とは独立した「子供 shop の 3 タブ」のどれに並べるかの軸。
	// 未選択 (auto) のときは表示側 deriveShopCategory が title/icon から推定する。
	shopCategoryLabel: 'ショップの並び（タブ）',
	shopCategoryHint:
		'子供のごほうびショップでどのタブに並べるかを選べます（未選択なら自動で振り分け）',
	shopCategoryAuto: '自動で振り分け',
	shopCategoryPhysical: 'もの（おもちゃ・おやつなど）',
	shopCategoryMoney: 'おこづかい',
	shopCategoryPrivilege: 'とくべつ（ゲーム時間・おでかけなど）',
} as const;

/**
 * AdminHome ダッシュボード用ラベル (#1465 Phase D)
 */
export const ADMIN_HOME_LABELS = {
	pageTitle: `${ADMIN_VIEW_TERMS.canonical} - がんばりクエスト`,
	pageTitleDemoSuffix: ' デモ',
	// #3144: ごほうび交換の承認待ち導線バナー (pending > 0 のときのみ表示)
	pendingRedemptionBanner: (count: number) =>
		`${REWARD_TERMS.canonical}の交換申請が ${count} 件 承認待ちです。確認して受け渡しましょう`,
	// #3148: 承認待ち件数の取得に失敗したときの導線 (silent 非表示で見落とすのを防ぐ)
	pendingRedemptionLoadFailed: `${REWARD_TERMS.canonical}の承認待ち件数を取得できませんでした。交換申請の確認ページを開いてください`,
	heading: '管理ダッシュボード',
	headingDemoSuffix: '（デモ）',
	onboardingCompleteText: 'すべてのセットアップが完了しました！',
	onboardingDismissButton: '非表示にする',
	tutorialBannerTitle: '初めてご利用ですか？',
	tutorialBannerHint: 'チュートリアルで使い方を確認しましょう（約3分）',
	tutorialStartButton: '開始',
	tutorialLaterButton: 'あとで',
	// #3033: freePlanQuick* 削除済 (plan-quick-link 撤去、プラン導線は header upgrade-btn に一本化)
	// #2295 (EPIC #2294 ①): seasonalSectionTitle / memoryTicket* 削除済 (2026-05-19)
	summaryChildrenAria: '登録こども数',
	summaryChildrenLabel: 'こどもの数',
	summaryPointsAria: '全ポイント合計',
	summaryPointsTotalPrefix: '合計',
	monthLabel: (year: string, month: string) => `${year}年${month}月`,
	monthlyHeadingPrefix: '📊 ',
	monthlyHeadingSuffix: 'のがんばり',
	monthlyDetailsLink: '詳しく見る →',
	monthlyChildActivitiesAria: (name: string) => `${name}の活動回数`,
	monthlyChildLevelAria: (name: string) => `${name}のレベル`,
	monthlyChildAchievementsAria: (name: string) => `${name}の実績`,
	monthlyActivitiesHeading: '活動回数',
	monthlyActivitiesUnit: '回',
	monthlyLevelHeading: 'レベル',
	monthlyAchievementsHeading: '実績',
	monthlyAchievementsUnit: '獲得',
	todayUsageHeading: '⏱️ ',
	weeklyUsageHeading: '📈 ',
	childrenSectionTitle: 'こども一覧',
	childrenEmpty: 'まだこどもが登録されていません',
	demoCtaTitle: 'いかがでしたか？',
	demoCtaHint: 'お子さまの「がんばり」を冒険に変えませんか？',
	demoCtaButton: '無料で はじめる →',
} as const;

/**
 * DowngradeResourceSelector ダイアログ用ラベル (#1465 Phase D)
 */
export const DOWNGRADE_RESOURCE_SELECTOR_LABELS = {
	dialogTitle: 'ダウングレードの確認',
	targetTierSuffix: 'へのダウングレード',
	retentionUnlimited: '無制限',
	/**
	 * 保持期間短縮の警告文 (#4482)。
	 *
	 * 以前は接頭辞 / 接尾辞の断片を svelte 側で `${days}日` と繋いで組み立てていたため、
	 * 保持日数を 365 の倍数に変えるとここだけ「365日」と述べ、料金表の「1年」と食い違った。
	 * 文の組み立てごと本 compound に集約し、日数の整形は formatRetentionPeriod に委ねる。
	 *
	 * `PlanLimits.historyRetentionDays` は `number | null` なので両引数とも null を受ける
	 * (null の整形は formatRetentionPeriod が「無期限」として担う)。
	 *
	 * #4528: 後段は「閲覧できなくなります」と述べていたが、実装
	 * (`server/services/retention-cleanup-service.ts`) は `recorded_date < cutoffDate` の
	 * 活動ログ・ポイント台帳・ステータス履歴を**行ごと削除する**。復元手段は無く、
	 * 上位プランに戻しても戻らない。ダウングレード確認画面は顧客が不可逆な結果を
	 * 自分の操作で確定させる直前の地点なので、婉曲化すると「あとで戻せば見られる」と
	 * 誤解したままデータを失う。#4496 (LP・特商法) / #4507 (メール) で確定した強さ
	 * 「削除され、復元できません（再契約でも戻りません）」と同一表現で述べ切る。
	 *
	 * @param currentDays 現プランの保持日数 (null = 無制限)
	 * @param targetDays  ダウングレード先の保持日数 (null = 無期限)
	 */
	retentionWarning: (currentDays: number | null, targetDays: number | null) => {
		const current = currentDays === null ? '無制限' : formatRetentionPeriod(currentDays);
		const target = formatRetentionPeriod(targetDays);
		return `データ保持期間が${current}から${target}に短縮されます。${target}を超えた記録は削除され、復元できません（再契約でも戻りません）。`;
	},
	excessTitlePrefix: '現在のリソースが',
	excessTitleSuffix: 'の上限を超えています',
	excessGuide:
		'ダウングレード先の上限に合わせて、アーカイブするリソースを選択してください。アーカイブされたデータはアップグレード時に復元できます。',
	childrenSectionTitle: (current: number, max: number | null) =>
		`子供（${current}人 → 上限 ${max ?? '無制限'}人）`,
	childrenSectionGuide: (excess: number, archived: number) =>
		`${excess}人分をアーカイブしてください（選択: ${archived}/${excess}）`,
	archiveLabel: 'アーカイブ',
	keepLabel: '残す',
	childRemainingHint: (remaining: number) => `あと${remaining}人分を選択してください`,
	activitiesSectionTitle: (current: number, max: number | null) =>
		`活動（${current}個 → 上限 ${max ?? '無制限'}個）`,
	activitiesSectionGuide: (excess: number, archived: number) =>
		`${excess}個分をアーカイブしてください（選択: ${archived}/${excess}）`,
	activityRemainingHint: (remaining: number) => `あと${remaining}個分を選択してください`,
	checklistsSectionTitle: (max: number | null) =>
		`チェックリストテンプレート（1子あたり上限 ${max ?? '無制限'}個）`,
	checklistsChildGuide: (childName: string, excess: number, archived: number) =>
		`${childName}: ${excess}個分をアーカイブ（選択: ${archived}/${excess}）`,
	restoreNote:
		'アーカイブされたデータは削除されません。再度アップグレードすることで完全に復元できます。',
	cancelButton: 'キャンセル',
	archivingLabel: 'アーカイブ中…',
	archiveAndProceedButton: 'アーカイブしてプラン変更へ進む',
	processingLabel: '処理中…',
	proceedButton: 'プラン変更へ進む',
	loadingLabel: '読み込み中...',
} as const;

/**
 * ChildProfileCard / ChildProfileCard 編集モード用ラベル (#1465 Phase D)
 */
export const CHILD_PROFILE_CARD_LABELS = {
	// Edit mode
	editingBadge: '編集中',
	avatarSectionTitle: 'プロフィール写真',
	avatarUploadButton: '📷 写真を変更',
	avatarNetworkError: 'ネットワークエラーが発生しました',
	avatarFileSizeError: (sizeMB: string) =>
		`ファイルサイズが大きすぎます（${sizeMB}MB）。5MB以下の画像を選択してください`,
	avatarServerError: 'サーバーエラーが発生しました。5MB以下のJPEG/PNG/WebPを選択してください',
	avatarUploadFailed: 'アップロードに失敗しました',
	avatarUploadSuccess: '写真をアップロードしました',
	basicInfoTitle: '基本情報',
	nicknameLabel: 'ニックネーム',
	ageLabel: '年齢',
	ageAutoCalcSuffix: '（自動計算）',
	themeColorLabel: 'テーマカラー',
	birthdayBonusTitle: '🎂 おたんじょうびボーナス',
	birthdayBonusNote: '※ ボーナス倍率の変更は別途保存されます',
	saveButton: '💾 保存',
	cancelButton: 'キャンセル',
	multiplierLabel: '倍率',
	multiplierApplyButton: '適用',
	bonusFormulaPreview: (age: number, multiplier: number) =>
		`→ ${age}歳 × 100pt × ${multiplier}倍 = ${Math.round(age * 100 * multiplier)}pt`,
	deleteConfirmText: 'この子供を本当に削除しますか？',
	deleteConfirmButton: '本当に削除',
	deleteCancelButton: 'やめる',
	deleteOpenButton: '🗑 この子供を削除',
	editButton: '✏️ 編集',
	// Tabs
	tabInfo: '📋 基本情報',
	tabStatus: '📊 ステータス',
	tabLogs: '📝 活動記録',
	tabAchievements: '🏆 実績',
	tabVoice: '📢 ボイス',
	// Info tab
	infoAgeUnit: '歳',
	infoAgeLabel: '年齢',
	infoUiModeLabel: 'UIモード',
	infoBalanceSuffix: '残高',
	infoLogCountLabel: '累計記録数',
	// Status tab
	statusUpdateSuccess: 'ステータスを更新しました',
	statusEmpty: 'ステータスデータがありません',
	statusXpUnit: 'XP',
	statusLevelPrefix: '(Lv.',
	statusLevelSuffix: ')',
	statusSaveButton: '保存',
	// Logs tab
	logsEmpty: '活動記録がありません',
	// Achievements tab
	achievementsEmpty: '実績がありません',
	// Voice tab
	voiceHint: '録音または音声ファイルを登録すると、活動完了時にお子さんに再生されます。',
	voiceRecorderTitle: '🎤 録音する',
	voiceRecordingPrefix: '● 録音中 ',
	voiceRecordingSuffix: '秒 / 10秒',
	voiceStopButton: '■ 停止',
	voiceCancelRecording: '取消',
	voiceStartButton: '● 録音開始（最大10秒）',
	voiceUploadTitle: '📁 ファイルからアップロード',
	voiceLabelLabel: 'ラベル',
	voiceLabelPlaceholder: 'ラベル（例: お母さんの声）',
	voiceUploading: 'アップロード中...',
	voiceSaveButton: '💾 保存',
	voiceUseRecordingNote: '✅ 録音データを使用します',
	voiceListTitle: (count: number) => `登録済み（${count}件）`,
	voiceActiveIndicator: '●',
	voiceInactiveIndicator: '○',
	voiceActivateButton: '有効化',
	voiceDeleteButton: '削除',
	voiceEmpty: 'ボイスが登録されていません。録音またはファイルアップロードで追加できます。',
	voicePriorityNote: '※ 有効なボイスが設定されている場合、ショップの効果音よりも優先されます。',
	// Header
	headerAgeTierSeparator: '歳 / ',
	headerBirthdayPrefix: '🎂 ',
} as const;

export const DEMO_REPORTS_LABELS = {
	pageTitle: '📊 週間レポート',
	reportTitleSuffix: '週間レポート',
	statActivityLabel: '活動',
	statActivityUnit: '回',
	statPointLabel: 'ポイント',
	statAchievementLabel: '実績',
	statAchievementUnit: '獲得',
	highlightTitle: '🏆 今週のハイライト',
	categoryTitle: '📈 カテゴリ別の様子',
	adviceTitle: '💡 アドバイス',
} as const;

export const ADMIN_CHILDREN_PAGE_LABELS = {
	pageTitle: '👧 こども管理',
	// #4546 ③: 仮アバターの作り直しをレースで見送ったときの通知 (ADR-0062 §1「一時的・回復可能」= Toast)。
	// 「失敗」ではなく「写真を優先した」正常な結果なので、責めず・次にどうすればよいかまで書く。
	placeholderAvatarSkippedTitle: 'アバターはそのままです',
	placeholderAvatarSkippedDesc:
		'編集中に写真がアップロードされたため、写真をそのまま残しました。頭文字のアバターに戻すには、写真を削除してください。',
	limitBannerTitle: 'こどもの登録上限に達しています',
	limitBannerDesc: (current: number, max: number) => `現在 ${current}人 / 最大 ${max}人。`,
	limitUpgradeLink: '🚀 プランをアップグレードする →',
	cancelButton: 'キャンセル',
	limitReachedButton: '上限に達しています',
	addFormTitle: 'こどもを追加',
	nicknameLabel: 'ニックネーム',
	birthdayHint: '設定すると年齢が自動計算されます',
	themeColorLabel: 'テーマカラー',
	addButton: '追加する',
	ageLabel: '年齢',
	ageLabelAutoCalc: '年齢（誕生日から自動計算）',
	agePlaceholder: '4',
	birthdayOrAgeRequired: '誕生日または年齢を入力してください',
	ageRange: '0〜18で入力してください',
} as const;

// #2362 PR-7 (ADR-0055、User §6): per-child challenge instance + 兄弟連動 UI
export const ADMIN_CHALLENGES_PAGE_LABELS = {
	// 兄弟連動比較 UI (SiblingChallengeComparison.svelte)
	siblingComparisonHeading: 'きょうだいの進捗',
	siblingComparisonAllCompleted: 'みんな達成',
	siblingComparisonAllCompletedMessage:
		'きょうだい全員で達成しました。お子さまの努力を一緒に認めてあげましょう。',
	// 子供別タブ
	childTabAllLabel: 'すべて',
	childTabAllAriaLabel: 'すべてのお子さま',
	// 一括追加 / cross-child copy
	bulkAddAction: '全員にこのチャレンジを追加',
	copyFromOtherChildAction: '他のお子さまから取り込む',
	copyConfirmTitle: (sourceName: string, targetCount: number) =>
		`${sourceName}のチャレンジを ${targetCount} 人にコピーしますか？`,
	copyCompletedMessage: (copiedCount: number) => `${copiedCount} 件のチャレンジをコピーしました。`,
	// 一括追加 完了通知 (#2362 PR-7)
	bulkCreatedMessage: (createdCount: number) => `${createdCount} 件のチャレンジを追加しました。`,
	// per-child empty state
	perChildEmptyTitle: 'このお子さまのチャレンジはまだありません',
	perChildEmptyDesc: 'みんなのテンプレートから取り込むか、新規作成してください',
	// #3195: アプリ自動生成への一本化 (親手動作成撤去、読み取り専用ビュー)
	autoGeneratedDesc:
		'チャレンジはアプリが毎週自動で用意します。お子さまの記録の傾向にあわせて、苦手なことや得意なことを伸ばす目標が届きます。',
	autoGeneratedEmptyDesc: 'お子さまがアプリを開くと、今週のチャレンジが自動で用意されます。',
	// #2554 follow-up CUJ-CH2 完全化: marketplace 取込 → ChildSelectionDialog auto-open → 確定 result toast
	// (admin-rewards / admin-activities と同型 pattern、ADR-0055 per-child + family-only gate 整合)
	importSuccess: (count: number) => `✨ ${count} 件のチャレンジを追加しました`,
	importAllDuplicates: 'このチャレンジ集は既に追加済みです',
	importFailed: '取込に失敗しました',
	// #2558 bug-1 整合: デモ環境では書き込みが no-op 化される。成功偽装せず明示する。
	importDemo: 'デモではお試し用です（実際の追加は行われません）',
	importInvalidPreset: '取込対象のプリセットが見つかりませんでした',
	// #4023 横展開: 削除確認。旧実装は onsubmit + preventDefault で、キャンセルしても
	// use:enhance 側の submit listener が走り削除が通っていた (admin/settings/rules と同型)。
	deleteConfirmTitle: 'このチャレンジを削除しますか？',
	deleteConfirmBody: (challengeTitle: string, childName: string) =>
		`「${challengeTitle}」（${childName}）を削除します。削除すると、このお子さまの今の進捗も一緒に消えます。`,
} as const;

export const CERTIFICATES_PAGE_LABELS = {
	pageTitle: '📜 がんばり証明書',
	backToReportsLink: 'レポートへ',
	freePlanNotePrefix: `${PLAN_FULL_TERMS.free}では証明書の閲覧のみ可能です。PDF保存は`,
	freePlanNoteLink: `${PLAN_FULL_TERMS.standard}以上`,
	freePlanNoteSuffix: 'で利用できます。',
	emptyTitle: 'まだ証明書がありません',
	emptyDesc: '活動を記録すると、マイルストーン達成時に証明書が発行されます',
	noChildrenTitle: '子供が登録されていません',
} as const;

export const PACKS_PAGE_LABELS = {
	// Round 18 Cluster A (ADR-0045): 活動パック → TEMPLATE_TERMS atom 経由
	pageTitle: TEMPLATE_TERMS.userFacing,
	pageDesc:
		'年齢に合わせた活動セットをインポートできます。同じ名前の活動は自動的にスキップされます。',
	recommendedBadge: 'おすすめ',
	importedBadge: 'インポート済',
	partiallyImportedSuffix: '件 登録済',
	activityCountSuffix: '件の活動',
	importingLabel: 'インポート中...',
	importButton: (count: number) => `${count}件の新しい活動をインポート`,
	// #1758 (#1709-D): must 推奨採用チェックボックス
	mustDefaultCheckboxLabel: '「今日のおやくそく」推奨を採用する',
	mustDefaultCheckboxHint: `歯みがき・お片付け・宿題などのおやくそく候補が、優先度「今日のおやくそく」として登録されます。あとで${ADMIN_VIEW_TERMS.parent}から個別に変更できます。`,
	mustDefaultBadge: 'おやくそく推奨',
	mustDefaultCount: (count: number) => `おやくそく推奨 ${count}件`,
} as const;

export const OPS_LAYOUT_LABELS = {
	headerTitle: 'がんばりクエスト 運営ダッシュボード',
	navKpi: 'KPI',
	navRevenue: '収益',
	navBusiness: '採算性',
	navCosts: '費用',
	navLicense: 'ライセンス',
	navAnalytics: '分析',
	navCohort: 'コホート',
	navPmfSurvey: 'PMF',
	navExport: 'エクスポート',
} as const;

export const SETUP_QUESTIONNAIRE_LABELS = {
	pageTitle: '📋 かんたんアンケート',
	pageDesc: 'お子さまに合った設定を自動でご用意します',
	// #1592 (ADR-0023 I4): 6→3 簡素化 — 親が「使い始めたいけど何ができるかわからない」を解消
	q1Legend: 'Q1. お子さまの課題は？（いくつでも）',
	// 新 3 軸の選択肢ラベル
	challengeHomeworkDaily: '毎日宿題をやらせたい',
	challengeChores: '家事をやらせたい',
	challengeBeyondGames: 'ゲーム以外のことに興味を惹かせたい',
	q2Legend: 'Q2. 1にちに どれくらい きろくする？',
	activityLevelFewLabel: 'すこしずつ（3〜5こ）',
	activityLevelFewDesc: 'はじめてでも むりなく',
	activityLevelNormalLabel: 'ふつう（5〜10こ）',
	activityLevelNormalDesc: 'おすすめ',
	activityLevelManyLabel: 'たくさん（10こ いじょう）',
	activityLevelManyDesc: 'いろいろ きろくしたい',
	recommendedBadge: 'おすすめ',
	q3Legend: 'Q3. チェックリストを自動作成する？',
	q3Hint: 'えらんだリストが自動で作成されます（あとから変更できます）',
	// プリセットラベル（チェックリスト一覧用）
	presetMorningRoutine: 'あさのしたく',
	presetEveningRoutine: 'よるのじゅんび',
	presetAfterSchool: 'がっこうからかえったら',
	presetWeekendChores: 'しゅうまつのおてつだい',
	presetBeyondGames: 'ゲームいがいのチャレンジ',
	submittingLabel: 'せっていちゅう...',
	startButton: 'この設定ではじめる！',
	skipButton: 'あとで設定する（スキップ）',
} as const;

export const CHILD_STATUS_LABELS = {
	growthChartTitle: 'せいちょうチャート',
	growthBestCatPrefix: '💬 ',
	growthBestCatSuffix: 'が',
	growthHighMessage: 'すごくのびたね！',
	growthLowMessage: 'ちょっとずつ せいちょうしてるよ！',
	growthStableMessage: '💬 あんていしてるね！ またがんばろう！',
	growthWeakCatPrefix: '🌟 ',
	growthWeakCatSuffix: 'にチャレンジすると のびしろがたくさん！',
	emptyStatus: 'ステータスがまだないよ',
} as const;

export const AUTH_INVITE_LABELS = {
	appTitle: 'がんばりクエスト',
	invalidLink: 'この招待リンクは無効または期限切れです。',
	invalidLinkDesc: '招待した方に新しいリンクを発行してもらってください。',
	loginPageLink: 'ログインページへ',
	// #4049: 家庭内共有端末 (親の端末で子の招待リンクを踏む) の正しい次アクションを案内する。
	// #0203 の残留防止でログアウト時に招待 Cookie が消えるため、ログアウト後は
	// 「招待リンクをもう一度タップする」必要がある。これを明示しないと、そのまま
	// /auth/signup に進んで新規家族グループの owner になってしまう。
	alreadyInTenant: '既に別のグループに所属しているため、この招待を受けることはできません。',
	alreadyInTenantDesc: `${CHILD_TERMS.hiragana}用のアカウントを新しく作る場合は、一度ログアウトしてから、招待リンクをもう一度タップしてください。`,
	// #4049 AC3: ログイン中に出るエラー画面の主導線 (「ログインページへ」だけを出口にしない)
	logoutButton: 'ログアウトする',
	inviteMessage: '家族グループへの招待が届いています。',
	roleLabel: '参加ロール:',
	// 招待の参加ロール表示 (内部コード role を露出しない、DESIGN.md §6)
	roleParent: PARENT_TERMS.honorific,
	roleChild: CHILD_TERMS.hiragana,
	signupButton: '新規アカウントを作成して参加',
	loginButton: '既存アカウントでログインして参加',
	// #3555 ①: 招待 email 束縛 (#3549 判断2) の不一致を顧客向けに案内する文言。
	// 英語エラーコード (INVITE_EMAIL_MISMATCH) を露出せず、次アクションを必ず添える。
	emailMismatch: 'この招待は別のメールアドレス宛です。',
	emailMismatchDesc: '招待した方に、あなたのメールアドレス宛の招待を発行し直してもらってください。',
	// #3555 ①: 受諾失敗 → 新規家族グループ自動作成後に admin 画面で表示する案内バナー
	acceptErrorMismatchBanner:
		'招待は別のメールアドレス宛だったため参加できず、新しい家族グループが作成されました。招待で参加するには、招待した方にあなたのメールアドレス宛の招待を発行し直してもらってください。',
	acceptErrorUnverifiedBanner:
		'メールアドレスの確認が完了していないため招待を受諾できず、新しい家族グループが作成されました。メールアドレスの確認後、招待した方に新しい招待を発行してもらってください。',
	// #4633 AC-A: email 束縛以外の受諾拒否も、同じく無音で「新しい家族グループの owner」に
	// 化ける。理由ごとに「なぜ参加できなかったか + 次アクション」を必ず添える。
	acceptErrorExpiredBanner:
		'招待の有効期限が切れていたため参加できず、新しい家族グループが作成されました。招待した方に、新しい招待リンクを発行してもらってください。',
	acceptErrorTenantNotFoundBanner:
		'招待元の家族グループが現在ご利用できない状態のため参加できず、新しい家族グループが作成されました。招待した方に、お支払い状況をご確認のうえ改めて招待を発行してもらってください。',
	acceptErrorAlreadyInTenantBanner:
		'すでに別の家族グループに参加しているため招待を受けられず、新しい家族グループが作成されました。招待で参加するには、一度ログアウトして別のアカウントで招待リンクを開いてください。',
	acceptErrorSelfInviteBanner:
		'ご自身が発行した招待は受け取れないため参加できず、新しい家族グループが作成されました。参加する方ご本人のアカウントで招待リンクを開いてください。',
	acceptErrorOwnerDowngradeBanner:
		'すでにこの家族グループの管理者のため招待を受けられず、新しい家族グループが作成されました。管理者のまま参加を続ける場合、この招待は受け取る必要はありません。',
	acceptErrorGenericBanner:
		'招待を受け取れなかったため、新しい家族グループが作成されました。招待した方に、招待リンクを発行し直してもらってください。',
} as const;

/**
 * #4633 AC-A: 受諾拒否理由 → 案内バナー文言の対応表 (SSOT)。
 * 理由の一覧は `INVITE_ACCEPT_ERROR_REASONS` (`$lib/domain/validation/auth`) 側が持つ。
 */
export const INVITE_ACCEPT_ERROR_BANNERS = {
	INVITE_EMAIL_MISMATCH: AUTH_INVITE_LABELS.acceptErrorMismatchBanner,
	INVITE_EMAIL_UNVERIFIED: AUTH_INVITE_LABELS.acceptErrorUnverifiedBanner,
	INVALID_OR_EXPIRED: AUTH_INVITE_LABELS.acceptErrorExpiredBanner,
	TENANT_NOT_FOUND: AUTH_INVITE_LABELS.acceptErrorTenantNotFoundBanner,
	ALREADY_IN_TENANT: AUTH_INVITE_LABELS.acceptErrorAlreadyInTenantBanner,
	SELF_INVITE_NOT_ALLOWED: AUTH_INVITE_LABELS.acceptErrorSelfInviteBanner,
	OWNER_CANNOT_BE_DOWNGRADED: AUTH_INVITE_LABELS.acceptErrorOwnerDowngradeBanner,
} as const;

/** 未知の理由 (古い cookie / 想定外) は汎用文言にフォールバックする。 */
export function getInviteAcceptErrorBanner(reason: string): string {
	return (
		(INVITE_ACCEPT_ERROR_BANNERS as Record<string, string>)[reason] ??
		AUTH_INVITE_LABELS.acceptErrorGenericBanner
	);
}

// DEMO_ACHIEVEMENTS_LABELS: 実績機能廃止 (#1782 / #1816) で参照ゼロのため namespace 削除 (#1833)

export const DEMO_LAYOUT_LABELS = {
	backToHpLink: 'HPに戻る',
	demoNotice: 'これはデモです。データは保存されません。',
	tryRealButton: '本番で使ってみる',
	planSwitcherLabel: 'プラン体験:',
	floatingCtaTitle: 'お子さまの ぼうけん、はじめよう！',
	floatingCtaDesc: `7日間無料・いつでも${CANCEL_TERMS.canonical}OK`,
	floatingCtaButton: '無料で はじめる →',
} as const;

export const SETUP_PACKS_LABELS = {
	// Round 18 Cluster A (ADR-0045): かつどうパック → TEMPLATE_TERMS atom 経由
	pageTitle: `${TEMPLATE_TERMS.userFacing}をえらぼう`,
	pageDesc: 'お子さまの年齢にあわせた活動セットを選んでください。あとから追加・変更できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: `おすすめ${TEMPLATE_TERMS.short}を自動で追加してすすむ`,
	backButton: 'もどる',
	importingLabel: 'インポート中...',
	addPacksButton: (count: number) => `${count}件のパックを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'おすすめで次へ',
	// #1758 (#1709-D): must 推奨採用チェックボックス（setup フロー版）
	mustDefaultCheckboxLabel: '「今日のおやくそく」推奨を採用する',
	mustDefaultCheckboxHint:
		'歯みがき・お片付け・宿題などのおやくそく候補が、優先度「今日のおやくそく」として登録されます。',
	mustDefaultBadge: 'おやくそく推奨',
} as const;

// #2140 MP-5: setup wizard β step 2「ごほうび一括追加」labels
export const SETUP_REWARDS_LABELS = {
	pageTitle: 'ごほうびセットをえらぼう',
	pageDesc:
		'お子さまのモチベーションになるごほうびを一括で追加できます。あとから追加・変更できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: 'おすすめセットを自動で追加してすすむ',
	backButton: 'もどる',
	importingLabel: 'インポート中...',
	addRewardsButton: (count: number) => `${count}件のセットを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'スキップして次へ',
	childPickerLabel: 'どのお子さまに追加しますか？',
	rewardsCountSuffix: '件のごほうび',
	emptyChildrenNotice: 'お子さまが登録されていないため、このステップはスキップされます。',
} as const;

// #2140 MP-5: setup wizard β step 3「ルール一括追加」labels
export const SETUP_RULES_LABELS = {
	pageTitle: 'おうちのルールをえらぼう',
	pageDesc:
		'家族のがんばりを応援するボーナスルールや交換ルールを一括で追加できます。あとから追加・変更できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: 'おすすめルールを自動で追加してすすむ',
	backButton: 'もどる',
	importingLabel: 'インポート中...',
	addRulesButton: (count: number) => `${count}件のルールを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'スキップして次へ',
	childPickerLabel: '交換ルールを追加するお子さま（任意）',
	childPickerNone: '選択しない（ボーナスルールのみ追加）',
	rulesCountSuffix: '件のルール',
	ruleTypeBonus: 'ボーナス',
	ruleTypeExchange: '交換',
	ruleTypePenalty: 'ペナルティ（取込未対応）',
	ruleTypeSpecial: 'スペシャル（取込未対応）',
	bonusOnlyNotice:
		'ボーナスルールは家族全体に適用されます。交換ルールはお子さまごとのごほうびとして登録されます。',
} as const;

// #2298 (EPIC #2294 ④): setup wizard β step 4「家族チャレンジ一括追加」labels
// 任意 step、auto-add 3 件 + 残 4 件は手動 import 動線。Research §5.1 onboarding 整合
/**
 * #2322 (EPIC #2319 ③): setup 任意 step「活動・ポイントの初期設定」用ラベル。
 * マーケプレ rule-preset 集約 (PO 提案) の Research 否定の代替案 A — sensible defaults を hard-code。
 */
export const SETUP_ACTIVITIES_DEFAULTS_LABELS = {
	pageTitle: '活動・ポイント設定の初期値',
	pageDesc:
		'おすすめの初期設定をワンタップで適用できます。あとから /admin/settings/activities でいつでも変更できます。',
	infoNotice:
		'これらの初期値はあくまでスタート地点です。家族の使い方に合わせて、あとから自由に変更できます。',
	defaultsSummaryTitle: '適用される初期設定',
	defaultDecayLabel: 'ステータス減少: ふつう（最初の2日は減少しません）',
	defaultPointModeLabel: 'ポイント表示: 「P」（あとで通貨換算も選べます）',
	defaultSiblingModeLabel: 'きょうだいチャレンジ: 協力（家族みんなで取り組みます）',
	defaultSiblingRankingLabel: 'きょうだいランキング: OFF（family プランで ON 可能）',
	applyButton: 'おすすめ初期値を適用してすすむ',
	applyingLabel: '適用中...',
	skipButton: 'スキップして次へ',
	backButton: 'もどる',
	applySuccessNotice: 'おすすめ初期値を適用しました',
} as const;

export const SETUP_CHALLENGES_LABELS = {
	pageTitle: '家族で挑戦するチャレンジを選ぼう',
	pageDesc:
		'家族みんなで取り組むチャレンジを一括で追加できます。スキップしても、あとから管理画面で追加できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: 'おすすめ 3 件を自動で追加してすすむ',
	backButton: 'もどる',
	importingLabel: '取込中...',
	addChallengesButton: (count: number) => `${count}件のチャレンジを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'スキップして次へ',
	challengesNotice: '家族全員で協力するチャレンジです。クリアすると家族みんなに点数が配られます。',
	noticeNoChildren: 'お子さまが登録されていないため、このステップはスキップされます。',
	targetSuffix: '回',
	rewardSuffix: 'P',
	periodFormat: (start: string, end: string): string => `期間: ${start} 〜 ${end}`,
	previewToggleOpen: '▼ なかみ',
	previewToggleClose: '▲ とじる',
} as const;

export const PARENT_LOGIN_LABELS = {
	backLink: 'もどる',
	pageTitle: 'おとうさん・おかあさんの',
	pageTitleLine2: 'ページだよ',
	pageDescLine1: 'ここから先はおとうさん・おかあさんに',
	pageDescLine2: 'ひみつのばんごうを入れてもらってね',
	pinInputAriaLabel: 'おやカギコード入力状態',
} as const;

export const VIEW_PAGE_LABELS = {
	appTitle: 'がんばりクエスト',
	viewOnlyNotice: '閲覧専用リンク',
	emptyChildren: 'まだ お子さまが とうろくされていません',
	statPointLabel: 'ポイント',
	statLevelLabel: 'そうごうレベル',
	footerText: 'がんばりクエスト — こどもの がんばりを みんなで おうえん',
	// #4703: 無効 / 期限切れ token 専用の説明。汎用 404「ページが みつかりません」だと
	// リンクを共有された人 (祖父母等) が「自分の操作を間違えた」と受け取ってしまう。
	invalidTokenTitle: 'このリンクは無効か、期限切れです',
	invalidTokenDesc: `リンクの有効期限が切れたか、共有した${PARENT_TERMS.honorific}が無効にした可能性があります。共有元の${PARENT_TERMS.honorific}に新しいリンクの発行を依頼してください。`,
} as const;

export const DEMO_BATTLE_LABELS = {
	pageTitle: '⚔️ きょうの バトル',
	startButton: 'バトル かいし！',
	demoNotice: '（デモモード：データは保存されません）',
	signupLink: 'お子さまの名前で はじめる →',
	replayButton: 'もういちど あそぶ',
	loadErrorMessage: 'バトルじょうほうを よみこめませんでした',
} as const;

/**
 * チェックリスト画面の文言 (年齢帯 variant)。
 *
 * #4509 ④/⑥: 以前は 1 セットのひらがな文言しか無く、13-18 歳がナビの「持ち物チェック」(漢字)
 * から遷移すると「にちようび」「おやにおねがいしてね」という幼児文体に着地していた。
 * 曜日名 7 件 / 時間帯 4 件も画面側に直書きされていた。
 *
 * 年齢帯の出し分けは `getChildChecklistLabels({ ageTier })` 経由に集約する
 * (`src/routes/CLAUDE.md` §年齢帯 variant: 画面側に `if (uiMode === ...)` を散らさない)。
 * 分割は MODE_VARIANTS (child-home) と同じ baby/preschool = ひらがな、
 * elementary 以上 = 漢字。
 */
interface ChildChecklistTextVariant {
	todayPrefix: string;
	nowPrefix: string;
	nowSuffix: string;
	emptyTitle: string;
	emptyDesc: string;
	completedAll: string;
	checkForPoints: string;
	completeTitle: string;
	completeMsg: string;
	completeButton: string;
	/** 曜日名 (index 0 = 日曜)。JST SSOT (`jstDayOfWeek()`) の戻り値で引く */
	dayNames: readonly string[];
	/** 時間帯ラベル (checklist.timeSlot の値で引く) */
	timeSlotLabels: Readonly<Record<string, string>>;
}

const CHILD_CHECKLIST_HIRAGANA: ChildChecklistTextVariant = {
	todayPrefix: 'きょうは',
	nowPrefix: 'いまは',
	nowSuffix: 'のじかん',
	emptyTitle: 'チェックリストがないよ',
	emptyDesc: 'おやにおねがいしてね',
	completedAll: '🎉 ぜんぶできた！',
	checkForPoints: 'ぜんぶチェックしたら',
	// #2196: backButton 撤廃 — BottomNav と動線重複 + 他 child タブ (achievements / battle / history / status / shop) 統一性
	completeTitle: 'ぜんぶできたよ！',
	completeMsg: 'わすれものなし！すごい！',
	completeButton: 'やったね！',
	dayNames: [
		'にちようび',
		'げつようび',
		'かようび',
		'すいようび',
		'もくようび',
		'きんようび',
		'どようび',
	],
	timeSlotLabels: {
		morning: 'あさ',
		afternoon: 'ひる',
		evening: 'よる',
		anytime: 'いつでも',
	},
};

const CHILD_CHECKLIST_KANJI: ChildChecklistTextVariant = {
	todayPrefix: '今日は',
	nowPrefix: '今は',
	nowSuffix: 'の時間',
	emptyTitle: 'チェックリストがありません',
	emptyDesc: 'おうちの人に追加してもらおう',
	completedAll: '🎉 全部できた！',
	checkForPoints: '全部チェックしたら',
	completeTitle: '全部できた！',
	completeMsg: '忘れ物なし！すごい！',
	completeButton: 'やったね！',
	dayNames: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
	timeSlotLabels: {
		morning: '朝',
		afternoon: '昼',
		evening: '夜',
		anytime: 'いつでも',
	},
};

/** 時間帯アイコン。年齢帯で変わらないため variant の外に置く */
export const CHILD_CHECKLIST_TIME_SLOT_ICONS: Readonly<Record<string, string>> = {
	morning: '☀️',
	afternoon: '🌤️',
	evening: '🌙',
	anytime: '🕐',
};

/**
 * 年齢帯に応じたチェックリスト文言を返す。
 *
 * `ageTier` は必ず呼び出し側から渡すこと (アンチパターン A1: `if (uiMode === 'baby')` 散在の回避)。
 * `(child)/+layout.server.ts` が解決した `data.uiMode` をそのまま渡す。
 */
export function getChildChecklistLabels(ctx: {
	ageTier: UiMode | string | null | undefined;
}): ChildChecklistTextVariant {
	const tier = normalizeUiMode(ctx.ageTier ?? '');
	return tier === 'baby' || tier === 'preschool' ? CHILD_CHECKLIST_HIRAGANA : CHILD_CHECKLIST_KANJI;
}

export const DEMO_CHILD_CHECKLIST_LABELS = {
	demoNotice: 'これはデモです。チェックは保存されません。',
} as const;

export const ADMIN_CHECKLISTS_PAGE_LABELS = {
	// #3097 (EPIC #3096): 正準スロット契約に conform — 子供タブ / 子供コンテキストバナー / 検索を
	//   activities (ADMIN_ACTIVITIES_PAGE_LABELS) と同型に揃える (NN/G #4 consistency)。
	childTabsAriaLabel: `${CHILD_TERMS.honorific}を選択`,
	childContextSuffix: 'のチェックリスト',
	// #3098: child 主軸 UI 統一に伴い hint を activities (childContextHint) と同型に揃える。
	childContextHint: `タブを切り替えると、他の${CHILD_TERMS.honorific}のチェックリストを表示します`,
	searchLabel: 'チェックリストを検索',
	searchPlaceholder: 'チェックリスト名で検索...',
	// #1755 (#1709-A): kind 削除に伴い tabAriaLabel は本 sub では未使用化
	//   後続 sub-issue (#1709-B) で他用途に流用 / 削除を検討
	tabAriaLabel: 'チェックリスト種別',
	// #1755 (#1709-A): kind 削除 — emptyChecklistMessage に統合
	emptyKindSuffix: 'がまだありません',
	// #2899: title は汎用チェックリスト機能のため「持ち物」限定表記を外す
	emptyChecklistMessage: 'チェックリストがまだありません',
	// #1755 (#1709-A): kind 選択削除に伴うダイアログタイトル / プレースホルダ統合
	addTemplateDialogTitle: 'チェックリスト作成',
	namePlaceholderItem: '例: がっこうのもちもの',
	inactiveBadge: '無効',
	deleteButton: '削除',
	timeSlotLabel: '時間帯:',
	addItemButton: '+ アイテム追加',
	// EPIC #3533: 旧 free 上限バナー文言 (limitReachedText / limitCountText / upgradeLink / upgradeDesc) は
	//   §10.2 P1/P3 に基づき撤去 (画面内 quota カウンタ・個別アップセル CTA を廃止、制約詳細はプラン画面へ一元化)。
	addTemplateButton: '+ テンプレート作成',
	addOverrideButton: '📅 ワンオフ追加',
	// #2778 (Cluster D / User 指摘 #1 ボタン重複解消): 2 並列 button → 「+ 追加」dropdown menu 集約 (Hick's Law)
	addMenuButton: '+ 追加',
	// #2903 (EPIC #2897): add 経路を activities (ActivitiesHeader) と同型に統一。
	//   AI 提案パネル直置きを撤去し「+ 追加」dropdown 内の選択肢 (手動 / AI / テンプレから探す / ワンオフ) に格納する。
	//   icon / 文言は activities header の add menu (FEATURES_LABELS.activitiesHeader.add*) と同一語彙で揃え、
	//   両ページの add 経路構成 (種類・順序) が一致することを E2E で assert 可能にする (AC3 同型性固定)。
	addMenuAriaLabel: 'チェックリストを追加するメニューを開く',
	addManualLabel: '手動で1つ追加',
	addManualIcon: '✏️',
	addAiLabel: 'AI で提案してもらう',
	addAiIcon: '✨',
	addBrowseTemplatesLabel: `${TEMPLATE_TERMS.userFacing}から探す`,
	addBrowseTemplatesIcon: '🔍',
	addOverrideMenuLabel: 'ワンオフ追加',
	addOverrideMenuIcon: '📅',
	// add dialog title (mode 別、activities の addDialogTitle* と同型)
	addDialogTitleAi: 'AI で提案してもらう',
	todayOverrideTitle: '📅 本日のワンオフ',
	formKindLabel: '種別',
	formIconLabel: 'アイコン',
	createButton: '作成',
	addButton: '追加',
	addItemDialogTitle: 'アイテム追加',
	overrideDialogTitle: 'ワンオフ追加/除外',
	// EPIC #3533: 旧 premiumBadgeLabel (ヘッダー「スタンダード以上」バッジ) は §10.2 P3/P4 で撤去
	//   (tier 表示は header に一本化、画面内の個別プランバッジは非採用)。
	// #2137 (MP-2): マーケットプレイス checklist 一括追加セクション (#2272: UI ラベルは TEMPLATE_TERMS atom 経由)
	marketplaceSectionTitle: `${CONCEPT_ICONS.template} ${TEMPLATE_TERMS.userFacing}から一括追加`,
	marketplaceSectionDesc:
		'季節やイベント時のチェックリストをワンタップで取込めます（重複時はスキップ）',
	marketplaceItemCount: (n: number) => `${n}項目`,
	marketplaceImportButton: '一括追加',
	marketplaceImportedBadge: '取込済',
	marketplaceImportSuccess: (presetName: string, items: number) =>
		`✅ 「${presetName}」: ${items}項目を追加しました`,
	marketplaceImportDuplicate: (presetName: string) =>
		`⚠️ 「${presetName}」は既に取込済みのためスキップしました`,
	marketplaceSeeMore: 'すべてのチェックリストを見る →',
	// #2362 PR-5 Phase 2: family master UX (ChecklistDistributionDialog / OverflowMenu / per-child progress)
	// #2899: 汎用チェックリスト機能のため「持ち物」限定表記を「チェックリスト / リスト」へ是正
	pageTitle: 'チェックリスト管理',
	familyChecklistsSectionTitle: '家族のチェックリスト',
	// #3098: child 主軸 UI 統一に伴い、header 説明を「子供タブで選択中の子のチェックリストを表示」軸に更新。
	//   同じリストを複数のお子さまに配ることも可能 (= 追加時に配信先を選ぶ) という従来の柔軟性は維持。
	familyChecklistsSectionDesc:
		'お子さまタブで、その子のチェックリストを管理できます。同じリストを複数のお子さまに追加することもできます。',
	emptyFamilyMessage: '家族のチェックリストがまだありません',
	emptyFamilyDesc: `みんなのテンプレートから取込むか、「${OVERFLOW_MENU_TERMS.itemMarketplace}」メニューから追加できます`,
	browseMarketplaceLink: `${CONCEPT_ICONS.template} ${TEMPLATE_TERMS.browse} →`,
	distributionSectionTitle: '配信先のお子さま',
	distributionEmpty: '誰にも配信されていません',
	distributionConfigureButton: '配信先を設定',
	distributionDialogTitle: '配信先のお子さまを選ぶ',
	distributionDialogDesc: 'チェックを入れたお子さまの画面に、このチェックリストが表示されます。',
	distributionSaveButton: '配信先を保存',
	distributionUpdated: (added: number, removed: number) =>
		`配信先を更新しました（追加 ${added} 件 / 解除 ${removed} 件）`,
	distributionNoChange: '配信先に変更はありませんでした',
	perChildProgressTitle: 'お子さまごとの今日の進捗',
	perChildProgressEmpty: '配信中のお子さまがいないため進捗は表示されません',
	perChildProgressDone: (childName: string, total: number) =>
		`${childName}: 今日のぶん ${total}/${total} 完了`,
	perChildProgressPartial: (childName: string, done: number, total: number) =>
		`${childName}: ${done}/${total}`,
	overflowMenuAriaLabel: 'チェックリスト管理メニュー',
	helpDialogTitle: 'チェックリスト ヘルプ',
	helpDialogDesc: `家族で 1 つのリストを作成し、配信先のお子さまを選ぶことで、同じリストを複数の${CHILD_TERMS.honorific}で共有できます。${CHILD_TERMS.honorific}ごとに今日の進捗が記録されます。`,
	// #3079: 個別 backup/restore 実装に伴い「今後対応予定」Dialog を撤去 (実機能に置換)。
	// 復元 dialog の文言は BACKUP_RESTORE_LABELS (共通 SSOT) を参照。restoreResourceNoun は
	// BACKUP_RESTORE_LABELS の文組み立て関数に渡す resource 名詞 (DESIGN.md §10 consistency)。
	restoreResourceNoun: 'チェックリスト',
	// テンプレート単位 export の選択 dialog 文言:
	exportSelectTitle: 'エクスポートするチェックリスト',
	exportSelectDesc: `1 つのチェックリストを選んで${BACKUP_TERMS.file}に書き出します。`,
	exportSelectEmpty: 'エクスポートできるチェックリストがありません',
	exportItemButton: (name: string) => `「${name}」をエクスポート`,
	importToastSuccess: (presetName: string, distributedCount: number) =>
		`「${presetName}」を取込み、${distributedCount}名のお子さまに配信しました`,
	importToastDuplicate: (presetName: string) =>
		`「${presetName}」は既に取込済みです（配信先のみ更新できます）`,
	// #2558 bug-1: デモ環境では書き込みが no-op 化される。成功偽装せず明示する。
	importToastDemo: 'デモではお試し用です（実際の追加は行われません）',
	importToastError: (presetName: string) =>
		`「${presetName}」の取込に失敗しました。時間をおいて再試行してください。`,
	importToastNotFound: (presetId: string) => `プリセット「${presetId}」が見つかりません。`,
	importInvalidPreset: '指定されたプリセットが見つかりませんでした',
	// #3098 (EPIC #3096 Sub-2): 子供主軸 UI 統一に伴う「別の子から copy」(= 配信先追加) 導線。
	//   activity の copy 導線 (ADMIN_ACTIVITIES_PAGE_LABELS.copy*) と同型語彙。
	copyFromChildMenuLabel: `他の${CHILD_TERMS.honorific}から取り込む`,
	copyFromChildMenuIcon: '📋',
	copyDialogTitle: `他の${CHILD_TERMS.honorific}のチェックリストを取り込む`,
	copyDialogDescPrefix: 'コピー元を選んでください（コピー先: ',
	copyDialogDescSuffix: '）',
	copyDialogSelectedPlaceholder: '—',
	copyDialogAgeSuffix: '歳',
	copyDialogCountSuffix: '件',
	copyDialogEmpty: `他の${CHILD_TERMS.honorific}がいません`,
	copyDialogCancel: 'キャンセル',
	copyDialogConfirm: '取り込む',
	copyDifferentChildError: `違う${CHILD_TERMS.honorific}を選んでください`,
	copyNoChange: '取り込めるチェックリストがありませんでした（すでに配信済み）',
	copySuccess: (added: number) => `${added} 件のチェックリストを取り込みました`,
	copyFailed: '取り込みに失敗しました',
} as const;

// ============================================================
// #2138 MP-3: /admin/settings/rules — 取込済 rule-preset 管理画面
// ============================================================

// #2895: marketplace 陳列撤去に伴い、本画面は「取込済 bonus ルールの確認 + ON/OFF + 削除」に簡素化。
// 旧 marketplace import 受付 / OverflowMenu / help-restore-export dialog 系のラベルは撤去した。
export const ADMIN_RULES_PAGE_LABELS = {
	// #3954: 本画面は #3339 で「ごほうび交換の承認要否」も持つようになったが、title / description は
	// ボーナスルールしか説明しておらず、探しに来た保護者が「ここではない」と引き返す状態だった。
	// hub カード (SETTINGS_LABELS.groupRulesTitle) と同じ名前にして、同じものを指すと分かるようにする。
	pageTitle: 'ごほうび・ボーナスルール',
	pageDescription:
		'ごほうび交換に保護者の承認が必要かどうかと、活動記録時に発火するボーナスポイントのルールを設定できます。',
	emptyTitle: 'ボーナスルールがありません',
	emptyDesc: 'ボーナスルールを取込むと、ここで ON / OFF を切り替えられます',
	sectionBonusTitle: `${CONCEPT_ICONS.challenge} ボーナスルール`,
	sectionBonusDesc:
		'活動記録時に発火するボーナスポイント。有効なルールのみが活動記録時に評価されます。',
	enabledBadge: '有効',
	disabledBadge: '無効',
	enableButton: '有効化',
	disableButton: '無効化',
	removeButton: '削除',
	removeConfirmTitle: 'このルールを削除しますか？',
	removeConfirm: '本当に削除しますか？取込済の rule は失われます。',
	importedAtLabel: '取込日時',
	rulesLabel: '含まれるルール',
	pointBonusSuffix: 'pt',
	updateSuccess: 'ルールを更新しました',
	removeSuccess: 'ルールを削除しました',
	// marketplace 詳細 → `?import=<presetId>` bonus auto-import の toast (family scope、即取込)。
	importToastSuccess: (presetName: string) =>
		`ボーナスルール「${presetName}」を取込みました。家族全員に適用されます。`,
	importToastDuplicate: (presetName: string) => `「${presetName}」は既に取込済みです。`,
	importToastError: (presetName: string) =>
		`「${presetName}」の取込に失敗しました。時間をおいて再試行してください。`,
	importToastNotFound: (presetId: string) => `プリセット「${presetId}」が見つかりません。`,
	// #4711: 種類違い (exchange / penalty / special) は「失敗 → 再試行」ではなく、
	// 取り込める画面 (交換型 = ごほうび管理) を案内する。内部 ID は出さない。
	importToastWrongType: (presetName: string) =>
		`「${presetName}」はボーナスルールではないため、この画面では取り込めません。`,
	importWrongTypeExchangeHint: `交換型のルールは${REWARD_TERMS.menu}で取り込みます。`,
	importWrongTypeGoToRewards: `${REWARD_TERMS.menu}で取り込む`,
	importWrongTypeNotImportable: 'このルールは取込対象外です。',
	// #2823: demo 環境の no-op 取込を正直に明示 (他 4 type と同文言、5 type 統一)。
	importDemo: 'デモではお試し用です（実際の追加は行われません）',
	// #3339: ごほうび交換の即時交換（親承認スキップ）設定。既定 = 承認必須。
	rewardApprovalSectionTitle: `${CONCEPT_ICONS.reward} ごほうび交換のしかた`,
	rewardApprovalSectionDesc:
		'お子さまがごほうびショップで交換するとき、保護者の承認を必須にするかを選べます。',
	rewardApprovalRequireState: '保護者の承認が必要',
	rewardApprovalInstantState: '承認なしで即時交換',
	rewardApprovalRequireDesc:
		'お子さまの交換は「承認待ち」になり、保護者が承認するとポイントが引かれます（初期設定）。',
	rewardApprovalInstantDesc:
		'お子さまがためたポイントで、承認を待たずにその場で交換できます（ポイントはその場で引かれます）。',
	rewardApprovalEnableInstantButton: '即時交換にする',
	rewardApprovalDisableInstantButton: '承認を必須に戻す',
	rewardApprovalSuccess: 'ごほうび交換の設定を更新しました',
	// #4023: 承認必須を「外す」方向 (承認必須 → 即時交換) にだけ確認を挟む。
	// 承認必須に戻す安全側の操作は確認しない (AC2)。文言は「よろしいですか」で終わらせず
	// 解除後に何が起きるか (結果) を書く (AC3)。
	rewardApprovalInstantConfirmTitle: '承認なしで交換できるようにしますか？',
	rewardApprovalInstantConfirmBody:
		'解除すると、お子さまは保護者の承認なしでポイントを使ってごほうびと交換できるようになります。あとから「承認を必須に戻す」でいつでも元に戻せます。',
} as const;

export const DEMO_ACTIVITIES_LABELS = {
	aiAddButton: '✨ AI追加',
	manualAddButton: '+ 手動追加',
	allFilter: 'すべて',
	emptyFilter: '該当する活動がありません',
} as const;

export const DEMO_CHECKLISTS_LABELS = {
	addTemplateButton: '+ テンプレート追加',
	addItemButton: '+ アイテム追加',
	emptyTitle: 'チェックリストがありません',
	emptyDesc: '登録するとお子さまの持ち物チェックリストを管理できます',
} as const;

// #2295 (EPIC #2294 ①): DEMO_EVENTS_LABELS 削除済 (2026-05-19) — シーズンイベント機構撤去

export const SWITCH_PAGE_LABELS = {
	adminForbiddenNotice: 'おやのアカウントでログインしてね',
	heading: 'だれがつかう？',
	emptyTitle: 'こどもがまだいないよ',
	emptyDesc: `${PARENT_TERMS.neutral}が${ADMIN_VIEW_TERMS.canonical}からついかしてね`,
	// #2353 設計欠陥 3: 「親しか押さないボタンなのにひらがな表記する理由がない」
	// ADMIN_VIEW_TERMS.parent 経由で漢字化 = 「保護者の見守り画面」
	adminLink: `🔒 ${ADMIN_VIEW_TERMS.parent}`,
} as const;

// 注: OPS_LICENSE_PAGE_LABELS (旧 /ops/license dashboard) は Epic #2525 Phase 7 PR-L4 (#2836)
//     license key 全廃に伴い撤去済 (route は PR-L3 #2818 で物理削除、割引配布は Stripe Coupon 代替)。

export const DEMO_CHALLENGES_LABELS = {
	sectionTitle: '👥 きょうだいチャレンジ',
	allClearedBadge: '全員クリア！',
	activeBadge: '開催中',
	dateRangeSeparator: '〜',
	targetPrefix: '目標',
	rewardPrefix: '報酬',
} as const;

export const DEMO_CHILD_ACHIEVEMENTS_LABELS = {
	sectionTitle: '🏅 チャレンジきろく',
	emptyTitle: 'まだチャレンジきろくがないよ',
	emptyDesc: 'チャレンジがはじまったら ここにきろくされるよ',
	clearedBadge: 'クリア！',
	inProgressBadge: 'ちょうせん中',
} as const;

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
	features: 'できること',
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
//   （実態は「親がセットアップで選択する 300+ 候補プール」であり、訴求から「自動で揃う」誤認を排除）
//   CI `measure-lp-dimensions.mjs` の正規表現 `<strong>(\d+)\+</strong>\s*プリセット活動` は
//   「プリセット活動」リテラルが残っていれば検出されるため、honest 表現でも CI 裏取りは継続して機能する
// #1953 (Phase 3 D8): atom 化対象ゼロ → #1913 (UIUX-E-1) で AGE_RANGE_TERMS を新設、ageRange を atom 参照化。
// プリセット数（300+）/ セットアップ時間（約 5 分）は引き続き本 LP 専用の仕様値であり terms.ts に対応 atom 不在。
// 将来 SETUP_TERMS / SPEC_TERMS 等を新設する判断は別 Issue で検討。
export const LP_HERO_SPEC_BADGES_LABELS = {
	// #1913: AGE_RANGE_TERMS.short = '3〜18 歳' を参照（波ダッシュ短縮形 atom）
	ageRange: `${AGE_RANGE_TERMS.short}`,
	ageRangeSuffix: '対応',
	presetCount: '300+',
	presetSuffix: 'プリセット活動 の候補',
	setupTime: '約 5 分',
	setupSuffix: 'で初期設定',
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
	trialSubheading: `${TRIAL_TERMS.durationSpaced}無料トライアル期間中は、選択したプランの全機能を制限なくお試しいただけます`,
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
	familyPatternInviteTag: 'スタンダード以上',
	familyPatternInviteTitle: '個別アカウント＋招待リンク型',
	familyPatternInviteDesc: `家族グループを作成し、招待リンクで家族を招待。家族メンバーがそれぞれの端末からアクセスでき、離れた場所からもお子さまの成長を見守れます。${PLAN_TERMS.standard}はご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}まで（オーナーを含むため招待は${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで）、${PLAN_TERMS.premium}は無制限で招待できます。`,

	// FAQ (#1647 R42 — labels.ts PRICING_PAGE_LABELS と整合 / #1643 R38 / #1653 R47)
	// #1896 PO-4-10: 旧 'faqTitle: よくある質問' は LP_FAQ_TERMS.faqHtmlTitle 経由に統一
	//   ('よくあるご質問' に長形式化)。key 名は compound 役割を明示する 'faqHeading' に rename
	//   し atom と key 名の混同を防ぐ（site/pricing.html data-lp-key 参照を同期更新）。
	faqHeading: `${LP_FAQ_TERMS.faqHtmlTitle}`,
	faqFreeQ: '無料プランでも十分使えますか？',
	// #1912 (F-6): LP FAQ の「ログインボーナス」→「ごほうび」へ日本語化
	faqFreeA: `はい。プリセットの活動とチェックリストで基本的な機能はすべてお使いいただけます。お子さまの冒険体験（レベル、ポイント、おみくじ、スタンプカード、毎日のごほうび）は${PLAN_FULL_TERMS.free}でも一切制限ありません。ただし${REWARD_TERMS.productRegistration}（貯めたポイントと交換する商品の登録）は${PLAN_FULL_TERMS.standard}以上の機能です。`,
	faqAfterTrialQ: '無料体験後はどうなりますか？',
	// #1641 R36 整合: 並列構造で「保持」と「90 日で削除」を両方明記
	// #1912 (F-6): LP FAQ の「ログインボーナス履歴」→「毎日のごほうび履歴」へ日本語化
	// #2057 (UIUX-F-13): 「管理画面」→ ${ADMIN_VIEW_TERMS.canonical} 経由化
	faqAfterTrialA: `7日間の無料体験終了後は無料プランに移行します。有料プランをご希望の場合は、${ADMIN_VIEW_TERMS.canonical}からアップグレードしてください。クレジットカードの事前登録は不要です。無料体験中に作成したオリジナル活動・ごほうび・チェックリスト・シール・レベルは保持されますが、活動履歴・ポイント獲得履歴・毎日のごほうび履歴は無料プランの保持期間（${PLAN_RETENTION_TERMS.freeSpaced}）を超えたものから順次削除されます。`,
	// #4496: 旧文言は退会の猶予期間を解約に転用していた (同ページ faqCancelVsDeleteA と自己矛盾)。
	//   アプリ内 PRICING_PAGE_LABELS.faqCancelA と同じ事実を述べる。
	faqCancelQ: '解約したらデータはすぐに削除されますか？',
	faqCancelA: `いいえ。${CANCEL_TERMS.canonical}してもデータは削除されません。現在の請求期間の終了日までは有料プランをそのままご利用いただけ、その後は${PLAN_FULL_TERMS.free}へ自動的に切り替わります（お子さまの記録は残ります）。${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。必要な記録は保持期間内にエクスポートしてください。データそのものを消すのはアカウント${CANCEL_TERMS.account}のお手続きです。`,
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
		'クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。',
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
	faqPurchaseStepsQ: 'どうやって有料プランを始めますか？',
	faqPurchaseStepsAIntro: '以下の 3 ステップで簡単に始められます。',
	faqPurchaseStepsStep1: `1. LP の「${CTA_TERMS.freeTrialVerb}」または「${FREE_TERMS.tryFree}」ボタンから ${SIGNUP_TERMS.canonical}ページへ進みます。`,
	faqPurchaseStepsStep2: `2. アカウント登録後、${ADMIN_VIEW_TERMS.canonical}のヘッダにある「プラン」ボタンを押し、希望のプランを選択します。`,
	faqPurchaseStepsStep3: `3. お申し込み内容のご確認画面 (${TOKUSHOHO_TERMS.heading6Important}) でチェックを入れて同意し、Stripe の決済画面でカード情報を入力すると ${TRIAL_TERMS.duration}の無料体験が始まります (${TRIAL_TERMS.noCreditCardMid})。`,

	// FAQ 解約手順 3 ステップ (Phase 4 #2621 §4.2、Phase 2 #2548 谷③解約柔軟性 解消、Kinde frictionless 整合)
	faqCancelStepsQ: `有料プランを${CANCEL_TERMS.canonicalVerb}にはどうすればよいですか？`,
	faqCancelStepsAIntro: `以下の 3 ステップで、いつでもご自身で${CANCEL_TERMS.canonicalVerb}ことができます（契約期間の縛りはありません）。`,
	faqCancelStepsStep1: `1. アプリにログイン後、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」セクションを開きます。`,
	faqCancelStepsStep2: `2. 「${STRIPE_PORTAL_TERMS.short}を開く」ボタンを押し、${STRIPE_PORTAL_TERMS.canonical}に移動します。`,
	faqCancelStepsStep3: `3. ${STRIPE_PORTAL_TERMS.short}の画面で「サブスクリプションを${CANCEL_TERMS.canonicalVerb}」を選択すると、${CANCEL_TERMS.canonical}が完了します。次回更新日まで有料機能はご利用いただけます。`,
	faqCancelStepsClosing: `${CANCEL_TERMS.anytimeOk}。${CANCEL_TERMS.canonical}の理由をお聞かせいただくと、サービス改善の参考にさせていただきます。`,
} as const;

// #1594 ADR-0023 I8 で導入された LP「開発者に直接相談」セクションは、
// ADR-0028 (#1713 R7) で LP セクション削除 → #1770 で空オブジェクト化 → #1772 で完全削除済み。
// 連絡導線は footer の mailto (`LP_FOOTER_LABELS.contactLink`) に集約済み。
// generate-lp-labels.mjs の parseBlock は当該定数不在時に空オブジェクトを返すよう修正されている。

/**
 * #1594 ADR-0023 I8: founder 1:1 ヒアリング動線
 * LP / admin に「開発者に直接相談」CTA を提供する。Pre-PMF "do things that don't scale"
 * 実践として、初期 ~10 親契約まで全員と直接対話する。
 */
export const FOUNDER_INQUIRY_LABELS = {
	// #support-unify: 旧「LP / admin 共通の CTA セクション」(ctaSectionHeading / Lead / Bullet1-3 /
	// ctaButton) は、admin/settings/support の founder CTA カードを統合サポートフォームへ集約した際に
	// 全参照が消えたため削除。/inquiry/founder ページ本体のラベルのみ存続させる。
	mailtoFallbackLabel: 'メールで送る',
	// /inquiry/founder ページ
	pageTitle: '開発者に直接相談',
	pageHeading: '👋 開発者に直接相談',
	pageLead:
		'個人開発のため、Pre-PMF 期はリード開発者本人が一人ひとりに直接お返事します。お気軽にご相談ください。',
	pageNote:
		'※ お返事は通常 2〜3 日以内にメールでお送りします。なるべく早くお返事しますが、個人運営のため遅れる場合がございます。',
	formNameLabel: 'お名前（ニックネーム可）',
	formNamePlaceholder: '例: 山田 太郎',
	formEmailLabel: 'メールアドレス',
	formEmailPlaceholder: '例: parent@example.com',
	formChildAgeLabel: 'お子さまの年齢（任意）',
	formChildAgePlaceholder: '例: 7 歳、3 歳と 6 歳など',
	formMessageLabel: 'ご相談内容',
	formMessagePlaceholder:
		'例:\n・ 6 歳の子に使わせたいが、ひらがなで操作できますか？\n・ 兄弟 2 人で使いたい、料金プランの選び方を教えてください\n・ 解約を考えていますが、データはどうなりますか？',
	formSubmitButton: '送信する',
	formSubmittingText: '送信中...',
	formCancelButton: 'キャンセル',
	successHeading: '受け付けました',
	successText:
		'ご相談を受け付けました。リード開発者から 2〜3 日以内にメールでお返事します。お待ちください。',
	successCloseButton: '閉じる',
	mailtoSectionHeading: 'メールで直接送る場合',
	mailtoSectionDesc:
		'フォームをお使いいただけない場合は、こちらのメールアドレス宛にお送りください。',
	errorRequiredFields: 'お名前・メールアドレス・ご相談内容は必須です',
	errorInvalidEmail: 'メールアドレスの形式が正しくありません',
	errorMessageTooLong: (max: number) => `ご相談内容は ${max} 文字以内にしてください`,
	errorRateLimit: (sec: number) => `送信間隔が短すぎます。${sec} 秒後に再送してください`,
	errorSendFailed: '送信に失敗しました。時間をおいて再度お試しください',
	// admin sidebar / footer link
	adminFooterLink: '👋 開発者に直接相談',
	adminFooterHint: '個人開発者にメッセージを送る（無料）',
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

export const BABY_HOME_LABELS = {
	pageTitle: '準備モード',
	parentNote: `${PARENT_TERMS.honorific}の方向けの準備ツールです`,
	waitingTitle: '3歳になるまでもう少し！',
	waitingDesc: '自分で入力できるようになるまで、楽しみに待っていてね。',
	ageMonthsLabel: (months: number) => `${months} ヶ月`,
	ageYearsLabel: (years: number) => `${years} 歳`,
	countdownLabel: '3歳まであと',
	countdownMonthsText: (months: number) => `${months} ヶ月`,
	countdownWeeksText: (weeks: number) => `${weeks} 週間`,
	countdownReachedText: 'もうすぐ3歳！年齢モードを変更できます',
	initialPointsTitle: '初期ポイントを設定する',
	initialPointsDesc: '3歳以降に使えるポイントを今から積み立てられます',
	initialPointsLinkLabel: '初期ポイントを設定する',
	currentPoints: (pts: number) => `現在のポイント: ${pts} pt`,
	goToAdmin: `${ADMIN_VIEW_TERMS.canonical}へ`,
	initialPointsPageTitle: '初期ポイント設定',
	initialPointsAmountLabel: 'ポイント数',
	initialPointsAmountHint: '3歳以降のスタートポイントとして追加されます',
	initialPointsSubmit: 'ポイントを追加',
	initialPointsSuccess: 'ポイントを追加しました',
	initialPointsCancel: 'キャンセル',
	initialPointsBackAriaLabel: '戻る',
	initialPointsMinError: '1以上のポイントを入力してください',
	initialPointsMaxError: '10000以下のポイントを入力してください',
} as const;

// ============================================================
// オンボーディングチェックリスト (#1361)
// ============================================================

export const ONBOARDING_LABELS = {
	title: 'はじめてのセットアップ',
	optionalSectionLabel: 'さらに便利にする設定',
	optionalCountSuffix: (n: number) => `任意・${n} 項目`,
	optionalSectionHeader: (n: number) => `さらに便利にする設定（任意・${n} 項目）`,
	allRequiredCompleted: '✅ はじめてのセットアップ完了!',
	completedSuffix: '完了',
	nextRecLabel: '次のおすすめ:',
	dismissBtn: '非表示にする',
} as const;

// ============================================================
// #2821: セットアップ再開導線 (離脱後の再入口) — SetupResumeBanner
// 顧客レビュー (2026-06-03) で「こども追加後ホームに戻ると次 step が分からない /
// テンプレ追加で活動管理に着地して迷子」が指摘された。OnboardingChecklist は /admin に
// しか出ないため、親が実際に着地する /switch・子供ホーム、および setup 由来の admin 遷移に
// 再開導線を出す。NN/G #1 (visibility of system status) / Anti-engagement (ADR-0012: 完了後は消える)。
// ============================================================
export const SETUP_RESUME_LABELS = {
	// /switch・子供ホームに出す「続きをやる」バナー
	resumeTitle: 'セットアップの続き',
	progressText: (done: number, total: number) => `あと ${total - done} ステップで準備完了`,
	resumeCta: '続きをする',
	// setup 由来で admin に着地したときの文脈バナー (?from=setup)
	contextTitle: '初期セットアップの途中です',
	contextDesc: '追加できたら、続きのステップに戻れます',
	backToSetupCta: 'セットアップに戻る',
	// 「・次は『<step 名>』」の追記句 (区切り・鉤括弧を SSOT に集約、hardcoded JP 増加回避)。
	nextStepSuffix: (label: string) => `・次は「${label}」`,
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
	row1ShotAlt: 'ご家族の見守り画面の活動カスタマイズ画面',
	row2ShotAlt: `${CHILD_TERMS.neutral}入力画面の過去の記録画面`,
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
	sectionDesc: `お子さまの成長に合わせて UI と機能が変化。最後は「アプリを使わなくても${AUTONOMY_TERMS.selfPlanningAble}」子育てステージへ。`,
	// #1848: LP 本体は CTA 1 行に短縮。5 ステージ詳細は graduation.html で展開。
	// #1895 (PO-4-9): 「5 ステージの詳細を見る →」は section-desc に「5」の予告がなく
	//   認知ジャンプを誘発（田中ゆかりペルソナ「5 ステージ?なんのステージ?」）。
	//   H2「3 歳から 18 歳まで、そして「卒業」へ」と直接接続する文言にリフレーム。
	linkLabel: '3 歳から 18 歳までの成長ストーリーを見る →',
	pageTitle: '成長ロードマップ - がんばりクエスト',
	pageHeroTitle: '3 歳から 18 歳まで、そして「卒業」へ',
	// #2058 (UIUX-F-16): sectionDesc と同じリフレーム（同文 SSOT）。
	pageHeroLead: `お子さまの成長に合わせて UI と機能が変化。最後は「アプリを使わなくても${AUTONOMY_TERMS.selfPlanningAble}」子育てステージへ。`,
	pageMetaDescription:
		'がんばりクエストの成長ロードマップ。幼児（3-5歳）から高校生（16-18歳）、そして「卒業」まで、お子さまの成長に合わせて UI と機能が変化していく様子を実画面付きで紹介。',
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
		'「はみがきした」「宿題おわった」を 2 タップで記録。学年別に用意された候補から、家庭で必要なものを選んで設定できます。',
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
	l3Desc:
		'貯めたポイントはごほうびショップが唯一の出口。実物のプレゼント・お小遣い・特権を親が設定し、子供が自分で選んで交換できます。',
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
// ごほうびショップ 子供側 UI (#1337)
// ============================================================

export const CHILD_SHOP_LABELS = {
	pageTitle: 'ごほうびショップ',
	navLabel: 'ショップ',
	navIcon: '🎁',
	pointBalanceLabel: 'いまのポイント',
	pointUnit: 'ポイント',
	exchangeButton: 'こうかんする',
	exchangeConfirmTitle: (rewardTitle: string, points: number) =>
		`${rewardTitle} と こうかんする？（${points} ポイント）`,
	exchangeConfirmYes: 'はい',
	exchangeConfirmCancel: 'やめる',
	/**
	 * #4509 ②: 不足分は「整形済みの表示文字列」を受け取る。
	 * 生ポイント + 固定単位だと通貨モードで嘘の数字になるため、単位は呼び出し側が
	 * splitPointDisplay で決める。
	 */
	insufficientPointsHint: (remainingText: string) => `あと ${remainingText}`,
	emptyMessage: 'ごほうびがまだありません',
	// 申請中バッジ
	statusPending: 'うけとりまち',
	statusApproved: 'こうかん済み',
	statusRejected: 'まってね',
	// 通知 overlay
	approvedTitle: (rewardTitle: string) => `${rewardTitle} もらったよ！`,
	rejectedTitle: (rewardTitle: string) => `${rewardTitle} は ちょっとまってね`,
	overlayCloseButton: 'とじる',
	// aria-labels
	rewardListAriaLabel: 'ごほうびリスト',
	pointProgressAriaLabel: 'ポイント進捗',
	// #2155 Dialog UX 改善: 階層化表示用ラベル
	exchangeConfirmHeading: 'こうかんしますか？',
	exchangeConfirmPointsLabel: 'ひつようなポイント',
	// #4684 F1/F2: 確認ダイアログの説明は「実際に起きること」を言う。
	//   - 即時交換 ON (reward_auto_approve): その場で approved 確定 = ポイントがすぐ減る。
	//   - 承認モード: 申請だけが作られる。push / メール通知の経路は無く、親が /admin を
	//     開いたときに承認待ちバナーで気づく。よって「れんらくがいく」とは言わない。
	exchangeConfirmDescriptionInstant: 'すぐに こうかんするよ（ポイントが へるよ）',
	exchangeConfirmDescriptionApproval: 'おうちのひとが みたら へんじがくるよ',
	exchangeDialogAriaLabel: 'ごほうび交換確認ダイアログ',
	// #2157 ショップ 3 系統タブ (実物 / お小遣い / 特権、26-設計書 §12 + #1336 SSOT 反映)
	// shopCategory key (physical / money / privilege) → 表示ラベル
	// (表示語彙は子供向け hiragana。internal key の 'money' を表示では「おこづかい」と呼ぶ)
	tabAll: 'すべて',
	tabPhysical: 'もの',
	tabAllowance: 'おこづかい',
	tabPrivilege: 'とくべつ',
	tabsAriaLabel: 'ごほうび系統タブ',
	tabEmpty: (categoryLabel: string) => `${categoryLabel} のごほうびは まだないよ`,
	// #2160 カテゴリ・フィルタ (ポイント範囲 + 交換可能チェック、子供向け最小 filter)
	filterPointsRangeLabel: 'ポイントでさがす',
	filterPointsRangeAll: 'ぜんぶ',
	filterPointsRangeLow: '〜100ポイント',
	filterPointsRangeMid: '100〜500ポイント',
	filterPointsRangeHigh: '500ポイント〜',
	filterPointsRangeAriaLabel: 'ポイント範囲フィルタ',
	filterAvailable: 'いまこうかんできる',
	filterAvailableAriaLabel: 'いまのポイントでこうかんできるものだけ表示',
	filterReset: 'リセット',
	filterBadge: (total: number, filtered: number) => `${total}件中 ${filtered}件`,
	filterEmptyMessage: 'じょうけんに あうごほうびが ありません',
	// #4407 個数指定 (単位量のごほうび = 「ゲーム時間 +30分」を 2 時間ぶん = 4 個 交換する)
	quantityLabel: 'いくつ こうかんする？',
	quantityDecreaseAriaLabel: 'こすうを へらす',
	quantityIncreaseAriaLabel: 'こすうを ふやす',
	// stepper ボタンの表示グリフ (全角記号。数字と並べたときに幅が揃う)
	quantityDecreaseGlyph: '−',
	quantityIncreaseGlyph: '＋',
	quantityUnit: 'こ',
	quantityValueAriaLabel: (quantity: number) => `こすう ${quantity}こ`,
	quantityMaxHint: 'もっているポイントで こうかんできる さいだいの こすうだよ',
	totalPointsLabel: 'ぜんぶで',
	// #4509 ②: 単位語 (「ポイント」) を見出しから外す。通貨モードでは値が「250円」になるため、
	// 見出しに「ポイント」が残ると同じ行の中で単位が二重に食い違う。
	remainingAfterLabel: 'こうかんしたあとの のこり',
	// #4407 AC9/AC12: 交換の結果を「見ている場所」に文字で出す (演出は加飾であって通知ではない)
	exchangeSuccessToastTitle: 'こうかんできたよ！',
	exchangeSuccessToastBody: (rewardTitle: string, quantity: number, balance: number) =>
		`${rewardTitle}${quantity > 1 ? ` ${quantity}こ` : ''} ／ のこり ${balance} ポイント`,
	exchangeRequestedToastTitle: 'おうちのひとに おねがいしたよ',
	// #4684 F2: 「へんじを まってね」は待てば通知が来ると読める。実際は親が /admin を開いた
	// ときの承認待ちバナーだけなので、子供が待ちっぱなしにならない言い方にする。
	exchangeRequestedToastBody: (rewardTitle: string, quantity: number) =>
		`${rewardTitle}${quantity > 1 ? ` ${quantity}こ` : ''} ／ おうちのひとが みたら へんじがくるよ`,
	// #4407 AC10: 交換申請が通らなかったときの文言 (状態に合わせて分ける)
	errorInsufficientPoints: 'ポイントが たりないよ',
	errorAlreadyPending: 'いま おうちのひとの へんじを まっているよ',
	errorRecentlyExchanged: 'さっき こうかんしたよ。すこし まってから もういちど おしてね',
	errorRewardNotFound: 'この ごほうびが みつからないよ',
	errorInvalidQuantity: 'こすうを もういちど えらんでね',
	errorChildNotSelected: 'こどもが えらばれていないよ',
	errorGeneric: 'うまく いかなかったよ。もういちど ためしてね',
} as const;

// #4407: 交換の「× 個数」表記 SSOT。個数 1 のときは付けない (従来表示を変えない)。
// ポイント台帳の description / 親の承認一覧の両方が本 helper を使う。
export function formatRewardWithQuantity(rewardTitle: string, quantity: number): string {
	return quantity > 1 ? `${rewardTitle} × ${quantity}` : rewardTitle;
}

// ============================================================
// ごほうびショップ 保護者の見守り画面 申請タブ (#1337 / #2057)
// ============================================================

export const ADMIN_SHOP_REQUEST_LABELS = {
	tabLabel: '申請',
	tabLabelRequests: 'ごほうび申請',
	emptyPendingMessage: '申請はありません',
	approveButton: '承認して渡した',
	rejectButton: '却下する',
	rejectNoteLabel: '却下理由（任意・最大100文字）',
	rejectConfirmButton: '確定',
	rejectCancelButton: 'キャンセル',
	requestedAtLabel: '申請日時',
	childNameLabel: '子供',
	rewardPointsUnit: 'ポイント',
	statusApproved: '承認済み',
	statusRejected: '却下済み',
	historyTabLabel: '履歴',
} as const;

// ============================================================
// ごほうび申請承認専用画面 (#2269: /admin/rewards/requests)
// CRUD と承認フローの責務分離（PO 指摘「ごほうび/申請タブ区分が意味不明」）
// ============================================================

export const ADMIN_REWARDS_REQUESTS_LABELS = {
	pageTitle: '📋 ごほうび申請承認',
	pageDescTitle: '📋 ごほうび申請承認',
	pageDescText: '子供からの交換申請に承認/却下します。',
	backToRewardsLabel: '← ごほうび管理に戻る',
	pendingSectionTitle: 'Pending',
	pendingCountSuffix: (count: number) => `${count} 件`,
	historySectionTitle: 'History（直近30件）',
	emptyPendingMessage: '申請はありません',
	emptyHistoryMessage: '履歴はありません',
	approveButton: '承認して渡した',
	rejectButton: '却下する',
	rejectNoteLabel: '却下理由（任意・最大100文字）',
	rejectConfirmButton: '確定',
	rejectCancelButton: 'キャンセル',
	requestedAtLabel: '申請日時',
	rewardPointsUnit: 'ポイント',
	statusApproved: '承認済み',
	statusRejected: '却下済み',
} as const;

// ============================================================
// UI プリミティブ コンポーネントラベル (#1465 Phase B)
// src/lib/ui/primitives/ 配下のハードコード文字列を集約
// ============================================================

// #3218 (EPIC #3217): 統一エラー通知 helper (error-notify.ts) の文言 SSOT。
// 内部例外をそのまま出さず、ユーザ向け平易文言にマッピングする (WCAG 3.3.1/3.3.3、Apple HIG)。
/** error-notify helper が受け取るエラー文言セットの構造 (#3225 ②b: age-tier 切替用)。 */
export type ErrorNotifyLabelSet = {
	readonly title: string;
	readonly generic: string;
	readonly network: string;
	readonly server: string;
	readonly forbidden: string;
	readonly conflict: string;
	readonly badRequest: string;
};

export const ERROR_NOTIFY_LABELS = {
	title: '処理できませんでした',
	generic: '時間をおいて再度お試しください',
	network: '通信に失敗しました。接続を確認して再度お試しください',
	server: 'エラーが発生しました。時間をおいて再度お試しください',
	forbidden: 'この操作を行う権限がありません',
	conflict: '他の操作と競合しました。画面を更新して再度お試しください',
	badRequest: '入力内容をご確認ください',
} as const satisfies ErrorNotifyLabelSet;

// #3225 ②b (EPIC #3217): 子供画面 (preschool / baby) 向けエラー文言。
// DESIGN.md §8 整合 — ひらがな・責めない言い回し・必ず次アクション (「もういちど ためしてね」) を提示する。
export const ERROR_NOTIFY_LABELS_CHILD = {
	title: 'できなかったよ',
	generic: 'もういちど ためしてね',
	network: 'つうしんが できなかったみたい。もういちど ためしてね',
	server: 'うまく いかなかったよ。あとで もういちど ためしてね',
	forbidden: 'これは できないみたい',
	conflict: 'もういちど やってみてね',
	badRequest: 'もういちど かくにんしてね',
} as const satisfies ErrorNotifyLabelSet;

/**
 * uiMode に応じたエラー文言セットを返す (#3225 ②b)。
 * preschool / baby はひらがな (`ERROR_NOTIFY_LABELS_CHILD`)、elementary 以上は標準 (漢字許容)。
 */
export function getErrorNotifyLabels(uiMode: string): ErrorNotifyLabelSet {
	return uiMode === 'preschool' || uiMode === 'baby'
		? ERROR_NOTIFY_LABELS_CHILD
		: ERROR_NOTIFY_LABELS;
}

export const UI_PRIMITIVES_LABELS = {
	// BirthdayInput
	birthdayInputLabel: 'おたんじょうび',
	yearUnit: '年',
	monthUnit: '月',
	dayUnit: '日',
	birthYearAriaLabel: '生まれた年',
	birthMonthAriaLabel: '生まれた月',
	birthDayAriaLabel: '生まれた日',
	birthYearPlaceholder: '----年',
	birthMonthPlaceholder: '--月',
	birthDayPlaceholder: '--日',
	// Dialog / Toast（子供向け UI のため「とじる」表記）
	closeAriaLabel: 'とじる',
	// FormField（パスワードトグル）
	passwordHide: 'パスワードを非表示',
	passwordShow: 'パスワードを表示',
	// PinInput（スクリーンリーダー向け）
	pinCodeLabel: 'PINコード',
	// Select
	selectPlaceholder: '選択してください',
	// Menu (#2254 / EPIC #2253)
	menuOpenAriaLabel: 'メニューを開く',
	// Button loading spinner (#2632 CX-DoR #9 NN/G #1、スクリーンリーダー向け)
	loadingAriaLabel: '処理中',
} as const;

// ============================================================
// OverflowMenu (EPIC #2362 PR-2) — admin route 共通 ⋮ menu 表示文字列
// ============================================================
//
// admin route (activity / reward / challenge / checklist / rule bonus) の
// top-right ⋮ menu の標準項目を SSOT 集約。各 route で項目 ON/OFF 可能 (props 制御)。
// terms.ts OVERFLOW_MENU_TERMS atom を template literal で参照。

export const OVERFLOW_MENU_LABELS = {
	openLabel: `${OVERFLOW_MENU_TERMS.openLabel}`,
	items: {
		marketplace: {
			id: 'marketplace',
			label: `${OVERFLOW_MENU_TERMS.itemMarketplace}`,
			icon: `${OVERFLOW_MENU_TERMS.itemMarketplaceIcon}`,
		},
		aiSuggest: {
			id: 'ai-suggest',
			label: `${OVERFLOW_MENU_TERMS.itemAiSuggest}`,
			icon: `${OVERFLOW_MENU_TERMS.itemAiSuggestIcon}`,
		},
		restore: {
			id: 'restore',
			label: `${OVERFLOW_MENU_TERMS.itemRestore}`,
			icon: `${OVERFLOW_MENU_TERMS.itemRestoreIcon}`,
		},
		export: {
			id: 'export',
			label: `${OVERFLOW_MENU_TERMS.itemExport}`,
			icon: `${OVERFLOW_MENU_TERMS.itemExportIcon}`,
		},
		help: {
			id: 'help',
			label: `${OVERFLOW_MENU_TERMS.itemHelp}`,
			icon: `${OVERFLOW_MENU_TERMS.itemHelpIcon}`,
		},
	},
} as const;

// ============================================================
// ChildSelectionDialog (EPIC #2362 PR-2) — per-child 取込ダイアログ表示文字列
// ============================================================
//
// per-child 採用 type (activity / reward / challenge) の marketplace 取込時の
// 「誰に追加するか / 全員に追加するか」を選択させる Dialog の compound。
// terms.ts CHILD_SELECTION_TERMS + CHILD_TERMS atom を組み合わせる。

export const CHILD_SELECTION_LABELS = {
	dialogTitle: `${CHILD_SELECTION_TERMS.dialogTitleQuestion}${CHILD_TERMS.honorific}${CHILD_SELECTION_TERMS.dialogTitleSuffix}`,
	allOption: `${CHILD_SELECTION_TERMS.allOptionLabel}`,
	confirm: `${CHILD_SELECTION_TERMS.confirmLabel}`,
	confirmLoading: `${CHILD_SELECTION_TERMS.confirmLoadingLabel}`,
	cancel: `${CHILD_SELECTION_TERMS.cancelLabel}`,
	listAriaLabel: `${CHILD_SELECTION_TERMS.listAriaLabel}`,
	ageUnitSuffix: `${CHILD_SELECTION_TERMS.ageUnitSuffix}`,
} as const;

// ============================================================
// VisibilityChipGroup (EPIC #2362 PR-2) — family master per-child visibility 表示文字列
// ============================================================
//
// family master 採用 type (checklist / rule bonus) の edit modal 内の
// per-child visibility chip toggle compound。
// terms.ts VISIBILITY_CHIP_TERMS atom を template literal で参照。

export const VISIBILITY_CHIP_LABELS = {
	sectionTitle: `${VISIBILITY_CHIP_TERMS.sectionTitle}`,
	toggleOn: `${VISIBILITY_CHIP_TERMS.toggleOn}`,
	toggleOff: `${VISIBILITY_CHIP_TERMS.toggleOff}`,
	allOn: `${VISIBILITY_CHIP_TERMS.allOnLabel}`,
	allOff: `${VISIBILITY_CHIP_TERMS.allOffLabel}`,
	groupAriaLabel: `${VISIBILITY_CHIP_TERMS.groupAriaLabel}`,
} as const;

// ============================================================
// スタンプカード N レアリティ ポジティブメッセージ (#1536)
// StampPressOverlay で N レアリティのスタンプ取得時に表示
// ============================================================

export const STAMP_PRESS_N_MESSAGES = {
	/** 準備モード (0-2歳) — 親向け、ひらがな・シンプル */
	baby: ['きょうも えらいね！', 'がんばったね！', 'すてき！', 'いいね！', 'すごいよ！'],
	/** 幼児 (3-5歳) — ひらがなのみ、大きな称賛 */
	preschool: [
		'よくがんばったね！',
		'えらい！えらい！',
		'さすが！',
		'すごいぞ！',
		'がんばってるね！',
	],
	/** 小学生 (6-12歳) — 元気よく、達成感を強調 */
	elementary: [
		'よくがんばった！',
		'さすが！すごい！',
		'今日もステキ！',
		'がんばってるね！',
		'どんどん成長してる！',
	],
	/** 中学生 (13-15歳) — クールに、内発的動機寄り */
	junior: ['いい感じ！', '続けてるのすごい！', 'ナイス！', 'さすがだね！', 'コツコツ最強！'],
	/** 高校生 (16-18歳) — フラットに、自律・継続を称える */
	senior: ['Good job!', '継続は力なり！', 'ナイスキープ！', '着実に積み上げてる！', '自分を誇れ！'],
} as const;

// ============================================================
// 本日の使用時間 (#1292: 自動スリープ + 使用時間可視化)
// AdminHome の使用時間セクションで利用
// ============================================================

export const USAGE_TIME_LABELS = {
	todayUsage: '本日の使用時間',
	todayUsageOf: (childName: string) => `${childName}の本日使用時間`,
	minutesUsed: (min: number) => `${min}分使用`,
	minutesOf15: (min: number) => `${min}分 / 15分`,
	// Phase 2: 週次 bar chart (#1576)
	weeklyUsage: '今週の使用時間',
	weeklyUsageOf: (childName: string) => `${childName}の今週使用時間`,
	noData: 'まだデータがありません',
	minutesUnit: '分',
	minutesUnitDisplay: '（分）',
	dayOfWeek: (date: string) => {
		const days = ['日', '月', '火', '水', '木', '金', '土'] as const;
		// 曜日は JST SSOT 経由 (#4015)。旧実装は +9h の手組みオフセット後に
		// ローカル TZ getter を読む形で、date-utils と同じ計算を二重に持っていた。
		return days[jstDayOfWeek(new Date(date))];
	},
	chartBarAriaLabel: (childName: string, date: string, min: number) => {
		const days = ['日', '月', '火', '水', '木', '金', '土'] as const;
		return `${childName} ${days[jstDayOfWeek(new Date(date))]}曜日 ${min}分`;
	},
} as const;

// ============================================================
// UI コンポーネント ラベル (#1465 Phase B)
// src/lib/ui/components/ 配下のハードコード文字列を集約
// ============================================================

export const UI_COMPONENTS_LABELS = {
	// ---- ActivityCard ----
	activityCardFrozenToast: 'おうちのひとに おねがいしてね',
	activityCardCompleted: '（きろくずみ）',
	activityCardMainQuest: '（メインクエスト×2）',
	activityCardMission: '（ミッション）',
	activityCardPinned: '（ピンどめ）',
	activityCardFrozen: '（ロックちゅう）',
	activityCardCountAriaLabel: (count: number) => `${count}かいきろくずみ`,
	activityCardMainQuestBadge: '⚔️ 2ばい!',
	activityCardStreakAriaLabel: (days: number) => `${days}にちれんぞく`,
	// #2146: priority='must' (今日のおやくそく) のカード演出統合用ラベル
	// 旧 MustProgressBar 専用セクションを廃止し、ActivityCard 自身に ribbon badge を付ける
	activityCardMustBadge: '⭐ おやくそく',
	activityCardMust: '（今日のおやくそく）',

	// ---- ActivityEmptyState ----
	activityEmptyTitle: 'ぼうけんの じゅんびちゅう...',
	activityEmptyDesc: 'おうちの人が かつどうを よういしているよ！',
	activityEmptyWait: 'もうすこし まってね ⏳',
	activityEmptyCanDo: '── できること ──',
	activityEmptyStatusLink: (statusLabel: string) => `${statusLabel}をみる`,

	// ---- AdventureStartOverlay ----
	adventureGreeting: (name: string) => `やあ！ ${name}！`,
	adventureBigText1: 'きょうから いっしょに',
	adventureBigText2: 'ぼうけんだよ！',
	adventureSubText1: 'いろんなことを がんばると',
	adventureSubText2: 'つよくなれるよ！',
	adventureCharacterAlt: 'ぼうけんキャラクター',
	adventureReadyText: '🌟 さあ、はじめよう！ 🌟',
	adventureReadySub: 'したのカードをタップしてみてね',
	adventureStartBtn: 'ぼうけんスタート！',

	// ---- BottomNav ----
	bottomNavHome: 'ホーム',
	bottomNavStrength: 'つよさ',
	bottomNavFamily: 'かぞく',
	bottomNavAriaLabel: 'メインナビゲーション',

	// ---- CategorySection ----
	categorySectionCollapse: '▲ たたむ',
	categorySectionExpand: (remaining: number) => `▼ もっとみる（のこり ${remaining}こ）`,

	// ---- Challenge target (#3333: 旧 ChallengeBanner 横長バナーを撤去し、対象カテゴリの
	// CategorySection ヘッダーへ静的バッジ + インライン進捗で統合。#2146/#2168 のカード演出統合
	// 思想に整合。ごほうび受取は SiblingCelebration が担う) ----
	challengeTargetRemaining: (count: number) => `のこり${count}かい`,
	challengeTargetComplete: 'クリア！',
	challengeTargetAria: (categoryName: string, remaining: number) =>
		`${categoryName}は今週のチャレンジ対象です。のこり${remaining}かい。`,
	challengeTargetAriaComplete: (categoryName: string) =>
		`${categoryName}の今週のチャレンジはクリアしました。`,

	// ---- ErrorAlert ----
	errorAlertRetry: 'しばらくしてからもう一度お試しください。',
	errorAlertFixInput: '入力内容をご確認ください。',
	errorAlertContactAdmin: '管理者にお問い合わせください。',
	errorAlertRetryBtn: 'もう一度試す',

	// ---- EventBanner ----
	eventBannerReceived: '✅ うけとりずみ',
	eventBannerReceive: '🎁 うけとる',

	// ---- FeatureGate ----
	featureGateFree: '無料',
	featureGateStandard: `${PLAN_TERMS.standard}`,
	featureGateFamily: `${PLAN_TERMS.premium}`,
	featureGateLockTitle: (plan: string) => `${plan}プラン以上で利用可能`,
	featureGateLockText: (plan: string) => `${plan}プラン以上で利用可能`,
	featureGateUpgrade: 'アップグレード',
	// EPIC #3533 §10.2.1: disabled 要素 tap→popover の 3 要素文言 (P2/P5)。
	// planFull は PLAN_FULL_TERMS 値 (例「スタンダードプラン」) を受ける。
	featureGatePopoverUnavailable: '現在のプランでは利用できません',
	featureGatePopoverRequirement: (planFull: string) => `${planFull}以上でご利用いただけます`,
	featureGatePopoverLink: 'プランを見る',

	// ---- GoogleSignInButton ----
	googleSignInLabel: 'Google でログイン',

	// ---- Header ----
	headerPremiumTitle: 'スタンダード以上',
	headerHelpAriaLabel: 'つかいかたガイド',
	headerStampAriaLabel: 'スタンプカードを見る',

	// ---- LevelUpOverlay ----
	levelUpMessages: {
		1: 'ぼうけんがはじまるよ！',
		2: 'がんばってるね！',
		3: 'つよくなってきたよ！',
		4: 'すごいぞ！どんどんいこう！',
		5: 'もうたいしたものだ！',
		6: 'きみはもうベテランだ！',
		7: 'そらもとべそうだね！',
		8: 'すばらしい！マスターめざそう！',
		9: 'ほぼさいきょう！あとすこし！',
		10: 'かみさまレベルだ！おめでとう！',
	} as Record<number, string>,
	levelUpLabel: (categoryName: string | undefined) =>
		`${categoryName ? `${categoryName} ` : ''}レベルアップ！`,
	levelUpDefaultMessage: 'すごい！がんばったね！',
	levelUpSpLabel: (sp: number) => `+${sp} SP ゲット！`,
	levelUpConfirmBtn: 'やったー！',

	// ---- LoadingButton ----
	loadingButtonDefault: '処理中...',

	// ---- Logo ----
	logoAlt: 'がんばりクエスト',
	logoPlanStandard: `⭐ ${PLAN_TERMS.standard}`,
	// Phase 7 PR-L4 (#2836): 顧客可視の header plan badge を premium atom 参照化 (ADR-0058)。
	logoPlanFamily: `⭐⭐ ${PLAN_TERMS.premium}`,

	// #2295 (EPIC #2294 ①): MonthlyRewardDialog 関連ラベル削除済 (2026-05-19)

	// ---- NumPad ----
	numPadAriaLabel: 'すうじパッド',
	numPadDeleteAriaLabel: 'けす',
	numPadOkAriaLabel: 'けってい',

	// ---- PageGuideOverlay ----
	pageGuideTabWhat: 'なにができる？',
	pageGuideTabHow: 'やりかた',
	pageGuideTabGoal: 'つかうと？',
	pageGuideTipsLabel: '💡 ポイント',
	pageGuideCloseBtn: 'とじる',
	pageGuideBackBtn: 'もどる',
	pageGuideNextBtn: (isLast: boolean) => (isLast ? 'かんりょう！' : 'つぎへ'),

	// ---- ParentMessageOverlay ----
	parentMessageTitle: '💌 おうえんメッセージ！',
	parentMessageFrom: 'パパ・ママからのメッセージだよ',
	parentMessageBody: (body: string) => `「${body}」`,
	parentMessageConfirmBtn: 'うれしい！',

	// ---- PremiumBadge ----
	premiumBadgeTitle: 'スタンダードプラン以上で利用可能',

	// ---- RadarChart ----
	radarChartAriaLabel: 'ステータスレーダーチャート',
	radarChartNow: 'いま',
	radarChartDefaultComparisonLabel: 'せんげつ',

	// ---- SiblingCheerOverlay ----
	siblingCheerTitle: '💌 おうえんがとどいたよ！',
	siblingCheerFrom: (name: string) => `${name}から`,
	siblingCheerConfirmBtn: 'ありがとう！',

	// ---- SiblingRanking ----
	siblingRankingMe: 'じぶん',
	siblingRankingCount: (count: number) => `${count}かい`,
	siblingRankingPeriod: '（こんしゅう）',

	// ---- SiblingTrendChart ----
	siblingTrendChartAriaLabel: 'きょうだい週次トレンドグラフ',
	siblingTrendChartTitle: 'きょうだい週次トレンドグラフ',

	// ---- SpecialRewardOverlay ----
	specialRewardTitle: '🎁 とくべつごほうび！',
	specialRewardPoints: (points: number) => `+${points} ポイント！`,
	specialRewardConfirmBtn: 'やったー！',

	// ---- StampCard ----
	stampCardTitle: 'スタンプカード',
	stampCardPeriod: (start: string, end: string) => `${start}〜${end}`,
	stampCardRedeemed: (points: number) => `✅ ${points}pt もらったよ！`,
	stampCardComplete: '🎊 コンプリート！',
	stampCardCompleteSub: '週明けにボーナスポイントがもらえるよ！',
	stampCardStampedToday: '✅ きょうはもうおしたよ！',
	stampCardRemaining: (remaining: number) => `✨ あと${remaining}回でコンプリート！`,

	// ---- StampPressOverlay ----
	stampPressWeekLabel: (count: number) => `今週 ${count}回目！`,
	stampPressStreakLabel: (days: number) => `${days}にちれんぞく！`,
	stampPressComplete: 'コンプリート！',
	stampPressCompleteSub: '週末にボーナスポイント！',
	stampPressRemaining: (remaining: number) => `あと${remaining}回でコンプリート！`,
	stampPressNextBtn: 'つぎへ',
	stampPressConfirmBtn: 'やったね！',
	stampPressWeeklyTitle: '先週のがんばり',
	stampPressWeeklyCount: (filled: number, total: number) => `${filled}/${total} おしたよ！`,
	stampPressWeeklyComplete: 'コンプリート！',
	stampPressWeeklyBonus: (bonus: number) => `コンプリートボーナス +${bonus}pt`,
	stampPressWeeklyMessage: '今週もがんばろう！',

	// ---- TutorialBubble ----
	tutorialBubbleEnd: (isYoung: boolean) => (isYoung ? 'おわり' : '終了'),
	tutorialBubblePrev: (isYoung: boolean) => (isYoung ? 'もどる' : '戻る'),
	tutorialBubbleNext: (isYoung: boolean, isLast: boolean) =>
		isYoung ? (isLast ? 'おしまい！' : 'つぎへ') : isLast ? '完了！' : '次へ',
} as const;

// ============================================================
// AI 送信の注意書き (#4599)
// ============================================================
//
// AI 提案 3 種 (活動 / チェックリスト / ごほうび) と領収書 OCR の 4 経路で共有する
// 唯一の定義。4 経路にコピペせず、`AiInputNotice.svelte` 経由で参照する。
//
// プライバシーポリシー第9条④ (#4583 / PR #4598) と同じ事実を、入力する瞬間に短く述べる。
// ADR-0012 (anti-engagement) 整合で警告は積み上げず hint 1 行に留め、送信先の詳細
// (運営者が管理する AWS 環境内 / 運営者の環境外) は条文側へリンクで委ねる。
// 生成 AI の製品名はここにも UI にも書かない (#4370 / #4583 と同一規律)。

export const AI_INPUT_NOTICE_LABELS = {
	/** テキスト入力経路 (AI 提案 3 種) */
	text: `入力した文章は${AI_TRANSFER_TERMS.genAi}に送信されます。${CHILD_TERMS.honorific}の${AI_TRANSFER_TERMS.identifyingInfo}は書かないでください。`,
	/** 画像アップロード経路 (領収書 OCR) */
	image: `アップロードした領収書画像は${AI_TRANSFER_TERMS.genAi}に送信されます。${CHILD_TERMS.honorific}の${AI_TRANSFER_TERMS.identifyingInfo}が写らないようご注意ください。`,
	/** 送信先の詳細 (条文) への導線 */
	linkLabel: '送信先とあつかい',
	linkHref: 'https://www.ganbari-quest.com/privacy.html#under-age',
} as const;

// ============================================================
// features ラベル (#1465 Phase B Priority 3)
// src/lib/features/ 配下のハードコード文字列を集約。
// 機能カテゴリ別にネスト構造で管理する。
// ============================================================

export const FEATURES_LABELS = {
	// ---- features/battle/ ----
	battle: {
		// BattlePage
		pageTitle: '⚔️ きょうの バトル',
		loadError: 'バトルじょうほうを よみこめませんでした',
		loadingText: 'バトルちゅう...',
		// BattleScene
		playerName: 'きみ',
		playerSpriteAlt: 'きみ',
		statsTitle: 'きみのステータス',
		// #1791: ステータス 5 軸とカテゴリ 5 軸の対応表（自キャラ左 + 対応表で「直近の活動が攻撃力になる」を可視化）
		statCategoryHpLabel: 'うんどう',
		statCategoryAtkLabel: 'べんきょう',
		statCategoryDefLabel: 'こうりゅう',
		statCategorySpdLabel: 'せいかつ',
		statCategoryRecLabel: 'そうぞう',
		statCategoryAriaLabel: '対応するカテゴリ',
		statCategoryNote: '※ 直近 7 日間の各カテゴリの累積ポイントが、ステータスに反映されます',
		startBtn: '⚔️ バトル かいし！',
		alreadyDone: 'きょうの バトルは おわったよ！',
		resultWin: '🎉 かった！',
		resultLose: '😢 まけちゃった…',
		rewardWin: (points: number) => `+${points}ポイント`,
		rewardLose: (points: number) => `+${points}ポイント（なぐさめ）`,
		encourageLose: 'つぎは かてるよ！ がんばろう！',
		// BattleLog
		logEnemy: 'てき',
		logPlayer: 'きみ',
		logDefeated: (who: string) => `${who}は たおれた…`,
		logCriticalPrefix: 'かいしんの いちげき！ ',
		logAttack: (who: string, damage: number, critical: boolean) =>
			`${critical ? 'かいしんの いちげき！ ' : ''}${who}の こうげき！ ${damage} ダメージ`,
		logTurnLabel: (turn: number) => `ターン${turn}`,
	},

	// ---- features/birthday/ ----
	birthday: {
		// BirthdayBanner
		bannerTitle: 'おたんじょうびボーナスがとどいているよ！',
		bannerSub: (name: string, age: number) => `${name}${age}さいおめでとう！ タップしてうけとろう`,
		bannerPoints: (totalPoints: number) => `⭐${totalPoints}pt`,
		// BirthdayModal
		modalMainPreClaimed: 'おたんじょうび おめでとう！',
		modalAgeText: (name: string, age: number) => `${name}${age}さい になったね！`,
		modalRewardLabel: '🎁 おたんじょうびボーナス',
		modalRewardPoints: (points: number) => `⭐ ${points} ポイント！`,
		modalClaiming: 'もらっています...',
		modalClaimBtn: '🎉 うけとる！',
		modalConfirmYounger: 'やったー！',
		modalConfirmOlder: 'ありがとう！',
		modalSubBaby: 'これからも いっぱい がんばろうね！',
		modalSubElementary: 'これからもたくさんチャレンジしよう！',
		modalSubOlder: 'これからもチャレンジを続けよう！',
		modalMainBaby: (name: string, age: number) => `${name}${age}さい\nおめでとう！`,
		modalMainOlder: (name: string, age: number) => `${name}${age}歳\nおめでとう！`,
	},

	// ---- features/certificate/ ----
	certificate: {
		// CertificateTemplate
		title: 'がんばり証明書',
		quote: (title: string) => `「${title}」`,
		issuer: 'がんばりクエスト',
		watermarkText: 'SAMPLE',
		// ShareCard
		branding: 'がんばりクエスト',
	},

	// ---- features/character/ ----
	character: {
		// CharacterTabs — 短縮タブラベル
		tabStatusYoung: 'つよさ',
		tabStatusOlder: 'ステータス',
		tabChallenge: 'チャレンジ',
		tabHistoryYoung: 'きろく',
		tabHistoryOlder: '記録',
		// #4681: バトル入口 (elementary / junior / senior のみ。LP「ボスバトル」訴求の到達経路)
		tabBattle: 'バトル',
	},

	// ---- features/challenge/ ----
	challenge: {
		// SiblingCelebration
		celebrationTitle: 'みんなクリア！',
		celebrationClaimBtn: '🎁 ほうしゅうをうけとる！',
		celebrationCloseBtn: 'とじる',
		// #4410 AC4: 閉じたあとどこで受け取るのかをダイアログ内で示す。claim ボタン自体は
		// 戻さない (#3333 の二重導線排除を壊さない) — 場所の案内だけを置く。
		celebrationClaimHint:
			'ごほうびは とじたあと したの「🎁 ほうしゅうをうけとる！」ボタンから うけとれるよ',
		// #3361 (ux-4): claim 失敗時の可視フィードバック (dead-end 回避、NN/G #1)
		claimErrorTitle: 'うけとれなかったよ',
		claimErrorFallback: 'もういちど ためしてね',
	},

	// ---- features/child/ ----
	child: {
		// TutorialHintBanner
		hintTitle: 'つかいかた ガイド あるよ！',
		hintSub: 'いつでも ❓ ボタンで みれるよ',
		hintCloseAriaLabel: '閉じる',
	},

	// ---- features/demo/ ----
	demo: {
		// DemoGuideBar
		guideBackAriaLabel: 'もどる',
		guideSeePricing: 'プランを見る',
		guideStartBtn: 'はじめる',
		guideActionHint: 'やってみよう',
		guideNextBtn: 'つぎへ',
		guideDismissAriaLabel: 'ガイドを閉じる',
	},

	// ---- features/loyalty/ ----
	loyalty: {
		// ChurnPreventionModal
		churnListBullet: '・',
		churnTitle: '解約する前に...',
		churnContinuingMonths: (months: number) => `あなたは ${months}ヶ月 継続中です`,
		churnLostHeading: '解約すると失われるもの:',
		churnInsightCount: (name: string, count: number) =>
			`💡 ${name}は 今月 ${count}回 がんばりました`,
		churnNote: '※ 解約しても基本データは残ります。再開すれば継続月数も引き継がれます。',
		churnKeepBtn: 'やっぱり続ける',
		churnCancelBtn: '解約手続きへ',
		// LoyaltyBadge
		badgeTitle: 'サポーターバッジ',
		badgeSub: (months: number) => `サポーター継続: ${months}ヶ月目`,
		badgeMonths: (months: number) => `${months}ヶ月`,
		badgeNextLabel: (remaining: number) => `次のバッジまで: あと${remaining}ヶ月`,
		badgeAllReached: '🏆 全ティア到達！',
		badgeMemoryTickets: (count: number) => `思い出チケット: ${count}枚`,
		badgeLoginBonus: (multiplier: number) => `ログインボーナス ×${multiplier}`,
	},

	// ---- features/admin/components/ AI suggest 共通 ----
	// Phase 7 PR-L4 (#2836): 顧客可視の AI suggest gate 文言を premium atom 参照化 (ADR-0058)。
	aiSuggestCommon: {
		familyOnlyBadge: `${PLAN_TERMS.premium}限定`,
		familyOnlyError: (kind: string) => `${kind}は${PLAN_FULL_TERMS.premium}でご利用いただけます`,
		familyOnlyDescription: (kind: string) => `${kind}は${PLAN_FULL_TERMS.premium}で解放されます。`,
		familyUpgradeBtn: `${PLAN_FULL_TERMS.premium}にアップグレード`,
		thinkingLabel: '考え中...',
		suggestBtn: '提案する',
		retryBtn: 'やり直す',
		fallbackNote: 'AIが利用できなかったため、入力内容から推定しました',
		errorEstimate: '推定に失敗しました',
		errorNetwork: 'ネットワークエラーが発生しました',
		progressBaseAi: 'AIに聞いています...',
		progressBaseWait: 'もうちょっと待ってね...',
		progressBaseFinal: 'あとすこし...',
		progressChecklistThinking: 'もちものを考え中...',
	},

	// ---- features/admin/components/AiSuggestPanel ----
	aiSuggestActivity: {
		title: '✨ やりたいことを教えてください',
		kind: 'AI 活動提案',
		description: 'やりたい活動を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します',
		placeholder: '例: ピアノの練習をした、公園で走った、折り紙を作った',
		acceptBtn: 'この内容で追加フォームを開く',
		previewKana: (kana: string) => `ひらがな: ${kana}`,
		previewKanji: (kanji: string) => `漢字: ${kanji}`,
	},

	// ---- features/admin/components/AiSuggestChecklistPanel ----
	aiSuggestChecklist: {
		title: '✨ どんなもちものが必要？',
		kind: 'AI チェックリスト提案',
		description: 'シーンや学年を入力すると、持ち物リストを自動で提案します',
		placeholder: '例: 小学3年生の月曜日の持ち物、えんそく、プール',
		acceptBtn: 'この内容でテンプレートを作成',
		itemCount: (count: number) => `(${count}個)`,
		freqDaily: 'まいにち',
		dirBring: '持参',
		dirReturn: '持帰',
		dirBoth: '往復',
	},

	// ---- features/admin/components/AiSuggestRewardPanel ----
	aiSuggestReward: {
		title: '✨ どんなごほうびがいい？',
		kind: 'AI ごほうび提案',
		description: 'ごほうびの内容を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します',
		placeholder: '例: おもちゃ、外食、ゲーム時間+30分、おこづかい500円',
		acceptBtn: 'この内容で入力する',
	},

	// ---- features/admin/components/AiSuggestCheerPanel (#2273) ----
	// 出来事テキスト → P 値 + カテゴリ + アイコン + 理由要約推定
	// AiSuggestRewardPanel と入力プロンプト・出力意味が異なるため別 component
	aiSuggestCheer: {
		title: '✨ どんな出来事だった？',
		kind: 'AI 応援提案',
		description:
			'子供のがんばりや出来事を入力すると、応援ポイント・カテゴリ・アイコンを自動で提案します',
		placeholder: '例: 運動会で1位、テストで100点、お皿を進んで洗った',
		acceptBtn: 'この内容で応援を送る',
		reasonLabel: '理由',
	},

	// ---- features/admin/components/PremiumWelcome ----
	premiumWelcome: {
		dialogAriaLabel: (planLabel: string) => `${planLabel}へようこそ`,
		titleLine1: (planIcon: string, planLabel: string) =>
			`がんばりクエスト ${planIcon} ${planLabel} へ`,
		titleLine2: 'ようこそ！',
		dividerLabel: '解放された機能',
		message: 'お子さまの「がんばり」を\nもっと楽しく応援しましょう！',
		ctaBtn: 'さっそく始める →',
	},

	// ---- features/admin/components/AdminLayout ----
	adminLayout: {
		demoBadge: 'デモ',
		upgradeBtn: 'アップグレード',
		pageGuideTitle: 'このページの使い方',
		tutorialRestartTitle: 'チュートリアルを開始',
		demoTopLink: 'デモトップ',
		switchToChild: '子供画面へ',
		desktopNavAriaLabel: '管理メニュー',
		mobileNavAriaLabel: 'メインナビゲーション',
		mobileMenuCloseAriaLabel: 'メニューを閉じる',
	},

	// ---- features/admin/components/AddActivityModeSelector ----
	// ---- features/admin/components/HiddenActivitiesSection ----
	hiddenActivities: {
		toggleLabel: (count: number) => `非表示の活動 (${count}件)`,
		closeIcon: '▲ 閉じる',
		openIcon: '▼ 開く',
		recordCount: (count: number) => `/ 記録 ${count}件`,
		restoreBtn: '復活',
		permanentDeleteBtn: '完全削除',
	},

	// ---- features/admin/components/TrialEndedDialog ----
	trialEndedDialog: {
		title: '無料体験が終了しました',
		message: '無料体験期間が終了しました。\nフリープランの範囲内で引き続きご利用いただけます。',
		messageLine1: '無料体験期間が終了しました。',
		messageLine2: 'フリープランの範囲内で引き続きご利用いただけます。',
		note1: `${PLAN_FULL_TERMS.free}の上限を超えるお子さま・活動・チェックリストは一時的に非表示（アーカイブ）になります`,
		note2: 'データは削除されません — 有料プランにすると自動で元に戻ります',
		ctaBtn: '⭐ プランを見る',
		dismissBtn: 'あとで',
	},

	// ---- features/admin/components/ActivitiesHeader ----
	// EPIC #2253 / #2255 / #2257: + dropdown menu + ︙ overflow menu に再構成
	// #2260 Fix-2: +page.svelte L167 hardcode の Dialog title 3 件を SSOT 化 (ADR-0045 / ADR-0009)
	activitiesHeader: {
		title: '📋 活動管理',
		exportAriaLabel: 'エクスポート',
		introduceAriaLabel: '活動の紹介',
		clearAllAriaLabel: '全クリア',
		// + dropdown menu に統合 (EPIC #2253 / #2255 / #2558 段階2)
		// #2558 段階2 (PO 方針: マーケットプレイス一本化): 「追加」と「一括追加」を 1 つの
		// 「+ 追加」メニューに統合。`import` 項目は admin 内ブラウズ UI を撤去し /marketplace へ画面遷移する。
		addButtonLabel: '+ 追加',
		addMenuAriaLabel: '活動を追加するメニューを開く',
		addManualLabel: '手動で1つ追加',
		addManualIcon: '✏️',
		addAiLabel: 'AI で提案してもらう',
		addAiIcon: '✨',
		// #2558 段階2 (bug-3 / bug-4 根治): 内部語彙「パック」を排し、admin 内ブラウズ UI でなく
		// みんなのテンプレート (/marketplace) への画面遷移を表す文言に統一。
		addBrowseTemplatesLabel: `${TEMPLATE_TERMS.userFacing}から探す`,
		addBrowseTemplatesIcon: '🔍',
		// #2558 段階2: copy / bulk を + 追加メニューに統合 (トップレベル独立ボタンを撤去)
		addCopyFromChildLabel: `別の${CHILD_TERMS.honorific}からコピー`,
		addCopyFromChildIcon: '📋',
		addBulkLabel: `複数の${CHILD_TERMS.honorific}にまとめて追加`,
		addBulkIcon: '👨‍👩‍👧‍👦',
		// Add Dialog title (mode 別、#2260 Fix-2 で +page.svelte hardcode を SSOT 化)
		addDialogTitleManual: '+ 手動で追加',
		addDialogTitleAi: '✨ AI で活動を追加',
		// ︙ overflow menu (restore / export / clear-all、EPIC #2253 / #2257 + #2558 段階2)
		// #2371 (EPIC #2362 PO 指摘 ③): introduce 撤去 (PR #2388 で PageGuideOverlay v2 + PageGuideRegistry 経由 `?` ボタンに統一済)
		// #2558 段階2: マーケットプレイスとは別概念の「バックアップから復元」をブラウズ UI 撤去に伴い overflow menu に独立配置
		overflowMenuAriaLabel: 'その他の操作',
		overflowTriggerLabel: '︙',
		restoreLabel: OVERFLOW_MENU_TERMS.itemRestore,
		restoreIcon: OVERFLOW_MENU_TERMS.itemRestoreIcon,
		exportLabel: 'エクスポート',
		exportIcon: '📤',
		clearAllLabel: 'すべて削除',
		clearAllIcon: '🗑',
		// #2558 段階2: バックアップから復元ダイアログ (旧 UnifiedImportHub file セクションの独立化)
		restoreDialogTitle: `📥 ${OVERFLOW_MENU_TERMS.itemRestore}`,
		// #backup-terms: 活動取込は JSON バックアップに加え CSV (自作表計算) も読み込めるため CSV を露出する (ADR-0013 truth、#3079 AC4)
		// #3201: 2 つの入力源 (書き出したバックアップ / 自作 CSV) を平易に並記 + 家族全体 (画像・音声含む)
		// の復元先は 設定 > データ である旨を誘導 (受理 format が画面ごとに異なる混乱の予防)
		restoreDialogDesc: `以前書き出した活動の${BACKUP_TERMS.file}か、表計算ソフトで作った${BACKUP_TERMS.csvFile}を読み込んで取り込みます。みんなのテンプレートの取り込みとは別の機能です。家族全体のデータ（画像・音声を含む）の${BACKUP_TERMS.restoreVerb}は「設定 > データ」から行えます。`,
		restoreSubmitBtn: '読み込む',
		restoreProcessing: '読み込み中…',
		restoreSuccess: (name: string, imported: number, skipped: number) =>
			skipped > 0
				? `✨ 「${name}」から ${imported} 件を復元しました (${skipped} 件は既存のためスキップ)`
				: `✨ 「${name}」から ${imported} 件を復元しました`,
		restoreAllDuplicates: (name: string) => `「${name}」の活動はすべて既に登録済みです`,
		restoreFailed: '復元に失敗しました',
		restoreDemo: 'デモではお試し用です（実際の復元は行われません）',
		restoreFileRequired: 'ファイルを選択してください',
		restoreFileFallbackName: 'ファイル',
	},

	// ---- features/admin/components/NotificationPermissionBanner ----
	// #2115 (Bug fix: loading / try-catch / Toast / fallback)
	// #2116 (透明性 UX: 2 段階開示 informed consent)
	notificationBanner: {
		title: '通知でもっと便利に',
		desc: '毎日のリマインダーで お子さまの がんばりを サポートしましょう',
		// #2116 AC1: 第 1 段階 (頻度 / 内容 / 送信先 / quiet hours が一目で把握可能)
		descCompact:
			'毎日 1 回まで、お子さまのがんばりリマインダーを親端末にお届けします（21:00-07:00 はお休み）',
		ctaBtn: '通知を受け取る',
		dismissBtn: 'あとで',
		// #2115 AC2: loading 中表示
		loadingLabel: '設定中…',
		// #2115 AC3: 成功 Toast
		toastSuccessTitle: '通知を有効化しました',
		toastSuccessDesc: '次回から大事なリマインダーをお届けします',
		// #2115 AC4: 失敗 fallback UI
		errorTitle: '通知を有効にできませんでした',
		errorDescDenied: 'ブラウザの設定で通知が拒否されている可能性があります。',
		errorDescGeneric: '通知の設定中にエラーが発生しました。時間をおいて再度お試しください。',
		errorSettingsLinkLabel: 'ブラウザの通知設定を確認する方法',
		// #2116 AC3-4: 2 段階開示 disclosure
		disclosureLabel: '📖 通知について詳しく',
		disclosureContent: {
			reminderTitle: 'がんばりリマインダー（毎日 1 回まで）',
			reminderExample: '例:「きょうも がんばろう！」「○○さんの がんばりを きろくしよう！」',
			streakWarningTitle: '連続記録のお知らせ',
			streakWarningExample: 'がんばりの連続記録が途切れそうなときにお知らせします',
			achievementTitle: '達成のお祝い',
			achievementExample: 'お子さまが新しいバッジや称号を獲得したときにお知らせします',
		},
		disclosureParentOnly: '通知はすべて親端末にのみ送られます。お子さまの端末には届きません。',
		disclosureQuietHours: '21:00〜07:00 はおやすみ時間で通知を送りません。',
		disclosureOffNote: '通知はあとから設定画面でいつでも OFF にできます。',
		disclosureSettingsLinkLabel: '通知の設定画面を開く',
	},

	// ---- features/admin/components/OnboardingChecklist ----
	onboardingChecklist: {
		progressAriaLabel: (pct: number) => `セットアップ進捗 ${pct}%`,
		nextRecLabel: '次のおすすめ:',
		dismissBtn: '非表示にする',
	},

	// ---- features/admin/components/PlanStatusCard ----
	planStatusCard: {
		freePlan: `${PLAN_FULL_TERMS.free}`,
		// Phase 7 PR-L4 (#2836): /admin/subscription の現在プランカードを premium atom 参照化 (ADR-0058)。
		// 旧「スタンダード プラン」「ファミリー プラン」直書きは family→premium rename 漏れだった。
		// 短縮 atom + 「 プラン」(空白付き) で従来の表示文字列を維持する。
		standardPlan: `${PLAN_TERMS.standard} プラン`,
		familyPlan: `${PLAN_TERMS.premium} プラン`,
		unlimited: '無制限',
		// #4482: 整形は formatRetentionPeriod が SSOT（365 の倍数なら「1年間」と述べる）。
		retentionDays: (days: number) => `${formatRetentionPeriod(days)}間`,
		trialBadge: (days: number) => `トライアル中（残り${days}日）`,
		statCustomActivity: 'カスタム活動',
		statChildren: 'こども',
		statRetention: 'データ保持',
		trialNote: (tierLabel: string) =>
			`${tierLabel}の全機能を体験中です。トライアル終了後もこのまま使うには本契約が必要です。`,
		processingText: '処理中...',
		makeContractBtn: '本契約する',
		upgradeBtn: '⭐ スタンダードにアップグレード',
		planDetailLink: 'プランの詳細',
		// Phase 7 PR-L4 (#2836): premium atom 参照化 (ADR-0058、family→premium rename 漏れ)。
		familyUpgradeBtn: `⭐⭐ ${PLAN_TERMS.premium}へ`,
	},

	// ---- features/admin/components/ActivityImportPanel (#2391 で物理削除済) ----
	// 旧 ActivityImportPanel.svelte は UnifiedImportHub.svelte に統合された。
	// UNIFIED_IMPORT_HUB_LABELS が後継 SSOT (このファイル後段)。

	// ---- features/admin/components/ActivityLimitBanner ----
	activityLimitBanner: {
		title: (current: number, max: number | null) =>
			`登録上限に達しています（${current}/${max ?? '無制限'}）`,
		linkLabel: 'プランをアップグレード →',
	},

	// ---- features/admin/components/ActivityClearAllConfirm ----
	activityClearAllConfirm: {
		// #4692 F3: 対象範囲を書かない「本当に全削除しますか？」は撤去。
		// 確認文は ADMIN_CHILD_SCOPE_LABELS.clearAllScopedConfirm(子の名前, 件数) を使う。
		processingText: '処理中...',
		executeBtn: '実行',
		cancelBtn: 'やめる',
		resultMessage: (deleted: number, hidden: number) =>
			`🗑 ${deleted}件削除、${hidden}件非表示にしました`,
	},

	// ---- features/admin/components/ActivityListItem ----
	activityListItem: {
		mainQuestBadge: '⚔️ メインクエスト ×2',
		closeBtn: '閉じる',
		editBtn: '編集',
		visibleBtn: '表示',
		hiddenBtn: '非表示',
		mainQuestEnable: '⚔️設定',
		mainQuestDisable: '⚔️解除',
		dailyLimitDefault: '1回/日',
		dailyLimitUnlimited: '無制限',
		dailyLimitN: (n: number) => `${n}回/日`,
		ageRange: (min: number, max: number) => `${min}-${max}歳`,
	},

	// ---- features/admin/components/ActivityEmptyState ----
	// EPIC #2253 / #2256: primary CTA + secondary import link の 2 段構成 (bulk import bridge)
	activityEmptyState: {
		filteredText: 'この条件に一致する活動はありません',
		noActivities: '活動がまだ登録されていません',
		addBtn: '+ 最初の活動を追加',
		// #2558 段階2 (bug-3 / bug-4 根治): admin 内ブラウズ UI でなく /marketplace への遷移を表す文言に統一
		secondaryImportLink: `または、${TEMPLATE_TERMS.userFacing}から探す`,
	},

	// ---- features/admin/components/ChildListCard ----
	childListCard: {
		meta: (age: number, tierLabel: string, themeLabel: string) =>
			`${age}歳 / ${tierLabel} / ${themeLabel}`,
	},
} as const;

/**
 * 法的文書 SSOT (#1638 / #1590)
 *
 * site/privacy.html / site/terms.html / signup フォームで横断的に使う
 * 法律用語のキー語彙。各 value が site/privacy.html / site/terms.html に出現することを
 * 検証する CI は無い（専用 lint は #4322 で撤去済。機械強制は無く、HTML との文言整合は
 * レビューで担保する、#4482）。key の存在は tests/unit/domain/legal-labels.test.ts が検証する。
 *
 * 注: site/*.html は SEO meta 等の例外を含むため、キー用語の存在確認のみで
 * data-label 等の SSOT 注入は要求しない（ADR-0009 例外）。
 */
export const LEGAL_LABELS = {
	graduation: '卒業',
	graduationDef: 'ポジティブな解約',
	externalTransmission: '外部送信規律',
	externalTransmissionLaw: '電気通信事業法第27条の12',
	familyUniqueId: '家族内一意 ID',
	underAge: '未成年者',
	crossBorderTransfer: '外国にある第三者への提供',
	crossBorderLaw: '個人情報保護法第28条',
	scc: '標準契約条項 (Standard Contractual Clauses, SCC)',
	dpa: 'Data Processing Addendum (DPA)',
	signupCrossBorderConsent: 'サービス提供に必要な範囲でのデータ保存・処理に同意します',
} as const;

// ============================================================
// Push Notification 関連 (#1593 ADR-0023 I6)
// 子端末への push 通知は構造的禁止 (Anti-engagement ADR-0012 + COPPA 改正)
// ============================================================
export const PUSH_NOTIFICATION_LABELS = {
	/** child role が subscribe を試みた際の API エラーメッセージ */
	childSubscribeForbidden:
		'お子さま用アカウントでは通知を受け取れません。保護者アカウントで設定してください。',
	/** 監査ログ用: child 端末への通知送信を skip した際のメッセージ */
	childSendSkipped: 'child role の subscription への push 送信をスキップしました',
	/** 既存レコードに不正な role が混入していた場合の警告 */
	unknownRoleSkipped: '不明な subscriber_role の subscription への送信をスキップしました',
} as const;

// ============================================================
// LP Pages added dynamically
// ============================================================

// 注: LP_LICENSEKEY_LABELS (旧 site/help/license-key.html 用) は Epic #2525 Phase 7 PR-L4 (#2836)
//     license key 全廃 + help ページ完全削除に伴い撤去済。`/help/license-key` → `/admin/subscription`
//     301 redirect (LEGACY_URL_MAP) で bookmark / 外部リンクを救済する。

// #1896 (PO-4-10): text1 / text2 を LP_FAQ_TERMS.canonicalLong 参照化（用語 SSOT 集約）。
export const LP_FAQ_LABELS = {
	text1: `${LP_FAQ_TERMS.canonicalLong} - がんばりクエスト`,
	text2: `${LP_FAQ_TERMS.canonicalLong}`,
	text3: 'お気軽にメール',
	text4: 'カテゴリ一覧',
	text5: '1. トライアル・解約',
	text6: '2. 料金・課金',
	text7: '3. プライバシー・データ',
	text8: '4. 対応年齢・使い方',
	text9: '5. 技術的なご質問',
	text10: 'トライアル・解約について',
	// #1915 (TECH-F 中頻度 D-1): TRIAL_PERIOD_TERMS atom 経由 + #1914 (TECH-F): CANCEL_TERMS.canonical 経由
	text11: `${TRIAL_PERIOD_TERMS.full}と、いつでも${CANCEL_TERMS.canonical}できる仕組みについて。`,
	text12: '無料トライアルの申込にクレジットカードは必要ですか？',
	text13: 'いいえ、不要です。',
	// #1943 (Phase 3 D3): 「無料プラン」atom を PLAN_FULL_TERMS.free 参照化 (LP_FAQ_LABELS 4 件)。
	text14: `トライアル期間終了時は自動で${PLAN_FULL_TERMS.free}に戻ります。課金への切り替えは必ず${ADMIN_VIEW_TERMS.canonical}からお客さまご自身の操作で行っていただきます。`,
	text15: 'トライアル後は自動で課金されますか？',
	text16: '自動課金はされません。',
	text17: `有料プランを継続したい場合のみ、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」から明示的にアップグレードしてください。クレジットカード情報の入力はアップグレード操作の中で初めて求められます。`,
	text18: `途中で${CANCEL_TERMS.canonical}するとどうなりますか？`,
	// #4496: 旧文言は退会の猶予期間と物理削除を解約の説明に転用していた (LP_FAQ_PHASEB_LABELS
	//   k19-k22 と同一内容)。解約はデータを削除しない — 実装事実は PRICING_PAGE_LABELS.faqCancelA 参照。
	// #4619: LP_FAQ_PHASEB_LABELS k19-k21 と同じ事実を述べる (日割り返金なし / 移行後も
	//   記録・ポイント付与を継続できる / 保持期間超過分は復元不能)。
	text19: `${CANCEL_TERMS.canonical}してもデータは削除されません。現在の請求期間の終了日までは有料プランをそのままご利用いただけ（日割り計算による返金はありません）、その後は${PLAN_FULL_TERMS.free}へ自動的に切り替わります。`,
	text20: WRITES_CONTINUE_ASSURANCE,
	text21: FREE_PLAN_RETENTION_NOTICE,
	text22: `必要な記録がある場合は、${ADMIN_VIEW_TERMS.canonical}からデータをエクスポートしてください。`,
	text23: 'トライアル中に作ったデータは残りますか？',
	text24: 'はい、残ります。',
	text25: `ただし${PLAN_FULL_TERMS.free}の制限（お子さま 2 人まで、活動 3 個までなど）を超える分は一時的に非表示（アーカイブ）になります。削除はされず、保護者の管理画面で非表示中のお子さまを確認できますが、記録・編集はできません。有料プランにアップグレードすると自動で元に戻ります。`,
	text26: '解約後に再開することはできますか？',
	text27: `${CANCEL_TERMS.canonical}のお手続き後、現在の請求期間の終了日までは有料プランをそのままご利用いただけます。その間はいつでも${ADMIN_VIEW_TERMS.canonical}から${CANCEL_TERMS.canonical}を取り消して継続できます。`,
	text28: `ただし${PLAN_FULL_TERMS.free}の保持期間（${PLAN_RETENTION_TERMS.freeSpaced}）を超えて削除された記録は、再契約しても復元できません。`,
	text29: '料金・課金について',
	text30: `3 つのプラン（${PLAN_TERMS.freeCardName} / ${PLAN_TERMS.standard} / ${PLAN_TERMS.premium}）と、課金の仕組みについて。`,
	text31: `${PLAN_FULL_TERMS.free}と有料プランは何が違いますか？`,
	text32: `${PLAN_FULL_TERMS.free}でもすべてご利用いただけます`,
	text33: '有料プランで解放される主な機能:',
	text34: 'お子さま・活動の人数制限解除（無料: お子さま 2 人 / 活動 3 個まで）',
	text35: `長期の履歴保持（無料: 過去 ${PLAN_RETENTION_TERMS.freeSpaced}まで → 有料: 無期限）`,
	text36: 'AI 自動提案（活動案・ごほうび案）',
	text37: 'きょうだいランキング・家族メンバー招待',
	text38: 'データのバックアップ',
	text39: '料金プランページ',
	text40: '子供が勝手に課金してしまう心配はありませんか？',
	text41: 'ありません。',
	text42: 'プラン変更・アップグレードは「保護者ロール」のログインが必要',
	text43: 'お子さまアカウントはプラン変更ボタン自体が表示されない',
	text44: 'Stripe の決済画面は必ず保護者のカード情報と明示的な確認ステップを経る',
	text45: '「無断課金」が構造的に発生しない設計のため、お子さまに安心してデバイスを渡せます。',
	text46: '兄弟姉妹で使うと、どちらかだけがゲーミフィケーションされて不公平になりませんか？',
	text47: '片方だけが得をする構造にはなりません',
	text48: `${PLAN_FULL_TERMS.standard}`,
	text49: `${PLAN_FULL_TERMS.premium}`,
	text50: '無制限',
	text51: `きょうだいランキング機能（${PLAN_FULL_TERMS.premium}）では、年齢差を考慮した調整もできるため「上の子が有利すぎる」状況を緩和できます。`,
	text52: '支払い方法は何が使えますか？',
	text53:
		'クレジットカード（Visa / Mastercard / JCB / American Express）に対応しています。Stripe による安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。',
	text54: 'プランを途中で解約した場合の返金は？',
	text55:
		'途中解約された場合も、お支払い済みの残り期間は引き続きご利用いただけます（プレミアム機能は期間満了まで有効）。',
	text56: '特定商取引法に基づく表記',
	text57: `プランの変更（${PLAN_TERMS.standard}↔${PLAN_TERMS.premium}）はできますか？`,
	text58: `はい。${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」からお手続きいただけます。`,
	text59:
		'アップグレード時は即座に反映され、ダウングレード時は次回更新日から新プランが適用されます。ご不明な点はお問い合わせください。',
	text60: 'プライバシー・データについて',
	text61: 'お子さまのデータの取り扱いと、サービス終了時の保証について。',
	text62: 'お子さまのデータが広告に使われることはありませんか？',
	text63: 'ありません。',
	text64: 'プライバシーポリシー',
	text65: 'データのエクスポート（書き出し）はできますか？',
	text66: `${PLAN_FULL_TERMS.standard}以上`,
	// #1815: 「シール、称号、」を削除（export-service.ts に実装がなく ADR-0013 LP truth 違反のため）
	text67: 'エクスポート対象: お子さま情報、活動、ポイント履歴、チェックリスト。',
	text68: 'お引越しや他のサービスへの移行、ご自身でのバックアップにご利用いただけます。',
	text69: 'サービスが終了したらデータはどうなりますか？',
	text70: '30 日以上前までに',
	text71: '通知: 終了日の 30 日以上前にメールでお知らせ',
	text72: 'エクスポート期間: 通知から終了日まで継続',
	text73: '終了後: すべてのデータを完全削除',
	text74: '利用規約',
	text75: `${CANCEL_TERMS.account}・アカウント削除はすぐにできますか？`,
	// #4496: 猶予はプラン別 (無料は 0 日 = 申請と同時に物理削除)。k76 / k77 と同一内容。
	text76: `${ADMIN_VIEW_TERMS.canonical}から${CANCEL_TERMS.account}（アカウント削除）を申請できます。猶予期間はご利用プランによって異なります（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）。`,
	text77: `${PLAN_FULL_TERMS.free}は申請と同時に削除されるため、取り消しもエクスポートもできません。有料プランは猶予期間中に申請の取り消しとデータのエクスポートができます。猶予期間の経過後、全データは完全に削除されます（復旧はできません）。`,
	text78: 'データはどこに保存されていますか？',
	text79: 'プライバシーポリシー',
	text80:
		'決済情報は Stripe（国際的な PCI DSS 準拠の決済プロバイダ）で管理されており、当サービスのサーバーにはカード番号等の秘匿情報を保持していません。',
	text81: '対応年齢・使い方について',
	text82: '0〜18 歳までの年齢モードと、日々の運用のしかたについて。',
	text83: '何歳から何歳まで使えますか？',
	text84: '0 〜 18 歳まで、5 つの年齢モードをご用意しています:',
	text85: '乳幼児（0-2 歳）',
	text86: '幼児（3-5 歳）',
	text87: '小学生（6-12 歳）',
	text88: '中学生（13-15 歳）',
	text89: '高校生（16-18 歳）',
	text90: `お子さまが成長したら、${ADMIN_VIEW_TERMS.canonical}から年齢モードを切り替えるだけで UI が自動で変わります。`,
	text91: 'お子さまが成長して年齢モードが変わる時、データはどうなりますか？',
	text92: 'ポイント・シール・レベル称号・履歴はすべて引き継がれます',
	text93:
		'例: 幼児モードで貯めた「ドラゴン」シールは、小学生モードに切り替えても同じコレクションに残ります。連続ログイン日数・レベルも継続します。',
	text94: '親が毎日設定する手間はどれくらいかかりますか？',
	text95: '初回セットアップ（5 分）と、日々の運用（1 日 30 秒〜）で回せるよう設計されています。',
	text96: '初日',
	text97: '毎日',
	text98: '週 1 回',
	text99:
		'親が毎日新しい活動を作る必要はありません。プリセットをそのまま使うか、年齢が変わった時にテンプレートを切り替えるだけで運用できます。',
	text100: 'スクリーンタイムが長くなる心配はありませんか？',
	text101:
		'「長く遊ばせる」設計にしていません。本サービスは「活動記録アプリ」であり、お子さまがアプリ内で過ごす時間は 1 回 1 〜 3 分が想定です。',
	text102: '活動記録 → ポイント獲得 → シール抽選 → 結果確認で完了（1 〜 3 分）',
	text103: '動画視聴・無限スクロール・配信コンテンツは一切なし',
	text104: '15 分の無操作で画面が自動で閉じる使いすぎ防止タイマーで、長時間滞在を防止',
	text105:
		'「スクリーンタイムを奪うのではなく、リアルの行動を促す」動機付けツールとしてお使いください。',
	text106: '祖父母や親戚も使えますか？',
	text107: `${PLAN_FULL_TERMS.premium}`,
	text108: '無制限',
	text109:
		'招待されたメンバーには閲覧権限を割り当てられ、お子さまへのコメントやスタンプ送付も可能です。',
	text110: '技術的なご質問',
	text111: 'デバイス・ブラウザ対応と、ソースコードの公開について。',
	text112: 'スマホ・タブレット・PC、何台まで使えますか？',
	text113:
		'デバイス数の制限はありません。Web ブラウザ（Chrome / Safari / Edge など）があれば、どのデバイスからでもログインしてお使いいただけます。',
	text114:
		'PWA（Progressive Web App）としてホーム画面にも追加できます。iOS / Android どちらもサポートしています。',
	text115: 'オフラインでも使えますか？',
	text116: `基本的な活動記録はオフラインでも動作します（PWA のキャッシュ機能）。ただしデータ同期・新規${SIGNUP_TERMS.canonical}・決済などはオンライン接続が必要です。`,
	text117:
		'旅行中や電波の弱い場所でも、お子さまが活動を記録 → ネット復帰時に自動同期、という使い方ができます。',
	text118: 'ソースコードは公開されていますか？',
	text119: 'ソースコードを公開',
	text120: '自前運用ガイド',
	text121:
		'これは「運営が終了してもアプリ自体は残り続ける」安心のための仕組みです。通常のご家庭はクラウド版をそのままお使いいただければ十分です。',
	text122: 'ほかにご質問はありますか？',
	text123: '上記にないご質問や、ご要望・フィードバックは、メールでお気軽にお寄せください。',
	text124: '通常 1 〜 2 営業日以内にご返信いたします。',
	text125: `${FREE_TERMS.tryFree}`,
	text126: 'デモを見る',
	text127: 'img src="logo-compact.png" alt="がんばりクエスト" height="44"',
	text128:
		'button class="hamburger" aria-label="メニュー" aria-expanded="false" aria-controls="main-nav" onclick="var n=this.nextElementSibling;n.classList.toggle(\'open\');var o=n.classList.contains(\'open\');this.textContent=o?\'✕\':\'☰\';this.setAttribute(\'aria-expanded\',o)"',
	text129: 'nav class="faq-toc" aria-label="FAQ目次"',
	text130:
		'a href="mailto:ganbari.quest.support@gmail.com?subject=FAQページからのお問い合わせ" data-contact-context="FAQ bottom"',
} as const;

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
	text19: ' データは完全にご自身の管理下。外部サーバーにデータを送信しません。',
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
	text45: 'API キーの自前設定が必要',
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
	k84: '家族のデータが広告にも第三者にも使われない設計です。サービス停止時は事前にお知らせ + データの書き出しができます。お子さまの記録は確実に手元に残せます。',
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
// LP_PAMPHLET_LABELS (#1465 SSOT Fixes)
//
// #1956 (Phase 3 D11): terms.ts atom (PLAN_TERMS / PLAN_FULL_TERMS / FREE_TERMS / CTA_TERMS /
//   TRIAL_TERMS) 参照化対象。char-by-char 一致厳守。
//   '7 日間' (半角スペース有り) は TRIAL_TERMS.duration ('7日間' スペース無し) と一致しないため
//   直書き継続（#2007 / #2008 / #2009 と同方針）。
// ============================================================

export const LP_PAMPHLET_LABELS = {
	k1: 'がんばりクエスト パンフレット',
	k2: '&#x1F5A8; 印刷 / PDF保存',
	k3: 'ブラウザの「印刷」からPDFとして保存できます。用紙サイズはA4を選択してください。',
	k4: 'がんばりクエスト',
	k5: 'こどもの がんばりを ぼうけんに',
	k6: '      「やりなさい」を',
	k7: '「やりたい！」',
	k8: 'に変える',
	k9: '      お子さまの毎日のがんばりをRPG風の冒険に変えて、',
	k10: '      ポイント、レベルアップ、チャレンジで',
	k11: '      「自分から動く力」を育てる家庭向けWebアプリです。',
	k12: '&#x2728; 3 つの仕組みで、毎日のがんばりが本物の報酬になる',
	k13: '活動',
	k14: ' 毎日の活動 &#x2192; ポイント',
	// #1912 (F-12 + F-11): zombie pamphletExtra namespace。「プリセット活動がそのまま使える」→
	//   「あらかじめ用意された 300 種類の活動がそのまま使える」へ顧客語彙化（長文での冗長な機能名連呼を解消）。
	//   F-11 「セットアップ」も LP 訴求文では「最初の準備」へ顧客語彙化（IT リテラシーなし親 P1 向け）。
	k15: '「はみがきした」「宿題おわった」をタップするだけ。あらかじめ用意された 300 種類の活動がそのまま使えるので設定は最小限。記録のたびにポイントが積み上がります。',
	k16: '習慣',
	k17: ' おみくじスタンプ &#x2192; 習慣',
	k18: '1 日 1 回までのおみくじスタンプ。週 5 日タップで 1 枚分のポイントに自動交換できます。三日坊主を防ぐ「毎日記録する習慣」を作ります。',
	k19: 'ごほうび',
	k20: ' ごほうびショップ &#x2192; 交換',
	k21: '&#x1F308; 3歳から18歳まで &#8212; 年齢に合わせた UI',
	k22: '&#x1F476; 0〜2歳のお子様は「準備モード」でご登録いただけます',
	k23: '小学生以上',
	k24: '6&#x301C;18歳',
	// #1956 (Phase 3 D11): 'まずは無料' = FREE_TERMS.start 部分参照化（PR-2008 ctaBottomDesc と同パターン）
	k25: `&#x1F3AE; ${FREE_TERMS.start}で始めよう！`,
	k26: '登録は1分。お子さまの名前と年齢を入れるだけで、今日から冒険が始まります。',
	k27: '&#x1F310; アクセスはこちら',
	k28: 'がんばりクエスト &#x2014; &#x6599;&#x91D1;&#x30D7;&#x30E9;&#x30F3; &amp; &#x59CB;&#x3081;&#x65B9;',
	k29: '&#x1F4B0; 料金プラン',
	k30: 'すべてのプランで冒険の仕組み（レベル・おみくじ・スタンプカード等）が使えます',
	// #1913 (UIUX-E-7): k31 = FREE_PLAN_TERMS.planSelfNoun, k32 「ずっと無料」→「永久無料」(FREE_PLAN_TERMS.forever) で
	//                   AC8 統一（pricing card price sub bullet）。
	k31: `${FREE_PLAN_TERMS.planSelfNoun}`,
	k32: `${FREE_PLAN_TERMS.forever}`,
	k33: 'お子さまの登録：2人まで',
	k34: 'プリセット活動の利用',
	k35: 'オリジナル活動の作成：3個まで',
	k36: 'レベル・ポイント・おみくじ・スタンプカード',
	// #1912 (F-6): zombie pricingExtra namespace。LP_PRICING_PHASEB_LABELS.k5 と同方針で日本語化。
	k37: '毎日のごほうび・続けるごほうび',
	// #1710 R3-C: 旧「持ち物／毎日習慣」統合表現を「持ち物チェックリスト」に純化（責務分離: 持ち物 = event-* / 毎日 must = 活動 priority 属性）
	k38: '持ち物チェックリスト 3個/子まで',
	k39: `${PLAN_RETENTION_TERMS.free}間の履歴保持`,
	k40: '&#x2B50; おすすめ',
	// #1956 (Phase 3 D11): 'スタンダード' = PLAN_TERMS.standard、
	//   '7日間無料体験' = TRIAL_TERMS.duration + CTA_TERMS.freeTrialNoun
	k41: `${PLAN_TERMS.standard}`,
	k42: '/月（税込）',
	k43: `${TRIAL_TERMS.duration}${CTA_TERMS.freeTrialNoun}`,
	k44: '子供の登録：無制限',
	k45: 'オリジナル活動：無制限',
	k46: `家族メンバー招待：${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで（オーナーを含めご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}）`,
	k47: `${REWARD_TERMS.productRegistration}`,
	k48: 'データのダウンロード',
	k49: `${PLAN_RETENTION_TERMS.standard}間の履歴保持`,
	k50: 'メールサポート',
	// #1956 (Phase 3 D11): 'ファミリー' = PLAN_TERMS.premium、
	//   '7日間無料体験' = TRIAL_TERMS.duration + CTA_TERMS.freeTrialNoun、
	//   'スタンダードの全機能' = PLAN_TERMS.standard + 'の全機能'（#1947 LP_PRICING_EXTRA_LABELS k19 と同パターン）
	k51: `${PLAN_TERMS.premium}`,
	k52: '/月（税込）',
	k53: `${TRIAL_TERMS.duration}${CTA_TERMS.freeTrialNoun}`,
	k54: `${PLAN_TERMS.standard}の全機能`,
	k55: '家族メンバー招待：無制限',
	k56: 'AI 自動提案（活動・ごほうび・チェックリスト）',
	k57: 'きょうだいランキング',
	k58: 'ひとことメッセージ（自由テキスト）',
	k59: '家族のデータ預かり枠（同時保管 10 件・自分でダウンロード可）',
	k60: '無制限の履歴保持',
	k61: 'メールサポート',
	k62: '&#x1F680; かんたん3ステップで始められます',
	k63: 'アカウント登録（無料）',
	k64: 'メールまたはGoogleアカウントで。',
	k65: '1分で完了します。',
	k66: 'お子さまの年齢と性別を設定',
	k67: '年齢に合わせた活動が',
	k68: '自動でセットアップ。',
	k69: '冒険スタート！',
	k70: '活動を記録するたびに',
	k71: 'ポイント獲得 &amp; レベルアップ！',
	// #1896 (PO-4-10): 旧 k72: '&#x2753; よくある質問' を LP_FAQ_TERMS.canonicalLong 参照化
	//   ('&#x2753; よくあるご質問' に統一)。本 namespace は pamphlet.html FAQ 見出し。
	k72: `&#x2753; ${LP_FAQ_TERMS.canonicalLong}`,
	k73: '料金はかかりますか？',
	// #1956 (Phase 3 D11): 'スタンダード' = PLAN_TERMS.standard、'ファミリープラン' = PLAN_FULL_TERMS.premium。
	//   '7 日間' は半角スペース有りで TRIAL_TERMS.duration と一致しないため直書き継続。
	// #1915 (TECH-F 中頻度 D-1): TRIAL_PERIOD_TERMS atom 経由
	k74: `基本機能は無料でずっとお使いいただけます。有料プランはより多くのお子さまの登録や高度な分析機能が必要な場合にご検討ください。${PLAN_TERMS.standard}・${PLAN_FULL_TERMS.premium}は ${TRIAL_PERIOD_TERMS.full}付きです。`,
	k75: '何歳から使えますか？',
	k76: '3歳から18歳までのお子さま向けに設計しています。3歳からはお子さま自身がタップして記録、年齢に合わせて画面が自動で変わるので、きょうだいでも安心です。0〜2歳のお子さまは「準備モード」（保護者が記録するモード）で記録のみご利用いただけます（お子さま向けゲーミフィケーションは適用されません）。',
	k77: '子供のデータは安全ですか？',
	k78: 'はい。通信は常に暗号化し、データはお預かり時にも保護した状態で保管しています。お子さまの本名は不要で、ニックネームでご利用いただけます。データの第三者への販売・共有は一切行いません。',
	k79: '有料プランへの切り替えはどうしますか？',
	k80: `${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」からアップグレードしていただくと、その場で有料機能が有効になります。クレジットカード（Visa / Mastercard / JCB / American Express）に対応し、Stripe による安全な決済処理を使用しています。詳しくは `,
	k81: '料金プラン',
	k82: ' をご覧ください。',
	k83: '&#x2694;&#xFE0F; がんばりクエスト',
	k84: 'お子さまの「がんばり」を冒険に変える',
	k85: '家庭向けWebアプリ',
	k86: 'お問い合わせ・コミュニティ',
	k87: '&#x2709;&#xFE0F; メール: ganbari.quest.support@gmail.com',
	k88: '&copy; 2026 がんばりクエスト（運営: 日下武紀／個人事業主）. All rights reserved.',
	k89: '利用規約',
	k90: 'プライバシーポリシー',
} as const;

// ============================================================
// LP_PRICING_EXTRA_LABELS (#1465 SSOT Fixes)
// ============================================================

export const LP_PRICING_EXTRA_LABELS = {
	k1: '☰',
	k2: 'お子さまの登録：2人まで',
	k3: 'プリセット活動の利用',
	k4: 'オリジナル活動の作成：3個まで',
	k5: 'レベル・ポイント・おみくじ・スタンプカード',
	// #1912 (F-6): zombie pricingExtra namespace。LP_PRICING_PHASEB_LABELS.k5 と同方針で日本語化。
	k6: '毎日のごほうび・続けるごほうび',
	// #1710 R3-C: 旧「持ち物／毎日習慣」統合表現を「持ち物チェックリスト」に純化
	k7: '持ち物チェックリスト 3個/子まで',
	k8: `${PLAN_RETENTION_TERMS.free}間の履歴保持`,
	k9: 'メールサポート（標準）',
	k10: 'お子さまの登録人数：無制限',
	k11: 'オリジナル活動の作成：無制限',
	k12: 'チェックリスト自由作成（無制限）',
	k13: `家族メンバー招待：${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで（オーナーを含めご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}）`,
	k14: `${REWARD_TERMS.productRegistration}`,
	k15: '家族のデータ預かり枠（同時保管 3 件・自分でダウンロード可）',
	k16: 'データのダウンロード',
	k17: `${PLAN_RETENTION_TERMS.standard}間の履歴保持`,
	k18: 'メールサポート',
	// #1947: k19 「スタンダードの全機能」のプラン名 atom を terms.ts 参照化
	k19: `${PLAN_TERMS.standard}の全機能`,
	k20: '家族メンバー招待：無制限',
	k21: '✨ AI 自動提案（活動・ごほうび・チェックリスト）',
	k22: 'きょうだいランキング',
	k23: 'ひとことメッセージ（自由テキスト）',
	k24: '家族のデータ預かり枠（同時保管 10 件・自分でダウンロード可）',
	k25: '無制限の履歴保持',
	k26: 'メールサポート',
	k27: '機能',
	// #1947: k28-k30 のプラン名 atom (フリー / スタンダード / ファミリー) を terms.ts 参照化。
	//        PLAN_TERMS.free='無料' のため、UI 表示「フリー」と一致しないことに留意。
	//        本 namespace では旧来から「フリー」表記を使用しており、char-by-char 一致を保つため直書き維持。
	//        スタンダード / ファミリーのみ atom 参照化する。
	k28: 'フリー',
	k29: `${PLAN_TERMS.standard}`,
	k30: `${PLAN_TERMS.premium}`,
	k31: '基本',
	k32: 'お子さまの登録人数',
	k33: '2人まで',
	k34: '無制限',
	k35: '無制限',
	k36: 'プリセット活動の利用',
	k37: 'オリジナル活動の作成',
	k38: '3個まで',
	k39: '無制限',
	k40: '無制限',
	k41: '活動履歴の保持',
	k42: `${PLAN_RETENTION_TERMS.free}`,
	k43: `${PLAN_RETENTION_TERMS.standard}`,
	k44: '無制限',
	k45: 'カスタマイズ',
	// #1708 R3-A / #1710 R3-C: k47 (旧 朝夜習慣リスト / 旧ルーチン-CL) は廃止語彙、k48 を「持ち物チェックリスト自由作成」に純化
	// indexExtra namespace は新 LP では未参照だが、generate-lp-labels.mjs が parseBlock するため残し、語彙のみ純化
	k46: '持ち物チェックリスト（登校・おでかけ）',
	k47: '持ち物チェックリスト自由作成',
	k48: '持ち物チェックリスト自由作成（無制限プラン）',
	k49: '3個/子まで',
	k50: '無制限',
	k51: '無制限',
	k52: `${REWARD_TERMS.productRegistration}`,
	k53: 'AI 自動提案（活動・ごほうび・チェックリスト）',
	k54: 'レポート・家族機能',
	k55: '日次サマリー',
	k56: '家族メンバー招待（別端末からアクセス）',
	k57: `${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで（オーナー含め${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}）`,
	k58: '無制限',
	k59: 'きょうだいランキング',
	k60: 'ひとことメッセージ（自由テキスト）',
	k61: 'データ管理',
	k62: 'データのダウンロード（手動エクスポート）',
	// #1912 (F-8): zombie pricingExtra namespace。
	k63: '家族のデータ預かり枠（自分でダウンロード同時保管数）',
	k64: '3 個',
	k65: '10 個',
	k66: 'サポート',
	k67: 'メールサポート',
} as const;

/**
 * Storybook stories.svelte で表示するラベル群（#1738、#1465 follow-up）
 *
 * **言語ポリシー**: Storybook の Story 名（サイドバー表示の `Primary` / `Default` 等）は
 * Storybook の慣習に従い英語のままとする。一方、コンポーネントの**表示テキスト**
 * （子要素・`message` プロパティ・トースト本文・ボタンラベル等）は本プロダクトの
 * 表示言語（日本語）に統一する。理由:
 *
 * 1. アプリ本体 UI は全て日本語であり、Storybook で実際の見た目を確認する用途上
 *    日本語で揃える方が UI 折り返し（旧 ADR-0016、方針は docs/DESIGN.md §3）・タイポグラフィ検証で有用
 * 2. 既存 stories の多数派（Alert / FormField / IconButton / NativeSelect / Select /
 *    BirthdayInput / ErrorAlert）が既に日本語で実装されており、Badge / Button / Card /
 *    LoadingButton / Toast の英語表示テキストだけが不一致だった
 * 3. labels.ts SSOT との一貫性（ADR-0009）
 *
 * 詳細は `docs/DESIGN.md` §6 「Storybook ラベル言語ポリシー」を参照。
 */
export const STORYBOOK_LABELS = {
	buttonDefault: 'ボタン',
	loading: '読み込み中...',
	badgeDefault: 'バッジ',
	cardDefault: 'カード',
	toastDefault: 'トースト',
	selectDefault: '選択',
	featureGate: {
		buttonLabel: 'クラウドエクスポート',
		unlockedContent: 'この機能は利用できます',
		sectionTitle: 'AI 提案パネル',
	},
	// #4172: SpecialRewardOverlay の見た目確認用。棚に並んだごほうび名 (親が登録した現実世界の報酬)。
	specialRewardOverlay: {
		title: 'ゲーム 30 分',
		titleLong: 'にちようびに こうえんで あそぶ',
	},
	// #4429: AvatarDisplay の見た目確認用。取得失敗時に 👤 へ落ちることを目視できるようにする。
	avatarDisplay: {
		nickname: 'たろう',
	},
	// #4538: SiblingChallengeComparison の見た目確認用。children 一覧から引けない childId が
	// あるときに内部 ID ではなく汎用語へ落ちることを目視できるようにする。
	siblingChallengeComparison: {
		challengeTitle: '今週は毎日おてつだい',
		firstChildNickname: 'はると',
		secondChildNickname: 'ひなた',
	},
	button: {
		primary: 'プライマリ',
		secondary: 'セカンダリ',
		danger: '削除',
		ghost: 'ゴースト',
		success: '成功',
		outline: 'アウトライン',
		small: '小',
		medium: '中',
		large: '大',
		disabled: '無効',
		loading: '取込中',
	},
	loadingButton: {
		save: '保存',
		saving: '保存中...',
		child: '子供',
		childSaving: '保存中...',
		send: '送信',
		sending: '送信中...',
	},
	badge: {
		success: '成功',
		warning: '警告',
		danger: 'エラー',
		info: '情報',
		neutral: 'ノーマル',
		accent: 'アクセント',
		small: '小',
		medium: '中',
	},
	card: {
		default: '通常カード',
		elevated: '浮き上がりカード',
		outlined: '枠線カード',
		paddingNone: '余白なし',
		paddingSm: '余白 小',
		paddingMd: '余白 中',
		paddingLg: '余白 大',
	},
	toast: {
		successTitle: '保存しました',
		successDesc: '変更を反映しました',
		successBtn: '成功トーストを表示',
		errorTitle: 'エラーが発生しました',
		errorDesc: '時間をおいて再度お試しください',
		errorBtn: 'エラートーストを表示',
		infoTitle: 'お知らせ',
		infoDesc: 'メンテナンスの予定があります',
		infoBtn: '情報トーストを表示',
		titleOnlyTitle: 'タイトルのみのお知らせ',
		titleOnlyBtn: 'タイトルのみトーストを表示',
	},
	alert: {
		successMessage: '保存しました！',
		warningMessage: '入力内容を確認してください',
		dangerMessage: 'エラーが発生しました',
		infoMessage: 'お知らせがあります',
	},
	errorAlert: {
		defaultMessage: 'データの読み込みに失敗しました。',
		warningMessage: 'セッションの有効期限が近づいています。',
		infoMessage: 'メンテナンスのお知らせ: 明日 AM2:00-4:00 にサーバーメンテナンスを実施します。',
		retryActionMessage: 'サーバーに接続できませんでした。',
		retryButtonMessage: 'データの保存に失敗しました。',
		retryAlertMessage: 'リトライを実行しました',
		fixInputMessage: 'PINコードが正しくありません。',
		contactAdminMessage: '予期しないエラーが発生しました。',
		successSeverity: '正常に処理されました。',
		warningSeverity: '操作の確認が必要です。',
		errorSeverity: 'エラーが発生しました。',
		actionNoneMessage: 'アクションなし',
		actionRetryTextMessage: 'リトライ案内 (テキストのみ)',
		actionRetryButtonMessage: 'リトライボタン付き',
		actionFixInputMessage: '入力修正を案内',
		actionContactAdminMessage: '管理者への連絡を案内',
		retryClickAlert: 'リトライ',
		longMessage:
			'データベースへの接続がタイムアウトしました。サーバーが高負荷状態にある可能性があります。しばらく時間をおいてから再度お試しください。問題が続く場合は管理者までお問い合わせください。',
	},
	birthdayInput: {
		labelDefault: 'おたんじょうび',
		errorInvalid: '有効な日付を入力してください。',
	},
	divider: {
		labelOr: 'または',
	},
	formField: {
		labelNickname: 'ニックネーム',
		placeholderNickname: 'たろうくん',
		labelEmail: 'メールアドレス',
		placeholderEmail: 'user@example.com',
		labelPassword: 'パスワード',
		labelAge: '年齢',
		labelTel: '電話番号',
		placeholderTel: '090-1234-5678',
		labelBirthday: '生年月日',
		labelReminderTime: 'リマインダー時刻',
		labelMemo: 'メモ',
		placeholderMemo: '自由記入...',
		labelMemoLong: '長文メモ',
		placeholderMemoLong: '8 行...',
		labelName: '名前',
		errorRequired: '入力が必要です',
		labelDisplayName: '表示名',
		hintDisplayName: '3〜20文字で入力してください',
		errorMemoMax: '500 文字以内で入力してください',
		labelDisabled: '無効なフィールド',
		valueDisabled: '編集不可',
		labelDisabledMemo: '無効メモ',
		valueDisabledMemo: '編集不可のテキスト',
	},
	iconButton: {
		labelEdit: '編集',
		labelDelete: '削除',
		labelClose: '閉じる',
		labelWarning: '注意',
		labelConfirm: '確認',
		labelSmall: '小',
		labelMedium: '中',
		labelLarge: '大',
	},
	nativeSelect: {
		labelTheme: 'テーマ',
		labelYear: '年',
		placeholder: '選択してください',
		hintLater: '後で変更できます',
		errorRequired: '選択してください',
		labelPlan: 'プラン',
		optionPlanFree: 'フリープラン',
		optionPlanStandard: `${PLAN_FULL_TERMS.standard}`,
		optionPlanFamily: `${PLAN_FULL_TERMS.premium} (準備中)`,
		optionThemeForest: 'もりのテーマ',
		optionThemeOcean: 'うみのテーマ',
		optionThemeSpace: 'うちゅうのテーマ',
	},
	select: {
		labelYear: '年',
		labelTheme: 'テーマカラー',
		placeholder: '選択してください',
		errorRequired: '選択してください',
		labelItem: 'アイテム',
		placeholderItem: 'アイテムを選択',
		itemPrefix: 'アイテム',
	},
	// Menu primitive (#2254 / EPIC #2253)
	menu: {
		triggerLabel: 'メニューを開く',
		triggerButton: '操作メニュー',
		itemEdit: '編集',
		itemDuplicate: '複製',
		itemArchive: 'アーカイブ',
		itemDelete: '削除',
		itemDeleteIcon: '🗑',
		itemEditIcon: '✏️',
		itemDuplicateIcon: '📄',
		itemArchiveIcon: '📦',
		itemDisabled: '無効な操作',
		ariaLabelOpen: 'メニューを開く',
	},
	logo: {
		captionSymbol: 'symbol',
		captionCompact: 'compact',
		captionFull: 'full',
	},
	// OverflowMenu primitive (EPIC #2362 PR-2)
	overflowMenu: {
		ariaLabelOpen: 'メニューを開く',
		itemMarketplace: 'みんなのテンプレから取込',
		itemAiSuggest: 'AI で提案してもらう',
		itemRestore: 'バックアップから復元',
		itemExport: 'エクスポート',
		itemHelp: 'このページのヘルプ',
	},
	// ChildSelectionDialog primitive (EPIC #2362 PR-2)
	childSelectionDialog: {
		triggerOpen: '取込先を選ぶ',
		childTaro: 'たろう (8 歳)',
		childHina: 'ひな (5 歳)',
		childKenta: 'けんた (1 歳)',
		childTaroIcon: '👦',
		childHinaIcon: '👧',
		childKentaIcon: '👶',
		emptyMessage: 'お子さまが登録されていません',
	},
	// VisibilityChipGroup primitive (EPIC #2362 PR-2)
	visibilityChipGroup: {
		childTaro: 'たろう (8 歳)',
		childHina: 'ひな (5 歳)',
		childKenta: 'けんた (1 歳)',
	},
	// Dialog primitive (CX-DoR #8、modal / 子供 最頻 UX の play coverage)
	dialog: {
		title: 'お知らせ',
		bodyText: 'この内容でよろしいですか？',
		confirmButton: 'はい',
		cancelButton: 'いいえ',
		ariaLabel: '確認ダイアログ',
		openTrigger: 'ダイアログを開く',
	},
	// #2821: SetupResumeBanner story の mock onboarding item label
	// (onboarding-service.ts の文言を反映。Storybook 専用 namespace、本番 SSOT と独立)。
	setupResumeBanner: {
		itemChildren: '子供を登録する',
		itemRewards: 'ごほうびプリセットを選ぶ',
		itemChecklist: 'チェックリストを作る',
		itemChildScreen: '子供の画面を確認する',
	},
	// #2998: AdminResourceHeader story の mock 文言 (3 画面共通ヘッダーの play coverage、CX-DoR #8)。
	adminResourceHeader: {
		title: '活動管理',
		description: 'お子さまの活動を登録・編集します',
		addButtonLabel: '+ 追加',
		addMenuAriaLabel: '追加メニューを開く',
		addManual: '手動で1つ追加',
		addAi: 'AI で提案してもらう',
		addBrowse: 'みんなのテンプレートから探す',
		overflowTrigger: '︙',
		overflowAriaLabel: 'その他の操作',
		overflowRestore: 'バックアップから復元',
		overflowExport: 'エクスポート',
		badge: '有料限定',
	},
	// #4302 follow-up: SaasLicensePanel story の mock 契約者名。
	// portal-fallback-notice (Stripe が flow を拒否したときのみ描画) は demo 環境で撮影できないため
	// (ss-render-impossible)、story の play で見た目を固定する (#4166)。
	saasLicensePanel: {
		tenantName: 'たろう家',
	},
	// #4528: DowngradeResourceSelector story の mock 表示テキスト。
	// ダウングレード確認ダイアログは有料契約 (tenant の stripeSubscriptionId) が無いと開かず、
	// local backend は tenants を持たないため撮影できない (ss-render-impossible)。
	// 保持期間短縮警告の見た目は story で固定する。
	downgradeResourceSelector: {
		childOne: 'たろう',
		childTwo: 'はなこ',
		childThree: 'じろう',
		activityOne: '歯みがき',
		activityTwo: 'お手伝い',
		activityThree: '音読',
		activityFour: 'ストレッチ',
	},
} as const;

// ============================================================
// 初月価値プレビュー体験 (#1600 ADR-0023 I9 / #2169 年齢別 variant 化)
// マイルストーン演出 + 30 日後親レポートプレビュー
// Anti-engagement (ADR-0012) 準拠: 過剰な祝福禁止、3 秒以内に閉じれる UI
// 年齢帯 variant (ADR-0015): preschool = ひらがな / elementary 以上 = 漢字
// 同一カード内のひらがな + 漢字混在を解消 (#2169)
// ============================================================
// #4268: ID 集合の SSOT は `constants/habit-milestones.ts` の `PRAISE_MILESTONE_IDS`
// (褒める軸 = 日数ベース + 開始の 1 件)。ここで独自 union を再定義しない。
type MilestoneTextKey = PraiseMilestoneId;

/** 表示文言を持つマイルストーン ID (fitness function が判定側との一致を検査する、#4268 AC4) */
export const MILESTONE_LABEL_IDS: readonly MilestoneTextKey[] = PRAISE_MILESTONE_IDS;

type MilestoneAgeContext = 'preschool' | 'elementary' | 'junior' | 'senior';

/** ひらがな variant (preschool 向け、3-5 歳) */
const MILESTONE_HIRAGANA: Record<MilestoneTextKey, { title: string; description: string }> = {
	first_record: {
		title: 'はじめての きろく',
		description: 'さいしょの がんばりを きろくできたよ',
	},
	streak_7: {
		title: '1 しゅうかん つづいた',
		description: '7 にち つづけて きろくできたよ',
	},
	streak_14: {
		title: '2 しゅうかん つづいた',
		description: '14 にち つづけて きろくできたよ',
	},
	streak_30: {
		title: '1 かげつ つづいた',
		description: '30 にち つづけて きろくできたよ',
	},
};

/** 漢字 variant (elementary / junior / senior 向け、6-18 歳) */
const MILESTONE_KANJI: Record<MilestoneTextKey, { title: string; description: string }> = {
	first_record: {
		title: 'はじめての記録',
		description: '最初のがんばりを記録できました',
	},
	streak_7: {
		title: '1 週間 つづいた',
		description: '7 日連続で記録できました',
	},
	streak_14: {
		title: '2 週間 つづいた',
		description: '14 日連続で記録できました',
	},
	streak_30: {
		title: '1 か月 つづいた',
		description: '30 日連続で記録できました',
	},
};

export const MILESTONE_LABELS = {
	/** 子供 UI に表示する小さなマイルストーンバナータイトル (#1600 旧 banner、#2168 で bell UI へ移行後も legacy で保持、#2169 でカタカナ「マイルストーン」を子供向けに変更) */
	bannerTitle: 'やったね！',
	bannerTitleKanji: '達成しました',
	bannerCloseLabel: '閉じる',
	/** #2168: Header 配置 bell button の aria-label (件数を含む) */
	bellAriaLabel: (count: number) => `新着のおしらせ ${count}件 を見る`,
	/** legacy: 漢字 variant (elementary 以上の callers が直接参照する場合用、後方互換) */
	first_record: MILESTONE_KANJI.first_record,
	streak_7: MILESTONE_KANJI.streak_7,
	streak_14: MILESTONE_KANJI.streak_14,
	streak_30: MILESTONE_KANJI.streak_30,
} as const;

/**
 * #2169 / ADR-0015: 年齢帯 variant を返す。
 *
 * `ageTier` を必ず渡すこと (アンチパターン A1: `if (uiMode === 'baby')` 散在を回避)。
 * - `preschool` → ひらがな
 * - `elementary` / `junior` / `senior` → 漢字
 * - `baby` 等 unsupported は漢字 fallback (`MilestoneBellButton` 側で baby は非表示済み、ADR-0011)
 */
export function getMilestoneLabel(
	id: MilestoneTextKey,
	ctx: { ageTier: MilestoneAgeContext | string },
): { title: string; description: string } {
	const variant = ctx.ageTier === 'preschool' ? MILESTONE_HIRAGANA : MILESTONE_KANJI;
	return variant[id] ?? MILESTONE_KANJI[id];
}

/**
 * #2169: bannerTitle の年齢帯 variant 取得。
 * preschool → 「やったね！」/ elementary 以上 → 「達成しました」
 */
export function getMilestoneBannerTitle(ctx: { ageTier: MilestoneAgeContext | string }): string {
	return ctx.ageTier === 'preschool'
		? MILESTONE_LABELS.bannerTitle
		: MILESTONE_LABELS.bannerTitleKanji;
}

export const VALUE_PREVIEW_LABELS = {
	/** dashboard セクションタイトル */
	sectionTitleFirstMonth: 'はじめての 30 日',
	sectionTitle30DayPreview: '1 か月の歩み',
	sectionHintFirstMonth: (daysSince: number) =>
		`登録から ${daysSince} 日目です。あと ${Math.max(0, 30 - daysSince)} 日で 1 か月の節目になります`,
	sectionHint30DayPreview: '1 か月のお子さまのがんばりをまとめました',
	totalActivitiesLabel: '記録した活動',
	totalActivitiesUnit: '回',
	currentStreakLabel: '現在の連続記録',
	currentStreakUnit: '日',
	longestStreakLabel: '最長連続記録',
	totalPointsLabel: 'ためたポイント',
	totalPointsUnit: 'pt',
	achievedMilestonesHeading: '達成したマイルストーン',
	noMilestonesYet: 'まだマイルストーン未達成です。最初の記録から始めましょう',
	categoryBreakdownHeading: 'カテゴリ別の活動回数',
	noCategoryData: 'まだ記録がありません',
	emptyState: 'まだお子さまの活動記録がありません',
	previewBannerHint: '続けて記録するほど、このグラフが充実していきます',
	categoryCountAria: (categoryName: string, count: number): string => `${categoryName} ${count} 回`,
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
	k7: '0-2 歳のお子さまは「準備モード」でご登録いただけます。<a href="faq.html#baby-mode" style="color:var(--brand-700)">詳しくはこちら</a>',
	k8: '幼児 (3-5)',
	k9: '小学生以上 (6-18)',
	k10: 'ひらがな中心・丸みのある大きなボタン',
	k11: '幼児 UI: ひらがな / 大タップ / 絵文字演出',
	// #1912 (F-6): 「ログインボーナス」→「毎日のごほうび」へ日本語化
	k12: '幼児期に身につけたい習慣を、読める・押せる・選べる形で始められます。',
	// #1801 M-MIN-2: hero CTA との重複を排除し、[02b] age-panel CTA を「デモを見る」のみに簡略化
	k13: '<a href="https://demo.ganbari-quest.com/" class="btn btn-demo">デモを見る</a>',
	k14: '漢字 + 情報密度で 15 年継続できる UI',
	k15: '小学生以降 UI: 漢字 / 情報密度 / 学年別プリセット',
	k16: '小学校以降は自分で計画してより多くの活動をより楽しく',
	// #1801 M-MIN-2: hero CTA との重複を排除し、[02b] age-panel CTA を「デモを見る」のみに簡略化
	k17: '<a href="https://demo.ganbari-quest.com/" class="btn btn-demo">デモを見る</a>',
	// #1910 AC6 (UIUX-A-6): age-panel scrshot vs body 高低差を埋める body 内チェックリスト 6 件
	// 各年齢 UI モードの代表機能 3 件を ✓ で列挙、age-panel-feature span との重複を避け具体例で訴求
	kinderCheck1: '大きなタップ領域 (80px) で押しやすい',
	kinderCheck2: 'ひらがな表示で読みやすい',
	kinderCheck3: '300+ プリセット活動からタップで選ぶだけ',
	primaryCheck1: '漢字 + 情報密度で 15 年継続できる UI',
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
	k39: '成長の記録（月次レポート）',
	k40: '月次レポートで活動・ポイント推移をひと目で把握。子供の成長を記録として残せます。',
	k41: '時間管理（使いすぎ防止）',
	k42: '設定時間が経過すると画面が自動で閉じる使いすぎ防止タイマー。スクリーンタイムの心配なく使わせられます。',
	k43: 'おうえんメッセージ',
	k44: '「よくがんばったね」の一言が子供のホーム画面に届きます。Family プランで家族全員から送れます。',
	k45: '設定の自由度',
	// #1894 (PO-4-8): card 3 本文 (k46) の冒頭で「ご家庭ごとに自由なカスタマイズ」を強調表記し、価値訴求を明示。
	//   旧: 「活動の種類・ポイント配分・ごほうびは自由にカスタマイズ。お子さまに合わせて調整できます。」
	//   PO 期待: 「個別ご家庭向けの自由なカスタマイズ」を card 3 で明示（リード k38 と呼応）
	k46: '<strong>ご家庭ごとに自由なカスタマイズ</strong>。活動の種類・ポイント配分・ごほうびを、お子さまに合わせて細かく調整できます。',
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
	k68: '家族のデータが第三者にも使われない設計です。サービス停止時は事前にお知らせ + データの書き出しができます。お子さまの記録は確実に手元に残せます。',
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
		'<strong>家庭で楽になること</strong>: 1 ヶ月の頑張り合計と前月比が一目でわかる',
	// #1720 R4 で softBenefitFamilySupport に統合済の旧キー。SSOT 整合のため語彙だけ更新
	softBenefitAutoSleep:
		'<strong>家庭で楽になること</strong>: 設定した時間で自動的に画面が閉じ、長時間利用が起きない',
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
	softFamilySupportDesc:
		'ご家庭のリズムに合わせて、ステータス（やる気・体力など）が時間とともに少しずつ減る強さを調整できます。「毎日少しずつでも続けるとお得」な仕組みで、習慣化を後押しします。',
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
	carouselSlide3Alt: `中高生（${AGE_RANGE_TERMS.juniorShort}代表）のホーム画面 — 自己管理ダッシュボード`,
	// #2057: 「子供管理画面」は文脈上「お子さま管理タブ」を指すため、ADMIN_VIEW_TERMS をそのまま
	// 適用すると「子供ご家族の見守り画面」と不自然になる。原文意図 (家族メンバー管理) を保つ表現に書換。
	carouselSlide4Alt: 'お子さま管理タブ — 家族メンバーの登録と切替',
	// #4644: ホーム画面への追加 (インストール) 訴求。アプリ内の案内 (PWA_INSTALL_LABELS) と
	// 同じ操作名を使うため PWA_TERMS.installAction を経由する (LP で読んだ操作名が
	// アプリ内で見つからない状態を作らない)。
	pwaTitle: `タブレットやスマホの${PWA_TERMS.installAction}しよう`,
	pwaDesc: `${PWA_TERMS.installAction}すると${PWA_TERMS.standalone}で起動します。${CHILD_TERMS.honorific}がブラウザのタブや URL 欄を誤って操作することがなくなり、記録に集中できます。`,
	pwaAndroidTitle: 'Android / Chrome',
	pwaAndroidSteps: `画面右上の「⋮」→「${PWA_TERMS.installAction}」→「追加」`,
	pwaIosTitle: 'iPhone / iPad（Safari）',
	pwaIosSteps: `画面下の「${PWA_TERMS.iosShareButton}」（□に↑）→「${PWA_TERMS.installAction}」→「追加」`,
	pwaNote:
		'アプリストアからのダウンロードは不要です。あとからアプリの「設定」→「サポート」でも手順を確認できます。',
} as const;

export const LP_PRICING_PHASEB_LABELS = {
	k1: 'お子さまの登録：2人まで',
	k2: 'プリセット活動の利用',
	k3: 'オリジナル活動の作成：3個まで',
	k4: 'レベル・ポイント・おみくじ・スタンプカード',
	// #1912 (F-6): 「ログインボーナス・連続達成ボーナス」→「毎日のごほうび・続けるごほうび」へ日本語化
	k5: '毎日のごほうび・続けるごほうび',
	// #1710 R3-C: 旧「持ち物／毎日習慣」統合表現を「持ち物チェックリスト」に純化
	k6: '持ち物チェックリスト 3個/子まで',
	k7: `${PLAN_RETENTION_TERMS.free}間の履歴保持`,
	k8: 'メールサポート（標準）',
	// #4705: 無料プランで**できないこと**のうち、貯めたポイントの使い道に直結する制限を
	// 検討時点で見えるようにする (実ゲート = isCustomRewardUnlocked、#4584)。
	k8b: `${REWARD_TERMS.productRegistration}は${PLAN_TERMS.standard}以上`,
	k9: 'お子さまの登録人数：無制限',
	k10: 'オリジナル活動の作成：無制限',
	k11: 'チェックリスト自由作成（無制限）',
	k12: `家族メンバー招待：${FAMILY_MEMBER_LIMIT_TERMS.standardInvites}まで（オーナーを含めご家族${FAMILY_MEMBER_LIMIT_TERMS.standardTotal}）`,
	k13: `${REWARD_TERMS.productRegistration}`,
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
	k36: '<td>持ち物チェックリスト（登校・おでかけ）</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k38: '<td>持ち物チェックリスト自由作成</td><td>3個/子まで</td><td class="check">無制限</td><td class="check">無制限</td>',
	k39: `<td>${REWARD_TERMS.productRegistration}</td><td class="dash">&#8212;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>`,
	k40: '<td>AI 自動提案（活動・ごほうび・チェックリスト）</td><td class="dash">&#8212;</td><td class="dash">&#8212;</td><td class="check">&#10003;</td>',
	k41: '<td colspan="4">レポート・家族機能</td>',
	k42: '<td>日次サマリー</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
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
	k22: `必要な記録がある場合は、${ADMIN_VIEW_TERMS.canonical}からデータをエクスポートしてください。`,
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
	k51: `きょうだいランキング機能（${PLAN_FULL_TERMS.premium}）では、年齢差を考慮した調整もできるため「上の子が有利すぎる」状況を緩和できます。`,
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
	k74: '詳しくは <a href="terms.html">利用規約</a> 第 14 条をご覧ください。',
	k75: `${CANCEL_TERMS.account}・アカウント削除はすぐにできますか？`,
	// #4496: 旧文言は猶予を一律「申請後 30 日間」と述べていたが、猶予はプラン別 (無料は 0 日 =
	//   申請と同時に物理削除)。無料プランの顧客が「30 日間は取り消せる」と誤認したまま退会すると
	//   データが全損する。日数は DELETION_GRACE_TERMS (値 SSOT = deletion-grace.ts) から引く。
	k76: `${ADMIN_VIEW_TERMS.canonical}から${CANCEL_TERMS.account}（アカウント削除）を申請できます。猶予期間はご利用プランによって異なります（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）。`,
	k77: `${PLAN_FULL_TERMS.free}は申請と同時に削除されるため、取り消しもエクスポートもできません。有料プランは猶予期間中に申請の取り消しとデータのエクスポートができます。猶予期間の経過後、全データは完全に削除されます（復旧はできません）。`,
	k78: 'データはどこに保存されていますか？',
	k79: 'AWS 米国バージニア北部リージョン（us-east-1）のデータベースに暗号化して保存しています。AWS DPA および標準契約条項（SCC）に基づき、改正個人情報保護法第 28 条に整合する形で適切に管理しています。詳細は<a href="privacy.html">プライバシーポリシー</a>第8条（データの国外移転）をご覧ください。',
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
	k96: `<strong>初日</strong>: ${SIGNUP_TERMS.canonical} → ${CHILD_TERMS.honorific}登録 → 年齢に応じた、あらかじめ用意された活動を選ぶ（300+ の中から）`,
	k97: `<strong>毎日</strong>: お子さまが自分で活動を記録 → 保護者は${ADMIN_VIEW_TERMS.canonical}で結果を確認（所要時間 30 秒〜）`,
	k98: '<strong>週 1 回</strong>: レベルアップ・チャレンジ達成を家族で共有（お楽しみタイム）',
	k99: '親が毎日新しい活動を作る必要はありません。プリセットをそのまま使うか、年齢が変わった時にテンプレートを切り替えるだけで運用できます。',
	k100: 'スクリーンタイムが長くなる心配はありませんか？',
	k101: '「長く遊ばせる」設計にしていません。本サービスは「活動記録アプリ」であり、お子さまがアプリ内で過ごす時間は 1 回 1 〜 3 分が想定です。',
	k102: '活動記録 → ポイント獲得 → スタンプ獲得 → 結果確認で完了（1 〜 3 分）',
	k103: '動画視聴・無限スクロール・配信コンテンツは一切なし',
	k104: '15 分の無操作で画面が自動で閉じる使いすぎ防止タイマーで、長時間滞在を防止',
	k105: '「スクリーンタイムを奪うのではなく、リアルの行動を促す」動機付けツールとしてお使いください。',
	k106: '祖父母や親戚も使えますか？',
	k107: `<strong>${PLAN_FULL_TERMS.premium}</strong>では、保護者側のメンバーを<strong>無制限</strong>に招待できます。祖父母・おじおば・離れて暮らす親御さまなどが、同じお子さまの成長を見守れます（${PLAN_FULL_TERMS.standard}はご家族合計${FAMILY_MEMBER_LIMIT_TERMS.standardTotalSpaced}まで＝オーナーを含むため招待は${FAMILY_MEMBER_LIMIT_TERMS.standardInvitesSpaced}までです）。`,
	k108: `招待されたメンバーは保護者として、お子さまの記録の確認と活動の記録ができます（アカウントを持たずに記録を見せたい場合は、${PLAN_FULL_TERMS.premium}の閲覧リンクをお使いください。閲覧専用です）。`,
	k109: '<span class="faq-category-num">5</span>技術的なご質問',
	k110: 'デバイス・ブラウザ対応と、ソースコードの公開について。',
	k111: 'スマホ・タブレット・PC、何台まで使えますか？',
	k112: 'デバイス数の制限はありません。Web ブラウザ（Chrome / Safari / Edge など）があれば、どのデバイスからでもログインしてお使いいただけます。',
	k113: 'PWA（Progressive Web App）としてホーム画面にも追加できます。iOS / Android どちらもサポートしています。',
	k114: 'オフラインでも使えますか？',
	k115: `基本的な活動記録はオフラインでも動作します（PWA のキャッシュ機能）。ただしデータ同期・新規${SIGNUP_TERMS.canonical}・決済などはオンライン接続が必要です。`,
	k116: '旅行中や電波の弱い場所でも、お子さまが活動を記録 → ネット復帰時に自動同期、という使い方ができます。',
	k117: 'ソースコードは公開されていますか？',
	k118: 'はい。本サービスのアプリ部分は GitHub で <a href="https://github.com/Takenori-Kusaka/ganbari-quest">ソースコードを公開</a> しています。技術に詳しい方はご自宅のパソコンで同じアプリを動かすこともできます（<a href="selfhost.html">自前運用ガイド</a>）。',
	k119: 'これは「運営が終了してもアプリ自体は残り続ける」安心のための仕組みです。通常のご家庭はクラウド版をそのままお使いいただければ十分です。',
	k120: 'ほかにご質問はありますか？',
	k121: '上記にないご質問や、ご要望・フィードバックは、メールでお気軽にお寄せください。通常 1 〜 2 営業日以内にご返信いたします。',
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
	//   「あらかじめ用意された 300 種類の活動がそのまま使える」へ顧客語彙化。
	k13: '「はみがきした」「宿題おわった」をタップするだけ。あらかじめ用意された 300 種類の活動がそのまま使えるので設定は最小限。記録のたびにポイントが積み上がります。',
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
	k34: '<span class="check">&#x2713;</span>持ち物チェックリスト 3個/子まで',
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
	k43: `<span class="check">&#x2713;</span>${REWARD_TERMS.productRegistration}`,
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
	k61: 'お子さまの年齢と性別を設定',
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
	articleHeader: '<h1>プライバシーポリシー</h1><p class="meta">最終更新日: 2026年8月7日</p>',
	intro:
		'個人開発者である日下武紀（以下「運営者」）は、Webアプリケーション「がんばりクエスト」（以下「本サービス」）における利用者の個人情報の取扱いについて、個人情報の保護に関する法律（以下「個人情報保護法」）その他関連法令に基づき、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。本サービスは家庭内でお子さまが利用することを想定しており、お子さまの個人情報の保護には特に配慮しています。',
	section1:
		'<h2>第1条（収集する情報）</h2><p>運営者は、本サービスの提供にあたり、以下の情報を収集します。</p><h3>1. アカウント情報</h3><p>認証および通知のためにメールアドレスを収集します。サービス内で表示する表示名をお預かりします。パスワードは不可逆のハッシュ化処理を施した状態で保存されます。これらの情報はご契約期間中保存されます。</p><h3>2. お子さまの情報</h3><p>サービス内表示のためにニックネーム、年齢区分（表示の最適化に使用）、表示設定（テーマ・UIモード等）をお預かりします。また、お誕生日のお祝い機能のために生年月日を任意でご登録いただけます。これらの情報はご契約期間中保存されます。</p><div class="highlight"><strong>お子さまの個人情報保護について</strong><ul><li>お子さまの本名の入力は必須ではありません。ニックネームでご利用いただけます。</li><li>お子さまが直接個人情報を入力する機能はありません。全ての登録は保護者が行います。</li><li>学校名、住所等の個人を特定できる情報は収集しません。生年月日は任意登録であり、お誕生日のお祝い機能にのみ使用します。</li></ul></div><h3>3. 活動データ</h3><p>サービス機能を提供するために、活動記録（ポイント、レベル等）、チャレンジ、チェックリスト記録をお預かりします。これらの情報はご契約期間中保存されます。</p><h3>4. 利用ログ</h3><p>セキュリティの確保および不正アクセス防止のために、アクセス日時、IPアドレス、アクセス先のURL、デバイス情報（ブラウザ種別等）を収集します。アクセスログは3日間保存した後、運営者が管理するAWS環境内のストレージへアーカイブして長期保存します。配信基盤（CDN）のアクセスログは同じ環境内に3日間のみ保存し、自動削除します。セキュリティインシデント調査に必要な場合は、当該ログを調査完了まで保持することがあります。</p><h3>5. 決済情報</h3><p>クレジットカード番号等の決済情報は、運営者のサーバーには保存されません。決済処理は全て外部の決済サービス（Stripe）を通じて行われ、当該サービスのプライバシーポリシーが適用されます。</p>',
	section2:
		'<h2>第2条（情報の利用目的）</h2><p>運営者は、収集した情報を以下の目的で利用します。</p><ol><li>本サービスの提供・運営・維持</li><li>利用者の認証・本人確認</li><li>サービスの改善・新機能の開発</li><li>利用状況の分析・統計処理（個人を特定しない形式）</li><li>重要なお知らせ・サービス変更の通知</li><li>不正利用の防止・セキュリティの確保</li><li>利用者からの問い合わせへの対応</li></ol>',
	section3:
		'<h2>第3条（情報の第三者提供）</h2><ol><li>運営者は、以下の場合を除き、利用者の個人情報を第三者に提供しません。<ul><li>利用者の同意がある場合</li><li>法令に基づく場合</li><li>人の生命、身体または財産の保護のために必要がある場合であって、利用者の同意を得ることが困難な場合</li></ul></li><li>運営者は、サービス提供のために以下の外部サービスを利用しています。各サービスは、それぞれのプライバシーポリシーに基づきデータを取り扱います。<ul><li><strong>Amazon Web Services (AWS)</strong> — サーバーインフラ（アプリケーションの実行・データの保存）、認証基盤、メール送信。データは原則としてバージニア北部リージョン（us-east-1）に保存されます。<br>プライバシーポリシー: <a href="https://aws.amazon.com/jp/privacy/" target="_blank" rel="noopener">https://aws.amazon.com/jp/privacy/</a></li><li><strong>Google LLC</strong> — OAuth認証（Googleアカウントによるログイン）。認証時にメールアドレスおよび表示名を取得します。<br>プライバシーポリシー: <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">https://policies.google.com/privacy</a></li><li><strong>Stripe, Inc.</strong> — 決済処理（クレジットカード情報の安全な取扱い）。決済情報はStripeのサーバー（米国）で処理されます。<br>プライバシーポリシー: <a href="https://stripe.com/jp/privacy" target="_blank" rel="noopener">https://stripe.com/jp/privacy</a></li><li><strong>Discord Inc.</strong> — 運用監視通知（個人を特定できない形式のイベント情報の送信）<br>プライバシーポリシー: <a href="https://discord.com/privacy" target="_blank" rel="noopener">https://discord.com/privacy</a></li><li><strong>Amazon Web Services (AWS)</strong> — 生成 AI（活動アイコン生成・テキスト補助）。運営者が管理する AWS 環境内で処理され、AWS 以外の第三者には送信されません。利用者識別子（家族内一意 ID）を含まないリクエストのみ送信します。<br>プライバシーポリシー: <a href="https://aws.amazon.com/jp/privacy/" target="_blank" rel="noopener">https://aws.amazon.com/jp/privacy/</a></li></ul></li></ol>',
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
		'<h2>第7条（Cookieの使用）</h2><p>本サービスは、認証状態の維持のためにCookieを使用します。使用するCookieは機能に必須のもののみであり、広告目的のトラッキングCookieは使用しません。</p><ul><li><strong>認証Cookie</strong> — ログイン状態の維持（セッション終了時またはTTL経過時に削除）</li><li><strong>コンテキストCookie</strong> — 利用者のロール・テナント情報（セッション中のみ）</li><li><strong>セキュリティCookie</strong> — 認証フロー中のみ使用されるCookie（フロー完了後に自動削除）<ul><li><code>oauth_state</code> — OAuth認証時のCSRF防止トークン</li><li><code>oauth_nonce</code> — OAuth認証時のリプレイ攻撃防止トークン</li></ul></li><li><strong>招待Cookie</strong> — 招待リンク経由のアクセス時に招待コードを一時保持（招待受理後に削除）</li></ul><p>ブラウザの設定によりCookieを無効にすることができますが、本サービスの一部機能が利用できなくなる場合があります。</p>',
	section8:
		'<h2>第8条（外部送信規律 公表）</h2><p>電気通信事業法第27条の12に基づき、本サービスがサービス提供のために外部に送信する情報を公表します。<strong>送信されるのは技術的な情報のみで、お預かりしたデータの第三者への提供や広告利用は行いません。</strong></p><p>運営者は、電気通信事業法第27条の12（外部送信規律）に基づき、利用者の端末から外部の第三者に送信される情報について、以下のとおり公表します。</p><ol><li><strong>送信される情報</strong>: ページ URL、リファラ、訪問時刻、画面解像度、ブラウザ言語、ユーザーエージェント等の通信ヘッダ情報</li><li><strong>送信先</strong>:<ul><li>Amazon Web Services, Inc.（運営者が管理する AWS 環境。アプリケーションの実行・データの保存・認証・生成 AI）</li><li>Stripe, Inc.（課金処理）</li></ul></li><li><strong>利用目的</strong>: ウェブサイトの機能提供および改善 / 課金処理 / コンテンツ生成（活動アイコン・テキスト補助等）</li><li><strong>個人を識別する情報</strong>: 上記の外部送信に際して、運営者は利用者本人を直接識別する情報（氏名・住所・電話番号等）を取得しません。利用者識別子は家族内一意 ID のみであり、外部第三者には送信しません。</li><li><strong>利用者の選択肢</strong>: 利用者は、ブラウザの設定により Cookie をブロックすることで、一部の外部送信を停止することができます。ただし、本サービスの一部機能が利用できなくなる場合があります。</li></ol>',
	section9:
		'<h2>第9条（未成年者の取扱い）</h2><p>本サービスは、お子さま（未成年者）が利用することを前提として設計されており、未成年者の保護のために以下の特別な措置を講じています。</p><ol><li><strong>全年齢で親同意フレームワーク運用</strong>: 年齢を問わず、すべてのお子さまの本サービス利用について、保護者（法定代理人）が本利用規約・本ポリシーに同意した上でアカウントを作成・管理します。お子さま本人がアカウントを作成することはできません。</li><li><strong>利用者識別子は家族内一意 ID のみ</strong>: お子さまを識別する情報は、家族グループ内でのみ一意に割り振られる ID であり、学校名・氏名・住所・電話番号等の本人を特定する情報は取得しません。</li><li><strong>利用者本人への直接接触の禁止</strong>: 運営者から、お子さま本人に対するアンケート・通知・メールマガジン等の直接的な接触は一切行いません。本サービスに関する連絡は、すべて保護者宛に行います。</li><li><strong>利用者データの域外送信ゼロ</strong>: お子さまの活動記録・プロフィール等のデータは、運営者が管理する AWS 環境内でのみ処理し、外部第三者（生成 AI 等を含む）への送信は行いません。</li><li><strong>親による削除請求の優先処理</strong>: 保護者からのお子さまデータ削除請求は、本ポリシー第5条・第6条の手続きに従って優先的に処理します。</li></ol>',
	section10: `<h2>第10条（外国にある第三者への提供）</h2><p>本サービスは、AWS（米国バージニア北部リージョン）/ Stripe / Google の各データセンターを利用してサービスを提供しています。これらは「外国にある第三者への提供」（個人情報保護法 §28）に該当しますが、以下の方針を厳守しています:</p><ul><li>お預かりしたデータは <strong>サービス提供のためだけに使用</strong> します</li><li><strong>広告利用・トラッキング・第三者への販売は一切行いません</strong></li><li><strong>機械学習・AI モデルの学習データへの流用はありません</strong></li><li>${CHILD_TERMS.neutral}の識別情報（ニックネーム等）は <strong>運営者の環境の外にある生成 AI サービスには送信しません</strong>（送信する機能自体がありません）</li></ul><p>運営者は、個人情報保護法第28条に基づき、利用者の個人データを外国にある第三者へ提供することについて、以下のとおり情報を提供し、利用者の同意を取得します。</p><ol><li><strong>移転先国</strong>: 米国（AWS バージニア北部リージョン: us-east-1）</li><li><strong>第三者の名称</strong>: Amazon Web Services, Inc.（米国デラウェア州法人）</li><li><strong>法的根拠</strong>: AWS との間で締結された Data Processing Addendum (DPA) および標準契約条項 (Standard Contractual Clauses, SCC) に基づき、個人情報の保護に関して日本と同等の水準にあると認められる体制を整備しています。</li><li><strong>移転される情報の範囲</strong>: 利用者識別子（家族内一意 ID）、活動記録、課金関連情報（決済情報そのものは Stripe で処理され、運営者および AWS のサーバーには保存されません）</li><li><strong>本人同意の取得</strong>: 上記の外国にある第三者への提供については、本サービスの${SIGNUP_TERMS.canonical}時に、「サービス提供に必要な範囲でのデータ保存・処理に同意します」のチェックボックス（広告利用・第三者への販売・機械学習への流用を行わない旨の説明とともに表示）により、利用者から明示的に同意を取得します。同意されない場合、本サービスをご利用いただくことができません。</li><li><strong>その他の外国にある第三者</strong>:<ul><li><strong>Stripe, Inc.</strong>（米国） — 決済情報の処理。Stripe は PCI DSS Level 1 認証を取得しています。</li><li><strong>Google LLC</strong>（米国） — OAuth 認証。</li></ul></li></ol>`,
	section11:
		'<h2>第11条（本ポリシーの変更）</h2><ol><li>運営者は、法令の改正、社会情勢の変化、またはサービス内容の変更に伴い、本ポリシーを変更することがあります。</li><li>重要な変更を行う場合は、本サービス上での通知またはメールにより、変更内容と施行日をお知らせします。</li><li>本ポリシーの重要な変更後に本サービスを継続して利用される場合、利用者には変更後のポリシーに対する再同意を求める場合があります。</li></ol>',
	section12:
		'<h2>第12条（個人情報保護管理者）</h2><div class="contact"><p><strong>個人情報保護管理者</strong></p><p>氏名: 日下武紀</p><p>連絡先: <a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="プライバシー">ganbari.quest.support@gmail.com</a></p></div>',
	section13:
		'<h2>第13条（お問い合わせ）</h2><p>個人情報の取扱いに関するお問い合わせは、以下までご連絡ください。開示等の請求に対しては、ご本人確認のうえ、合理的な期間内に対応いたします。</p><div class="contact"><p>がんばりクエスト運営者 日下武紀</p><p>お問い合わせ: <a href="https://github.com/Takenori-Kusaka/ganbari-quest/issues">GitHub Issues</a> / <a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="プライバシー">メール</a></p></div>',
	effective: '<p>以上</p><p>制定日: 2026年3月27日</p><p>最終改定日: 2026年8月7日</p>',
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
	articleHeader: '<h1>利用規約</h1><p class="meta">最終更新日: 2026年8月13日</p>',
	intro:
		'本利用規約（以下「本規約」）は、個人開発者である日下武紀（以下「運営者」）が提供するWebアプリケーション「がんばりクエスト」（以下「本サービス」）の利用条件を定めるものです。本サービスは個人が開発・運営するものであり、企業が提供するサービスとは運営体制が異なります。本サービスをご利用いただくにあたり、本規約に同意いただく必要があります。',
	section1:
		'<h2>第1条（定義）</h2><ol><li>「利用者」とは、本規約に同意の上、本サービスを利用する全ての方をいいます。</li><li>「保護者」とは、本サービスにおいて管理者権限でアカウントを作成・管理する利用者をいいます。</li><li>「こども」とは、保護者が本サービスに登録した未成年の家族をいいます。</li><li>「家族グループ」とは、保護者が作成し、こどもや他の保護者が所属するグループをいいます。</li><li>「コンテンツ」とは、利用者が本サービスに登録した活動、ポイント、実績等のデータをいいます。</li></ol>',
	section2:
		'<h2>第2条（サービスの内容）</h2><ol><li>本サービスは、家庭内でのこどもの日常活動をゲーミフィケーション（ポイント、レベル、実績等）により動機づけすることを目的としたWebアプリケーションです。</li><li>運営者は、本サービスの内容を予告なく変更・追加・削減することがあります。</li><li>本サービスは教育効果や行動変容を保証するものではありません。</li></ol>',
	section3:
		'<h2>第3条（アカウントの管理）</h2><ol><li>利用者は、自己の責任においてアカウント情報を管理するものとします。</li><li>アカウント情報の不正利用により生じた損害について、運営者は一切の責任を負いません。</li><li>こどものアカウントは保護者が作成・管理するものとし、こども自身がアカウントを作成することはできません。</li><li>保護者は、こどものデータの入力内容および本サービスの利用について責任を負うものとします。</li><li>1つのメールアドレスにつき1つのアカウントのみ作成できます。</li></ol>',
	section4:
		'<h2>第4条（禁止事項）</h2><p>利用者は、本サービスの利用にあたり、以下の行為を行ってはなりません。</p><ol><li>法令または公序良俗に違反する行為</li><li>犯罪行為に関連する行為</li><li>運営者のサーバーまたはネットワークの機能を破壊・妨害する行為</li><li>本サービスの運営を妨害するおそれのある行為</li><li>他の利用者の個人情報を収集または蓄積する行為</li><li>不正アクセスまたはこれを試みる行為</li><li>他の利用者に成りすます行為</li><li>反社会的勢力に対して直接または間接に利益を供与する行為</li><li>本サービスの他の利用者または第三者の知的財産権、肖像権、プライバシー、名誉その他の権利または利益を侵害する行為</li><li>本サービスを商業目的で利用する行為（運営者が別途許諾した場合を除く）</li><li>その他、運営者が不適切と判断する行為</li></ol>',
	section5:
		'<h2>第5条（アカウントの停止・削除）</h2><ol><li>運営者は、利用者が前条の禁止事項に違反した場合、または本規約のいずれかの条項に違反した場合、事前の通知なくアカウントの停止または削除を行うことができます。</li><li>前項の措置により利用者に生じた損害について、運営者は一切の責任を負いません。</li><li>運営者は、アカウント停止または削除の理由について、開示する義務を負いません。</li></ol>',
	section6:
		'<h2>第6条（未成年者の利用）</h2><ol><li>本サービスは、保護者の管理のもとでこどもが利用することを前提として設計されています。</li><li>未成年者が本サービスを利用する場合、法定代理人（保護者）の同意が必要です。</li><li>保護者は、こどもの本サービスの利用に関して一切の責任を負うものとします。</li><li>保護者が本規約に同意してアカウントを作成した時点で、こどもの本サービスの利用についても同意したものとみなします。</li><li>未成年者の個人情報の取扱いについて、運営者は<a href="privacy.html#under-age">プライバシーポリシー第9条（未成年者の取扱い）</a>に定める特別な保護措置を講じています。</li></ol>',
	section7: `<h2>第7条（料金および支払い）</h2><ol><li>本サービスの基本機能は無料でご利用いただけます。一部の機能は有料プランへの加入が必要です。料金の詳細は本サービス内の料金ページに記載します。</li><li>有料プランの支払いは、運営者が指定する決済サービスを通じて行われます。</li><li>有料プランは契約期間ごとに自動更新されます。自動更新の停止（解約）は、次回更新日の前日までに${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」→「${STRIPE_PORTAL_TERMS.short}を開く」（${STRIPE_PORTAL_TERMS.canonical}）から行うことができます。</li><li>解約後も、支払い済み期間の終了日まで有料プランの機能をご利用いただけます。</li><li>日割り計算による返金は行いません。</li><li><strong>解約とアカウント削除の違い</strong>: 解約はサブスクリプションの自動更新停止のみを行うものであり、利用者のデータは${PLAN_FULL_TERMS.free}へ移行して保持されます（保持期間は次項に定めます）。データを完全に削除したい場合は、本サービスにログインのうえ、設定画面の「アカウント削除」から本人が実施してください。詳細は第13条に定めます。</li><li><strong>プラン別の履歴保持期間</strong>: 活動記録等の履歴は、ご利用中のプランに応じて次の期間保持されます。${PLAN_FULL_TERMS.free}: ${PLAN_RETENTION_TERMS.free}間 / ${PLAN_FULL_TERMS.standard}: ${PLAN_RETENTION_TERMS.standard}間 / ${PLAN_FULL_TERMS.premium}: 無期限。保持期間を超えた履歴は削除され、復元できません（再度有料プランにご加入いただいた場合も戻りません）。</li><li><strong>プラン変更</strong>: 利用者はいつでもプランを変更できます。上位プランへの変更（アップグレード）は直ちに反映されます。下位プランへの変更（ダウングレード）および解約による${PLAN_FULL_TERMS.free}への移行では、<strong>変更後のプランの保持期間を超える履歴は削除されます</strong>。また、変更後のプランの上限を超えるお子さま・活動等は閲覧できない状態になります。プラン変更のお手続きをご自身で行う場合、削除される履歴があるときは手続きの前に画面上でお知らせします。解約により${PLAN_FULL_TERMS.free}へ移行する場合は、解約時点でこの案内は行われません。</li></ol>`,
	section8: `<h2>第8条（無料トライアル）</h2><ol><li>有料プランには無料トライアル期間が含まれる場合があります。期間の詳細は本サービス内に記載します。</li><li>無料トライアルのご利用にお支払い情報の登録は不要です。期間中・終了後を問わず、自動的に料金が発生することはありません。</li><li>無料トライアル期間終了後、自動的に${PLAN_FULL_TERMS.free}に移行します。有料プランへの移行はお客さまご自身で${ADMIN_VIEW_TERMS.canonical}より手続きしていただく必要があります。</li><li>無料トライアルは、<strong>ご家族（家族グループ）につき1回</strong>のみご利用いただけます。同一のご家族に属する複数のアカウントで重ねてご利用いただくことはできません。ただし、運営者が実施するキャンペーン等により、運営者の判断で再度ご提供する場合があります。</li></ol>`,
	section9:
		'<h2>第9条（知的財産権）</h2><ol><li>本サービスに関する知的財産権は全て運営者または正当な権利者に帰属します。</li><li>利用者が本サービスに登録したコンテンツの著作権は利用者に帰属しますが、運営者はサービスの提供および改善に必要な範囲で当該コンテンツを利用できるものとします。</li></ol>',
	section10:
		'<h2>第10条（個人情報の取扱い）</h2><p>利用者の個人情報の取扱いについては、別途定める<a href="privacy.html">プライバシーポリシー</a>に従うものとします。</p>',
	section11:
		'<h2>第11条（サービスの中断・停止）</h2><ol><li>運営者は、以下の場合、事前の通知なく本サービスの全部または一部を中断・停止することがあります。<ul><li>システムの保守・点検・更新を行う場合</li><li>地震、落雷、火災、停電、天災等の不可抗力により本サービスの提供が困難な場合</li><li>その他、運営者がサービスの中断・停止が必要と判断した場合</li></ul></li><li>サービスの中断・停止により利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、運営者は責任を負いません。</li></ol>',
	section12: `<h2>第12条（免責事項）</h2><ol><li>本サービスは個人開発者が運営するものであり、「現状有姿（AS IS）」で提供されます。運営者は、本サービスの正確性、完全性、信頼性、適時性、安全性、特定目的への適合性について、明示的または黙示的を問わず一切の保証をしません。</li><li>本サービスはこどもの教育効果や行動変容を保証するものではなく、結果について運営者は責任を負いません。</li><li>運営者は、本サービスの利用により利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、一切の責任を負いません。</li><li>運営者は、以下に起因する損害について、一切の責任を負いません。<ul><li>データの消失、破損、改ざん、または復旧の不能</li><li>サービスの中断、遅延、停止、または終了</li><li>第三者サービス（AWS、Stripe、Google等）の障害、仕様変更、またはサービス停止</li><li>不正アクセス、コンピュータウイルス、その他のセキュリティ侵害</li><li>利用者間のトラブルまたは紛争</li><li>利用者の操作ミスまたはアカウント管理の不備</li></ul></li><li>運営者は、間接損害、特別損害、偶発的損害、結果的損害、逸失利益、およびデータの喪失について、たとえその可能性を事前に告知されていた場合であっても、責任を負いません。</li><li>前各項の規定にかかわらず、消費者契約法その他の強行法規の適用により運営者の責任が認められる場合、運営者が利用者に対して賠償する金額は、当該利用者が損害発生月を含む直近3ヶ月間に本サービスに対して実際に支払った利用料の総額を上限とします。${PLAN_FULL_TERMS.free}の利用者については、運営者の賠償額の上限は0円とします。</li></ol>`,
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
	effective: '<p>以上</p><p>制定日: 2026年3月27日</p><p>最終改定日: 2026年8月13日</p>',
} as const;

// ============================================================
// CHECKOUT_LABELS — Stripe Checkout custom_text SSOT (#2346 / EPIC #2345)
// ============================================================
//
// 景品表示法対応の critical 修正:
//   - 旧: 'お支払い後、すぐにすべての機能をご利用いただけます。' (stripe-service.ts 直書き)
//   - 旧: 'アプリに戻ってすべての機能をお楽しみください。'        (stripe-service.ts 直書き)
//   - 新: 'お支払い後、すぐにお選びのプランの機能をご利用いただけます。'
//   - 新: 'アプリに戻ってお選びのプランの機能をお楽しみください。'
//
// 法的根拠:
//   - 景品表示法 5 条 1 号 (優良誤認表示) — 「すべての機能」表示はスタンダードプラン購入時に
//     ファミリープラン機能まで含むと誤認させる可能性 (課徴金 売上 × 3% リスク)
//   - 特商法 2022-06 改正 最終確認画面ガイドライン — Stripe Checkout 最終確認画面の
//     誤認表示は消費者契約取消可能性 (消費者契約法 4 条 1 項)
//   - 消費者庁「動画見放題プラン」措置命令事例 — 本ケースと相同類型
//
// 設計指針:
//   - submitMessage         : Stripe Checkout の `custom_text.submit.message` 用
//                              (購入確定ボタン直前の説明文)
//   - afterSubmitMessage    : Stripe Checkout の `custom_text.after_submit.message` 用
//                              (購入確定直後の thank-you 画面文)
//   - submitMessageWithPlan : future-proof: プラン名動的差し込み版 (固定文言版は本 PR で採用、
//                              関数版は将来 plan tier が確定した文脈で使用予定)
//   - afterSubmitMessageWithPlan : 同上 (after_submit 版)
//
// `${CHECKOUT_TERMS.chosenPlanFeature}` 経由参照によりリテラル「お選びのプランの機能」を
// terms.ts SSOT (atom) から 1 行修正で全 compound に伝播可能 (ADR-0045)。
//
// 参照: docs/decisions/0002-critical-fix-quality-gate.md (本 atom 適用の critical 5 要件履歴)

export const CHECKOUT_LABELS = {
	submitMessage: `お支払い後、すぐに${CHECKOUT_TERMS.chosenPlanFeature}をご利用いただけます。`,
	afterSubmitMessage: `アプリに戻って${CHECKOUT_TERMS.chosenPlanFeature}をお楽しみください。`,
	// future-proof: プラン名動的差し込み版 (#2346 No-gos = 本 PR では未使用、定義のみ)
	submitMessageWithPlan: (planLabel: string) =>
		`お支払い後、すぐに${planLabel}の機能をご利用いただけます。`,
	afterSubmitMessageWithPlan: (planLabel: string) =>
		`アプリに戻って${planLabel}の機能をお楽しみください。`,
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
	section5:
		'<h2>第5条（障害通知）</h2><ol><li>サービス障害が発生した場合、運営者は本サービス内のお知らせにて状況を通知します。重大な障害の際は、登録メールアドレスへご連絡する場合があります。</li><li>障害の検知はデプロイ時の自動検証および定期的なヘルスチェック（準備中）により行われ、異常を検知した場合は速やかに対応を開始し通知します。</li></ol>',
	section6:
		'<h2>第6条（サポート対応）</h2><p>お問い合わせは<a href="https://github.com/Takenori-Kusaka/ganbari-quest/issues">GitHub Issues</a>または<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="SLA">メール</a>にて24時間受け付けています。初回応答は48時間以内（営業日ベース）を目標としています。対応言語は日本語です。</p><p>個人運営のため、応答が遅れる場合があります。ご理解をお願いいたします。</p>',
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
	articleHeader: '<h1>特定商取引法に基づく表記</h1><p class="meta">最終更新日: 2026年4月9日</p>',
	tableContent: `<tr><th>販売業者</th><td>日下武紀</td></tr><tr><th>運営責任者</th><td>日下武紀</td></tr><tr><th>所在地</th><td>請求があり次第、遅滞なく開示します（<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法-所在地">ganbari.quest.support@gmail.com</a> までご連絡ください）<br><small>※特商法第 11 条 + 同法施行規則第 23 条に基づく省略表示。請求受付後、遅滞なく所在地を書面・メール等にて開示いたします</small></td></tr><tr><th>電話番号</th><td>請求があり次第、遅滞なく開示します（<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法-電話番号">ganbari.quest.support@gmail.com</a> までご連絡ください）<br>受付時間: 平日 10:00〜18:00（土日祝・年末年始を除く）<br>※お問い合わせはメールを推奨いたします（原則 2 営業日以内に返信することを目標としています）<br><small>※特商法第 11 条 + 同法施行規則第 23 条に基づく省略表示。請求受付後、遅滞なく電話番号を書面・メール等にて開示いたします</small></td></tr><tr><th>メールアドレス</th><td><a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法">ganbari.quest.support@gmail.com</a></td></tr><tr><th>URL</th><td><a href="https://www.ganbari-quest.com">https://www.ganbari-quest.com</a></td></tr><tr><th>販売価格</th><td>${PLAN_FULL_TERMS.free}: 無料<br>${PLAN_FULL_TERMS.standard}: 月額${PRICE_TERMS.standardYenFull}（税込）<br>${PLAN_FULL_TERMS.premium}: 月額${PRICE_TERMS.familyYenFull}（税込）</td></tr><tr><th>支払方法</th><td>クレジットカード（Visa, Mastercard, JCB, American Express）<br>※Stripe決済サービス経由</td></tr><tr><th>支払時期</th><td>初回: 7 日間無料トライアルから開始。トライアル終了後は自動的に${PLAN_FULL_TERMS.free}に移行し、自動課金は発生しません。有料プランへの移行はお客さまご自身で${ADMIN_VIEW_TERMS.canonical}より手続きしていただく必要があります。<br>月額プラン: 毎月契約日に自動課金</td></tr><tr><th>サービス提供時期</th><td>お申込み後、即時ご利用いただけます（有料プランは 7 日間無料トライアルから開始）</td></tr><tr><th>返品・キャンセル</th><td>デジタルサービスのため返品はお受けしておりません。<br>有料プランの解約（中途解約）は、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」→「${STRIPE_PORTAL_TERMS.short}を開く」（${STRIPE_PORTAL_TERMS.canonical}）からいつでも可能です。<br>解約後は現在の請求期間の終了日まで引き続きご利用いただけます。日割り計算による返金は行いません。<br><br><strong>解約とデータの取扱い</strong>：解約によってお客様のデータが削除されることはありません。請求期間の終了後は${PLAN_FULL_TERMS.free}へ自動的に移行し、記録はそのまま保持されます。${PLAN_FULL_TERMS.free}の上限を超えるお子さま・活動・チェックリストはアーカイブされ、画面には表示されなくなります。アーカイブされたデータも削除はされず、有料プランに戻すと元どおりご利用いただけます。お支払いの失敗により契約が終了した場合も同じ取扱いです。${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。<br><br><strong>アカウント${CANCEL_TERMS.account}（データの完全削除）について</strong>：データそのものの削除をご希望の場合は、${ADMIN_VIEW_TERMS.canonical}の設定からアカウント${CANCEL_TERMS.account}をお申し込みください。ご利用プランに応じた猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）の経過後、すべてのお客様データが完全に削除されます（復旧不可）。有料プランは猶予期間中に${CANCEL_TERMS.account}の取消しとデータのエクスポートが可能ですが、${PLAN_FULL_TERMS.free}は猶予期間がなくお申し込みと同時に削除されます。</td></tr><tr><th>無料トライアル</th><td>初回お申込み時に 7 日間無料トライアルをご利用いただけます。<br>トライアル期間中にキャンセルされた場合、料金は発生しません。<br>トライアル終了後は自動的に${PLAN_FULL_TERMS.free}に移行します。自動課金は一切ありません。</td></tr><tr><th>追加料金</th><td>表示価格以外の追加料金はございません。<br>（インターネット接続に必要な通信料等は利用者のご負担となります）</td></tr><tr><th>動作環境</th><td>Chrome, Safari, Firefox, Edge の最新版<br>インターネット接続が必要です</td></tr>`,
	effective: '<p>制定日: 2026年3月31日</p><p>最終改定日: 2026年4月9日</p>',
} as const;

// ============================================================
// #2370 (EPIC #2362 P4): UnifiedImportHub + UnifiedEmptyState ラベル
//
// PO 指摘 ② (admin import UX が type ごとに分散) 直接解決のため、
// 5 type 横断で再利用される UI ラベルを集約する SSOT。
//
// 参照箇所:
//   - src/lib/marketplace/ui/UnifiedImportHub.svelte (5 type 共通 import エントリ)
//   - src/lib/marketplace/ui/UnifiedEmptyState.svelte (5 admin リソース共通 empty state)
//   - src/routes/(parent)/admin/{activities,rewards,checklists,settings/rules,challenges}/
//
// 設計原則 (DESIGN.md §10 Hick's Law / EPIC #2253 bridge ルール):
//   - empty state は「ないなら追加」へ secondary link を提供（initial setup 期の発見性）
//   - header `+` メニュー内 1 階層内アクセスで運用期の到達性を確保
//   - import / 手動作成の 2 経路を統一的に表示し add 経路 ≤ 4 を維持
// ============================================================
export const UNIFIED_IMPORT_HUB_LABELS = {
	heading: 'まとめて取り込む',
	description: 'マーケットプレイスや手元のファイルから一括で追加できます。',
	loading: '処理中...',
	emptyMarketplace: '取り込めるアイテムが見つかりません。',
	marketplaceHeading: 'マーケットプレイスから',
	fileHeading: 'ファイルから',
	// #backup-terms: 活動取込は CSV (自作表計算) も受けるため CSV を露出する (ADR-0013 truth)
	// #3201: slash 表記「バックアップ / CSV」を廃止し 2 つの入力源を平易に並記
	fileDesc: `保存しておいた${BACKUP_TERMS.file}か、表計算ソフトで作った${BACKUP_TERMS.csvFile}を取り込みます。`,
	fileImportBtn: 'ファイルを取り込む',
	addBtn: 'この内容で追加',
	processingText: '取り込み中...',
	// 5 type 共通の type 切替タブ
	typeTabAriaLabel: '取り込む種類を選ぶ',
	// 結果メッセージ (type 横断、imported/skipped を含む)
	resultSuccess: (name: string, imported: number, skipped: number) =>
		skipped > 0
			? `「${name}」を取り込みました（追加 ${imported} 件 / スキップ ${skipped} 件）`
			: `「${name}」を取り込みました（追加 ${imported} 件）`,
	resultAllDuplicates: (name: string) => `「${name}」はすべて重複していました（追加 0 件）`,
	resultError: '取り込みに失敗しました',
	// #2558 bug-1: デモ環境では書き込みが no-op 化されるため、成功偽装ではなく
	// 「お試し用」であることを明示して dialog を閉じる (dead-end 解消)。
	resultDemo: 'デモではお試し用です（実際の追加は行われません）',
	// Pack / set 説明 (type 表示用)
	itemCountSuffix: (count: number) => `（${count} 件）`,
	targetAgeRange: (min: number, max: number) => `対象年齢 ${min} 〜 ${max} 歳`,
	// childId 未選択時の警告 (reward-set / checklist 等 requiresChildId === true で表示)
	childRequiredHint: '※ 対象の子供を選んでから取り込みできます。',
	// preset 内アイテム数と対象年齢の連結 separator
	itemAgeSeparator: '・',
	// 既に取込済みの preset に表示するバッジ (#2391 Phase 2/3)
	importedBadge: '取込済み',
	// type 選択時のヒント
	typeHintActivityPack: 'プリセット活動を一括で追加します。',
	typeHintRewardSet: 'ごほうびテンプレートを子供ごとに一括登録します。',
	typeHintChecklist: '持ち物チェックリストのテンプレートを取り込みます。',
	typeHintRulePreset: 'ポイント交換や連続ボーナス等のルールを取り込みます。',
	typeHintChallengeSet: '家族で取り組むチャレンジ集を一括で追加します。',
} as const;

export const UNIFIED_EMPTY_STATE_LABELS = {
	// 5 admin リソース共通の empty state テキスト
	icon: '📋',
	// resource 名を埋め込むため関数形式
	noItems: (resourceName: string) => `${resourceName}がまだありません`,
	filteredText: '条件に一致するものがありません',
	addBtn: '＋ 新しく作る',
	importBtn: '📥 取り込みで追加する',
	// Reward / Checklist 等で childId 必須な場合の補助文言
	pickChildHint: '対象の子供を選んでから取り込みできます。',
	disabledReason: '権限が不足しています',
} as const;

/**
 * 参照先のレコードを解決できなかったときの表示名 (#4538)。
 *
 * 内部 ID (`#${childId}` 等) を表示名のフォールバックにしない (DESIGN.md §6「内部コード露出禁止」、
 * 過去事例 #498 / #573)。UUID が画面に出ても顧客には意味が無く、誰のことか分からないうえ、
 * 内部識別子を不必要に露出する。**画面 (子供 / 親) を問わず本ラベルを使う**。
 *
 * 出る条件は「一覧に載っていない子供 / 定義が無いカテゴリを参照している」= データ不整合であり、
 * 通常運用では出ない。出たときに「不明である」と正直に述べるのが正しい (存在しない名前を作らない)。
 *
 * 子供画面側の同種フォールバックは `CHILD_HOME_LABELS.siblingUnknownName` (「きょうだい」)。
 * 読み手が違う (子供 = ひらがな / 親 = 敬称) ため値は分けるが、**内部 ID を出さない**点は共通で、
 * `tests/unit/architecture/child-ui-display-integrity.test.ts` が両 scope をまとめて guard する。
 */
export const UNRESOLVED_ENTITY_LABELS = {
	/** children 一覧から引けなかった子供の表示名 */
	child: `不明な${CHILD_TERMS.honorific}`,
	/** カテゴリ定義から引けなかったカテゴリの表示名 */
	category: '不明なカテゴリ',
} as const;

// #3593 ④: system 生成 ポイント台帳 (point_ledger) description の SSOT。
// これらは DB に data 値として保存されると同時に、ポイント履歴 UI に表示される system 文言。
// ADR-0045 に従い service 層のコード直書きを避け、labels compound に集約する
// (「ポイント」は POINT_TERMS.unitFull atom を参照)。
export const POINT_LEDGER_LABELS = {
	/** baby モード初期ポイント付与 (親設定) の ledger description */
	initialSetup: '親による初期ポイント設定',
	/** ポイント → おこづかい変換の ledger description (変換モード別サフィックス付き) */
	convert(amount: number, mode: 'preset' | 'manual' | 'receipt'): string {
		const base = `${amount}${POINT_TERMS.unitFull}をおこづかいにかえました`;
		if (mode === 'manual') return `${base}（手動入力）`;
		if (mode === 'receipt') return `${base}（領収書読み取り）`;
		return base;
	},
} as const;

// #4644: オフライン着地ページ (`/offline`) の文言。
//
// 読み手は**年齢帯を問わず子供**である (Service Worker はどの画面からの遷移でも
// ここへ落とすため、preschool の子が最初に読む可能性がある)。年齢帯 variant は
// 持たず、全年齢が読めるひらがな主体の 1 種類に固定する。漢字を混ぜると preschool が
// 読めず、逆に「エラー」等のカタカナ専門語を出すと「壊した」と受け取られる。
export const OFFLINE_LABELS = {
	/** ページタイトル (svelte:head) */
	pageTitle: 'いんたーねっとに つながっていません',
	/** 画面見出し */
	heading: 'いんたーねっとに つながっていないよ',
	/** 本文 (原因と対処。子供が自分で試せることだけを書く) */
	body: 'でんぱが とどいていないみたい。おうちの Wi-Fi を たしかめてから、もういちど ためしてね。',
	/** 「壊れていない」ことの明示 (パニック防止。ADR-0012 整合で煽らない) */
	reassurance: 'きろくは きえていないから だいじょうぶ。',
	/** 再読み込みボタン */
	retry: 'もういちど ひらく',
	/** 装飾アイコン (aria-hidden) */
	icon: '📡',
} as const;

// #4644: ホーム画面への追加 (インストール) ガイドの文言。
//
// 親向けの案内。ADR-0012 整合で「押し付けない」— バナーは閉じたら二度と出さず、
// 恒久導線は 設定 > サポート に置く (フィードバック導線と同じ SSOT、DESIGN.md §10)。
export const PWA_INSTALL_LABELS = {
	/** 案内バナーの見出し */
	bannerTitle: `${PARENT_TERMS.honorific}の方へ: ${PWA_TERMS.installAction}できます`,
	/** 案内バナーの本文 (メリットを 1 文で) */
	bannerBody: `${PWA_TERMS.installAction}すると${PWA_TERMS.standalone}で起動し、${CHILD_TERMS.honorific}がブラウザのタブや URL 欄を誤って操作することなく使えます。`,
	/** Android / Chrome: ブラウザ標準のインストールダイアログを起動する */
	bannerInstallAction: PWA_TERMS.installAction,
	/** iOS Safari 等、beforeinstallprompt が無い環境で手順を開く */
	bannerHowToAction: '追加方法をみる',
	/** バナーを閉じる (以後表示しない) */
	bannerDismiss: '閉じる',
	/** 閉じるボタンの aria-label (「以後出ない」ことを読み上げでも伝える) */
	bannerDismissAria: '追加の案内を閉じる（次回から表示しません）',
	/** 手順ダイアログ / 設定内カードの見出し */
	guideTitle: `${PWA_TERMS.installAction}する方法`,
	/** 手順ダイアログの導入文 */
	guideIntro: `お使いの端末に合わせて操作してください。追加しても${PWA_TERMS.standalone}で開くだけで、アプリを別途インストールするわけではありません。`,
	/** Android / Chrome 手順の見出し */
	androidTitle: 'Android / Chrome の場合',
	androidStep1: '画面右上の「⋮」（メニュー）をひらく',
	androidStep2: `「${PWA_TERMS.installAction}」または「アプリをインストール」をえらぶ`,
	androidStep3: '確認画面で「追加」をおす',
	/** iOS / Safari 手順の見出し */
	iosTitle: 'iPhone / iPad（Safari）の場合',
	iosStep1: `画面下の「${PWA_TERMS.iosShareButton}」ボタン（□に↑）をおす`,
	iosStep2: `メニューを下にスクロールして「${PWA_TERMS.installAction}」をえらぶ`,
	iosStep3: '右上の「追加」をおす',
	/** 追加後に何が起きるか */
	afterNote: `追加すると、ホーム画面のアイコンから${PWA_TERMS.standalone}で開けるようになります。`,
	/** 設定 > サポート のカード見出し */
	settingsCardTitle: PWA_TERMS.installAction,
	/** 設定 > サポート のカード説明 */
	settingsCardDesc: `${CHILD_TERMS.honorific}が安全に使えるよう、ホーム画面にアイコンを置く手順をいつでも確認できます。`,
	/** 設定 > サポート の展開ボタン */
	settingsCardAction: '手順をみる',
	/** ダイアログを閉じる */
	close: '閉じる',
} as const;
