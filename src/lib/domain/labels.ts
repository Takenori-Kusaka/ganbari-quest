// src/lib/domain/labels.ts
// 用語辞書 — UI表示ラベルの Single Source of Truth
// 全てのUIラベルはこのファイルからインポートすること。ハードコード禁止。
// #1304: baby=準備モード に表記変更済み（AGE_TIER_LABELS / AGE_TIER_SHORT_LABELS）

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
	// 管理画面
	activities: '活動管理',
	activitiesIntroduce: '活動紹介スライド',
	reports: 'レポート',
	achievements: 'チャレンジ管理',
	growth: '成長記録ブック',
	points: 'ポイント管理',
	messages: 'おうえんメッセージ',
	rewards: 'ごほうび',
	checklists: 'チェックリスト管理',
	events: 'イベント管理',
	challenges: 'きょうだいチャレンジ',
	children: 'こども管理',
	members: 'メンバー管理',
	settings: '設定',
	analytics: 'アナリティクス',
	billing: '請求書・支払い管理',
	certificates: 'がんばり証明書',
	license: 'プラン・お支払い',
	statusBenchmark: 'ベンチマーク管理',
	packs: '活動パック',
	// 認証
	login: 'ログイン',
	signup: 'アカウント登録',
	invite: '招待',
	forgotPassword: 'パスワードリセット',
	// セットアップ
	setup: 'セットアップ',
	// 子供用
	childAchievements: 'チャレンジきろく',
	childStatus: 'つよさ',
	childHome: 'ホーム',
	childChecklist: 'もちものチェック',
	// デモ子供用
	demoChildAchievements: 'チャレンジきろく',
	demoChildStatus: 'つよさ',
	demoChildBattle: 'バトル',
	demoChildHome: 'ホーム',
	demoChildChecklist: 'もちものチェック (デモ)',
	// デモ管理画面
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
	setupPacks: '活動パック選択',
	// ユーザー切替
	switchUser: 'だれがつかう？',
	// その他
	marketplace: 'テンプレート',
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
	upgrade: 'アップグレード',
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

export const NAV_CATEGORIES = {
	activity: { label: '活動', icon: '🎮' },
	record: { label: '記録', icon: '📊' },
	settings: { label: '設定', icon: '⚙️' },
} as const;

export type NavCategoryId = keyof typeof NAV_CATEGORIES;

// ============================================================
// ナビゲーション項目ラベル
// ============================================================

export const NAV_ITEM_LABELS = {
	// #1396: 管理画面ホームタブ（直接遷移・dropdown なし）
	home: 'ホーム',
	reports: 'レポート',
	growthBook: 'グロースブック',
	achievements: 'チャレンジ履歴',
	analytics: 'アナリティクス',
	points: 'ポイント',
	messages: 'おうえん',
	rewards: 'ごほうび',
	activities: '活動管理',
	// #1168: チェックリスト（ナビは単一、ページ内タブで「持ち物」「ルーティン」に分離）
	checklists: 'チェックリスト',
	itemChecklists: '持ち物チェックリスト',
	routineChecklists: 'ルーティン',
	events: 'イベント',
	challenges: 'チャレンジ',
	// #1170: マーケットプレイス グローバルナビ昇格 → #1212-H ADR-0041 呼称変更（テンプレート）
	marketplace: 'テンプレート',
	children: 'こども',
	settings: '設定',
	license: 'プラン',
	billing: '請求管理',
	members: 'メンバー',
} as const;

// ============================================================
// 年齢区分ラベル（管理画面用）
// ============================================================

/** 管理画面で保護者に表示する年齢区分ラベル（#537: 日本の学校制度に準拠） */
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

export const PLAN_LABELS = {
	free: '無料プラン',
	standard: 'スタンダードプラン',
	family: 'ファミリープラン',
} as const;

export const PLAN_SHORT_LABELS = {
	free: '無料',
	standard: 'スタンダード',
	family: 'ファミリー',
} as const;

export type PlanKey = keyof typeof PLAN_LABELS;

/** プラン制限メッセージで使う共通ラベル（「スタンダードプラン以上」） */
export const PAID_PLAN_LABEL = 'スタンダードプラン以上' as const;

export const LICENSE_PLAN_LABELS: Record<string, string> = {
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

/** ライセンスプランラベルを取得 (license-plan.ts の値 → 表示ラベル) */
export function getLicensePlanLabel(plan: string): string {
	return LICENSE_PLAN_LABELS[plan] ?? plan;
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
	rpgBattle: 'RPG バトル',
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
export const ACTION_LABELS = {
	upgrade: 'アップグレード',
	viewPlans: 'プランを見る',
	later: 'あとで',
	freeTrial: '無料体験',
	freeTrialWord: '無料で試す',
	// #1383: タイトル文脈用の可能形 (「7日間、全機能を無料で試せます」)。
	// freeTrialWord (終止形) を「〜ます」に連結すると「試すます」と非文法になるため、
	// 完全活用済みの文言を個別定数化する。
	freeTrialDesc: '無料で試せます',
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
 * CI: scripts/check-forbidden-terms.mjs が完全一致禁止語を検出する。
 */
export const TRIAL_LABELS = {
	durationDays: 7,
	bannerTitleActive: (days: number) => `${ACTION_LABELS.freeTrial}中（残り${days}日）`,
	bannerTitleUrgent: `${ACTION_LABELS.freeTrial}は明日で終了します`,
	bannerDescActive: '全機能をお試しいただけます。',
	bannerTitleNotStarted: `7日間、全機能を${ACTION_LABELS.freeTrialDesc}`,
	bannerDescNotStarted: `${PLAN_LABELS.standard}のすべての機能をお使いいただけます。カード登録不要。`,
	bannerCtaNotStarted: ACTION_LABELS.viewPlans,
	bannerCtaStart: `7日間 ${ACTION_LABELS.freeTrialWord}`,
	bannerCtaSubmitting: ACTION_LABELS.submitting,
	bannerTitleExpired: `${ACTION_LABELS.freeTrial}が終了しました`,
	bannerDescExpired: `${ACTION_LABELS.upgrade}で全機能をご利用いただけます。`,
	bannerDescExpiredWithArchive: `一部のデータが制限されています。${ACTION_LABELS.upgrade}ですべて復元できます。`,
	bannerCtaExpired: `⭐ ${ACTION_LABELS.upgrade}`,
} as const;

// ============================================================
// ライフサイクルメール用ラベル（#1601 / ADR-0023 §3.2 §3.3 §5 I11）
//
// 期限切れ前リマインド (renewal) + 休眠復帰 (dormant) + 配信停止 (unsubscribe) の
// メール文言 SSOT。Anti-engagement 原則（ADR-0012）に従い、煽り表現
// （「今すぐアップグレード」「失効します」等）を含めない中立的トーンとする。
//
// 親宛のみ送信されるため、敬語ベース（「ご利用ありがとうございます」「ご確認ください」）。
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
	renewalGraduate: '卒業（解約）をご希望の場合は、管理画面から手続きできます。',
	renewalCtaLabel: 'プラン管理画面を開く',

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
// PremiumModal 用ラベル（#1166 labels.ts SSOT 化）
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
	priceStandard: '¥500',
	priceFamily: '¥780',
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
	pageTitle: 'みんなのテンプレート',
	navShort: 'テンプレート',
	pageDescription: 'お子さまの年齢にぴったりの活動・ごほうび・チェックリストを見つけよう',
	metaDescription:
		'活動パック・ごほうびセット・チェックリスト・特別ルールを探そう。がんばりクエストの公式テンプレート集です。',
	filterClear: 'フィルタをクリア',
	emptyState: '条件に合うコンテンツがありません',
	ctaHeading: 'テンプレートを使うには',
	ctaSubheading: 'アカウント登録後、管理画面からワンタップで使ってみることができます',
	ctaStart: '無料で はじめる',
	backToHome: 'トップページへ',
	backToDemo: 'デモを体験',
	breadcrumbRoot: 'テンプレート',
	recommendedSection: 'おすすめパック',
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
	detailLegacyPackNote: '既存の活動パックから使えるようになります。詳しくは',
	detailLegacyPackLink: 'パック詳細ページ',
	detailLegacyPackSuffix: 'をご覧ください。',
	detailRulePointCost: '必要ポイント',
	detailRulePointBonus: 'ボーナス',
	detailCtaSignup: 'がんばりクエストに登録して使ってみる',
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
			description:
				'各こどもの名前・年齢・ポイント残高が表示されます。「こどもごとの進捗をざっくり把握したい」時にここを見てください。\n\n⭐ 無料プランではこどもを2人まで登録できます。3人以上のきょうだいがいる場合はスタンダードプラン以上で無制限に登録できます。',
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
			description:
				'家族のデータをJSONファイルとしてエクスポート（バックアップ）したり、別の環境からインポート（復元）できます。機種変更やデータの引っ越しに便利です。',
		},
		'settings-1': {
			title: 'こども画面へ切替',
		},
		'settings-2': {
			description: '管理画面へのアクセスを保護する',
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
// デモ実行モード関連ラベル（#1180 / ADR-0039）
// ============================================================

/**
 * デモモード（`?mode=demo`）関連の文言 SSOT。
 * ハードコードせず本定数を介して参照すること（ADR-0037 準拠）。
 * baby / preschool モードではひらがな併記を優先する。
 */
export const DEMO_LABELS = {
	/** 上部バナーのメイン文言 */
	bannerTitle: 'おためしモード',
	bannerDescription: 'これはおためしです。記録やせっていはほぞんされません。',
	/** 「ほんとうに始める」CTA */
	ctaStart: 'ほんとうに始める',
	/** 退出ボタン */
	ctaExit: 'おためしをやめる',
	/** 退出先（ログイン誘導ではなく LP に戻す） */
	exitHref: '/demo/exit',
	/** サインアップ CTA 先 */
	signupHref: '/auth/signup',
} as const;

// ============================================================
// おやカギコード関連ラベル（#1360）
// ============================================================

/**
 * 親向け管理画面ロック（旧称「PINコード」→「おやカギコード」）の UI 文言 SSOT。
 * ロジック定数（DEFAULT_PIN）は `$lib/domain/constants/oyakagi` を参照。
 */
export const OYAKAGI_LABELS = {
	name: 'おやカギコード',
	shortName: 'おやカギ',
	setupStep: 'おやカギコードを変更する',
	changeAction: 'おやカギを変更',
	changeSuccess: 'おやカギコードを変更しました',
	sectionTitle: '🔒 おやカギコード変更',
	inputLabel: 'おやカギコード（4〜6桁）',
	inputPlaceholder: 'おやカギコードを入力',
	defaultValueHint: '初期値は 5086（がんばり）です',
	invalidError: 'おやカギコードが正しくありません',
	lockedError: 'おやカギコードの入力に連続して失敗したため、しばらく待ってから再度お試しください',
	formatError: 'おやカギコードは4〜6桁の数字で入力してください',
	numberOnlyError: 'おやカギコードは数字のみです',
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
	errorInvalidJson: 'JSONの解析に失敗しました',
	errorImportFailed: 'インポートに失敗しました',

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
 * - log_constraint: 複合 unique 制約 (activity_logs, login_bonuses, status_history)
 */
export type ImportSkipReason = 'preset_duplicate' | 'name_duplicate' | 'log_constraint';

// ============================================================
// 設定ページ関連ラベル（#1452 Phase B）
// ============================================================

export const SETTINGS_LABELS = {
	// grace_period バナー
	gracePeriodTitle: '解約手続き中です',
	gracePeriodDesc:
		'現在、アカウントは解約手続き中で読み取り専用モードです。期限までにキャンセルしないとデータが完全に削除されます。',
	reactivateSubmitting: 'キャンセル中...',
	reactivateAction: '解約をキャンセルして通常利用に戻る',

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
	siblingChallengeMode: 'チャレンジモード',
	siblingRankingLabel: 'きょうだいランキングを表示する',
	siblingRankingUpsell: 'きょうだいランキングはファミリープラン限定の機能です。',
	siblingRankingUpsellLink: 'プランのアップグレード',
	siblingRankingUpsellSuffix: 'で利用できます。',
	siblingSaveAction: '設定を保存',

	// 通知設定
	notificationSectionTitle: '🔔 通知設定',
	notificationSaved: '通知設定を保存しました',
	notificationBrowserLabel: 'ブラウザ通知',
	notificationChecking: '確認中...',
	notificationEnableAction: '通知を有効にする',
	notificationDisableAction: '通知を無効にする',
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

	// データ管理
	dataSectionTitle: '💾 データ管理',
	dataExportDesc:
		'家族のデータをJSONファイルとしてダウンロードできます。バックアップや別環境への移行に使用できます。',
	dataExportTarget: 'エクスポート対象:',
	dataExportItem1: '子供プロフィール・活動記録・ポイント履歴',
	dataExportItem2: 'ステータス・実績・称号・ログインボーナス',
	dataExportItem3: 'チェックリスト・誕生日振り返り',
	dataExportItem4: '活動マスタ・きせかえアイテム',
	dataExportUpsellTitle: '🔒 データエクスポートは ',
	dataExportUpsellPlan: 'スタンダードプラン',
	dataExportUpsellSuffix: ' 以上でご利用いただけます。',
	dataExportUpsellDesc:
		'家族のデータをJSON/ZIP形式でダウンロードして、バックアップや引っ越しに利用できます。',
	dataExportUpsellCta: 'プランを見る',
	dataExportLockedButton: '🔒 データをエクスポート（有料プラン限定）',
	dataExportIncludeFiles: '画像・音声ファイルも含める（ZIP形式）',
	dataExportIncludeFilesHint:
		'画像・音声を含める場合は上のチェックをオンにしてください。ファイルサイズが大きくなる場合があります（最大100MB）。',
	dataExportCompact: '圧縮形式でエクスポート（ファイルサイズを削減）',
	dataExporting: 'エクスポート中...',
	dataExportAction: 'データをエクスポート',

	// インポート
	dataImportTitle: 'データのインポート',
	dataImportDesc: 'エクスポートしたJSONファイルからデータを復元できます。',
	dataImportMode: 'インポートモード',
	dataImportModeReplace: '置換（既存データを削除してインポート）',
	dataImportModeAdd: '追加（既存データを残して追加）',
	dataImportModeReplaceWarning:
		'既存の子供・活動ログ・ポイント等のデータをすべて削除してからインポートします。',
	dataImportModeAddNote: '新しい子供データとして追加されます（既存データは上書きされません）。',
	dataImportLoading: '読み込み中...',
	dataImportSelectFile: 'JSONファイルを選択',
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
	dataImportWarningsTitle: (n: number | string) => `警告 (${n}件):`,
	dataImportErrorsTitle: (n: number | string) => `エラー (${n}件):`,
	dataImportClose: '閉じる',

	// クラウドエクスポート
	cloudSectionTitle: '☁️ クラウド共有',
	cloudSlotCounter: (current: number, max: number) => `保管枠 ${current} / ${max}`,
	cloudUpsellTitle: '🔒 クラウド共有は ',
	cloudUpsellPlan: 'スタンダードプラン',
	cloudUpsellSuffix: ' 以上でご利用いただけます。',
	cloudUpsellDesc:
		'家族のデータをクラウドに保管して、PINコードで別端末や他のアカウントと共有できます（スタンダード: 3枠 / ファミリー: 10枠）。',
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

	// フィードバック
	feedbackSectionTitle: '💬 フィードバック・ご意見',
	feedbackContentLabel: '内容',
	feedbackContentPlaceholder: 'ご意見・ご要望をお聞かせください...',
	feedbackContactNote: '技術的なご質問・使い方の相談は',
	feedbackContactLinkLabel: 'メール',
	feedbackContactSuffix: 'でも受け付けています',

	// アプリ情報
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
	accountDeleteOwnerWarning:
		'削除後のデータ復旧はできません。事前にデータをエクスポートすることを強くお勧めします。',
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
	accountDeleteTransferOption: 'オーナー権限を移譲して退会する',
	accountDeleteFullOption: '家族グループを全て削除する',
	accountDeleteFullOptionDesc: '全メンバーの所属が解除され、全データが削除されます。',
	accountDeleteCancelAction: 'キャンセル',

	// ログアウト
	logoutSectionTitle: 'ログアウト',
	logoutDesc:
		'このデバイスからがんばりクエストのアカウントからログアウトします。再度ログインするにはメールアドレスとパスワードが必要です。',
	logoutAction: 'アカウントからログアウト',
} as const;

export const LICENSE_PAGE_LABELS = {
	// 現在のプラン
	currentPlanTitle: '現在のプラン',
	currentPlanLabel: 'プラン',
	currentPlanStatus: 'ステータス',
	currentPlanExpiry: '有効期限',
	currentPlanLicenseKey: 'ライセンスキー',
	currentPlanFamilyName: '家族名',
	currentPlanCreatedAt: '登録日',

	// ライセンスキー適用
	licenseKeyTitle: 'ライセンスキーを適用',
	licenseKeyDesc:
		'キャンペーン・サポート窓口から受け取ったライセンスキーを入力して、プランを有効化できます。',
	licenseKeyApplySuccess: 'ライセンスキーを適用しました。プランが更新されています。',
	licenseKeyInputLabel: 'ライセンスキー',
	licenseKeyHelpToggle: 'ライセンスキーについて',
	licenseKeyHelpOnce: '一回限りの使用',
	licenseKeyHelpOnceDesc: '一度有効化すると、他のアカウントでは使用できません。',
	licenseKeyHelpOverwrite: 'プラン上書き',
	licenseKeyHelpOverwriteDesc: '現在のプランはキーに対応するプランに上書きされます。',
	licenseKeyHelpBound: '紐付け先',
	licenseKeyHelpBoundDesc:
		'現在のアカウント（家族）に紐付き、他の家族へ付け替えることはできません。',
	licenseKeyHelpIrreversible: '取り消し不可',
	licenseKeyHelpIrreversibleDesc: '適用後に取り消すことはできません。',
	licenseKeyApplyButton: 'ライセンスキーを適用',

	// ライセンスキー確認ダイアログ
	licenseKeyConfirmTitle: 'ライセンスキーを有効化しますか？',
	licenseKeyConfirmDesc: '入力されたライセンスキーを現在のアカウントに適用します。',
	licenseKeyConfirmOnce: '一回限り',
	licenseKeyConfirmOnceDesc: '使用可能です（適用後は他アカウントで使えなくなります）',
	licenseKeyConfirmPlan: 'プラン',
	licenseKeyConfirmPlanDesc: 'が自動で付与され、現在のプランは上書きされます',
	licenseKeyConfirmBoundPrefix: 'このキーは',
	licenseKeyConfirmBoundSuffix: (tenantName: string) =>
		`「${tenantName}」に紐付けられ、他の家族に付け替えできません`,
	licenseKeyConfirmIrreversible: '取り消すことはできません',
	licenseKeyEnteredKey: '入力されたキー',
	licenseKeyAgreeOnce: '一回限り使用',
	licenseKeyAgreeOnceDesc: 'であり、他のアカウントでは使えなくなることに同意します',
	licenseKeyAgreePrefix: 'このライセンスキーが',
	licenseKeyCancel: 'キャンセル',
	licenseKeyConfirmPlanPrefix: 'キーに対応する',
	licenseKeyConfirmIrreversiblePrefix: '適用を',
	licenseKeyApplyLoading: '適用中…',
	licenseKeyApplyConfirm: '適用する',

	// プランラベル
	planLabelMonthly: 'スタンダード月額（¥500/月）',
	planLabelYearly: 'スタンダード年額（¥5,000/年）',
	planLabelFamilyMonthly: 'ファミリー月額（¥780/月）',
	planLabelFamilyYearly: 'ファミリー年額（¥7,800/年）',
	planLabelLifetime: '永久ライセンス',
	planLabelFree: '無料プラン',

	// ステータスラベル
	statusActive: '有効',
	statusGracePeriod: '猶予期間',
	statusSuspended: '停止中',
	statusTerminated: '解約済み',

	// 無料トライアル
	trialActiveTitle: 'スタンダードプラン トライアル中',
	trialActiveDays: (days: number | string) => `残り ${days}日`,
	trialActiveUntil: (date: string | null) => `${date ?? ''} まで`,
	trialStartTitle: '7日間 無料でお試し',
	trialStartDesc: 'スタンダードプランの全機能を体験できます',
	trialStartButton: '無料トライアルを開始する',
	trialStartNote: 'クレジットカード不要 — 自動で課金されることはありません',
	trialUsed: '無料トライアルは使用済みです',

	// ステータス別メッセージ
	gracePeriodTitle: '⚠️ 猶予期間中',
	gracePeriodDesc:
		'お支払いの確認が取れていません。猶予期間内にお支払いを完了してください。期間を過ぎるとサービスが停止されます。',
	suspendedTitle: '⏸️ サービス停止中',
	suspendedDesc:
		'ライセンスが停止されています。データは保持されていますが、新しい活動の記録やポイントの付与はできません。',
	terminatedTitle: '❌ 解約済み',
	terminatedDesc:
		'このアカウントは解約されています。データは一定期間保持されますが、その後削除されます。',

	// プラン管理
	planManagementTitle: 'プラン管理',
	planManagementUnavailable: '決済機能は現在準備中です',
	portalButton: (loading: boolean) => (loading ? '読み込み中...' : 'プラン変更・支払い管理'),
	portalNote: 'Stripeの管理画面でプラン変更・支払い方法の更新・解約ができます',
	portalPinNote: (usesPin: boolean) =>
		`⚠️ プラン変更には${usesPin ? '親 PIN' : '確認フレーズ'}の入力が必要です`,
	billingMonthly: '月額',
	billingYearly: '年額（17% OFF）',

	// スタンダードプラン
	standardPlanName: 'スタンダード',
	standardPlanDesc: '子供無制限・活動無制限・1年保持',
	standardPriceMonthly: '¥500',
	standardPriceYearly: '¥5,000',
	standardPerMonth: '/月',
	standardPerYear: '/年',

	// ファミリープラン
	familyPlanName: 'ファミリー',
	familyPlanDesc: '家族みんなで見守る+永久保持',
	familyPriceMonthly: '¥780',
	familyPriceYearly: '¥7,800',
	familyRecommendBadge: 'おすすめ',

	// 購入ボタン
	checkoutButton: (tier: string, loading: boolean) =>
		loading ? '処理中...' : `${tier === 'family' ? 'ファミリー' : 'スタンダード'}プランで始める`,
	checkoutNote: 'いつでもキャンセル・プラン変更可能',

	// 支払い履歴
	paymentHistoryTitle: '支払い履歴',
	paymentHistoryPortalNote: '支払い履歴はStripeの管理画面でご確認いただけます',
	paymentHistoryPortalButton: '支払い履歴を確認',
	paymentHistoryEmpty: '支払い履歴はまだありません',
	paymentHistoryBillingLink: '🧾 請求書・支払い方法の管理',

	// Portal 確認ダイアログ
	portalConfirmTitle: 'プラン変更の確認',
	portalConfirmDesc:
		'Stripeの管理画面に移動します。この画面からプラン変更・解約・ダウングレードが可能です。',
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
	churnLostItemBonus: (multiplier: number | string) => `ログインボーナス ×${multiplier}倍`,
	churnLostItemTitle: (title: string) => `「${title}」称号`,
	churnLostRetentionDays: (days: number | string) => `${days}日以前のデータへのアクセス`,

	// デモ版固有ラベル
	demoNotice: 'これはデモ画面です',
	demoNoticeOperationsDisabled: '実際の操作はできません',
	demoNoticeToast: (notice: string) => `${notice} - 実際の操作はできません`,
	demoNoticeToastText: 'デモでは実際の操作はできません',
	demoNoticeDesc:
		'本番の /admin/license と同じ画面構成ですが、Stripe決済・ライセンスキー適用・トライアル開始はすべて無効化されています。クリックしても課金は発生しません。',
	demoApplySuccessTitle: 'ライセンスキーが適用されました（デモ）',
	demoApplySuccessDesc: (planName: string) =>
		`プランが ${planName} に変更されました。これはデモの模擬動作です。実際のプラン変更は行われていません。`,
	demoCurrentPlanTitle: '現在のプラン（デモ）',
	demoPlanUsageTitle: 'プラン利用状況',
	demoPlanUsageActivity: 'カスタム活動',
	demoPlanUsageChildren: 'こども',
	demoPlanUsageRetention: 'データ保持',
	demoPlanUsageRetentionValue: (days: number | null) => (days === null ? '無制限' : `${days}日間`),
	demoPlanUsageMaxValue: (max: number | null) => (max === null ? '無制限' : String(max)),
	demoTrialNote: 'デモではトライアルは開始できません',
	demoLicenseKeyTitle: '💎 ライセンスキーをお持ちの方',
	demoLicenseKeyDesc: '買い切りライセンスキーをお持ちの場合は、こちらで適用できます。',
	demoLicenseKeyNote: 'デモでは実際の適用は行われません（画面の変化を体験できます）', // full text including parenthesized part
	demoLicenseKeyHelpAutoGrant: 'プラン自動付与',
	demoLicenseKeyHelpAutoGrantDesc: 'キーに対応するプランが自動で付与されます。',
	demoLicenseKeyHelpBoundDesc: '現在のアカウント（家族）に紐付き、他の家族に付け替えできません。',
	demoLicenseKeyHelpIrreversibleDesc: '適用後の取り消しはできません。',
	demoLicenseKeyConfirmBound: (name: string) => `このキーは「${name}」に紐付けられます`,
	demoLicenseKeyConfirmPlanDesc: 'が自動で付与されます',
	demoLicenseKeyMockNote: 'これはデモの模擬操作です。実際のキー消費やプラン変更は行われません。',
	demoLicenseKeyAgreeDesc:
		'であり、\n\t\t\t\t\t\t\t\t他のアカウントでは使えなくなることに同意します',
	demoCheckoutButton: (tier: string) =>
		`${tier === 'family' ? 'ファミリー' : 'スタンダード'}プランで始める`,
	demoCheckoutNote: 'デモでは実際の決済は行われません',
	demoPlanManagementTitle: 'プラン管理',
	demoPaymentHistoryTitle: '支払い履歴',
} as const;

export const REPORTS_LABELS = {
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
	weeklyEmptyNote: '子どもを登録すると、毎週レポートが生成されます',

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
	// ページタイトル
	pageTitle: 'OPS - KPI サマリー',

	// フェッチ時刻
	fetchedAt: (dateStr: string) => `${dateStr} 時点`,

	// KPI カード
	kpiLabelTotal: '総テナント数',
	kpiLabelActive: 'アクティブ',
	kpiLabelGracePeriod: '猶予期間',
	kpiLabelSuspended: '停止中',
	kpiLabelTerminated: '退会済み',
	kpiNewThisMonth: (n: number | string) => `+${n} 今月`,

	// プラン別内訳
	planBreakdownTitle: 'プラン別内訳（アクティブテナント）',
	planColPlan: 'プラン',
	planColTenants: 'テナント数',
	planColMrr: 'MRR 概算',
	planMonthly: '月額 (¥500/月)',
	planYearly: '年額 (¥5,000/年)',
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
	receiptLabel: '領収書を撮影して金額を読み取り',
	receiptCaptureButtonTitle: '領収書を撮影 / 画像を選択',
	receiptCaptureButtonNote: 'JPEG, PNG, WebP（5MB以下）',
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
	licenseKeyLabel: 'ライセンスキー',
	licenseKeyHint: '購入済みのライセンスキーを入力してください',
	licenseKeyHelpToggle: 'ライセンスキーについて',
	licenseKeyHelpOnce: '一回限りの使用',
	licenseKeyHelpOnceDesc: '一度有効化すると、他のアカウントでは使用できません。',
	licenseKeyHelpAutoDetect: 'プラン自動判定',
	licenseKeyHelpAutoDetectDesc: 'キーに応じてスタンダード / ファミリープランが自動で付与されます。',
	licenseKeyHelpBound: '紐付け先',
	licenseKeyHelpBoundDesc:
		'現在登録中のアカウント（家族）に紐付きます。後から他の家族に付け替えることはできません。',
	licenseKeyHelpExpiry: '有効期限',
	licenseKeyHelpExpiryDesc: '発行日から所定の期間で失効します（失効後は使用不可）。',
	licenseKeyOnceAgreePrefix: 'このライセンスキーが',
	licenseKeyOnceAgreeStrong: '一回限り使用',
	licenseKeyOnceAgreeSuffix: 'であり、他のアカウントでは使えなくなることに同意します',
	licenseKeyOnceAgreeError: '一回限り使用への同意が必要です',
	licenseKeySkipButton: 'ライセンスキーなしで続ける',
	licenseKeyLinkButton: 'ライセンスキーをお持ちの方',
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
	submitWithLicenseKey: 'ライセンスキーで登録',
	submitWithTrial: '7日間 無料体験をはじめる',
	submitFree: '無料ではじめる',
	trialPlanNote: (planName: string) =>
		`セットアップ後に ${planName}プランのトライアルが開始されます`,
	trialPlanStandard: 'スタンダード',
	trialPlanFamily: 'ファミリー',
	loginLink: '既にアカウントをお持ちの方はこちら',
	legalNote: '有料プランをご利用の前に',
	legalTokushoho: '特定商取引法に基づく表記',
	legalSlaAnd: 'および',
	legalSla: 'SLA',
	legalNoteEnd: 'をご確認ください',

	// ライセンスキー確認ダイアログ
	licenseConfirmTitle: 'ライセンスキーを有効化しますか？',
	licenseConfirmKeyLabel: '入力されたキー',
	licenseConfirmOnce: '一回',
	licenseConfirmOnceDesc: 'しか使用できません。有効化後は他のアカウントで再利用できません。',
	licenseConfirmPlanPrefix: 'キーに対応する',
	licenseConfirmPlanStrong: 'プラン（スタンダード / ファミリー）',
	licenseConfirmPlanSuffix: 'が自動で付与されます。',
	licenseConfirmBoundPrefix: 'このキーは',
	licenseConfirmBoundEmail: (email: string) => `「${email || '入力中のアカウント'}」`,
	licenseConfirmBoundSuffix: 'に紐付けられ、後から他の家族に付け替えることはできません。',
	licenseConfirmExpiry: '有効期限',
	licenseConfirmExpirySuffix: 'が設定されています。発行から一定期間で失効します。',
	licenseConfirmCancel: 'キャンセル',
	licenseConfirmOk: '有効化する',

	// submitBlockReason (JS, shown in template)
	blockEmailRequired: 'メールアドレスを入力してください',
	blockPasswordRequired: 'パスワードを入力してください',
	blockPasswordConfirmRequired: 'パスワード（確認）を入力してください',
	blockPasswordMismatch: 'パスワードが一致しません',
	blockTermsRequired: '利用規約への同意が必要です',
	blockPrivacyRequired: 'プライバシーポリシーへの同意が必要です',
	blockCrossBorderRequired: '米国への個人データ移転への同意が必要です',
	blockLicenseKeyInvalid: 'ライセンスキーを正しく入力してください',
	blockLicenseOnceRequired: 'ライセンスキーが一回限り使用であることに同意してください',
} as const;

export const ANALYTICS_LABELS = {
	pageTitle: 'アナリティクス - 管理画面',
	pageHeading: 'アナリティクス',
	pageDescription:
		'DynamoDB に蓄積された業務イベントから 4 つの主要指標を可視化します（Pre-PMF Bucket A 範囲）。',

	// #1639 (#1591 follow-up): DynamoDB ベース 4 種可視化のラベル

	// 共通
	periodLabel: '期間',
	period7d: '直近 7 日',
	period30d: '直近 30 日',
	period90d: '直近 90 日',
	periodWeekly: '週次',
	periodMonthly: '月次',
	noDataLabel: 'データがありません',
	fetchErrorLabel: '取得に失敗しました',
	fetchedAtLabel: '取得時刻',
	totalLabel: '合計',
	countSuffix: '件',
	tenantSuffix: 'テナント',

	// AC1: Activation funnel
	activationFunnelHeading: 'アクティベーションファネル',
	activationFunnelDesc:
		'signup → 初回子供登録 → 初回活動完了 → 初回報酬演出のテナント単位ユニーク件数。各ステップ間の遷移率を表示します。',
	activationFunnelStepLabels: {
		activation_signup_completed: 'signup 完了',
		activation_first_child_added: '初回子供登録',
		activation_first_activity_completed: '初回活動完了',
		activation_first_reward_seen: '初回報酬演出',
	},
	activationFunnelConversionLabel: '前ステップからの遷移率',
	activationFunnelStepHeading: 'ステップ',
	activationFunnelTenantHeading: 'テナント数',

	// AC2: Retention cohort
	retentionCohortHeading: 'リテンションコホート',
	retentionCohortDesc:
		'サインアップ月別のテナント残存率（Day 1 / 7 / 14 / 30 / 60 / 90 時点）。サンプルが少ない月はサンプル不足として表示されます。',
	retentionCohortHeading_cohort: 'コホート',
	retentionCohortHeading_size: 'サイズ',
	retentionCohortInsufficientSample: 'サンプル不足',
	retentionCohortDayHeading: (day: number) => `D${day}`,
	retentionCohortNotYet: '—',

	// AC3: Sean Ellis score
	seanEllisHeading: 'Sean Ellis スコア (PMF 指標)',
	seanEllisDesc:
		'「サービスが使えなくなったらどう感じる？」アンケートで「とても残念」と答えた割合（N/A 除外）。40% 超で PMF 達成判定。',
	seanEllisRoundLabel: 'round',
	seanEllisScoreLabel: 'スコア',
	seanEllisAchieved: 'PMF 達成',
	seanEllisNotAchieved: '未達成',
	seanEllisTotalResponses: '回答数',
	seanEllisOpsLink: 'ops/pmf-survey で詳細を見る',

	// AC4: Cancellation reasons
	cancellationReasonsHeading: '解約理由分布',
	cancellationReasonsDesc:
		'解約フローで取得した理由カテゴリの内訳。卒業 / 離反 / 中断の 3 分類で表示します。',
	cancellationCategoryHeading: 'カテゴリ',
	cancellationCountHeading: '件数',
	cancellationPercentageHeading: '比率',
} as const;

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
	billingPortalDesc: 'Stripe の管理画面で以下の操作ができます:',
	featureInvoices: '過去の請求書の確認・ダウンロード',
	featurePaymentMethod: '支払い方法（クレジットカード）の変更',
	featurePlanSwitch: '月額 / 年額プランの切り替え',
	featureNextBilling: '次回請求日の確認',
	notReadyAlert: '決済機能は現在準備中です',
	openPortalError: '請求管理画面を開けませんでした',
	openPortalLoading: '読み込み中...',
	openPortalButton: '請求管理画面を開く',
	openPortalNote: 'Stripe の安全な管理画面に移動します',
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
	dialogTitle: '請求管理画面を開く',
	dialogDesc:
		'Stripeの管理画面に移動します。この画面から支払い方法の変更・プラン切り替えが可能です。',
	dialogPinRequired: (label: string) => `⚠️ 誤操作を防ぐため、${label}を入力してください。`,
	dialogPinOrPhrase: '確認フレーズ',
	dialogConfirmPhraseLabel: (phrase: string) => `確認のため「${phrase}」と入力してください`,
	dialogCancelButton: 'キャンセル',
	dialogConfirmLoading: '確認中…',
	dialogConfirmButton: '請求管理画面へ',
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
	categoryGraduationHint: '子供が自律した・がんばりクエストを使う必要がなくなった',
	categoryChurnLabel: '離反',
	categoryChurnHint: '機能が合わない・期待と違った',
	categoryPauseLabel: '中断',
	categoryPauseHint: '家庭事情・引っ越し・一時的に離れる（再開予定あり）',

	// Plan-context messaging (free / standard / family 共通)
	freePlanNotice:
		'無料プランをご利用中です。解約後はアカウント自体を削除する必要がありますが、その前に理由をお聞かせください。',
	paidPlanNotice:
		'解約手続きを進めると、Stripe の管理画面で決済停止を行います。次回の請求は発生しません。',

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
	successDesc:
		'いただいたご意見は、サービス改善に活用させていただきます。続けて Stripe の管理画面で解約手続きを完了してください。',
	successProceedButton: 'Stripe 管理画面で解約を完了する',
	successProceedHint:
		'Stripe の管理画面で「サブスクリプションをキャンセル」を選択すると解約が完了します',
	successFreeProceed: 'アカウント削除はこちら',
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
	rewardSuggestionHint:
		'子どもががんばって貯めたポイントを、ご家庭で意味のある形に変えていただくための参考例です。',
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
	successProceedButton: '解約手続きへ進む',
	successProceedFreeButton: '管理画面に戻る',
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

export const OPS_LICENSE_ISSUE_LABELS = {
	pageTitle: 'OPS - キャンペーンキー発行',
	backLink: '← ライセンス一覧に戻る',

	// Issue form card
	cardTitle: 'キャンペーンキー一括発行',
	cardDesc1:
		'Stripe を経由せず、プレゼント・サポート補償・キャンペーン配布用のライセンスキーを発行します。',
	cardDesc2:
		'発行結果は CSV ダウンロードで受け取り、運営ツール (メール/LINE 等) で配布してください。',
	cardDesc3: '発行操作はすべて監査ログに記録されます。',

	// Stripe promo details
	promoCodeSummary: 'Stripe 100% OFF プロモコードを使う場合（#803）',
	promoCodeDesc1:
		'公開キャンペーン（SNS 等で URL を配布する）や、Stripe の本人確認を通したい場合は、',
	promoCodeDesc2Prefix: 'この画面ではなく ',
	promoCodeDesc2Strong: 'Stripe Dashboard の Coupons / Promotion codes',
	promoCodeDesc2Suffix1: ' を使ってください。',
	promoCodeDesc2Suffix2:
		'100% OFF の Coupon + Promotion code を発行し、「プランを契約する」ボタンから Checkout → プロモコード適用のフローでプランが解放されます。',
	promoCodeList1: '使い分け・運用手順:',
	promoCodeList1CodePath: 'docs/design/19-プライシング戦略書.md §8',
	promoCodeList2:
		'流出対策: Coupon 作成時に Max redemptions / Expires at / First-time order only を必ず設定',
	promoCodeList3Prefix: '経路 A (本画面) と経路 B (Stripe) の両方とも、発行結果は ',
	promoCodeList3Link: '/ops の監査ログ',
	promoCodeList3Suffix: ' または Stripe Dashboard で確認可能',
	promoCodeDashboardLink: 'Stripe Dashboard → Coupons を開く',

	// Form fields
	planLabel: 'プラン（必須）',
	quantityLabel: '数量（必須・1〜500）',
	reasonLabel: 'キャンペーン名 / 理由（必須）',
	reasonPlaceholder: '例: 2026春_幼稚園キャンペーン / CS-1234 補填',
	reasonHint: '監査ログとレコードの tenantId に記録されます。',
	expiresAtLabel: '有効期限',
	expiresAtDefault: 'デフォルト (発行から 90 日)',
	expiresAtNever: '期限なし (lifetime 的扱い)',
	tenantIdLabel: '発行プール ID（任意）',
	tenantIdPlaceholder: '省略時は campaign:<理由> を自動採番',
	tenantIdHint: 'record.tenantId に入る値。同一キャンペーンで揃えると後から検索しやすい。',
	submitLoading: '発行中...',
	submitButton: 'キーを発行する',

	// Issue result
	resultTitle: (count: number | string) => `発行結果 (${count} 件)`,
	resultPlanPrefix: 'プラン: ',
	resultReasonPrefix: '／ 理由: ',
	resultExpiresPrefix: '／ 有効期限: ',
	copyAllButton: '全てコピー',
	downloadCsvButton: 'CSV ダウンロード',
	errorCount: (count: number | string) =>
		`${count} 件は発行に失敗しました（ログを確認してください）。`,
} as const;

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
	resultXpLabel: 'けいけんち',
	resultMissionComplete: '🎯 ミッションたっせい！',
	resultMissionAllClear: '🎉 ぜんぶクリア！',
	resultTodayCount: (n: number | string) => `きょう ${n}かいめ！`,
	resultSpecialRewardRemaining: (n: number | string) => `🎁 あと${n}かいで とくべつごほうび！`,
	resultCancelButton: (s: number | string) => `とりけし (${s}s)`,
	resultConfirmButton: 'やったね！',
	crossComboBang: '！',
} as const;

export const DEMO_SIGNUP_LABELS = {
	// Hero section
	heroTitle: 'デモ体験ありがとうございます！',
	heroDesc1: 'お子さまの「がんばり」を',
	heroDesc2: '冒険に変えてみませんか？',

	// Primary CTA card
	trialHeading: '7日間の無料トライアル',
	trialSubheading: 'クレジットカード登録不要で今すぐ始められます',
	ctaStartFree: '無料で はじめる',
	ctaCancelNote: 'いつでもキャンセルOK・違約金なし',

	// Value propositions
	featuresHeading: 'がんばりクエストでできること',
	feature1Title: 'お子さまの名前で記録',
	feature1Desc: 'デモでは保存されませんが、本番ではすべて安全に保存されます',
	feature2Title: '成長の可視化',
	feature2Desc: '月次レポートでお子さまの成長傾向をレーダーチャートで確認',
	feature3Title: 'デイリーミッション',
	feature3Desc: '毎日の目標で「続ける力」を自然に育てます',
	feature4Title: '家族みんなで管理',
	feature4Desc: 'きょうだいをまとめて管理。家族メンバーの招待も可能',
	feature5Title: '安心・安全',
	feature5Desc: 'PIN認証で子供のデータを保護。広告なし・データ販売なし',

	// Pricing summary
	pricingHeading: '料金プラン',
	pricingFreeLabel: 'フリー',
	pricingFreePrice: '（¥0）からスタート。スタンダード・ファミリーの2プランをご用意。',
	pricingStandardLabel: 'スタンダード',
	pricingStandardPrice: '（月額¥500〜）と',
	pricingFamilyLabel: 'ファミリー',
	pricingFamilyPrice: '（月額¥780〜）。',
	pricingTrialNote: 'スタンダード・ファミリープランはすべて7日間の無料トライアル付き',
	pricingDetailsLink: 'プランの詳細を料金ページで見る →',

	// Testimonials
	testimonialsHeading: 'ご利用者の声',
	testimonial1: '「毎朝、自分からスタンプを押したがるようになりました」',
	testimonial1Author: '— 5歳男の子のママ',
	testimonial2: '「お手伝いが楽しいゲームに変わった。親も記録が楽」',
	testimonial2Author: '— 8歳女の子のパパ',

	// Secondary CTA
	ctaStartTrial: '無料トライアルを はじめる',
	ctaTrialNote: '7日間無料 ・ いつでもキャンセルOK',

	// Back to demo
	backToDemo: 'デモに戻る',
} as const;

// ============================================================
// admin/challenges ページ (#1452 Phase B)
// ============================================================

export const CHALLENGES_LABELS = {
	// Family streak
	familyStreakTitle: (days: number) => `家族ストリーク: ${days}日`,
	familyStreakRecorded: (count: number) => `今日は${count}人が記録済み`,
	familyStreakNone: '今日はまだ誰も記録していません',
	familyStreakMilestone: (remaining: number, days: number, points: number) =>
		`あと${remaining}日で${days}日ボーナス（+${points}P）`,

	// Family plan notice
	familyPlanTitle: '👨‍👩‍👧‍👦 ファミリープラン限定機能',
	familyPlanDesc: 'きょうだいチャレンジと家族ストリークはファミリープランでご利用いただけます',
	familyPlanButton: 'プランを確認',

	// Challenge section
	sectionTitle: '👥 きょうだいチャレンジ',
	cancelButton: 'キャンセル',
	createButton: '＋ 新規チャレンジ',

	// Notifications
	createdNotice: 'チャレンジを作成しました',
	deletedNotice: 'チャレンジを削除しました',

	// Create form
	formTitle: '新規チャレンジ作成',
	titleLabel: 'タイトル',
	titlePlaceholder: 'みんなで今週3回うんどう！',
	descLabel: '説明（任意）',
	descPlaceholder: '家族みんなでうんどうしよう',
	typeLabel: '種別',
	typeCooperative: '協力',
	typeCompetitive: '競争',
	periodLabel: '期間',
	periodWeekly: '週間',
	periodMonthly: '月間',
	periodCustom: 'カスタム',
	categoryLabel: 'カテゴリ（任意）',
	categoryAll: '全カテゴリ',
	startDateLabel: '開始日',
	endDateLabel: '終了日',
	targetLabel: '目標回数',
	rewardPointsLabel: '報酬ポイント',
	rewardMessageLabel: '達成メッセージ（任意）',
	rewardMessagePlaceholder: 'みんなすごい！',
	submitButton: '作成',

	// Empty state
	noChallengeTitleIcon: '👥',
	noChallengeTitle: 'チャレンジはまだありません',
	noChallengeDesc: '上のボタンから作成してください',

	// Challenge card
	badgeAllCompleted: '全員クリア！',
	badgeActive: '開催中',
	badgeExpired: '終了',
	targetGoal: (count: number) => `目標${count}回`,
	rewardLabel: (points: number) => `報酬${points}P`,
	deleteButton: '削除',
	deleteConfirm: (title: string) => `「${title}」を削除しますか？`,

	dateSeparator: ' 〜 ',

	// Challenge type/period labels
	typeLabelCooperative: '協力',
	typeLabelCompetitive: '競争',
	periodLabelWeekly: '週間',
	periodLabelMonthly: '月間',
	periodLabelCustom: 'カスタム',

	// Category names (same as GROWTH_BOOK_LABELS)
	categoryUndou: 'うんどう',
	categoryBenkyou: 'べんきょう',
	categorySeikatsu: 'せいかつ',
	categoryKouryuu: 'こうりゅう',
	categorySouzou: 'そうぞう',
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
	roleParent: '保護者',
	roleChild: 'こども',

	// Current members section
	currentMembersTitle: '現在のメンバー',
	noMembersText: 'メンバーがいません',
	transferButton: '移譲',
	removeButton: '削除',
	leaveGroupButton: '家族グループを離れる',

	// Invite section
	inviteSectionTitle: 'メンバーを招待',
	inviteRoleLabel: '招待ロール',
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
	inviteRevokeButton: '取消し',

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
	adminTitle: 'おやの管理画面',
	adminDesc: '活動の追加、こどもの管理、ポイント確認などの管理機能を体験できます。',
	adminButton: '管理画面をみる',

	// Feature highlights
	featuresTitle: '体験できる機能',
	feature1Title: '活動きろく',
	feature1Desc: '— お子さまの日々のがんばりをワンタップで記録',
	feature2Title: 'ステータス',
	feature2Desc: '— 5軸のレーダーチャートで成長を可視化',
	feature3Title: 'きょうだいチャレンジ',
	feature3Desc: '— きょうだいで協力・競争する目標を設定',
	feature4Title: 'デイリーミッション',
	feature4Desc: '— 毎日の目標で継続をサポート',

	// Conversion CTA
	ctaTitle: 'お子さまの冒険、はじめませんか？',
	ctaNote: '7日間無料 ・ いつでもキャンセルOK',
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
	oyakagiDesc1: '管理画面にアクセスするための',
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

// ============================================================
// Ops ライセンスキー詳細ページ (#1452 Phase B)
// ============================================================

export const OPS_LICENSE_KEY_LABELS = {
	// Navigation
	backLink: '← ライセンス一覧に戻る',

	// Key info
	keyLabel: 'ライセンスキー',
	missingRecord: 'レコードなし',
	noRecordNote:
		'このキーの永続レコードが見つかりません（SQLite ローカルモードでは永続化されません）。',

	// Detail fields
	fieldPlan: 'プラン',
	fieldKind: '種別',
	fieldIssuedAt: '発行日時',
	fieldExpiresAt: '有効期限',
	fieldIssuedBy: '発行者',
	fieldConsumedBy: '使用テナント',
	fieldConsumedAt: '使用日時',
	fieldRevokedAt: '失効日時',
	fieldRevokedReason: '失効理由',
	fieldRevokedBy: '失効実行者',

	// Revoke button
	revokeButton: 'このキーを失効させる',

	// Revoke result messages
	revokedSuccess: (reason: string) => `キーを失効させました (理由: ${reason})`,

	// Revoke modal
	modalTitle: 'ライセンスキーを失効させる',
	modalDesc: 'この操作は取り消せません。失効後、このキーはすぐに validate で拒否されます。',
	reasonLabel: '失効理由（必須）',
	noteLabel: 'メモ（任意）',
	notePlaceholder: 'CS チケット番号や状況メモ',
	cancelButton: 'キャンセル',
	submitButton: (submitting: boolean) => (submitting ? '処理中...' : '失効を確定'),
} as const;

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
	subtitle1: '基本無料ではじめられます。スタンダード・ファミリープランはすべて',
	subtitleTrialDays: '7日間の無料体験',
	subtitle2: '付き',
	featureNote:
		'お子さまが楽しめる冒険の仕組み（レベル・おみくじ・スタンプカード・ログインボーナス・連続達成ボーナスなど）は',
	featureNoteStrong: '全プラン共通',
	featureNoteSuffix: 'で制限なし',
	faqTitle: 'よくある質問',
	faqFreePlanQ: '無料プランでも十分使えますか？',
	faqFreePlanA:
		'はい。プリセットの活動とチェックリストで基本的な機能はお使いいただけます。お子さまの冒険体験は無料でも一切制限ありません。',
	faqCancelTrialQ: '無料体験中にキャンセルできますか？',
	faqCancelTrialA: 'はい。無料体験期間中にキャンセルすれば一切課金されません。',
	faqCancelQ: '解約したらデータはすぐに削除されますか？',
	// #1647 R42 + #1643 R38: 実装 grace-period-service.ts の {standard:7, family:30} に合わせる
	// アプリ内 /pricing と LP /site/pricing.html の両方で同一回答を返す SSOT
	faqCancelA:
		'プランによって猶予期間が異なります。スタンダードプラン: 解約申請から 7 日間の読み取り専用猶予期間後、すべてのデータが完全に削除されます（復旧不可）。ファミリープラン: 解約申請から 30 日間の読み取り専用猶予期間後、すべてのデータが完全に削除されます（復旧不可）。猶予期間中はログインしてエクスポート可能です。',
	faqBillingDateQ: '課金日はいつですか？',
	faqBillingDateA: 'お申し込み日を起算日として毎月（または毎年）自動更新されます。',
	faqPaymentQ: '支払い方法は？',
	faqPaymentA:
		'クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しています。',
	faqPlanChangeQ: 'プランの変更はできますか？',
	faqPlanChangeA:
		'はい。スタンダード↔ファミリー、月額↔年額の切り替えがいつでも可能です。管理画面の「プラン・お支払い」から変更できます。',
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
	sectionTitle: '🎁 ごほうび',
	premiumBadge: '有料限定',
	tabRewards: 'ごほうび',
	pageDescTitle: '🎁 とくべつなごほうび',
	pageDescText1: 'がんばったこどもへの特別なごほうびを設定・付与します。',
	pageDescText2:
		'日常の活動ポイントとは別に、お手伝いや特別な成果に対してボーナスポイントを贈れます。',
	pageDescHintPrefix: '💌 スタンプやメッセージは',
	pageDescHintLink: 'おうえんメッセージ',
	pageDescHintSuffix: 'から送れます',
	upgradeBannerTitle: '特別なごほうび設定はスタンダードプラン以上の機能です',
	upgradeBannerDesc:
		'アップグレードすると、お手伝いや特別な成果に対してカスタムのボーナスごほうびを作成・付与できます。',
	upgradeButton: 'プランを確認する',
	selectChildTitle: 'こどもを選択',
	selectTemplateTitle: 'テンプレートを選択',
	presetToggle: (open: boolean) => `${open ? '▼' : '▶'} プリセットからテンプレートを追加`,
	confirmGrantTitle: '内容を確認して付与',
	titleLabel: 'タイトル',
	pointsLabel: 'ポイント',
	iconLabel: 'アイコン',
	categoryLabel: 'カテゴリ',
	grantButton: (icon: string, title: string, points: number) =>
		`${icon} ${title || '報酬'} (${points}P) を付与する`,
	grantSuccess: '特別報酬を付与しました！',
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

export const MESSAGES_LABELS = {
	pageDescTitle: '💌 おうえんメッセージ',
	pageDescText1: 'スタンプやメッセージでこどもを応援しましょう。',
	pageDescText2: 'こどもの画面にスタンプが届き、親からの気持ちが伝わります。',
	pageDescHintPrefix: '🎁 特別なボーナスポイントの付与は',
	pageDescHintLink: 'ごほうび',
	pageDescHintSuffix: 'から行えます',
	selectChildTitle: '1. こどもを選択',
	messageTypeTitle: '2. おうえんの種類',
	stampButton: 'スタンプ',
	textMessageButton: 'ひとことメッセージ',
	textMessageDisabledTitle: 'ファミリープラン限定',
	textMessageDisabledSrOnly:
		'ひとことメッセージはファミリープラン限定の機能です。ご利用にはプランのアップグレードが必要です。',
	sendSuccess: 'おうえんメッセージを送りました！',
	recentMessagesTitle: '最近のメッセージ',
	msgRead: '既読',
	msgUnread: '未読',
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
	noActivitiesMsg: 'まだ活動が登録されていません。あとから管理画面で追加できます。',
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

export const ACHIEVEMENTS_LABELS = {
	challengeEmptyTitle: 'チャレンジきろくはまだありません',
	challengeEmptyDesc: 'チャレンジ機能は今後リリース予定です',
	customSectionTitle: '🏅 カスタム実績',
	toggleOpen: '閉じる',
	toggleCreate: '+ 作成',
	fieldNameLabel: '実績名',
	fieldNamePlaceholder: 'ピアノ100回マスター',
	fieldDescLabel: '説明（任意）',
	fieldDescPlaceholder: 'ピアノの練習を100回がんばった！',
	fieldIconLabel: 'アイコン',
	fieldBonusLabel: 'ボーナスPT',
	fieldCondTypeLabel: '条件タイプ',
	fieldCondValueLabel: '目標値',
	createButton: '作成する',
	noCustomAchievements: 'カスタム実績はまだありません',
	achievedLabel: '達成済み ✅',
	deleteButton: '削除',
	upgradeTitle: 'カスタム実績・称号',
	upgradeDesc: 'お子さまだけのオリジナル実績を作成できます',
	upgradeLink: 'スタンダードプラン以上で利用可能 →',
	noChildrenMessage: '子供が登録されていません',
} as const;

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

export const DEMO_MESSAGES_LABELS = {
	formLabel: 'メッセージ（30文字以内）',
	formPlaceholder: 'がんばってるね！だいすき！',
	sendDisabled: 'デモではメッセージを送れません',
	ctaTitle: 'おうえんメッセージで親子のつながりを深めませんか？',
	ctaDesc: '登録すると、スタンプやメッセージでお子さまを応援できます。',
} as const;

// ============================================================
// イベント管理ページ (#1452 Phase B)
// ============================================================

export const EVENTS_LABELS = {
	pageTitle: '🎉 シーズンイベント管理',
	createdMessage: 'イベントを作成しました',
	updatedMessage: 'イベントを更新しました',
	deletedMessage: 'イベントを削除しました',
	createFormTitle: '新規イベント作成',
	createButton: '作成',
	noEventsTitle: 'イベントはまだありません',
	noEventsDesc: '上のボタンから作成してください',
	activeLabel: '開催中',
	inactiveLabel: '無効',
	separatorLabel: '〜',
	deleteButton: '削除',
} as const;

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
	upgradeBannerDesc:
		'無料プランではプリセット閲覧のみ可能です。スタンダードプラン以上にアップグレードすると、カスタムのボーナスごほうびを作成・付与できます。',
	selectTemplateTitleDemo: '2. テンプレートを選択（またはカスタム）',
	confirmGrantTitleDemo: '3. 内容を確認して付与',
	demoGrantDisabled: 'デモでは報酬を付与できません',
	ctaTitle: '特別報酬で子どもをもっと応援しませんか？',
	ctaDesc: '登録すると、テンプレートやカスタム報酬を自由に付与できます。',
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
	pinHintPrefix: '💡 管理画面の「せってい」から',
	pinHintMiddle: 'を変更すると、おやの画面を守れるよ。',
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
} as const;

export const DEMO_ADMIN_HOME_LABELS = {
	planSwitcherAriaLabel: 'デモ用プラン切替',
	planSwitcherLabel: 'デモ: プランを切り替えて体験',
	freePlanButton: '無料プラン',
	standardPlanButton: '⭐ スタンダード',
	familyPlanButton: '⭐⭐ ファミリー',
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
 * AdminHome ダッシュボード用ラベル (#1465 Phase D)
 */
export const ADMIN_HOME_LABELS = {
	pageTitle: '管理画面 - がんばりクエスト',
	pageTitleDemoSuffix: ' デモ',
	heading: '管理ダッシュボード',
	headingDemoSuffix: '（デモ）',
	onboardingCompleteText: 'すべてのセットアップが完了しました！',
	onboardingDismissButton: '非表示にする',
	tutorialBannerTitle: '初めてご利用ですか？',
	tutorialBannerHint: 'チュートリアルで使い方を確認しましょう（約3分）',
	tutorialStartButton: '開始',
	tutorialLaterButton: 'あとで',
	freePlanQuickName: '無料プラン',
	freePlanQuickHint: 'もっと便利に使いませんか？',
	freePlanQuickAction: '⭐ アップグレード →',
	seasonalSectionTitle: '🌸 季節コンテンツ',
	memoryTicketLabel: '🎫 思い出チケット',
	memoryTicketCountSuffix: '枚',
	memoryTicketProgress: (months: number, nextMonth: number) =>
		`継続${months}ヶ月 — 次のチケットまで${nextMonth}ヶ月`,
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
	noExcessNote: '現在のリソース数はダウングレード先の上限以内です。そのままプラン変更に進めます。',
	retentionWarningPrefix: 'データ保持期間が',
	retentionUnlimited: '無制限',
	retentionDaysSuffix: '日',
	retentionFromTo: 'から',
	retentionTargetSuffix: '日に短縮されます。',
	retentionDataLossSuffix: '日以前のデータは閲覧できなくなります。',
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
	avatarGenerating: '生成中...',
	avatarGenerateButton: '✨ AI生成',
	avatarGenerateFailed: '生成に失敗しました',
	avatarNetworkError: 'ネットワークエラーが発生しました',
	avatarFileSizeError: (sizeMB: string) =>
		`ファイルサイズが大きすぎます（${sizeMB}MB）。5MB以下の画像を選択してください`,
	avatarServerError: 'サーバーエラーが発生しました。5MB以下のJPEG/PNG/WebPを選択してください',
	avatarUploadFailed: 'アップロードに失敗しました',
	avatarUploadSuccess: '写真をアップロードしました',
	avatarGenerateSuccess: 'アバターを生成しました',
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

export const CERTIFICATES_PAGE_LABELS = {
	pageTitle: '📜 がんばり証明書',
	backToReportsLink: 'レポートへ',
	freePlanNotePrefix: '無料プランでは証明書の閲覧のみ可能です。PDF保存は',
	freePlanNoteLink: 'スタンダードプラン以上',
	freePlanNoteSuffix: 'で利用できます。',
	emptyTitle: 'まだ証明書がありません',
	emptyDesc: '活動を記録すると、マイルストーン達成時に証明書が発行されます',
	noChildrenTitle: '子供が登録されていません',
} as const;

export const PACKS_PAGE_LABELS = {
	pageTitle: '活動パック',
	pageDesc:
		'年齢に合わせた活動セットをインポートできます。同じ名前の活動は自動的にスキップされます。',
	recommendedBadge: 'おすすめ',
	importedBadge: 'インポート済',
	partiallyImportedSuffix: '件 登録済',
	activityCountSuffix: '件の活動',
	importingLabel: 'インポート中...',
	importButton: (count: number) => `${count}件の新しい活動をインポート`,
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
	invalidLinkDesc: '招待した方に新しいリンクを発行してもらってください。',
	loginPageLink: 'ログインページへ',
	inviteMessage: '家族グループへの招待が届いています。',
	roleLabel: '参加ロール:',
	signupButton: '新規アカウントを作成して参加',
	loginButton: '既存アカウントでログインして参加',
} as const;

export const DEMO_ACHIEVEMENTS_LABELS = {
	pageTitle: '🏅 チャレンジ履歴',
	pageDesc: '過去に完了したチャレンジの記録です。',
	allClearedBadge: '全員クリア！',
	completedBadge: '完了',
	dateSeparator: '〜',
	targetPrefix: '· 目標',
	targetUnit: '回',
	rewardPrefix: '· 報酬',
} as const;

export const DEMO_LAYOUT_LABELS = {
	backToHpLink: 'HPに戻る',
	demoNotice: 'これはデモです。データは保存されません。',
	tryRealButton: '本番で使ってみる',
	planSwitcherLabel: 'プラン体験:',
	floatingCtaTitle: 'お子さまの ぼうけん、はじめよう！',
	floatingCtaDesc: '7日間無料・いつでもキャンセルOK',
	floatingCtaButton: '無料で はじめる →',
} as const;

export const SETUP_PACKS_LABELS = {
	pageTitle: 'かつどうパックをえらぼう',
	pageDesc: 'お子さまの年齢にあわせた活動セットを選んでください。あとから追加・変更できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: 'おすすめパックを自動で追加してすすむ',
	backButton: 'もどる',
	importingLabel: 'インポート中...',
	addPacksButton: (count: number) => `${count}件のパックを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'おすすめで次へ',
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
} as const;

export const DEMO_BATTLE_LABELS = {
	pageTitle: '⚔️ きょうの バトル',
	startButton: 'バトル かいし！',
	demoNotice: '（デモモード：データは保存されません）',
	signupLink: 'お子さまの名前で はじめる →',
	replayButton: 'もういちど あそぶ',
	loadErrorMessage: 'バトルじょうほうを よみこめませんでした',
} as const;

export const CHILD_CHECKLIST_LABELS = {
	todayPrefix: 'きょうは',
	nowPrefix: 'いまは',
	nowSuffix: 'のじかん',
	emptyTitle: 'チェックリストがないよ',
	emptyDesc: 'おやにおねがいしてね',
	completedAll: '🎉 ぜんぶできた！',
	checkForPoints: 'ぜんぶチェックしたら',
	backButton: 'もどる',
	completeTitle: 'ぜんぶできたよ！',
	pointsSuffix: 'ポイント！',
	completeMsg: 'わすれものなし！すごい！',
	completeButton: 'やったね！',
} as const;

export const DEMO_CHILD_CHECKLIST_LABELS = {
	demoNotice: 'これはデモです。チェックは保存されません。',
} as const;

export const ADMIN_CHECKLISTS_PAGE_LABELS = {
	// #1755 (#1709-A): kind 削除に伴い tabAriaLabel は本 sub では未使用化
	//   後続 sub-issue (#1709-B) で他用途に流用 / 削除を検討
	tabAriaLabel: 'チェックリスト種別',
	// #1755 (#1709-A): kind 削除 — emptyChecklistMessage に統合
	emptyKindSuffix: 'がまだありません',
	emptyChecklistMessage: '持ち物チェックリストがまだありません',
	// #1755 (#1709-A): kind 選択削除に伴うダイアログタイトル / プレースホルダ統合
	addTemplateDialogTitle: '持ち物チェックリスト作成',
	namePlaceholderItem: '例: がっこうのもちもの',
	inactiveBadge: '無効',
	deleteButton: '削除',
	timeSlotLabel: '時間帯:',
	addItemButton: '+ アイテム追加',
	limitReachedText: (max: number | string) => `フリープランの上限 (${max}個) に達しました`,
	limitCountText: (current: number | string, max: number | string) =>
		`チェックリスト ${current} / ${max}`,
	upgradeLink: 'アップグレード →',
	upgradeDesc: 'スタンダード以上にアップグレードすると無制限に作成できます。',
	addTemplateButton: '+ テンプレート作成',
	addOverrideButton: '📅 ワンオフ追加',
	todayOverrideTitle: '📅 本日のワンオフ',
	formKindLabel: '種別',
	formIconLabel: 'アイコン',
	createButton: '作成',
	addButton: '追加',
	addItemDialogTitle: 'アイテム追加',
	overrideDialogTitle: 'ワンオフ追加/除外',
	premiumBadgeLabel: 'スタンダード以上',
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

export const DEMO_EVENTS_LABELS = {
	sectionTitle: '🎉 シーズンイベント管理',
	emptyNotice: 'イベントはまだありません',
	activeBadge: '開催中',
	dateRangeSeparator: '〜',
} as const;

export const SWITCH_PAGE_LABELS = {
	adminForbiddenNotice: 'おやのアカウントでログインしてね',
	heading: 'だれがつかう？',
	emptyTitle: 'こどもがまだいないよ',
	emptyDesc: 'おやがかんりがめんからついかしてね',
	adminLink: '🔒 おやのかんりがめん',
} as const;

export const OPS_LICENSE_PAGE_LABELS = {
	pageTitle: 'OPS - ライセンスキー管理',
	issueButton: '＋ キャンペーンキーを発行',
	searchTitle: 'ライセンスキー検索',
	keyInputLabel: 'ライセンスキー',
	searchButton: '検索',
} as const;

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

export const LP_NAV_LABELS = {
	hamburgerAriaLabel: 'メニュー',
	logoAlt: 'がんばりクエスト',
	home: 'ホーム',
	marketplace: 'テンプレートを探す',
	pricing: '料金プラン',
	faq: 'よくあるご質問',
	selfhost: '仕組みを公開（開発者向け）',
	signup: '無料で始める',
	login: 'ログイン',
	features: 'できること',
} as const;

export const LP_FOOTER_LABELS = {
	brandName: 'がんばりクエスト',
	brandTagline: 'お子さまの「がんばり」を冒険に変える家庭向けWebアプリ',
	linksHeading: 'リンク',
	pricingLink: '料金プラン',
	faqLink: 'よくあるご質問',
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
export const LP_HERO_PRICE_BAND_LABELS = {
	itemFree: '基本無料',
	itemPriceLabel: '月',
	itemPriceValue: '¥500〜',
	itemTrial: '有料は 7 日間無料',
	itemCancel: 'いつでも解約',
} as const;

// LP CTA 直下の不安解消 3 バッジ (#1626 R22)
// site/index.html / pricing.html / faq.html の CTA 直下に配置
export const LP_CTA_TRUST_BADGES_LABELS = {
	noCreditCard: 'クレジットカード登録不要',
	noAds: '広告なし',
	cancelAnytime: 'いつでも解約 OK',
} as const;

// LP Hero 仕様起点の数字バッジ (#1628 R24)
// PMF 後送り testimonial の代替として仕様値を訴求
export const LP_HERO_SPEC_BADGES_LABELS = {
	ageRange: '3〜18 歳',
	ageRangeSuffix: '対応',
	presetCount: '300+',
	presetSuffix: 'プリセット活動',
	setupTime: '約 5 分',
	setupSuffix: 'で初期設定',
} as const;

// LP CTA / 価格 / 期間表記 SSOT (#1616 R12)
// PM 優先 J 節裁定 2: 「無料で始める」（漢字統一）
// site/ 配下では本定数を data-lp-key で参照し、表記揺れを排除する
export const LP_COMMON_LABELS = {
	// CTA 動詞（site/ 全ページで本値に統一）
	ctaSignup: '無料で始める',
	ctaDemo: 'デモを見る',
	ctaPricing: '料金プラン',
	ctaContact: 'お問い合わせ',
	ctaPricingDetail: '料金の詳細を見る →',
	contactHint: 'メールでお気軽にお問い合わせください',
	contactEmail: 'ganbari.quest.support@gmail.com',
	// 期間表記（「7 日間無料トライアル」に統一）
	trialPeriodLabel: '7 日間無料トライアル',
	trialPeriodShort: '7 日間無料',
	trialPeriodFull: '7 日間の無料トライアル',
	// 価格表記
	priceStandardMonthly: '月 ¥500',
	priceFamilyMonthly: '月 ¥780',
	priceMinFrom: '月 ¥500〜',
	// クレカ不要訴求
	noCreditCardNote: 'クレジットカード登録不要',
	// 解約訴求
	cancelAnytime: 'いつでも解約 OK',
	bulletPoint: '・',
} as const;

// LP 法務系打消し表示 (#1609 R5 / #1610 R6)
// 景表法 第 5 条 + 消費者庁 打消し表示ガイドライン準拠
// data-lp-key で site/index.html / site/faq.html に注入
export const LP_LEGAL_DISCLAIMER_LABELS = {
	// #1643 R38 整合: 実装 grace-period-service.ts の {standard: 7, family: 30} に合わせプラン別表記
	// LP メトリクス desktopHeight ratchet 維持のため可読性確保しつつ簡潔に
	cancelDisclaimer:
		'※解約後はプラン別の読み取り専用猶予期間（スタンダード 7 日 / ファミリー 30 日）後にすべてのデータが完全に削除されます。日割り返金はありません。',
	cancelDisclaimerLinks: 'FAQ / 特定商取引法に基づく表記',
	cancelDisclaimerCta:
		'※解約後はプラン別の猶予期間（スタンダード 7 日 / ファミリー 30 日）後にすべてのデータが完全に削除されます。',
	cancelDisclaimerCtaLink: 'FAQ',
	liabilityTitle: 'サービス利用に関する重要なご案内',
	liabilityBody:
		'万一の障害・不具合等による損害賠償は、有料プランは「直近 3 ヶ月の支払額」を上限、無料プランは 0 円とさせていただいております（消費者契約法等の強行法規に基づく権利は対象外）。',
	liabilityLinks: '利用規約 第 12 条 / FAQ「賠償について」',
	faqLiabilityIntro:
		'本サービスは個人開発者が運営する小規模サービスであり、利用規約 第 12 条（免責事項）に基づき、賠償額には上限を設けております。',
	faqLiabilityPaid:
		'有料プランをご利用の方: 損害発生月を含む直近 3 ヶ月間に実際にお支払いいただいた利用料の総額を上限とします',
	faqLiabilityFree: '無料プランをご利用の方: 賠償額の上限は 0 円とさせていただきます',
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
// ============================================================

export const LP_PRICING_LABELS = {
	pageTitle: '料金プラン - がんばりクエスト',
	metaDescription:
		'がんばりクエストの料金プラン。基本無料で始められます。スタンダード月額500円（税込）、ファミリー月額780円（税込）。すべての有料プランに7日間の無料体験付き。',
	ogTitle: '料金プラン - がんばりクエスト',
	ogDescription:
		'基本無料で始められます。お子さまのポイント・レベルアップ・ログインボーナス（おみくじ + スタンプカード）などの冒険体験は無料プランでも一切制限ありません。',

	// Hero (#1652 R46)
	heroTitle: '料金プラン',
	heroLead1: 'お子さまの成長を冒険に変える。',
	heroLeadHighlight: '基本無料',
	heroLead2: 'で今日から始められます。',
	heroSubtext: '有料プランはすべて',
	heroSubtextStrong: '7日間の無料体験',
	heroSubtextSuffix: '付き（クレジットカード登録不要）',
	heroPriceBand: '基本無料 ・ 月 ¥500（税込）から ・ 有料は 7 日間無料体験 ・ いつでも解約 OK',
	heroCtaPrimary: '7 日間無料トライアル',
	heroCtaSecondary: 'プランを比較する',

	// Plan card: Free (#1651 R45 + #1644 R39 + #1645 R40)
	planFreeName: 'フリー',
	planFreePrice: '¥0',
	planFreePriceSub: 'ずっと無料 ・ クレカ登録不要',
	planFreePersona: 'こんなご家族におすすめ: まずはお子さま 1〜2 人で試したいご家族へ',
	planFreeDesc:
		'ポイント・レベルアップ・おみくじ・スタンプカードなど、お子さまの冒険体験はすべて無料。',
	planFreeCta: '無料ではじめる',
	planFreeBadge: '永久無料',

	// Plan card: Standard (#1645 R40 + #1651 R45)
	planStandardBadge: 'おすすめ',
	planStandardName: 'スタンダード',
	planStandardPrice: '¥500',
	planStandardUnit: '/月（税込）',
	planStandardYearly: '年額 ¥5,000（税込・2ヶ月分お得）',
	planStandardPersona:
		'こんなご家族におすすめ: お子さま 3 人以上 / 我が家ルールをカスタマイズしたいご家族へ',
	planStandardDesc: 'カスタマイズ自由自在。お子さまにぴったりの環境を作れます。',
	planStandardCta: '7日間 無料体験',

	// Plan card: Family (#1645 R40 + #1651 R45)
	planFamilyName: 'ファミリー',
	planFamilyPrice: '¥780',
	planFamilyUnit: '/月（税込）',
	planFamilyYearly: '年額 ¥7,800（税込・2ヶ月分お得）',
	planFamilyPersona: 'こんなご家族におすすめ: 祖父母・離れた家族と一緒に応援したいご家族へ',
	planFamilyDesc: '家族みんなで見守る。きょうだいの比較やレポートで成長を応援できます。',
	planFamilyCta: '7日間 無料体験',

	// CTA disclaimer (#1646 R41)
	ctaDisclaimerBadges: '✅ クレジットカード登録不要 ✅ 自動課金なし ✅ いつでも解約 OK',
	ctaDisclaimerNote: '※ 7 日間無料体験は初回お申込み時のみ。価格はすべて税込表示です。',

	// Plan note (below cards) — #1650 R44 (括弧書き一掃) / #1629 R25 (「コンボ」→「連続達成ボーナス」へ)
	allPlansNote:
		'💡 お子さまが楽しめる冒険の仕組み（レベル・おみくじ・スタンプカード・ログインボーナス・連続達成ボーナスなど）は',
	allPlansNoteStrong: '全プラン共通',
	allPlansNoteSuffix: 'で制限なし',

	// Comparison table (#1650 R44 + #1657 R50)
	comparisonTitle: '機能比較表',
	comparisonSubtitle: '冒険の仕組みは全プラン共通で制限なく楽しめます',

	// Trial section (#1641 R36 + #1642 R37)
	trialHeading: '7日間の無料体験',
	// #1642 R37: 経路汎用化（standard / family どちらの trial も同文言で説明）
	trialSubheading: '7 日間の無料体験では、選択したプランの全機能を制限なくお試しいただけます',
	trialStep1Title: 'いつでも好きなタイミングで開始',
	trialStep1Desc:
		'アカウント登録後、管理画面からワンタップで無料体験を開始できます。クレジットカードの登録は不要です。',
	trialStep2Title: '7日間、選択したプランの全機能が使い放題',
	// #1642 R37: 経路依存（?plan=standard / ?plan=family / admin/license 手動）すべてに対応
	trialStep2Desc:
		'スタンダード/ファミリーいずれもプランの全機能（カスタム活動・レポート・データエクスポート・AI 自動提案・きょうだいランキング・離れた家族応援メッセージなど）を制限なくお試しいただけます。',
	trialStep3Title: '終了後は自動で無料プランに戻ります',
	trialStep3Desc:
		'無料体験期間が終わると、自動的に無料プランへ移行します。自動課金は一切ありません。',
	trialStepHighlight: '無料体験中にいつでもプラン選択可能',
	trialStepHighlightDesc:
		'気に入ったら無料体験中にそのままプランを選択できます。もちろん、何もしなければ自動で無料プランに戻ります。',
	// #1641 R36: 実装 retention-cleanup-service.ts に整合した「並列構造」
	trialDataReassureLine1Strong:
		'無料体験中に作成したオリジナル活動・ごほうび・もちものチェックリスト・シール・レベル・お子さま登録',
	trialDataReassureLine1Suffix: 'は、無料プランに移行した後もそのまま保持されます。',
	trialDataReassureLine2Strong: '活動履歴・ポイント獲得履歴・ログインボーナス履歴',
	trialDataReassureLine2Suffix: 'は無料プランの保持期間（90 日）を超えたものから順次削除されます。',
	trialDataReassureLine3:
		'有料プランにアップグレードすれば、より長期間（スタンダード: 1 年 / ファミリー: 無制限）の履歴をご利用いただけます。',

	// Family pattern section
	familyPatternsTitle: '家族での使い方',
	familyPatternsSubtitle: 'ご家庭の環境に合わせて、2つのスタイルからお選びいただけます',
	familyPatternSharedTag: '全プラン対応',
	familyPatternSharedTitle: '親アカウント共用型',
	familyPatternSharedDesc:
		'親が1つのアカウントを作成し、同じ端末でお子さまと画面を切り替えて使います。設定も操作もシンプルで、すぐに始められます。無料プランを含む全プランで利用できます。',
	familyPatternInviteTag: 'スタンダード以上',
	familyPatternInviteTitle: '個別アカウント＋招待リンク型',
	familyPatternInviteDesc:
		'家族グループを作成し、招待リンクで家族を招待。家族メンバーがそれぞれの端末からアクセスでき、離れた場所からもお子さまの成長を見守れます。スタンダードは4人まで、ファミリープランは無制限で招待できます。',

	// FAQ (#1647 R42 — labels.ts PRICING_PAGE_LABELS と整合 / #1643 R38 / #1653 R47)
	faqTitle: 'よくある質問',
	faqFreeQ: '無料プランでも十分使えますか？',
	faqFreeA:
		'はい。プリセットの活動とチェックリストで基本的な機能はすべてお使いいただけます。お子さまの冒険体験（レベル、ポイント、おみくじ、スタンプカード、毎日のログインボーナス）は無料プランでも一切制限ありません。',
	faqAfterTrialQ: '無料体験後はどうなりますか？',
	// #1641 R36 整合: 並列構造で「保持」と「90 日で削除」を両方明記
	faqAfterTrialA:
		'7日間の無料体験終了後は無料プランに移行します。有料プランをご希望の場合は、管理画面からアップグレードしてください。クレジットカードの事前登録は不要です。無料体験中に作成したオリジナル活動・ごほうび・チェックリスト・シール・レベルは保持されますが、活動履歴・ポイント獲得履歴・ログインボーナス履歴は無料プランの保持期間（90 日）を超えたものから順次削除されます。',
	// #1643 R38 + #1647 R42: プラン別猶予期間（実装 grace-period-service.ts 準拠）
	faqCancelQ: '解約したらデータはすぐに削除されますか？',
	faqCancelA:
		'プランによって猶予期間が異なります。スタンダードプランは解約申請から 7 日間、ファミリープランは解約申請から 30 日間の読み取り専用猶予期間が設けられ、その後すべてのデータが完全に削除されます（復旧不可）。猶予期間中はログインしてエクスポートが可能です。',
	faqBillingDateQ: 'お支払い日はいつですか？',
	faqBillingDateA:
		'お申し込み日を起算日として、月額プランは毎月、年額プランは毎年自動更新されます。例えば4月15日にお申し込みの場合、次回のお支払い日は5月15日（月額）または翌年4月15日（年額）です。',
	faqYearlyCancelQ: '年額プランを途中解約した場合は？',
	faqYearlyCancelA:
		'年額プランを途中解約しても、お支払い済みの残り期間は引き続きご利用いただけます。日割りでの返金は行っておりません。',
	faqPaymentQ: '支払い方法は？',
	faqPaymentA:
		'クレジットカード（Visa, Mastercard, JCB, American Express）に対応しています。Stripeによる安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。',
	faqPlanChangeQ: 'プランの変更はできますか？',
	faqPlanChangeA:
		'はい。スタンダード↔ファミリー、月額↔年額の切り替えが可能です。管理画面の「プラン・お支払い」→「プラン変更・支払い管理」からお手続きいただけます。プラン変更方法についてご不明な点は、お問い合わせください。',
	faqAdsQ: '子供の画面に広告は出ますか？',
	faqAdsA:
		'いいえ。無料プランでも広告は一切表示しません。お子さまが安心して使える環境を最優先にしています。',
	faqMultiDeviceQ: '家族で複数端末から使えますか？',
	faqMultiDeviceA:
		'はい。スタンダード以上のプランで、家族メンバーを招待して複数端末からアクセスできます。スタンダードプランは4人まで、ファミリープランは無制限に招待可能です。無料プランでも1つの端末でお子さまを切り替えて使えます。',
	// #1653 R47: 「卒業」概念訴求（FAQ 文脈・機能訴求は禁止）
	faqGraduationQ: 'ずっと使い続ける必要がありますか？',
	faqGraduationA:
		'いいえ、お子さまが自立して習慣化できたら「卒業」していただいて構いません。がんばりクエストは「子供の自立」を最終ゴールとして設計されており、ずっと依存して使い続けることを想定していません。卒業の目安は小学校高学年〜中学生頃です。',

	// CTA bottom
	ctaBottomTitle: 'お子さまの冒険を始めよう',
	ctaBottomDesc: 'まずは無料ではじめて、お子さまの反応を見てみませんか？',
	ctaBottomPrimary: '無料ではじめる',
	ctaBottomSecondary: 'デモで体験する',
} as const;

/**
 * #1594 ADR-0023 I8: LP の「開発者に直接相談」セクション専用ラベル。
 * generate-lp-labels.mjs が parseBlock で抽出して shared-labels.js に export する。
 * `data-lp-key="founderInquiry.<key>"` で site/index.html から参照される。
 *
 * NOTE: アプリ側 (admin / /inquiry/founder) は FOUNDER_INQUIRY_LABELS を使用する。
 * 本定数は LP 用の最小サブセット (#1465 SSOT 化原則 + LP shared-labels.js 自動生成制約)。
 */
export const LP_FOUNDER_INQUIRY_LABELS = {
	sectionHeading: '👋 開発者に直接相談（無料）',
	sectionLead:
		'個人開発のため、Pre-PMF 期は開発者本人が一人ひとりの相談に直接お返事します。商業的な売り込みではなく、「ご家庭に本当に合うかどうか」を一緒に判断します。',
	bullet1: '導入前のご相談（向き / 不向きを率直にお伝えします）',
	bullet2: '使い方が分からない・困っている',
	bullet3: '解約を検討中（その前に一度お話しさせてください）',
	ctaButton: '直接相談する（無料）',
	ctaSeparator: '／',
	mailtoFallback: 'メールで送る',
} as const;

/**
 * #1594 ADR-0023 I8: founder 1:1 ヒアリング動線
 * LP / admin に「開発者に直接相談」CTA を提供する。Pre-PMF "do things that don't scale"
 * 実践として、初期 ~10 親契約まで全員と直接対話する。
 */
export const FOUNDER_INQUIRY_LABELS = {
	// LP / admin 共通の CTA セクション
	ctaSectionHeading: '👋 開発者に直接相談（無料）',
	ctaSectionLead:
		'個人開発のため、Pre-PMF 期は開発者本人が一人ひとりの相談に直接お返事します。商業的な売り込みではなく、「ご家庭に本当に合うかどうか」を一緒に判断します。',
	ctaSectionBullet1: '導入前のご相談（向き / 不向きを率直にお伝えします）',
	ctaSectionBullet2: '使い方が分からない・困っている',
	ctaSectionBullet3: '解約を検討中（その前に一度お話しさせてください）',
	ctaButton: '直接相談する（無料）',
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
export const LP_RETENTION_LABELS = {
	sectionTitle: '三日坊主にならない設計',
	sectionDesc:
		'「有料アプリって三日坊主になりがち…」という不安に先回りで答えます。スタンプカードのレア度分散と「1 日 1 回まで」の煽らない設計が、毎日の継続を支えます。',
	card1Title: '飽きを防ぐレア度分散',
	card1Desc:
		'普通のスタンプ (N) から超レアスタンプ (UR) まで 4 段階。毎回違うスタンプが押されることで、子供の「明日もやろう」を支えます。',
	card2Title: '習慣を育てるおみくじスタンプ',
	card2Desc:
		'毎朝のログイン → おみくじ → スタンプカードは、活動の記録とは別の「毎日記録する習慣」を育てるための仕組みです。「ちょっとした楽しみ」で継続を支えます。',
	card3Title: '1 日 1 回まで — 煽らない設計',
	card3Desc:
		'「もっと引きたい」の誘導はありません。1 日 1 回という制限が、逆に「明日もやろう」という継続を生みます。',
	pamphletNote:
		'スタンプカードのレア度分散（N/R/SR/UR）が「明日もやろう」を支える習慣形成のエンジン。1 日 1 回までで煽らない設計のため、三日坊主を防ぎます。',
} as const;

export const BABY_HOME_LABELS = {
	pageTitle: '準備モード',
	parentNote: '保護者の方向けの準備ツールです',
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
	goToAdmin: '管理画面へ',
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
// LP [02] アナログ vs デジタル 比較セクション (#1614 R10)
// SSOT: site/index.html [02] セクション用ラベル
// 親 P1 が「シール帳でいいんじゃない？」と離脱する直前の優位訴求
// ============================================================

export const LP_VERSUS_LABELS = {
	sectionTitle: 'シール帳・ホワイトボードでも、いいんじゃない？',
	sectionDesc:
		'多くのご家庭がまず紙で試して、続かずに諦めています。「3 歳から 18 歳まで」「家族みんなで」「ずっと続ける」には、がんばりクエストだから届く差があります。',
	tagAnalog: 'シール帳・紙',
	tagDigital: 'がんばりクエスト',
	// 各優位点アイコン (#1597 ADR-0023 I5 — 装飾的アクセント枠 / asset-catalog.md 準拠)
	row1Icon: '📊',
	row2Icon: '🌱',
	row3Icon: '🎓',
	row4Icon: '📍',
	row1AnalogTitle: '集計が手作業で計算ミスが起きがち',
	row1DigitalTitle: '自動集計でいつでもポイントが見える',
	row1DigitalDesc: '子供が「あと 50 ポイントで欲しいごほうび」と自分で計画できます。',
	row2AnalogTitle: '年齢が変わるたびに冊子を買い替え',
	row2DigitalTitle: '3 歳から 18 歳まで同じアプリで継続',
	row2DigitalDesc: '15 年分の成長履歴がひとつにまとまります。',
	row3AnalogTitle: '続けることが目的になりがち',
	row3DigitalTitle: '子供が自律したらアプリは不要',
	row3DigitalDesc: '「使わなくなる」が成功のゴール。卒業を最終地点として設計しています。',
	row4AnalogTitle: '家を離れると続けられない',
	row4DigitalTitle: '旅行先・祖父母宅でも続けられる',
	row4DigitalDesc: 'スマホ・タブレットで開けば連続記録が途切れません。',
} as const;

// ============================================================
// LP [05b] 年齢別成長ロードマップ — 卒業を最終地点に (#1613 R9)
// StoryBrand 7 要素「Success」と整合
// SSOT: site/index.html [05b] セクション用ラベル
// ============================================================

// #1712 R5: 5 stage の H3 を「親主語ベネフィット」にリフレーム + 親視点 / 子供視点 1 行併記。
//   開発者目線の「○○の特徴」型 → 保護者が観測できる行動変化（「○○が要らなくなる」「○○を聞かなくても」）
//   へ書き換え、購入後の体験イメージを具体化する。
export const LP_GROWTH_ROADMAP_LABELS = {
	sectionTitle: '3 歳から 18 歳まで、そして「卒業」へ',
	sectionDesc:
		'お子さまの成長に合わせて UI と機能が変化。最後は「アプリを使わなくても自分で計画できる」自律へ。',
	parentBenefitLabel: '親が観測できること',
	childExperienceLabel: '子供が体験すること',
	preschoolAge: '幼児',
	preschoolRange: '3-5',
	preschoolUnit: '歳',
	preschoolTitle: '「はをみがいてー」「おかたづけしてー」が要らなくなる',
	preschoolDesc: '大きなボタンとひらがな UI で「自分で押した！」の達成感を毎日体験。',
	preschoolParentBenefit: '「やって」と言わなくても、子供が自分で動き始める',
	preschoolChildExperience: '大きな絵文字ボタンを押すだけで褒められる達成感',
	elementaryAge: '小学生',
	elementaryRange: '6-12',
	elementaryUnit: '歳',
	elementaryTitle: '「宿題やった？」を聞かなくても、子供から見せてくれる',
	elementaryDesc:
		'漢字 UI に切替、称号で「次は何を達成しよう？」と自分で目標を立てる力が育ちます。',
	elementaryParentBenefit: '声かけ回数が減り、子供から達成報告が来るようになる',
	elementaryChildExperience: '称号や実績が増え、「次は何を狙おう」と自分で計画する楽しさ',
	juniorAge: '中学生',
	juniorRange: '13-15',
	juniorUnit: '歳',
	juniorTitle: '部活と塾の両立を、子供が自分で計画する',
	juniorDesc: '月次レポートで「自分のペース」を客観視し、自律的なリズム調整が可能に。',
	juniorParentBenefit: '時間管理を子供任せにできて、過干渉を手放せる',
	juniorChildExperience: '月次レポートで自分のペースを見える化し、無理せず続けられる',
	seniorAge: '高校生',
	seniorRange: '16-18',
	seniorUnit: '歳',
	seniorTitle: '進路相談で「これだけやってきた」を子供自身が語れる',
	seniorDesc: '15 年分の活動ログが「自分はこれだけやってきた」という自信に。',
	seniorParentBenefit: '進路面談で子供自身が活動履歴を語れるようになる',
	seniorChildExperience: '15 年分の積み重ねが履歴として残り、自分の自信になる',
	graduateLabel: 'そして',
	graduateAccent: '卒業',
	graduateTitle: 'アプリを開かなくなった日 — それは家族の卒業式',
	graduateDesc:
		'「使わなくなる」ことががんばりクエストの成功。15 年分の記録はいつでも書き出してご家族の手元に残せます。',
	graduateParentBenefit: '子供が自律したことを、ログイン頻度の低下で確認できる',
	graduateChildExperience: 'アプリを開かなくても自分で計画できる、大人になった実感',
	// ベネフィット行 + screenshot alt #1707 / #1712
	preschoolShotAlt: '幼児ホーム画面 — 大きな絵文字ボタンと達成スタンプ',
	elementaryShotAlt: '小学生ホーム画面 — 称号コレクションとデイリーミッション',
	juniorShotAlt: '中学生ホーム画面 — 月次レポートと自己ペース可視化',
	seniorShotAlt: '高校生ホーム画面 — 15 年分のログと進路素材',
	graduateShotAlt: '卒業画面 — 履歴エクスポートと家族の手元に残す記録',
} as const;

// ============================================================
// LP [03] コアループ 3 層モデル (#1343)
// SSOT: site/index.html [03] セクション用ラベル
// ============================================================

// #1624 R20: StoryBrand 7 要素のうち Internal Problem / Philosophical / Avoiding Failure
//   を sectionDesc に補完。「毎日同じことを言う疲れ」「子供の自律を信じる」「シール帳で挫折しないため」
export const LP_CORELOOP_LABELS = {
	sectionTitle: '3 つの仕組みで、毎日のがんばりが本物の報酬になる',
	sectionDesc:
		'毎日「歯みがいた？」「宿題は？」と繰り返し声をかけるのは、親も子も疲れます。子供は本来、自分で動きたい力を持っています。シール帳で 3 日でやめてしまった経験のある方こそ、活動 → 習慣 → ごほうびの 3 つの仕組みでお試しください。',
	// 親視点サブタイトル
	parentPerspectiveTitle: '親の視点',
	parentPerspectiveDesc:
		'プリセット活動で設定は 2 分。子供の取り組みをポイントで定量把握できます。',
	// 子供視点サブタイトル
	childPerspectiveTitle: '子供の視点',
	childPerspectiveDesc: '活動を重ねてポイントを貯め、ごほうびショップで欲しいものと交換できます。',
	// 仕組み 1: 毎日の活動
	l1Title: '毎日の活動 — がんばりを記録する',
	l1Step1Title: '活動を 2 タップで記録',
	l1Step1Desc:
		'「はみがきした」「宿題おわった」をタップするだけ。プリセット活動がそのまま使えるので設定は最小限です。',
	l1Step2Title: 'ポイントが獲得できる',
	l1Step2Desc: '記録した活動に応じてポイントが加算。「今日どれだけ頑張ったか」が数字で見えます。',
	// 仕組み 2: 習慣カード（おみくじスタンプ）
	l2Title: '習慣カード — 毎日の楽しみで続ける',
	l2Step1Title: 'おみくじスタンプを引く',
	l2Step1Desc:
		'1 日 1 回までのおみくじスタンプ。スタンプのレア度に応じてボーナスポイントが獲得でき、毎日記録する習慣が、自然に身につきます（1 日 1 回までで煽らない設計）。',
	l2Step2Title: 'スタンプカードが完成する',
	l2Step2Desc: '1 週間続けるとスタンプカードが 1 枚完成。三日坊主を防ぐ「継続の見える化」です。',
	// 仕組み 3: ごほうび交換
	l3Title: 'ごほうび交換 — ポイントを欲しいものに換える',
	l3Step1Title: 'ポイントを蓄積する',
	l3Step1Desc:
		'毎日の活動ポイントと習慣カードのボーナスポイントが積み上がります。ポイントは家庭内の通貨として機能します。',
	l3Step2Title: 'ごほうびショップで交換',
	l3Step2Desc:
		'貯めたポイントはごほうびショップが唯一の出口。実物のプレゼント・お小遣い・特権（夜ふかし権など）を親が設定し、子供が自分で選んで交換できます。',
	// 誘導注記
	shopNote:
		'ごほうびショップは唯一の出口。ポイントは「欲しいものと交換できる通貨」として機能するので、子供の自律的な目標設定を促します。',
	// pamphlet用短文
	pamphletNote:
		'毎日の活動でポイント / 習慣カードのおみくじスタンプ（習慣形成）/ ごほうびショップ（唯一の出口）の 3 つの仕組みで、毎日のがんばりが本物の報酬になります。',
	// バッジ表記（旧 L1/L2/L3 を顧客語彙に）
	l1Badge: '活動',
	l2Badge: '習慣',
	l3Badge: 'ごほうび',
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
	insufficientPointsHint: (remaining: number) => `あと ${remaining} ポイント`,
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
} as const;

// ============================================================
// ごほうびショップ 親管理画面 申請タブ (#1337)
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
// UI プリミティブ コンポーネントラベル (#1465 Phase B)
// src/lib/ui/primitives/ 配下のハードコード文字列を集約
// ============================================================

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
		const d = new Date(date);
		// date は YYYY-MM-DD (UTC) で渡されるため、JST に補正
		const jstDay = new Date(d.getTime() + 9 * 60 * 60 * 1000).getDay();
		return days[jstDay];
	},
	chartBarAriaLabel: (childName: string, date: string, min: number) => {
		const days = ['日', '月', '火', '水', '木', '金', '土'] as const;
		const d = new Date(date);
		const jstDay = new Date(d.getTime() + 9 * 60 * 60 * 1000).getDay();
		return `${childName} ${days[jstDay]}曜日 ${min}分`;
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

	// ---- ChallengeBanner ----
	challengeBannerClear: 'クリア！',
	challengeBannerMe: 'じぶん',
	challengeBannerReceive: '🎁 うけとる',
	challengeBannerReceived: '✅ うけとりずみ',
	challengeBannerCountdownUrgent: (days: number) => `あと${days}にち！`,
	challengeBannerCountdown: (days: number) => `あと${days}にち`,

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
	featureGateStandard: 'スタンダード',
	featureGateFamily: 'ファミリー',
	featureGateLockTitle: (plan: string) => `${plan}プラン以上で利用可能`,
	featureGateLockText: (plan: string) => `${plan}プラン以上で利用可能`,
	featureGateUpgrade: 'アップグレード',

	// ---- FeedbackFab ----
	feedbackFabLabel: 'ご意見・不具合報告',

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
	logoPlanStandard: '⭐ スタンダード',
	logoPlanFamily: '⭐⭐ ファミリー',

	// ---- MonthlyRewardDialog ----
	monthlyRewardAriaLabel: '月替わりプレゼント',
	monthlyRewardArrived: '今月のプレゼントがとどいたよ！',
	monthlyRewardOpenBtn: 'あける！',
	monthlyRewardGotLabel: (name: string) => `「${name}」をゲット！`,
	monthlyRewardConfirmBtn: 'やったね！ 🎉',

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

	// ---- PageHelpButton ----
	pageHelpButtonTitle: 'このページの使い方',
	pageHelpButtonAriaLabel: 'このページの使い方ガイドを開く',

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
	},

	// ---- features/challenge/ ----
	challenge: {
		// SiblingCelebration
		celebrationTitle: 'みんなクリア！',
		celebrationClaimBtn: '🎁 ほうしゅうをうけとる！',
		celebrationCloseBtn: 'とじる',
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
	aiSuggestCommon: {
		familyOnlyBadge: 'ファミリー限定',
		familyOnlyError: (kind: string) => `${kind}はファミリープランでご利用いただけます`,
		familyOnlyDescription: (kind: string) => `${kind}はファミリープランで解放されます。`,
		familyUpgradeBtn: 'ファミリープランにアップグレード',
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

	// ---- features/admin/components/FeedbackDialog ----
	feedbackDialog: {
		title: 'ご意見・不具合報告',
		successText: '送信しました。ご意見ありがとうございます！',
		closeBtn: '閉じる',
		demoNote: 'デモ版のため、実際には送信されません',
		categoryLabel: '種別',
		categoryOpinion: 'ご意見',
		categoryBug: '不具合報告',
		categoryFeature: '機能要望',
		categoryOther: 'その他',
		categoryPlaceholder: '選択してください',
		contentLabel: '内容',
		contentPlaceholder: 'お気づきの点やご要望をお聞かせください',
		screenshotLabel: 'スクリーンショット（任意）',
		screenshotImageAlt: '添付スクリーンショット',
		screenshotRemoveBtn: '削除',
		screenshotPickerLabel: '画像を選択（最大 2MB）',
		cancelBtn: 'キャンセル',
		submitBtn: '送信する',
		submittingText: '送信中...',
		errorScreenshotSize: 'スクリーンショットは2MB以内にしてください',
		errorScreenshotType: '画像ファイルを選択してください',
		errorReadFile: 'ファイルの読み込みに失敗しました',
		errorSend: '送信に失敗しました',
		errorNetwork: 'ネットワークエラーが発生しました',
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
	addActivityModeSelector: {
		aiLabel: 'AIで追加',
		aiDesc: 'AIが活動を提案します',
		manualLabel: '手動で追加',
		manualDesc: '名前やポイントを設定',
		importLabel: 'パックから追加',
		importDesc: 'おすすめセットを一括追加',
	},

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
		note1: 'オリジナル活動やチェックリストの超過分は一時的に非表示になります',
		note2: 'データは削除されません — アップグレードで復活します',
		ctaBtn: '⭐ プランを見る',
		dismissBtn: 'あとで',
	},

	// ---- features/admin/components/ActivitiesHeader ----
	activitiesHeader: {
		title: '📋 活動管理',
		exportAriaLabel: 'エクスポート',
		introduceAriaLabel: '活動の紹介',
		clearAllAriaLabel: '全クリア',
	},

	// ---- features/admin/components/NotificationPermissionBanner ----
	notificationBanner: {
		title: '通知でもっと便利に',
		desc: '毎日のリマインダーで お子さまの がんばりを サポートしましょう',
		ctaBtn: '通知を受け取る',
		dismissBtn: 'あとで',
	},

	// ---- features/admin/components/OnboardingChecklist ----
	onboardingChecklist: {
		progressAriaLabel: (pct: number) => `セットアップ進捗 ${pct}%`,
		nextRecLabel: '次のおすすめ:',
		dismissBtn: '非表示にする',
	},

	// ---- features/admin/components/PlanStatusCard ----
	planStatusCard: {
		freePlan: '無料プラン',
		standardPlan: 'スタンダード プラン',
		familyPlan: 'ファミリー プラン',
		unlimited: '無制限',
		retentionDays: (days: number) => `${days}日間`,
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
		familyUpgradeBtn: '⭐⭐ ファミリーへ',
	},

	// ---- features/admin/components/ActivityImportPanel ----
	activityImportPanel: {
		heading: '📥 活動パックからインポート',
		seeAllPacks: 'すべてのパック →',
		desc: 'おすすめの活動セットを一括追加できます（重複はスキップ）',
		emptyText: '利用可能なパックがありません',
		processingText: '処理中...',
		addBtn: '追加',
		fileImportHeading: '📁 ファイルからインポート',
		fileImportDesc: 'JSON または CSV ファイルから活動を一括追加（重複はスキップ）',
		fileImportBtn: 'インポート',
		packResult: (packName: string, imported: number, skipped: number) =>
			`📦 「${packName}」: ${imported}件追加、${skipped}件スキップ`,
		fileResult: (packName: string, imported: number, skipped: number) =>
			`📁 「${packName}」: ${imported}件追加、${skipped}件スキップ`,
		packMeta: (count: number, ageMin: number, ageMax: number) =>
			`${count}件 ・ ${ageMin}〜${ageMax}歳`,
	},

	// ---- features/admin/components/ActivityLimitBanner ----
	activityLimitBanner: {
		title: (current: number, max: number | null) =>
			`登録上限に達しています（${current}/${max ?? '無制限'}）`,
		linkLabel: 'プランをアップグレード →',
	},

	// ---- features/admin/components/ActivityClearAllConfirm ----
	activityClearAllConfirm: {
		text: '本当に全削除しますか？',
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

	// ---- features/admin/components/AddActivityFab ----
	addActivityFab: {
		addAriaLabel: '活動を追加',
		limitAriaLabel: '追加上限',
	},

	// ---- features/admin/components/ActivityEmptyState ----
	activityEmptyState: {
		filteredText: 'この条件に一致する活動はありません',
		noActivities: '活動がまだ登録されていません',
		addBtn: '+ 活動を追加する',
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
 * 法律用語のキー語彙。文言ドリフト防止のため、CI (`scripts/check-lp-ssot.mjs`)
 * で各 value が site/privacy.html / site/terms.html に出現することを検証する。
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

export const LP_LICENSEKEY_LABELS = {
	text1: 'ライセンスキーの使い方 - がんばりクエスト ヘルプ',
	text2: 'ライセンスキーの使い方',
	text3: '最終更新日: 2026年4月17日',
	text4: 'ライセンスキーとは',
	text5: 'ライセンスキーは ',
	text6: ' から始まる英数字のコードで、以下のような形式です。',
	text7:
		'購入完了後、ご登録のメールアドレスに自動で送信されます。管理画面の「ライセンス」ページでもいつでも確認できます。',
	text8: '適用手順（3ステップ）',
	text9: '管理画面にログイン',
	text10: 'ライセンスキーを入力',
	text11: '「適用する」を押す',
	text12: 'ライセンス管理を開く',
	text13: 'ご注意',
	text14: '1回限りの使用',
	text15: '有効期限',
	text16: '第三者への共有禁止',
	text17: 'よくある質問',
	text18: 'メールが届きません',
	text19: '迷惑メールフォルダをご確認ください。',
	text20: ' からのメールが届いていない場合、以下をお試しください。',
	text21: '管理画面の「ライセンス」ページでキーを直接確認する',
	text22: '管理画面の「せってい」→「お問い合わせ」からサポートに連絡する',
	text23: '「ライセンスキーが不正です」と表示されます',
	text24: 'キーの入力ミスの可能性があります。以下を確認してください。',
	text25: 'メールからコピー＆ペーストで入力する（手入力だとミスが起きやすいです）',
	text26: '先頭や末尾に余分なスペースがないか確認する',
	text27: '大文字・小文字は自動で変換されるので気にしなくて大丈夫です',
	text28: '「このライセンスキーは既に使用されています」と表示されます',
	text29: 'キーは1回限り有効です。既に別のアカウントで使用済みの場合は再利用できません。',
	text30:
		'身に覚えがない場合は、管理画面の「せってい」→「お問い合わせ」からサポートにご連絡ください。',
	text31: '「このライセンスキーは有効期限が切れています」と表示されます',
	text32: 'ライセンスキーには有効期限（通常90日）があり、期限を過ぎると使用できなくなります。',
	text33:
		'新しいキーの発行が必要な場合は、管理画面の「せってい」→「お問い合わせ」からサポートにご連絡ください。',
	text34: '別のデバイスでもキーを使えますか？',
	text35:
		'ライセンスキーは1つのアカウント（家族グループ）に対して有効です。同じアカウントでログインすれば、どのデバイスからでも有料機能をご利用いただけます。',
	text36: 'お問い合わせ',
	text37: '上記で解決しない場合は、管理画面の「せってい」→「お問い合わせ」からご連絡ください。',
	text38: 'お問い合わせの際は、以下の情報を添えていただけるとスムーズです。',
	text39: 'ご登録のメールアドレス',
	text40: 'ライセンスキーの最初の7文字（例: GQ-ABCD）',
	text41: '表示されたエラーメッセージ',
	text42: 'img src="../logo-compact.png" alt="がんばりクエスト" height="44"',
	text43:
		'button class="hamburger" aria-label="メニュー" aria-expanded="false" aria-controls="main-nav" onclick="var n=this.nextElementSibling;n.classList.toggle(\'open\');var o=n.classList.contains(\'open\');this.textContent=o?\'✕\':\'☰\';this.setAttribute(\'aria-expanded\',o)"',
	text44: 'ライセンスキーは、がんばりクエストの有料プランを有効にするためのコードです。',
	text45:
		'購入後にメールでお届けするキーを、管理画面から入力するだけで有料機能が使えるようになります。',
	text46:
		'がんばりクエストにログインし、左メニューまたはナビゲーションから「ライセンス」ページを開きます。',
	text47: '「ライセンスキーを入力」欄に、メールで届いたキーをコピー＆ペーストします。',
	text48: '手入力の場合はハイフンも含めて正確に入力してください。',
	text49: 'ボタンを押すと、有料プランが即座に有効になります。',
	text50: '画面に「適用完了」と表示されれば成功です。',
} as const;

export const LP_FAQ_LABELS = {
	text1: 'よくあるご質問 - がんばりクエスト',
	text2: 'よくあるご質問',
	text3: 'お気軽にメール',
	text4: 'カテゴリ一覧',
	text5: '1. トライアル・解約',
	text6: '2. 料金・課金',
	text7: '3. プライバシー・データ',
	text8: '4. 対応年齢・使い方',
	text9: '5. 技術的なご質問',
	text10: 'トライアル・解約について',
	text11: '7 日間無料トライアルと、いつでもキャンセルできる仕組みについて。',
	text12: '無料トライアルの申込にクレジットカードは必要ですか？',
	text13: 'いいえ、不要です。',
	text14:
		'トライアル期間終了時は自動で無料プランに戻ります。課金への切り替えは必ず管理画面からお客さまご自身の操作で行っていただきます。',
	text15: 'トライアル後は自動で課金されますか？',
	text16: '自動課金はされません。',
	text17:
		'有料プランを継続したい場合のみ、管理画面の「プラン・お支払い」から明示的にアップグレードしてください。クレジットカード情報の入力はアップグレード操作の中で初めて求められます。',
	text18: '途中でキャンセルするとどうなりますか？',
	text19: '30 日間の猶予期間（読み取り専用）',
	text20: '猶予期間中: データの閲覧・エクスポートが可能（新規作成・編集は不可）',
	text21: '猶予期間終了後: すべてのデータが完全に削除',
	text22:
		'バックアップが必要な場合は、猶予期間中に管理画面からデータエクスポート（JSON / CSV）をお願いします。',
	text23: 'トライアル中に作ったデータは残りますか？',
	text24: 'はい、残ります。',
	text25:
		'ただし無料プランの制限（お子さま 2 人まで、活動 3 個までなど）を超えるデータは、閲覧はできますが追加・編集の一部が制限されます。制限解除は有料プランへのアップグレードで行えます。',
	text26: '解約後に再開することはできますか？',
	text27: '30 日間の猶予期間中であれば、管理画面から解約申請を取り消して有料プランを継続できます。',
	text28:
		'猶予期間終了後にデータが完全に削除された場合は、新規サインアップからのやり直しとなります（過去のデータ復旧はできません）。',
	text29: '料金・課金について',
	text30: '3 つのプラン（フリー / スタンダード / ファミリー）と、課金の仕組みについて。',
	text31: '無料プランと有料プランは何が違いますか？',
	text32: '無料プランでもすべてご利用いただけます',
	text33: '有料プランで解放される主な機能:',
	text34: 'お子さま・活動の人数制限解除（無料: お子さま 2 人 / 活動 3 個まで）',
	text35: '長期の履歴保持（無料: 過去 90 日まで → 有料: 無期限）',
	text36: 'AI 自動提案（活動案・ごほうび案）',
	text37: 'きょうだいランキング・家族メンバー招待',
	text38: 'データエクスポート（JSON / CSV）',
	text39: '料金プランページ',
	text40: '子供が勝手に課金してしまう心配はありませんか？',
	text41: 'ありません。',
	text42: 'プラン変更・アップグレードは「保護者ロール」のログインが必要',
	text43: 'お子さまアカウントはプラン変更ボタン自体が表示されない',
	text44: 'Stripe の決済画面は必ず保護者のカード情報と明示的な確認ステップを経る',
	text45: '「無断課金」が構造的に発生しない設計のため、お子さまに安心してデバイスを渡せます。',
	text46: '兄弟姉妹で使うと、どちらかだけがゲーミフィケーションされて不公平になりませんか？',
	text47: '片方だけが得をする構造にはなりません',
	text48: 'スタンダードプラン',
	text49: 'ファミリープラン',
	text50: '無制限',
	text51:
		'きょうだいランキング機能（ファミリープラン）では、年齢差を考慮した調整もできるため「上の子が有利すぎる」状況を緩和できます。',
	text52: '支払い方法は何が使えますか？',
	text53:
		'クレジットカード（Visa / Mastercard / JCB / American Express）に対応しています。Stripe による安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。',
	text54: '年額プランを途中で解約した場合の返金は？',
	text55:
		'年額プランを途中解約された場合も、お支払い済みの残り期間は引き続きご利用いただけます（プレミアム機能は期間満了まで有効）。',
	text56: '特定商取引法に基づく表記',
	text57: 'プランの変更（月額↔年額、スタンダード↔ファミリー）はできますか？',
	text58:
		'はい。管理画面の「プラン・お支払い」→「プラン変更・支払い管理」からお手続きいただけます。',
	text59:
		'アップグレード時は即座に反映され、ダウングレード時は次回更新日から新プランが適用されます。ご不明な点はお問い合わせください。',
	text60: 'プライバシー・データについて',
	text61: 'お子さまのデータの取り扱いと、サービス終了時の保証について。',
	text62: 'お子さまのデータが広告に使われることはありませんか？',
	text63: 'ありません。',
	text64: 'プライバシーポリシー',
	text65: 'データのエクスポート（書き出し）はできますか？',
	text66: 'スタンダードプラン以上',
	text67:
		'エクスポート対象: お子さま情報、活動、ポイント履歴、シール、実績、称号、チェックリスト。',
	text68: 'お引越しや他のサービスへの移行、ご自身でのバックアップにご利用いただけます。',
	text69: 'サービスが終了したらデータはどうなりますか？',
	text70: '30 日以上前までに',
	text71: '通知: 終了日の 30 日以上前にメールでお知らせ',
	text72: 'エクスポート期間: 通知から終了日まで継続',
	text73: '終了後: すべてのデータを完全削除',
	text74: '利用規約',
	text75: '退会・アカウント削除はすぐにできますか？',
	text76:
		'管理画面から退会（アカウント削除）を申請できます。申請後 30 日間の猶予期間があり、その間に申請を取り消すこともデータをエクスポートすることもできます。',
	text77: '猶予期間終了後、全データは完全に削除されます（復旧はできません）。',
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
	text90: 'お子さまが成長したら、管理画面から年齢モードを切り替えるだけで UI が自動で変わります。',
	text91: 'お子さまが成長して年齢モードが変わる時、データはどうなりますか？',
	text92: 'ポイント・シール・称号・履歴はすべて引き継がれます',
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
	text104: '15 分の無操作で自動スリープし、長時間滞在を防止',
	text105:
		'「スクリーンタイムを奪うのではなく、リアルの行動を促す」動機付けツールとしてお使いください。',
	text106: '祖父母や親戚も使えますか？',
	text107: 'ファミリープラン',
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
	text116:
		'基本的な活動記録はオフラインでも動作します（PWA のキャッシュ機能）。ただしデータ同期・新規アカウント作成・決済などはオンライン接続が必要です。',
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
	text125: '無料で始める',
	text126: 'デモを見る',
	text127: 'img src="logo-compact.png" alt="がんばりクエスト" height="44"',
	text128:
		'button class="hamburger" aria-label="メニュー" aria-expanded="false" aria-controls="main-nav" onclick="var n=this.nextElementSibling;n.classList.toggle(\'open\');var o=n.classList.contains(\'open\');this.textContent=o?\'✕\':\'☰\';this.setAttribute(\'aria-expanded\',o)"',
	text129: 'nav class="faq-toc" aria-label="FAQ目次"',
	text130:
		'a href="mailto:ganbari.quest.support@gmail.com?subject=FAQページからのお問い合わせ" data-contact-context="FAQ bottom"',
} as const;

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
	text23: ' オープンソース（MIT License）。商用利用も可能です。',
	text24: '&#x1F4CA; SaaS版との比較',
	text25: '項目',
	text26: 'SaaS版',
	text27: 'セルフホスト版',
	text28: 'セットアップ',
	text29: '&#x2705; アカウント登録だけ',
	text30: 'Docker のインストールが必要',
	text31: '料金',
	text32: '基本無料 / 有料プランあり',
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
	text44: '&#x2705; ファミリープランで利用可',
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
	text55: 'img src="logo-compact.png" alt="がんばりクエスト" height="44"',
	text56:
		'button class="hamburger" aria-label="メニュー" aria-expanded="false" aria-controls="main-nav" onclick="var n=this.nextElementSibling;n.classList.toggle(\'open\');var o=n.classList.contains(\'open\');this.textContent=o?\'✕\':\'☰\';this.setAttribute(\'aria-expanded\',o)"',
} as const;

// ============================================================
// LP_INDEX_EXTRA_LABELS (#1465 SSOT Fixes)
// ============================================================

export const LP_INDEX_EXTRA_LABELS = {
	k1: 'がんばりクエスト — 「やりなさい」を「やりたい！」に変える',
	k2: '☰',
	k3: '「やりなさい」を ',
	k4: '「やりたい！」',
	k5: ' に変える家族 RPG',
	k6: '    3〜18 歳の毎日の習慣を、ポイント・シール・称号で冒険に変える。声をかけなくても、自分から動きだす家族時間へ。',
	k7: '無料で始める',
	k8: 'デモを見る',
	k9: '家族何人でも無料ではじめられます / クレジットカード登録不要',
	k10: '子供のホーム画面 — 活動を記録してポイントゲット',
	k11: 'お子さまの年齢で、画面とむずかしさが変わります',
	k12: '3 歳から 18 歳まで、2 つの UI モードが対応。',
	k13: 'タップで「今のお子さまに合う UI」をご覧ください。',
	k14: '      0-2 歳のお子様は「準備モード」でご登録いただけます。',
	k15: '詳しくはこちら',
	k16: '幼児 (3-5)',
	k17: '小学生以上 (6-18)',
	k18: 'ひらがな中心・丸みのある大きなボタン',
	k19: '幼児 UI: ひらがな / 大タップ / 絵文字演出',
	k20: '「はをみがく」「おかたづけ」など、幼児期に身につけたい習慣がプリセット済み。ログインボーナスで毎日おみくじが 1 回引けて、スタンプカードが週末に 1 枚完成します。',
	k21: 'デモを見る',
	k22: '漢字 + 情報密度で 15 年継続できる UI',
	k23: '小学生以降 UI: 漢字 / 情報密度 / 学年別プリセット',
	k24: '宿題・習い事・部活・受験まで、学年が上がるにつれて情報密度が増す設計。実績解放と称号で「次は何をクリアしよう？」と子供自身が計画を立て、3 歳から 18 歳まで 15 年間、同じアプリで成長を記録できます。',
	k25: 'デモを見る',
	k26: '&#x1F476; 0〜2 歳のお子様は「',
	k27: '準備モード',
	k28: '」でご登録いただけます &#8212; ',
	k29: 'デモを見る',
	k30: '&#x1F9D1;&#x200D;&#x1F4BB; 親の視点',
	k31: '&#x1F9D2; 子供の視点',
	k32: '朝から夜まで、飽きさせない 5 つの工夫',
	k33: 'すぐ楽しい「おみくじ」から、長く積み上がる「称号」、毎日の「習慣エンジン」、忘れ物を減らす「持ち物リスト」、そして冒険のクライマックスまで。',
	k34: '時間軸に沿った 5 つの工夫が、日々のがんばりを支えます。',
	k35: '&#9312; 即効の楽しみ',
	k36: 'おみくじ',
	k37: 'ログインするだけで 1 日 1 回の運試し。「大吉」が出るとボーナスポイントが獲得でき、毎日記録する習慣が、自然に身につきます。',
	k38: '&#9313; 長期の達成感',
	k39: '実績 &amp; 称号',
	k40: '「はじめのぼうけんしゃ」から「でんせつのゆうしゃ」へ。長期の積み重ねが称号として永久に刻まれ、子供の自己肯定感を支えます。',
	k41: '&#9314; 習慣エンジン',
	k42: 'コンボ &amp; 朝夜の習慣リスト',
	k43: '朝・夜・週末のくり返しチェック（ルーティンチェックリスト）で習慣化。',
	k44: '連続達成で倍率が上がり、自分から動く力が育ちます。',
	k45: '&#9315; 忘れ物ゼロへ',
	k46: '持ち物チェックリスト',
	k47: '通学・習い事の持ち物を、子ども自身がタップ確認。',
	k48: '朝の「あれ持った？」を減らします。',
	k49: '&#9316; 冒険のクライマックス',
	k50: 'RPG バトル',
	k51: 'コンボで貯めたエネルギーでボスに挑戦。小学生から全年齢で使える、毎日の努力を可視化する冒険の締めくくりです。',
	k52: '遊びだけで終わらせない、親のための機能',
	k53: 'ゲーミフィケーションの裏で、親がちゃんと伴走できる設計。「遊ばせっぱなし」「設定が大変そう」の不安を取り除く 4 つの機能です。',
	k54: '成長の記録（月次レポート）',
	k55: '月次レポートで活動・ポイント推移をひと目で把握。子供の成長を記録として残せます。',
	k56: '時間管理（使いすぎ防止）',
	k57: '設定時間が経過すると画面が自動スリープ。スクリーンタイムの心配なく使わせられます。',
	k58: 'おうえんメッセージ',
	k59: '「よくがんばったね」の一言が子供のホーム画面に届きます。Family プランで家族全員から送れます。',
	k60: '設定の自由度',
	k61: '活動の種類・ポイント配分・ごほうびは自由にカスタマイズ。お子さまに合わせて調整できます。',
	k62: '料金プラン',
	k63: '月 ¥500 から、家族全員が使える設計です。',
	k64: '安心して始められる 4 つのお約束。',
	k65: '基本無料',
	k66: '有料は',
	k67: '月 &#165;500（税込）〜',
	k68: '7 日間無料体験',
	k69: 'いつでも解約 OK',
	k70: 'お子さま 2 人までのご家庭なら、無料プランで冒険の仕組みをすべてお使いいただけます。',
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
	k82: '管理画面は保護者だけが開けるカギ（おやカギコード）でロックできます。お子さまが自分でポイントを増やしたり設定を変えたりすることができません。',
	k83: '広告ゼロ・データは家族の手元に',
	k84: '家族のデータが広告にも第三者にも使われない設計です。エクスポートでいつでも家族の手元に持ち出せ、もし運営が止まっても、ご家庭で別の動かし方を続けられる準備も用意しています。',
	k85: '仕組みを詳しく知りたい方へ &#8594;',
	k86: 'よくあるご質問',
	k87: '保護者の皆さまから特によくいただく 3 つ。',
	k88: '他のご質問は ',
	k89: 'FAQ 専用ページ（24 項目）',
	k90: ' をご覧ください。',
	k91: '無料トライアルにクレジットカードは必要ですか？',
	k92: '不要です。メール認証だけで 7 日間すべての有料機能をお試しいただけます。期間終了時は自動で無料プランに戻るため、',
	k93: '気付いたら課金されていた',
	k94: 'ということはありません。',
	k95: '子供が勝手に課金してしまう心配はありませんか？',
	k96: 'ありません。課金操作は保護者権限のアカウントからのみ実行できる設計です。お子さまアカウントにはプラン変更ボタン自体が表示されません。',
	k97: '詳しくはこちら',
	k98: 'サービスが終了したらデータはどうなりますか？',
	k99: '終了日の 30 日以上前に登録メールアドレスへお知らせし、その間にデータをエクスポート（JSON / CSV）いただけます。',
	k100: '詳しくはこちら',
	k101: '料金・兄弟姉妹・年齢モード・エクスポート等、他のご質問は ',
	k102: 'FAQ 専用ページ',
	k103: ' へ。',
	k104: '家族で全部使ってから、続けるか決める',
	k105: '7 日間無料・クレジットカード登録不要 / いつでもキャンセル可能。',
	k106: '今日からお子さまの「やりたい！」を育てませんか？',
	k107: '無料で始める',
	k108: 'ご質問・ご要望は',
	k109: 'メール',
	k110: 'でお気軽にどうぞ',
	k111: '全機能を家族で試せる（7 日間無料）',
	k112: 'クレジットカード不要',
	k113: '無料で始める',
	k114: '&#10005;',
} as const;

// ============================================================
// LP_PAMPHLET_LABELS (#1465 SSOT Fixes)
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
	k15: '「はみがきした」「宿題おわった」をタップするだけ。プリセット活動がそのまま使えるので設定は最小限。記録のたびにポイントが積み上がります。',
	k16: '習慣',
	k17: ' おみくじスタンプ &#x2192; 習慣',
	k18: '1 日 1 回までのおみくじスタンプ。1 週間続くとスタンプカードが完成。三日坊主を防ぐ「毎日記録する習慣」を作ります。',
	k19: 'ごほうび',
	k20: ' ごほうびショップ &#x2192; 交換',
	k21: '&#x1F308; 3歳から18歳まで &#8212; 2つの UI モード',
	k22: '&#x1F476; 0〜2歳のお子様は「準備モード」でご登録いただけます',
	k23: '小学生以上',
	k24: '6&#x301C;18歳',
	k25: '&#x1F3AE; まずは無料で始めよう！',
	k26: '登録は1分。お子さまの名前と年齢を入れるだけで、今日から冒険が始まります。',
	k27: '&#x1F310; アクセスはこちら',
	k28: 'がんばりクエスト &#x2014; &#x6599;&#x91D1;&#x30D7;&#x30E9;&#x30F3; &amp; &#x59CB;&#x3081;&#x65B9;',
	k29: '&#x1F4B0; 料金プラン',
	k30: 'すべてのプランで冒険の仕組み（レベル・おみくじ・スタンプカード等）が使えます',
	k31: 'フリー',
	k32: 'ずっと無料',
	k33: 'お子さまの登録：2人まで',
	k34: 'プリセット活動の利用',
	k35: 'オリジナル活動の作成：3個まで',
	k36: 'レベル・ポイント・おみくじ・スタンプカード',
	k37: 'ログインボーナス・コンボ',
	k38: 'チェックリスト（持ち物／朝夜の習慣 合計3個/子まで）',
	k39: '90日間の履歴保持',
	k40: '&#x2B50; おすすめ',
	k41: 'スタンダード',
	k42: '/月（税込）',
	k43: '7日間無料体験',
	k44: '子供の登録：無制限',
	k45: 'オリジナル活動：無制限',
	k46: '家族メンバー招待：4人まで',
	k47: '特別なごほうび設定',
	k48: 'データのダウンロード',
	k49: '1年間の履歴保持',
	k50: 'メールサポート',
	k51: 'ファミリー',
	k52: '/月（税込）',
	k53: '7日間無料体験',
	k54: 'スタンダードの全機能',
	k55: '家族メンバー招待：無制限',
	k56: 'AI 自動提案（活動・ごほうび・チェックリスト）',
	k57: 'きょうだいランキング',
	k58: 'ひとことメッセージ（自由テキスト）',
	k59: 'クラウド保管枠（同時保管 10 個・手動エクスポート）',
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
	k72: '&#x2753; よくある質問',
	k73: '料金はかかりますか？',
	k74: '基本機能は無料でずっとお使いいただけます。有料プランはより多くのお子さまの登録や高度な分析機能が必要な場合にご検討ください。スタンダード・ファミリープランは 7 日間無料トライアル付きです。',
	k75: '何歳から使えますか？',
	k76: '3歳から18歳までのお子さま向けに設計しています。3歳からはお子さま自身がタップして記録、年齢に合わせて画面が自動で変わるので、きょうだいでも安心です。0〜2歳のお子さまは「準備モード」（保護者が記録するモード）で記録のみご利用いただけます（お子さま向けゲーミフィケーションは適用されません）。',
	k77: '子供のデータは安全ですか？',
	k78: 'はい。通信は常に暗号化し、データはお預かり時にも保護した状態で保管しています。お子さまの本名は不要で、ニックネームでご利用いただけます。データの第三者への販売・共有は一切行いません。',
	k79: '有料プランへの切り替えはどうしますか？',
	k80: '管理画面の「プラン・お支払い」からアップグレードしていただくと、その場で有料機能が有効になります。クレジットカード（Visa / Mastercard / JCB / American Express）に対応し、Stripe による安全な決済処理を使用しています。詳しくは ',
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
	k6: 'ログインボーナス・コンボ',
	k7: 'チェックリスト（持ち物／朝夜の習慣 合計3個/子まで）',
	k8: '90日間の履歴保持',
	k9: 'メールサポート（標準）',
	k10: 'お子さまの登録人数：無制限',
	k11: 'オリジナル活動の作成：無制限',
	k12: 'チェックリスト自由作成（無制限）',
	k13: '家族メンバー招待：4人まで',
	k14: '特別なごほうび設定（即時付与）',
	k15: 'クラウド保管枠（同時保管 3 個・手動エクスポート）',
	k16: 'データのダウンロード',
	k17: '1年間の履歴保持',
	k18: 'メールサポート',
	k19: 'スタンダードの全機能',
	k20: '家族メンバー招待：無制限',
	k21: '✨ AI 自動提案（活動・ごほうび・チェックリスト）',
	k22: 'きょうだいランキング',
	k23: 'ひとことメッセージ（自由テキスト）',
	k24: 'クラウド保管枠（同時保管 10 個・手動エクスポート）',
	k25: '無制限の履歴保持',
	k26: 'メールサポート',
	k27: '機能',
	k28: 'フリー',
	k29: 'スタンダード',
	k30: 'ファミリー',
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
	k42: '90日',
	k43: '1年',
	k44: '無制限',
	k45: 'カスタマイズ',
	k46: '持ち物チェックリスト（登校・おでかけ）',
	k47: '朝夜の習慣リスト（ルーティンチェックリスト）',
	k48: 'チェックリスト自由作成（持ち物／朝夜の習慣 合算）',
	k49: '3個/子まで',
	k50: '無制限',
	k51: '無制限',
	k52: '特別なごほうび設定（即時付与）',
	k53: 'AI 自動提案（活動・ごほうび・チェックリスト）',
	k54: 'レポート・家族機能',
	k55: '日次サマリー',
	k56: '家族メンバー招待（別端末からアクセス）',
	k57: '4人まで',
	k58: '無制限',
	k59: 'きょうだいランキング',
	k60: 'ひとことメッセージ（自由テキスト）',
	k61: 'データ管理',
	k62: 'データのダウンロード（手動エクスポート）',
	k63: 'クラウド保管枠（手動エクスポート同時保管数）',
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
 *    日本語で揃える方が UI 折り返し（ADR-0016）・タイポグラフィ検証で有用
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
		optionPlanStandard: 'スタンダードプラン',
		optionPlanFamily: 'ファミリープラン (準備中)',
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
	logo: {
		captionSymbol: 'symbol',
		captionCompact: 'compact',
		captionFull: 'full',
	},
} as const;

// ============================================================
// 初月価値プレビュー体験 (#1600 ADR-0023 I9)
// マイルストーン演出 + 30 日後親レポートプレビュー
// Anti-engagement (ADR-0012) 準拠: 過剰な祝福禁止、3 秒以内に閉じれる UI
// ============================================================
export const MILESTONE_LABELS = {
	/** 子供 UI に表示する小さなマイルストーンバナータイトル */
	bannerTitle: 'マイルストーン',
	bannerCloseLabel: '閉じる',
	first_record: {
		title: 'はじめての記録',
		description: '最初のがんばりを記録できました',
	},
	records_5: {
		title: '5 かい きろく',
		description: '5 回の活動を記録できました',
	},
	records_10: {
		title: '10 かい きろく',
		description: '10 回の活動を記録できました',
	},
	streak_7: {
		title: '1 しゅうかん つづいた',
		description: '7 日連続で記録できました',
	},
	streak_14: {
		title: '2 しゅうかん つづいた',
		description: '14 日連続で記録できました',
	},
	streak_30: {
		title: '1 かげつ つづいた',
		description: '30 日連続で記録できました',
	},
} as const;

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
// 生成元: scripts/check-lp-ssot.mjs で検出された 339 件の violation 行を
// 全て data-lp-key 化したときの label 値（innerHTML 形式）。
// 各 namespace 内の k1, k2, ... は HTML 内の出現順。
// LP_*_LABELS / LP_*_EXTRA_LABELS との重複は許容（同じ文字列が複数 namespace に存在しうる）。
// 値は applyLpKeys() で DOMPurify.sanitize 後 innerHTML 注入されるため、
// strong/em/a/br/span/sup/sub/small/b/i 以外のタグは drop される。
// ============================================================

export const LP_INDEX_PHASEB_LABELS = {
	k1: 'がんばりクエスト — 「やりなさい」を「やりたい！」に変える',
	k2: '「やりなさい」を <span>「やりたい！」</span> に変える家族 RPG',
	k3: '3〜18 歳の毎日の習慣を、ポイント・スタンプ・称号で冒険に変える。声をかけなくても、自分から動きだす家族時間へ。',
	k4: '3〜18 歳の子供のホーム画面 — 活動を記録してポイントゲット',
	k5: 'お子さまの年齢で、画面とむずかしさが変わります',
	k6: '3 歳から 18 歳まで、2 つの UI モードが対応。タップで「今のお子さまに合う UI」をご覧ください。',
	k7: '0-2 歳のお子さまは「準備モード」でご登録いただけます。<a href="faq.html#baby-mode" style="color:var(--brand-700)">詳しくはこちら</a>',
	k8: '幼児 (3-5)',
	k9: '小学生以上 (6-18)',
	k10: 'ひらがな中心・丸みのある大きなボタン',
	k11: '幼児 UI: ひらがな / 大タップ / 絵文字演出',
	k12: '「はをみがく」「おかたづけ」など、幼児期に身につけたい習慣がプリセット済み。ログインボーナスで毎日おみくじが 1 回引けて、スタンプカードが週末に 1 枚完成します。',
	k13: '<a href="https://ganbari-quest.com/auth/signup" class="btn btn-primary">無料で始める</a><a href="https://ganbari-quest.com/demo" class="btn btn-demo">デモを見る</a>',
	k14: '漢字 + 情報密度で 15 年継続できる UI',
	k15: '小学生以降 UI: 漢字 / 情報密度 / 学年別プリセット',
	k16: '宿題・習い事・部活・受験まで、学年が上がるにつれて情報密度が増す設計。実績解放と称号で「次は何をクリアしよう？」と子供自身が計画を立て、3 歳から 18 歳まで 15 年間、同じアプリで成長を記録できます。',
	k17: '<a href="https://ganbari-quest.com/auth/signup" class="btn btn-primary">無料で始める</a><a href="https://ganbari-quest.com/demo" class="btn btn-demo">デモを見る</a>',
	k18: '&#x1F476; 0〜2 歳のお子さまは「<strong>準備モード</strong>」でご登録いただけます — <a href="https://ganbari-quest.com/demo">デモを見る</a>',
	k19: '&#x1F9D1;&#x200D;&#x1F4BB; 親の視点',
	k20: '&#x1F9D2; 子供の視点',
	k21: 'コアループを支える 4 つの工夫',
	k22: '毎日の「活動 → 習慣 → ごほうび」の冒険を、長期の達成感・朝の準備・夜の習慣・冒険のクライマックスから支える 4 つの工夫です。',
	k23: '&#9312; 長期の達成感',
	k24: '実績 &amp; 称号',
	k25: '「はじめのぼうけんしゃ」から「でんせつのゆうしゃ」へ。長期の積み重ねが称号として永久に刻まれ、子供の自己肯定感を支えます。',
	k26: '&#9313; 朝の準備をスムーズに',
	k27: '持ち物チェックリスト',
	k28: '通学や習い事の持ち物を、子ども自身がタップ確認。',
	k29: '朝の「あれ持った？」を減らします。',
	k30: '&#9314; 朝夜の習慣化',
	k31: 'ルーティンチェックリスト',
	k32: '朝・夜・週末のくり返しを子ども自身がタップ確認。',
	k33: '「歯みがいた？」「着替えた？」の声かけ負担を減らします。',
	k34: '&#9315; 冒険のクライマックス',
	k35: 'RPG バトル',
	k36: '毎日の努力で貯めたエネルギーでボスに挑戦。小学生から全年齢で使える、冒険の締めくくりです。',
	k37: '遊びだけで終わらせない、親のための機能',
	k38: 'ゲーミフィケーションの裏で、親がちゃんと伴走できる設計。「遊ばせっぱなし」「設定が大変そう」の不安を取り除く 4 つの機能です。',
	k39: '成長の記録（月次レポート）',
	k40: '月次レポートで活動・ポイント推移をひと目で把握。子供の成長を記録として残せます。',
	k41: '時間管理（使いすぎ防止）',
	k42: '設定時間が経過すると画面が自動スリープ。スクリーンタイムの心配なく使わせられます。',
	k43: 'おうえんメッセージ',
	k44: '「よくがんばったね」の一言が子供のホーム画面に届きます。Family プランで家族全員から送れます。',
	k45: '設定の自由度',
	k46: '活動の種類・ポイント配分・ごほうびは自由にカスタマイズ。お子さまに合わせて調整できます。',
	k47: '料金プラン',
	k48: '月 ¥500 から、家族全員が使える設計です。安心して始められる 4 つのお約束。',
	k49: '<strong>基本無料</strong>',
	k50: '・',
	k51: '有料は<strong>月 ¥500（税込）〜</strong>',
	k52: '・',
	k53: '<strong>7 日間無料トライアル</strong>',
	k54: '・',
	k55: 'いつでも解約 OK',
	k56: 'お子さま 2 人までのご家庭なら、無料プランで冒険の仕組みをすべてお使いいただけます。3 人以上 / 長期履歴 / AI 自動提案は有料プランで。',
	k57: '<a href="pricing.html" class="btn btn-primary">料金の詳細を見る &#8594;</a>',
	k58: 'お子さまのデータは、家族だけのものです',
	k59: '広告なし・家族だけで閉じた空間・データは家族の手元に。「こっそり外に持ち出される」「勝手に操作される」不安をゼロにする 4 つの約束。',
	k60: '広告なし',
	k61: '子供の画面に広告を出しません。行動データを広告に利用することもありません。',
	k62: 'プライバシーポリシー &#8594;',
	k63: '家族限定',
	k64: '家族メンバー以外はお子さまのデータを閲覧できません。招待制で閉じた空間を維持します。',
	k65: '保護者専用のカギ付き',
	k66: '管理画面は保護者だけが開けるカギ（おやカギコード）でロックできます。お子さまが自分でポイントを増やしたり設定を変えたりすることができません。',
	k67: '広告ゼロ・データは家族の手元に',
	k68: '家族のデータが広告にも第三者にも使われない設計です。エクスポートでいつでも家族の手元に持ち出せ、もし運営が止まっても、ご家庭で別の動かし方を続けられる準備も用意しています。',
	k69: '仕組みを詳しく知りたい方へ &#8594;',
	k70: 'よくあるご質問',
	k71: '保護者の皆さまから特によくいただく 3 つ。他のご質問は <a href="faq.html" class="nav-text">FAQ 専用ページ（24 項目）</a> をご覧ください。',
	k72: '無料トライアルにクレジットカードは必要ですか？',
	k73: '不要です。メール認証だけで 7 日間すべての有料機能をお試しいただけます。期間終了時は自動で無料プランに戻るため、<strong>気付いたら課金されていた</strong>ということはありません。',
	k74: '子供が勝手に課金してしまう心配はありませんか？',
	k75: 'ありません。課金操作は保護者権限のアカウントからのみ実行できる設計です。お子さまアカウントにはプラン変更ボタン自体が表示されません。<a href="faq.html#pricing">詳しくはこちら</a>',
	k76: 'サービスが終了したらデータはどうなりますか？',
	k77: '終了日の 30 日以上前に登録メールアドレスへお知らせし、その間にデータをエクスポート（JSON / CSV）いただけます。<a href="faq.html#privacy">詳しくはこちら</a>',
	k78: '料金・兄弟姉妹・年齢モード・エクスポート等、他のご質問は <a href="faq.html">FAQ 専用ページ</a> へ。',
	k79: '家族で全部使ってから、続けるか決める',
	k80: '7 日間無料・クレジットカード登録不要 / いつでもキャンセル可能。今日からお子さまの「やりたい！」を育てませんか？',
	k81: '無料で始める',
	k82: 'ご質問・ご要望は<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="LP CTA">メール</a>でお気軽にどうぞ',
	k83: '全機能を家族で試せる（7 日間無料）<small>クレジットカード不要</small>',
	k84: '無料で始める',
	// #1736 m-MIN-7: 体験軸 FAQ Q4 (Top 3 → Top 4)
	k85: '子供が自分から使ってくれるようになりますか？',
	k86: '多くの保護者から「ガミガミ言わなくても、子供から見せに来るようになった」とのお声をいただいています。ただし、最初の 1 週間は親子で一緒に楽しむ時間を取ることをおすすめします。',
	// #1736 m-MIN-7: section-desc を「Top 3」→「Top 4」に
	k87: '保護者の皆さまから特によくいただく 4 つ。他のご質問は <a href="faq.html" class="nav-text">FAQ 専用ページ（24 項目）</a> をご覧ください。',
	// #1707 R2: machine-tour 各カードの「親が観測できる」1 行ベネフィット
	tourBenefitRoutine:
		'<strong>親が観測できること</strong>: 朝晩の声かけ回数が減り、子供が自分でタップ完了する',
	tourBenefitBattle:
		'<strong>親が観測できること</strong>: 1 日の努力が「バトルで使えるエネルギー」として可視化される',
	// #1707 R2: soft-features 各カードの「親が観測できる」1 行ベネフィット
	softBenefitMonthlyReport:
		'<strong>親が観測できること</strong>: 1 ヶ月の頑張り合計と前月比が一目でわかる',
	softBenefitAutoSleep:
		'<strong>親が観測できること</strong>: 設定した時間で自動的に画面が閉じ、長時間利用が起きない',
	softBenefitCheerMessage:
		'<strong>親が観測できること</strong>: 家族から送ったメッセージを子供が読むと既読が付く',
	softBenefitSettings:
		'<strong>親が観測できること</strong>: 子供の年齢・興味に合わせて活動とポイント配分を細かく調整できる',
} as const;

export const LP_PRICING_PHASEB_LABELS = {
	k1: 'お子さまの登録：2人まで',
	k2: 'プリセット活動の利用',
	k3: 'オリジナル活動の作成：3個まで',
	k4: 'レベル・ポイント・おみくじ・スタンプカード',
	k5: 'ログインボーナス・連続達成ボーナス',
	k6: 'チェックリスト（持ち物／朝夜の習慣 合計3個/子まで）',
	k7: '90日間の履歴保持',
	k8: 'メールサポート（標準）',
	k9: 'お子さまの登録人数：無制限',
	k10: 'オリジナル活動の作成：無制限',
	k11: 'チェックリスト自由作成（無制限）',
	k12: '家族メンバー招待：4人まで',
	k13: '特別なごほうび設定（即時付与）',
	k14: 'クラウド保管枠（同時保管 3 個・手動エクスポート）',
	k15: 'データのダウンロード',
	k16: '1年間の履歴保持',
	k17: 'メールサポート',
	k18: 'スタンダードの全機能',
	k19: '家族メンバー招待：無制限',
	k20: '✨ AI 自動提案（活動・ごほうび・チェックリスト）',
	k21: 'きょうだいランキング',
	k22: 'ひとことメッセージ（自由テキスト）',
	k23: 'クラウド保管枠（同時保管 10 個・手動エクスポート）',
	k24: '無制限の履歴保持',
	k25: 'メールサポート',
	k26: '機能',
	k27: 'フリー',
	k28: 'スタンダード',
	k29: 'ファミリー',
	k30: '<td colspan="4">基本</td>',
	k31: '<td>お子さまの登録人数</td><td>2人まで</td><td class="check">無制限</td><td class="check">無制限</td>',
	k32: '<td>プリセット活動の利用</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k33: '<td>オリジナル活動の作成</td><td>3個まで</td><td class="check">無制限</td><td class="check">無制限</td>',
	k34: '<td>活動履歴の保持</td><td>90日</td><td>1年</td><td class="check">無制限</td>',
	k35: '<td colspan="4">カスタマイズ</td>',
	k36: '<td>持ち物チェックリスト（登校・おでかけ）</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k37: '<td>朝夜の習慣リスト（ルーティンチェックリスト）</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k38: '<td>チェックリスト自由作成（持ち物／朝夜の習慣 合算）</td><td>3個/子まで</td><td class="check">無制限</td><td class="check">無制限</td>',
	k39: '<td>特別なごほうび設定（即時付与）</td><td class="dash">&#8212;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k40: '<td>AI 自動提案（活動・ごほうび・チェックリスト）</td><td class="dash">&#8212;</td><td class="dash">&#8212;</td><td class="check">&#10003;</td>',
	k41: '<td colspan="4">レポート・家族機能</td>',
	k42: '<td>日次サマリー</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k43: '<td>家族メンバー招待（別端末からアクセス）</td><td class="dash">&#8212;</td><td>4人まで</td><td class="check">無制限</td>',
	k44: '<td>きょうだいランキング</td><td class="dash">&#8212;</td><td class="dash">&#8212;</td><td class="check">&#10003;</td>',
	k45: '<td>ひとことメッセージ（自由テキスト）</td><td class="dash">&#8212;</td><td class="dash">&#8212;</td><td class="check">&#10003;</td>',
	k46: '<td colspan="4">データ管理</td>',
	k47: '<td>データのダウンロード（手動エクスポート）</td><td class="dash">&#8212;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
	k48: '<td>クラウド保管枠（手動エクスポート同時保管数）</td><td class="dash">&#8212;</td><td>3 個</td><td>10 個</td>',
	k49: '<td colspan="4">サポート</td>',
	k50: '<td>メールサポート</td><td class="check">&#10003;</td><td class="check">&#10003;</td><td class="check">&#10003;</td>',
} as const;

export const LP_FAQ_PHASEB_LABELS = {
	k1: 'よくあるご質問 - がんばりクエスト',
	k2: 'よくあるご質問',
	k3: '保護者の皆さまから多くいただくご質問に、カテゴリ別にお答えします。ここにないご質問は、<a href="mailto:ganbari.quest.support@gmail.com?subject=FAQページからのお問い合わせ" data-contact-context="FAQ hero">お気軽にメール</a>でお問い合わせください。',
	k4: 'カテゴリ一覧',
	k5: '<a href="#trial">1. トライアル・解約</a>',
	k6: '<a href="#pricing">2. 料金・課金</a>',
	k7: '<a href="#privacy">3. プライバシー・データ</a>',
	k8: '<a href="#usage">4. 対応年齢・使い方</a>',
	k9: '<a href="#technical">5. 技術的なご質問</a>',
	k10: '<span class="faq-category-num">1</span>トライアル・解約について',
	k11: '7 日間無料トライアルと、いつでもキャンセルできる仕組みについて。',
	k12: '無料トライアルの申込にクレジットカードは必要ですか？',
	k13: '<strong>いいえ、不要です。</strong>メールアドレスと Google アカウント（またはメール認証）でサインアップするだけで、クレジットカード情報を入力せずに 7 日間すべての有料機能をお試しいただけます。',
	k14: 'トライアル期間終了時は自動で無料プランに戻ります。課金への切り替えは必ず管理画面からお客さまご自身の操作で行っていただきます。',
	k15: 'トライアル後は自動で課金されますか？',
	k16: '<strong>自動課金はされません。</strong>7 日間のトライアル終了時は、自動的に無料プランへ戻ります。',
	k17: '有料プランを継続したい場合のみ、管理画面の「プラン・お支払い」から明示的にアップグレードしてください。クレジットカード情報の入力はアップグレード操作の中で初めて求められます。',
	k18: '途中でキャンセルするとどうなりますか？',
	k19: '管理画面の「プラン・お支払い」→「解約」からいつでも解約できます。解約を申請すると、その時点で <strong>30 日間の猶予期間（読み取り専用）</strong>に入ります。',
	k20: '猶予期間中: データの閲覧・エクスポートが可能（新規作成・編集は不可）',
	k21: '猶予期間終了後: すべてのデータが完全に削除',
	k22: 'バックアップが必要な場合は、猶予期間中に管理画面からデータエクスポート（JSON / CSV）をお願いします。',
	k23: 'トライアル中に作ったデータは残りますか？',
	k24: '<strong>はい、残ります。</strong>トライアル終了後に無料プランへ戻っても、お子さま・活動・ポイント・履歴などのデータは引き続き保存されます。',
	k25: 'ただし無料プランの制限（お子さま 2 人まで、活動 3 個までなど）を超えるデータは、閲覧はできますが追加・編集の一部が制限されます。制限解除は有料プランへのアップグレードで行えます。',
	k26: '解約後に再開することはできますか？',
	k27: '30 日間の猶予期間中であれば、管理画面から解約申請を取り消して有料プランを継続できます。',
	k28: '猶予期間終了後にデータが完全に削除された場合は、新規サインアップからのやり直しとなります（過去のデータ復旧はできません）。',
	k29: '<span class="faq-category-num">2</span>料金・課金について',
	k30: '3 つのプラン（フリー / スタンダード / ファミリー）と、課金の仕組みについて。',
	k31: '無料プランと有料プランは何が違いますか？',
	k32: 'お子さまの冒険体験（活動記録・ポイント・レベル・スタンプ・称号・連続達成ボーナス）は、<strong>無料プランでもすべてご利用いただけます</strong>。',
	k33: '有料プランで解放される主な機能:',
	k34: 'お子さま・活動の人数制限解除（無料: お子さま 2 人 / 活動 3 個まで）',
	k35: '長期の履歴保持（無料: 過去 90 日まで → 有料: 無期限）',
	k36: 'AI 自動提案（活動案・ごほうび案）',
	k37: 'きょうだいランキング・家族メンバー招待',
	k38: 'データエクスポート（JSON / CSV）',
	k39: '詳細は <a href="pricing.html">料金プランページ</a> の比較表をご覧ください。',
	k40: '子供が勝手に課金してしまう心配はありませんか？',
	k41: '<strong>ありません。</strong>課金操作は保護者権限のアカウントからのみ実行できるよう設計されています。',
	k42: 'プラン変更・アップグレードは「保護者ロール」のログインが必要',
	k43: 'お子さまアカウントはプラン変更ボタン自体が表示されない',
	k44: 'Stripe の決済画面は必ず保護者のカード情報と明示的な確認ステップを経る',
	k45: '「無断課金」が構造的に発生しない設計のため、お子さまに安心してデバイスを渡せます。',
	k46: '兄弟姉妹で使うと、どちらかだけがゲーミフィケーションされて不公平になりませんか？',
	k47: '同じ家族アカウント内で複数のお子さまをまとめて管理できます。ポイント・シール・称号はお子さまごとに独立して蓄積され、<strong>片方だけが得をする構造にはなりません</strong>。',
	k48: '<strong>無料プラン</strong>: お子さま 2 人まで登録可能（招待機能なし、ご本人の端末のみ）',
	k49: '<strong>スタンダードプラン</strong>: お子さま無制限で登録可能・家族メンバー招待は <strong>4 人まで</strong>（核家族でのご利用想定）',
	k50: '<strong>ファミリープラン</strong>: お子さま無制限で登録可能・家族メンバー招待は <strong>無制限</strong>（祖父母・おじおばなど拡張家族でのご利用想定）',
	k51: 'きょうだいランキング機能（ファミリープラン）では、年齢差を考慮した調整もできるため「上の子が有利すぎる」状況を緩和できます。',
	k52: '支払い方法は何が使えますか？',
	k53: 'クレジットカード（Visa / Mastercard / JCB / American Express）に対応しています。Stripe による安全な決済処理を使用しており、カード情報は当サービスのサーバーには保存されません。',
	k54: '年額プランを途中で解約した場合の返金は？',
	k55: '年額プランを途中解約された場合も、お支払い済みの残り期間は引き続きご利用いただけます（プレミアム機能は期間満了まで有効）。',
	k56: '日割りでの返金は行っておりません。詳細は <a href="tokushoho.html">特定商取引法に基づく表記</a> をご確認ください。',
	k57: 'プランの変更（月額↔年額、スタンダード↔ファミリー）はできますか？',
	k58: 'はい。管理画面の「プラン・お支払い」→「プラン変更・支払い管理」からお手続きいただけます。',
	k59: 'アップグレード時は即座に反映され、ダウングレード時は次回更新日から新プランが適用されます。ご不明な点はお問い合わせください。',
	k60: '<span class="faq-category-num">3</span>プライバシー・データについて',
	k61: 'お子さまのデータの取り扱いと、サービス終了時の保証について。',
	k62: 'お子さまのデータが広告に使われることはありませんか？',
	k63: '<strong>ありません。</strong>広告配信自体を一切行っておらず、お子さまの行動データを第三者に提供することもありません。',
	k64: 'データは「お子さまの成長を家族内で共有する」目的のみに使用されます。詳細は <a href="privacy.html">プライバシーポリシー</a> をご参照ください。',
	k65: 'データのエクスポート（書き出し）はできますか？',
	k66: 'はい。<strong>スタンダードプラン以上</strong>で、管理画面から JSON / CSV 形式でデータをエクスポートできます。',
	k67: 'エクスポート対象: お子さま情報、活動、ポイント履歴、シール、実績、称号、チェックリスト。',
	k68: 'お引越しや他のサービスへの移行、ご自身でのバックアップにご利用いただけます。',
	k69: 'サービスが終了したらデータはどうなりますか？',
	k70: 'サービス終了時は、<strong>30 日以上前までに</strong>登録メールアドレスへお知らせし、その間にデータのエクスポートが可能です。',
	k71: '通知: 終了日の 30 日以上前にメールでお知らせ',
	k72: 'エクスポート期間: 通知から終了日まで継続',
	k73: '終了後: すべてのデータを完全削除',
	k74: '詳しくは <a href="terms.html">利用規約</a> 第 14 条をご覧ください。',
	k75: '退会・アカウント削除はすぐにできますか？',
	k76: '管理画面から退会（アカウント削除）を申請できます。申請後 30 日間の猶予期間があり、その間に申請を取り消すこともデータをエクスポートすることもできます。',
	k77: '猶予期間終了後、全データは完全に削除されます（復旧はできません）。',
	k78: 'データはどこに保存されていますか？',
	k79: 'AWS 米国バージニア北部リージョン（us-east-1）のデータベースに暗号化して保存しています。AWS DPA および標準契約条項（SCC）に基づき、改正個人情報保護法第 28 条に整合する形で適切に管理しています。詳細は<a href="privacy.html">プライバシーポリシー</a>第8条（データの国外移転）をご覧ください。',
	k80: '決済情報は Stripe（国際的な PCI DSS 準拠の決済プロバイダ）で管理されており、当サービスのサーバーにはカード番号等の秘匿情報を保持していません。',
	k81: '<span class="faq-category-num">4</span>対応年齢・使い方について',
	k82: '0〜18 歳までの年齢モードと、日々の運用のしかたについて。',
	k83: '何歳から何歳まで使えますか？',
	k84: '0 〜 18 歳まで、5 つの年齢モードをご用意しています:',
	k85: '<strong>乳幼児（0-2 歳）</strong>: 保護者の準備モード。記録と振り返り中心',
	k86: '<strong>幼児（3-5 歳）</strong>: ひらがな・大きなボタン・シンプルな色使い',
	k87: '<strong>小学生（6-12 歳）</strong>: 標準モード。漢字・情報密度を保ちつつ、ポイント・実績・称号で「自分から動く力」を育てます',
	k88: '<strong>中学生（13-15 歳）</strong>: 情報密度やや高め、漢字あり',
	k89: '<strong>高校生（16-18 歳）</strong>: 大人に近い UI、自己管理中心',
	k90: 'お子さまが成長したら、管理画面から年齢モードを切り替えるだけで UI が自動で変わります。',
	k91: 'お子さまが成長して年齢モードが変わる時、データはどうなりますか？',
	k92: '年齢モードを切り替えても、<strong>ポイント・シール・称号・履歴はすべて引き継がれます</strong>。見た目（UI）だけが切り替わる設計です。',
	k93: '例: 幼児モードで貯めた「ドラゴン」シールは、小学生モードに切り替えても同じコレクションに残ります。連続ログイン日数・レベルも継続します。',
	k94: '親が毎日設定する手間はどれくらいかかりますか？',
	k95: '初回セットアップ（5 分）と、日々の運用（1 日 30 秒〜）で回せるよう設計されています。',
	k96: '<strong>初日</strong>: サインアップ → お子さま登録 → 年齢に応じたプリセット活動を選ぶ（300+ のテンプレートから）',
	k97: '<strong>毎日</strong>: お子さまが自分で活動を記録 → 保護者は管理画面で結果を確認（所要時間 30 秒〜）',
	k98: '<strong>週 1 回</strong>: レベルアップ・実績を家族で共有（お楽しみタイム）',
	k99: '親が毎日新しい活動を作る必要はありません。プリセットをそのまま使うか、年齢が変わった時にテンプレートを切り替えるだけで運用できます。',
	k100: 'スクリーンタイムが長くなる心配はありませんか？',
	k101: '「長く遊ばせる」設計にしていません。本サービスは「活動記録アプリ」であり、お子さまがアプリ内で過ごす時間は 1 回 1 〜 3 分が想定です。',
	k102: '活動記録 → ポイント獲得 → スタンプ獲得 → 結果確認で完了（1 〜 3 分）',
	k103: '動画視聴・無限スクロール・配信コンテンツは一切なし',
	k104: '15 分の無操作で自動スリープし、長時間滞在を防止',
	k105: '「スクリーンタイムを奪うのではなく、リアルの行動を促す」動機付けツールとしてお使いください。',
	k106: '祖父母や親戚も使えますか？',
	k107: '<strong>ファミリープラン</strong>では、保護者側のメンバーを<strong>無制限</strong>に招待できます。祖父母・おじおば・離れて暮らす親御さまなどが、同じお子さまの成長を見守れます（スタンダードプランは 4 人までの招待が可能です）。',
	k108: '招待されたメンバーには閲覧権限を割り当てられ、お子さまへのコメントやスタンプ送付も可能です。',
	k109: '<span class="faq-category-num">5</span>技術的なご質問',
	k110: 'デバイス・ブラウザ対応と、ソースコードの公開について。',
	k111: 'スマホ・タブレット・PC、何台まで使えますか？',
	k112: 'デバイス数の制限はありません。Web ブラウザ（Chrome / Safari / Edge など）があれば、どのデバイスからでもログインしてお使いいただけます。',
	k113: 'PWA（Progressive Web App）としてホーム画面にも追加できます。iOS / Android どちらもサポートしています。',
	k114: 'オフラインでも使えますか？',
	k115: '基本的な活動記録はオフラインでも動作します（PWA のキャッシュ機能）。ただしデータ同期・新規アカウント作成・決済などはオンライン接続が必要です。',
	k116: '旅行中や電波の弱い場所でも、お子さまが活動を記録 → ネット復帰時に自動同期、という使い方ができます。',
	k117: 'ソースコードは公開されていますか？',
	k118: 'はい。本サービスのアプリ部分は GitHub で <a href="https://github.com/Takenori-Kusaka/ganbari-quest">ソースコードを公開</a> しています。技術に詳しい方はご自宅のパソコンで同じアプリを動かすこともできます（<a href="selfhost.html">自前運用ガイド</a>）。',
	k119: 'これは「運営が終了してもアプリ自体は残り続ける」安心のための仕組みです。通常のご家庭はクラウド版をそのままお使いいただければ十分です。',
	k120: 'ほかにご質問はありますか？',
	k121: '上記にないご質問や、ご要望・フィードバックは、メールでお気軽にお寄せください。通常 1 〜 2 営業日以内にご返信いたします。',
	k122: '無料で始める',
	k123: 'デモを見る',
} as const;

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
	k13: '「はみがきした」「宿題おわった」をタップするだけ。プリセット活動がそのまま使えるので設定は最小限。記録のたびにポイントが積み上がります。',
	k14: '<span class="fi-layer-badge">習慣</span> おみくじスタンプ &#x2192; 習慣',
	k15: '1 日 1 回までのおみくじスタンプ。1 週間続くとスタンプカードが完成。三日坊主を防ぐ「毎日記録する習慣」を作ります。',
	k16: '<span class="fi-layer-badge">ごほうび</span> ごほうびショップ &#x2192; 交換',
	k17: '&#x1F308; 3歳から18歳まで — 2つの UI モード',
	k18: '&#x1F476; 0〜2歳のお子さまは「準備モード」でご登録いただけます',
	k19: '小学生以上',
	k20: '6&#x301C;18歳',
	k21: '&#x1F3AE; まずは無料で始めよう！',
	k22: '登録は1分。お子さまの名前と年齢を入れるだけで、今日から冒険が始まります。',
	k23: '&#x1F310; アクセスはこちら',
	k24: 'がんばりクエスト &#x2014; &#x6599;&#x91D1;&#x30D7;&#x30E9;&#x30F3; &amp; &#x59CB;&#x3081;&#x65B9;',
	k25: '&#x1F4B0; 料金プラン',
	k26: 'すべてのプランで冒険の仕組み（レベル・おみくじ・スタンプカード等）が使えます',
	k27: 'フリー',
	k28: 'ずっと無料',
	k29: '<span class="check">&#x2713;</span>お子さまの登録：2人まで',
	k30: '<span class="check">&#x2713;</span>プリセット活動の利用',
	k31: '<span class="check">&#x2713;</span>オリジナル活動の作成：3個まで',
	k32: '<span class="check">&#x2713;</span>レベル・ポイント・おみくじ・スタンプカード',
	k33: '<span class="check">&#x2713;</span>ログインボーナス・連続達成ボーナス',
	k34: '<span class="check">&#x2713;</span>チェックリスト（持ち物／朝夜の習慣 合計3個/子まで）',
	k35: '<span class="check">&#x2713;</span>90日間の履歴保持',
	k36: '&#x2B50; おすすめ',
	k37: 'スタンダード',
	k38: '&#xA5;500<small>/月（税込）</small>',
	k39: '7 日間無料トライアル',
	k40: '<span class="check">&#x2713;</span>子供の登録：無制限',
	k41: '<span class="check">&#x2713;</span>オリジナル活動：無制限',
	k42: '<span class="check">&#x2713;</span>家族メンバー招待：4人まで',
	k43: '<span class="check">&#x2713;</span>特別なごほうび設定',
	k44: '<span class="check">&#x2713;</span>データのダウンロード',
	k45: '<span class="check">&#x2713;</span>1年間の履歴保持',
	k46: '<span class="check">&#x2713;</span>メールサポート',
	k47: 'ファミリー',
	k48: '&#xA5;780<small>/月（税込）</small>',
	k49: '7 日間無料トライアル',
	k50: '<span class="check">&#x2713;</span>スタンダードの全機能',
	k51: '<span class="check">&#x2713;</span>家族メンバー招待：無制限',
	k52: '<span class="check">&#x2713;</span>AI 自動提案（活動・ごほうび・チェックリスト）',
	k53: '<span class="check">&#x2713;</span>きょうだいランキング',
	k54: '<span class="check">&#x2713;</span>ひとことメッセージ（自由テキスト）',
	k55: '<span class="check">&#x2713;</span>クラウド保管枠（同時保管 10 個・手動エクスポート）',
	k56: '<span class="check">&#x2713;</span>無制限の履歴保持',
	k57: '<span class="check">&#x2713;</span>メールサポート',
	k58: '&#x1F680; かんたん3ステップで始められます',
	k59: 'アカウント登録（無料）',
	k60: 'メールまたはGoogleアカウントで。1分で完了します。',
	k61: 'お子さまの年齢と性別を設定',
	k62: '年齢に合わせた活動が自動でセットアップ。',
	k63: '冒険スタート！',
	k64: '活動を記録するたびにポイント獲得 &amp; レベルアップ！',
	k65: '&#x2753; よくある質問',
	k66: '料金はかかりますか？',
	k67: '基本機能は無料でずっとお使いいただけます。有料プランはより多くのお子さまの登録や高度な分析機能が必要な場合にご検討ください。スタンダード・ファミリープランは 7 日間無料トライアル付きです。',
	k68: '何歳から使えますか？',
	k69: '3歳から18歳までのお子さま向けに設計しています。3歳からはお子さま自身がタップして記録、年齢に合わせて画面が自動で変わるので、きょうだいでも安心です。0〜2歳のお子さまは「準備モード」（保護者が記録するモード）で記録のみご利用いただけます（お子さま向けゲーミフィケーションは適用されません）。',
	k70: '子供のデータは安全ですか？',
	k71: 'はい。通信は常に暗号化し、データはお預かり時にも保護した状態で保管しています。お子さまの本名は不要で、ニックネームでご利用いただけます。データの第三者への販売・共有は一切行いません。',
	k72: '有料プランへの切り替えはどうしますか？',
	k73: '管理画面の「プラン・お支払い」からアップグレードしていただくと、その場で有料機能が有効になります。クレジットカード（Visa / Mastercard / JCB / American Express）に対応し、Stripe による安全な決済処理を使用しています。詳しくは <a href="https://www.ganbari-quest.com/pricing.html">料金プラン</a> をご覧ください。',
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
// applyLpKeys() の innerHTML + DOMPurify sanitize 機構で nested HTML
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
	articleHeader: '<h1>プライバシーポリシー</h1><p class="meta">最終更新日: 2026年4月28日</p>',
	intro:
		'個人開発者である日下武紀（以下「運営者」）は、Webアプリケーション「がんばりクエスト」（以下「本サービス」）における利用者の個人情報の取扱いについて、個人情報の保護に関する法律（以下「個人情報保護法」）その他関連法令に基づき、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。本サービスは家庭内でお子さまが利用することを想定しており、お子さまの個人情報の保護には特に配慮しています。',
	section1:
		'<h2>第1条（収集する情報）</h2><p>運営者は、本サービスの提供にあたり、以下の情報を収集します。</p><h3>1. アカウント情報</h3><p>認証および通知のためにメールアドレスを収集します。サービス内で表示する表示名をお預かりします。パスワードは不可逆のハッシュ化処理を施した状態で保存されます。これらの情報はご契約期間中保存されます。</p><h3>2. お子さまの情報</h3><p>サービス内表示のためにニックネーム、年齢区分（表示の最適化に使用）、表示設定（テーマ・UIモード等）をお預かりします。また、お誕生日のお祝い機能のために生年月日を任意でご登録いただけます。これらの情報はご契約期間中保存されます。</p><div class="highlight"><strong>お子さまの個人情報保護について</strong><ul><li>お子さまの本名の入力は必須ではありません。ニックネームでご利用いただけます。</li><li>お子さまが直接個人情報を入力する機能はありません。全ての登録は保護者が行います。</li><li>学校名、住所等の個人を特定できる情報は収集しません。生年月日は任意登録であり、お誕生日のお祝い機能にのみ使用します。</li></ul></div><h3>3. 活動データ</h3><p>サービス機能を提供するために、活動記録（ポイント、レベル等）、チャレンジ、チェックリスト記録をお預かりします。これらの情報はご契約期間中保存されます。</p><h3>4. 利用ログ</h3><p>セキュリティの確保および不正アクセス防止のために、アクセス日時、IPアドレス、デバイス情報（ブラウザ種別等）を収集します。アクセスログはCloudWatch Logsに3日間保存した後、S3にアーカイブして長期保存します。セキュリティインシデント調査に必要な場合は、当該ログを調査完了まで保持することがあります。</p><h3>5. 決済情報</h3><p>クレジットカード番号等の決済情報は、運営者のサーバーには保存されません。決済処理は全て外部の決済サービス（Stripe）を通じて行われ、当該サービスのプライバシーポリシーが適用されます。</p>',
	section2:
		'<h2>第2条（情報の利用目的）</h2><p>運営者は、収集した情報を以下の目的で利用します。</p><ol><li>本サービスの提供・運営・維持</li><li>利用者の認証・本人確認</li><li>サービスの改善・新機能の開発</li><li>利用状況の分析・統計処理（個人を特定しない形式）</li><li>重要なお知らせ・サービス変更の通知</li><li>不正利用の防止・セキュリティの確保</li><li>利用者からの問い合わせへの対応</li></ol>',
	section3:
		'<h2>第3条（情報の第三者提供）</h2><ol><li>運営者は、以下の場合を除き、利用者の個人情報を第三者に提供しません。<ul><li>利用者の同意がある場合</li><li>法令に基づく場合</li><li>人の生命、身体または財産の保護のために必要がある場合であって、利用者の同意を得ることが困難な場合</li></ul></li><li>運営者は、サービス提供のために以下の外部サービスを利用しています。各サービスは、それぞれのプライバシーポリシーに基づきデータを取り扱います。<ul><li><strong>Amazon Web Services (AWS)</strong> — サーバーインフラ（Lambda, DynamoDB）、認証基盤（Cognito）、メール送信（SES）。データは原則としてバージニア北部リージョン（us-east-1）に保存されます。<br>プライバシーポリシー: <a href="https://aws.amazon.com/jp/privacy/" target="_blank" rel="noopener">https://aws.amazon.com/jp/privacy/</a></li><li><strong>Google LLC</strong> — OAuth認証（Googleアカウントによるログイン）。認証時にメールアドレスおよび表示名を取得します。<br>プライバシーポリシー: <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">https://policies.google.com/privacy</a></li><li><strong>Stripe, Inc.</strong> — 決済処理（クレジットカード情報の安全な取扱い）。決済情報はStripeのサーバー（米国）で処理されます。<br>プライバシーポリシー: <a href="https://stripe.com/jp/privacy" target="_blank" rel="noopener">https://stripe.com/jp/privacy</a></li><li><strong>Discord Inc.</strong> — 運用監視通知（個人を特定できない形式のイベント情報の送信）<br>プライバシーポリシー: <a href="https://discord.com/privacy" target="_blank" rel="noopener">https://discord.com/privacy</a></li><li><strong>Amazon Web Services (AWS Bedrock)</strong> — 生成 AI（活動アイコン生成・テキスト補助）。利用者識別子（家族内一意 ID）を含まないリクエストのみ送信します。<br>プライバシーポリシー: <a href="https://aws.amazon.com/jp/privacy/" target="_blank" rel="noopener">https://aws.amazon.com/jp/privacy/</a></li><li><strong>Google LLC (Gemini API)</strong> — 生成 AI（画像生成）。利用者識別子（家族内一意 ID）を含まないリクエストのみ送信します。<br>プライバシーポリシー: <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">https://policies.google.com/privacy</a></li></ul></li></ol>',
	section4:
		'<h2>第4条（データの安全管理）</h2><p>運営者は、個人情報への不正アクセス、紛失、破壊、改ざん、漏洩の防止のため、以下の安全管理措置を講じています。</p><ul><li>通信は全て TLS 1.2 以上で暗号化されます。</li><li>保存データは AES-256 で暗号化されます。</li><li>パスワードは不可逆のハッシュ化処理を施して保存されます。</li><li>データベースは定期的に自動バックアップされます。</li></ul>',
	section5:
		'<h2>第5条（利用者の権利）</h2><p>利用者は、自己の個人情報について、以下の権利を有します。</p><ol><li><strong>開示請求</strong> — 運営者が保有する自己の個人情報の開示を請求できます。</li><li><strong>訂正請求</strong> — 個人情報の内容が事実でない場合、訂正を請求できます。</li><li><strong>削除請求</strong> — 個人情報の削除を請求できます。</li><li><strong>利用停止請求</strong> — 個人情報の利用停止を請求できます。</li></ol><p>上記の請求は、本サービスの設定画面から行うか、下記のお問い合わせ先までご連絡ください。</p>',
	section6:
		'<h2>第6条（データの削除）</h2><ol><li><strong>個別データの削除</strong>: 特定の活動記録やお子さまの情報の削除は、本サービスの管理画面から即時実行できます。</li><li><strong>アカウント全体の削除</strong>: アカウント削除を申請後、30日間の猶予期間を設けます。猶予期間中は削除の取消しが可能です。</li><li><strong>バックアップからの完全消去</strong>: アカウント削除後90日以内に、バックアップデータからも完全に消去されます。</li></ol>',
	section6_2:
		'<h2>第6条の2（卒業フローと事例公開承諾）</h2><p>本サービスは「お子さまが自律して使う必要がなくなった」ことを「卒業」と定義し、ポジティブな解約として扱います。卒業選択時に表示される専用ページで、ご家庭が任意で「事例として公開してもよい」旨を承諾された場合、以下の情報を保管します。</p><ol><li><strong>保管する情報</strong>: ご家庭が任意指定したニックネーム（実名禁止）、卒業時点の残ポイント数、ご利用期間（日数）、任意の卒業メッセージ。</li><li><strong>利用目的</strong>: サービス紹介ページ等での事例として公開し、他のご家庭の参考となる卒業ストーリーの提示に活用します。</li><li><strong>公開時の取り扱い</strong>: 実名は使用せず、お預かりしたニックネームのみを表示します。お子さまが特定されない形でのみ公開します。</li><li><strong>承諾の撤回</strong>: 公開承諾の撤回は、サービス問い合わせ窓口からご連絡いただくことで対応します。撤回後は当該事例を 30 日以内に非公開化します。</li><li><strong>承諾なしの場合</strong>: 公開を承諾されない場合も「卒業者数」「平均利用期間」等の集計値（個人を特定しない形式）には含まれます。</li></ol>',
	section7:
		'<h2>第7条（Cookieの使用）</h2><p>本サービスは、認証状態の維持のためにCookieを使用します。使用するCookieは機能に必須のもののみであり、広告目的のトラッキングCookieは使用しません。</p><ul><li><strong>認証Cookie</strong> — ログイン状態の維持（セッション終了時またはTTL経過時に削除）</li><li><strong>コンテキストCookie</strong> — 利用者のロール・テナント情報（セッション中のみ）</li><li><strong>セキュリティCookie</strong> — 認証フロー中のみ使用されるCookie（フロー完了後に自動削除）<ul><li><code>oauth_state</code> — OAuth認証時のCSRF防止トークン</li><li><code>oauth_nonce</code> — OAuth認証時のリプレイ攻撃防止トークン</li></ul></li><li><strong>招待Cookie</strong> — 招待リンク経由のアクセス時に招待コードを一時保持（招待受理後に削除）</li></ul><p>ブラウザの設定によりCookieを無効にすることができますが、本サービスの一部機能が利用できなくなる場合があります。</p>',
	section8:
		'<h2>第8条（外部送信規律 公表）</h2><p>電気通信事業法第27条の12に基づき、本サービスがサービス提供のために外部に送信する情報を公表します。<strong>送信されるのは技術的な情報のみで、お預かりしたデータの第三者への提供や広告利用は行いません。</strong></p><p>運営者は、電気通信事業法第27条の12（外部送信規律）に基づき、利用者の端末から外部の第三者に送信される情報について、以下のとおり公表します。</p><ol><li><strong>送信される情報</strong>: ページ URL、リファラ、訪問時刻、画面解像度、ブラウザ言語、ユーザーエージェント等の通信ヘッダ情報</li><li><strong>送信先</strong>:<ul><li>Amazon Web Services, Inc.（自社アカウント内 DynamoDB / Lambda / Cognito）</li><li>Stripe, Inc.（課金処理）</li><li>Amazon Web Services (AWS Bedrock)（生成 AI）</li><li>Google LLC (Gemini API)（生成 AI）</li></ul></li><li><strong>利用目的</strong>: ウェブサイトの機能提供および改善 / 課金処理 / コンテンツ生成（活動アイコン・テキスト補助等）</li><li><strong>個人を識別する情報</strong>: 上記の外部送信に際して、運営者は利用者本人を直接識別する情報（氏名・住所・電話番号等）を取得しません。利用者識別子は家族内一意 ID のみであり、外部第三者には送信しません。</li><li><strong>利用者の選択肢</strong>: 利用者は、ブラウザの設定により Cookie をブロックすることで、一部の外部送信を停止することができます。ただし、本サービスの一部機能が利用できなくなる場合があります。</li></ol>',
	section9:
		'<h2>第9条（未成年者の取扱い）</h2><p>本サービスは、お子さま（未成年者）が利用することを前提として設計されており、未成年者の保護のために以下の特別な措置を講じています。</p><ol><li><strong>全年齢で親同意フレームワーク運用</strong>: 年齢を問わず、すべてのお子さまの本サービス利用について、保護者（法定代理人）が本利用規約・本ポリシーに同意した上でアカウントを作成・管理します。お子さま本人がアカウントを作成することはできません。</li><li><strong>利用者識別子は家族内一意 ID のみ</strong>: お子さまを識別する情報は、家族グループ内でのみ一意に割り振られる ID であり、学校名・氏名・住所・電話番号等の本人を特定する情報は取得しません。</li><li><strong>利用者本人への直接接触の禁止</strong>: 運営者から、お子さま本人に対するアンケート・通知・メールマガジン等の直接的な接触は一切行いません。本サービスに関する連絡は、すべて保護者宛に行います。</li><li><strong>利用者データの域外送信ゼロ</strong>: お子さまの活動記録・プロフィール等のデータは、運営者が管理する自社 AWS アカウント内 DynamoDB のみで処理し、外部第三者（生成 AI 等を含む）への送信は行いません。</li><li><strong>親による削除請求の優先処理</strong>: 保護者からのお子さまデータ削除請求は、本ポリシー第5条・第6条の手続きに従って優先的に処理します。</li></ol>',
	section10:
		'<h2>第10条（外国にある第三者への提供）</h2><p>本サービスは、AWS（米国バージニア北部リージョン）/ Stripe / Google の各データセンターを利用してサービスを提供しています。これらは「外国にある第三者への提供」（個人情報保護法 §28）に該当しますが、以下の方針を厳守しています:</p><ul><li>お預かりしたデータは <strong>サービス提供のためだけに使用</strong> します</li><li><strong>広告利用・トラッキング・第三者への販売は一切行いません</strong></li><li><strong>機械学習・AI モデルの学習データへの流用はありません</strong></li><li>子供の識別情報（ニックネーム等）は <strong>Google Gemini API には送信しません</strong>（マスク済み）</li></ul><p>運営者は、個人情報保護法第28条に基づき、利用者の個人データを外国にある第三者へ提供することについて、以下のとおり情報を提供し、利用者の同意を取得します。</p><ol><li><strong>移転先国</strong>: 米国（AWS バージニア北部リージョン: us-east-1）</li><li><strong>第三者の名称</strong>: Amazon Web Services, Inc.（米国デラウェア州法人）</li><li><strong>法的根拠</strong>: AWS との間で締結された Data Processing Addendum (DPA) および標準契約条項 (Standard Contractual Clauses, SCC) に基づき、個人情報の保護に関して日本と同等の水準にあると認められる体制を整備しています。</li><li><strong>移転される情報の範囲</strong>: 利用者識別子（家族内一意 ID）、活動記録、課金関連情報（決済情報そのものは Stripe で処理され、運営者および AWS のサーバーには保存されません）</li><li><strong>本人同意の取得</strong>: 上記の外国にある第三者への提供については、本サービスのサインアップ時に、「サービス提供に必要な範囲でのデータ保存・処理に同意します」のチェックボックス（広告利用・第三者への販売・機械学習への流用を行わない旨の説明とともに表示）により、利用者から明示的に同意を取得します。同意されない場合、本サービスをご利用いただくことができません。</li><li><strong>その他の外国にある第三者</strong>:<ul><li><strong>Stripe, Inc.</strong>（米国） — 決済情報の処理。Stripe は PCI DSS Level 1 認証を取得しています。</li><li><strong>Google LLC</strong>（米国） — OAuth 認証および Gemini API（生成 AI）。</li></ul></li></ol>',
	section11:
		'<h2>第11条（本ポリシーの変更）</h2><ol><li>運営者は、法令の改正、社会情勢の変化、またはサービス内容の変更に伴い、本ポリシーを変更することがあります。</li><li>重要な変更を行う場合は、本サービス上での通知またはメールにより、変更内容と施行日をお知らせします。</li><li>本ポリシーの重要な変更後に本サービスを継続して利用される場合、利用者には変更後のポリシーに対する再同意を求める場合があります。</li></ol>',
	section12:
		'<h2>第12条（個人情報保護管理者）</h2><div class="contact"><p><strong>個人情報保護管理者</strong></p><p>氏名: 日下武紀</p><p>連絡先: <a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="プライバシー">ganbari.quest.support@gmail.com</a></p></div>',
	section13:
		'<h2>第13条（お問い合わせ）</h2><p>個人情報の取扱いに関するお問い合わせは、以下までご連絡ください。開示等の請求に対しては、ご本人確認のうえ、合理的な期間内に対応いたします。</p><div class="contact"><p>がんばりクエスト運営者 日下武紀</p><p>お問い合わせ: <a href="https://github.com/Takenori-Kusaka/ganbari-quest/issues">GitHub Issues</a> / <a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="プライバシー">メール</a></p></div>',
	effective: '<p>以上</p><p>制定日: 2026年3月27日</p><p>最終改定日: 2026年4月28日</p>',
} as const;

// ============================================================
// LP /site/terms.html SSOT (#1703 / #1683-C / ADR-0009 supersede / ADR-0025)
// 命名規則: legalTerms.<key>
//   - articleHeader / intro / section1〜section20 / effective
// ============================================================
export const LP_LEGAL_TERMS_LABELS = {
	articleHeader: '<h1>利用規約</h1><p class="meta">最終更新日: 2026年4月28日</p>',
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
	section7:
		'<h2>第7条（料金および支払い）</h2><ol><li>本サービスの基本機能は無料でご利用いただけます。一部の機能は有料プランへの加入が必要です。料金の詳細は本サービス内の料金ページに記載します。</li><li>有料プランの支払いは、運営者が指定する決済サービスを通じて行われます。</li><li>有料プランは契約期間ごとに自動更新されます。自動更新の停止（解約）は、次回更新日の前日までに本サービスの設定画面から行うことができます。</li><li>解約後も、支払い済み期間の終了日まで有料プランの機能をご利用いただけます。</li><li>日割り計算による返金は行いません。</li></ol>',
	section8:
		'<h2>第8条（無料トライアル）</h2><ol><li>有料プランには無料トライアル期間が含まれる場合があります。期間の詳細は本サービス内に記載します。</li><li>無料トライアル期間中に解約した場合、料金は発生しません。</li><li>無料トライアル期間終了後、自動的に無料プランに移行します。有料プランへの移行はお客さまご自身で管理画面より手続きしていただく必要があります。</li><li>無料トライアルは、1アカウントにつき1回のみご利用いただけます。</li></ol>',
	section9:
		'<h2>第9条（知的財産権）</h2><ol><li>本サービスに関する知的財産権は全て運営者または正当な権利者に帰属します。</li><li>利用者が本サービスに登録したコンテンツの著作権は利用者に帰属しますが、運営者はサービスの提供および改善に必要な範囲で当該コンテンツを利用できるものとします。</li></ol>',
	section10:
		'<h2>第10条（個人情報の取扱い）</h2><p>利用者の個人情報の取扱いについては、別途定める<a href="privacy.html">プライバシーポリシー</a>に従うものとします。</p>',
	section11:
		'<h2>第11条（サービスの中断・停止）</h2><ol><li>運営者は、以下の場合、事前の通知なく本サービスの全部または一部を中断・停止することがあります。<ul><li>システムの保守・点検・更新を行う場合</li><li>地震、落雷、火災、停電、天災等の不可抗力により本サービスの提供が困難な場合</li><li>その他、運営者がサービスの中断・停止が必要と判断した場合</li></ul></li><li>サービスの中断・停止により利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、運営者は責任を負いません。</li></ol>',
	section12:
		'<h2>第12条（免責事項）</h2><ol><li>本サービスは個人開発者が運営するものであり、「現状有姿（AS IS）」で提供されます。運営者は、本サービスの正確性、完全性、信頼性、適時性、安全性、特定目的への適合性について、明示的または黙示的を問わず一切の保証をしません。</li><li>本サービスはこどもの教育効果や行動変容を保証するものではなく、結果について運営者は責任を負いません。</li><li>運営者は、本サービスの利用により利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、一切の責任を負いません。</li><li>運営者は、以下に起因する損害について、一切の責任を負いません。<ul><li>データの消失、破損、改ざん、または復旧の不能</li><li>サービスの中断、遅延、停止、または終了</li><li>第三者サービス（AWS、Stripe、Google等）の障害、仕様変更、またはサービス停止</li><li>不正アクセス、コンピュータウイルス、その他のセキュリティ侵害</li><li>利用者間のトラブルまたは紛争</li><li>利用者の操作ミスまたはアカウント管理の不備</li></ul></li><li>運営者は、間接損害、特別損害、偶発的損害、結果的損害、逸失利益、およびデータの喪失について、たとえその可能性を事前に告知されていた場合であっても、責任を負いません。</li><li>前各項の規定にかかわらず、消費者契約法その他の強行法規の適用により運営者の責任が認められる場合、運営者が利用者に対して賠償する金額は、当該利用者が損害発生月を含む直近3ヶ月間に本サービスに対して実際に支払った利用料の総額を上限とします。無料プランの利用者については、運営者の賠償額の上限は0円とします。</li></ol>',
	section13:
		'<h2>第13条（利用者データの取扱い）</h2><ol><li>利用者は、自己のコンテンツについて、いつでも削除を申請することができます。</li><li>アカウント削除を申請した場合、30日間の猶予期間の後、全データが完全に削除されます。猶予期間中は削除の取消しが可能です。</li><li>運営者はデータのバックアップを実施していますが、データの復旧を保証するものではありません。</li></ol>',
	section14:
		'<h2>第14条（卒業 — ポジティブな解約について）</h2><ol><li><strong>哲学</strong>: 本サービスは、お子さまが日常活動を自律的に行えるようになった時点で、本サービスの継続利用を推奨しません。これを「卒業」と呼びます。卒業は、お子さまが成長し、本サービスの動機づけがなくても自分の力で日々の活動に取り組めるようになった、ポジティブな節目です。</li><li><strong>卒業時の手続き</strong>: 利用者は、本サービスの管理画面から「卒業手続き」を行うことで、本契約を終了し、データのエクスポートまたは削除を選択することができます。具体的な手続き UI は別途提供します（実装は今後のリリースで提供予定）。</li><li><strong>残ポイントの還元</strong>: 卒業時に保有しているポイントについて、現金または物品での還元を希望される場合は、別途運営者までご連絡ください。還元の対象範囲・方法については、運営者が個別に案内します。</li><li><strong>通常の解約との関係</strong>: 卒業は、利用者の意思による契約終了の一形態であり、本規約第7条に定める通常の解約手続きと並存します。利用者は、卒業手続きの代わりに通常の解約手続きを選択することもできます。</li></ol>',
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
	effective: '<p>以上</p><p>制定日: 2026年3月27日</p><p>最終改定日: 2026年4月28日</p>',
} as const;

// ============================================================
// LP /site/sla.html SSOT (#1703 / #1683-C / ADR-0009 supersede / ADR-0025)
// 命名規則: legalSla.<key>
//   - articleHeader / intro / section1〜section8 / effective
// ============================================================
export const LP_LEGAL_SLA_LABELS = {
	articleHeader: '<h1>サービスレベル合意（SLA）</h1><p class="meta">最終更新日: 2026年4月17日</p>',
	intro:
		'本文書は、個人開発者である日下武紀が運営するがんばりクエスト（以下「本サービス」）のサービスレベル目標を定めるものです。本サービスは個人が開発・運営しているため、企業が提供するサービスとは運営体制が異なります。本SLAは、運営者が誠実に達成を目指す目標値を示すものであり、法的な保証ではありません。',
	section1:
		'<h2>第1条（適用範囲）</h2><ol><li>本SLAは、本サービスのSaaS版（https://ganbari-quest.com）に適用されます。</li><li>セルフホスト版（利用者自身の環境で動作するもの）には適用されません。</li><li>本SLAは、運営者が合理的な努力により達成を目指す目標であり、法的な保証を構成するものではありません。</li></ol>',
	section2:
		'<h2>第2条（サービス可用性）</h2><ol><li>運営者は、本サービスの月間可用性 <strong>99.5%</strong> を目標とします（月間約3.6時間の計画外ダウンタイムに相当）。</li><li>以下は計画外ダウンタイムに含みません。<ul><li>事前に通知された計画メンテナンス</li><li>天災・戦争等の不可抗力による停止</li><li>クラウド基盤の障害</li><li>利用者側の環境に起因する接続障害</li></ul></li></ol>',
	section3:
		'<h2>第3条（デプロイおよび計画メンテナンス）</h2><ol><li>本サービスは継続的デプロイ（CI/CD）を採用しており、通常のコードデプロイはゼロダウンタイムで実施されます。通常のデプロイにおいてサービスの中断は発生しません。</li><li>インフラストラクチャの変更（CDKスタック更新、データベースマイグレーション等）により、サービスの一時的な中断が見込まれる場合は「計画メンテナンス」として扱い、以下の対応を行います。<ul><li>事前通知: 24時間前までにDiscordステータスチャンネルにて告知</li><li>影響範囲および想定される中断時間の事前説明</li></ul></li><li>緊急のセキュリティパッチ等、事前通知なく実施する場合があります。この場合は可能な限り速やかに通知します。</li></ol>',
	section4:
		'<h2>第4条（データ保護）</h2><p>運営者は、利用者のデータを保護するために以下の措置を講じています。</p><ul><li>日次の自動バックアップを実施しています。</li><li>全ての通信はTLS 1.2以上で暗号化されます。</li><li>保存データはAES-256で暗号化されます。</li><li>障害発生時の復旧目標時間は4時間以内です。</li><li>データの復旧時点目標は24時間以内（日次バックアップ間隔）です。</li></ul>',
	section5:
		'<h2>第5条（障害通知）</h2><ol><li>サービス障害が発生した場合、運営者はDiscordの公開ステータスチャンネルにて状況を通知します。継続的なダウンタイムが1時間を超える場合は、登録メールアドレスへの通知も行います。</li><li>障害の検知はデプロイ時の自動検証および定期的なヘルスチェック（準備中）により行われ、異常を検知した場合は速やかに対応を開始し通知します。</li></ol>',
	section6:
		'<h2>第6条（サポート対応）</h2><p>お問い合わせは<a href="https://github.com/Takenori-Kusaka/ganbari-quest/issues">GitHub Issues</a>または<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="SLA">メール</a>にて24時間受け付けています。初回応答は48時間以内（営業日ベース）を目標としています。対応言語は日本語です。</p><p>個人運営のため、応答が遅れる場合があります。ご理解をお願いいたします。</p>',
	section7:
		'<h2>第7条（SLA未達時の対応）</h2><ol><li>本SLAに定める目標値を達成できなかった場合、運営者は原因の調査と再発防止に努めます。</li><li>本SLAは法的な保証ではなく、目標未達に対するサービスクレジット（返金・減額）の提供は行いません。</li><li>重大な障害（連続24時間以上のサービス停止等）が発生した場合、有料プランの利用者は障害期間に相当する日数分のサービス期間延長を申請できます。延長の可否は運営者が判断します。</li></ol>',
	section8:
		'<h2>第8条（免責事項）</h2><ol><li>本サービスは個人開発によるものであり、エンタープライズ向けサービスと同等の可用性・冗長性を保証するものではありません。運営者1名での対応となるため、障害対応に時間を要する場合があります。</li><li>本SLAに定める目標値を達成できなかった場合でも、運営者は損害賠償義務を負いません。損害賠償については、<a href="terms.html">利用規約</a>第12条（免責事項）の定めに従います。</li><li>本SLAの内容は、サービスの改善に伴い変更される場合があります。重要な変更がある場合は14日前までに通知します。</li></ol>',
	effective:
		'<p>制定日: 2026年3月27日</p><p>最終改定日: 2026年4月17日</p><p>がんばりクエスト運営者 日下武紀</p>',
} as const;

// ============================================================
// LP /site/tokushoho.html SSOT (#1703 / #1683-C / ADR-0009 supersede / ADR-0025)
// 命名規則: legalTokushoho.<key>
//   - articleHeader: h1 + meta
//   - tableContent: 全 13 行のテーブルを 1 key に格納（table 構造保持）
//   - effective: 制定日 / 最終改定日
// ============================================================
export const LP_LEGAL_TOKUSHOHO_LABELS = {
	articleHeader: '<h1>特定商取引法に基づく表記</h1><p class="meta">最終更新日: 2026年4月9日</p>',
	tableContent:
		'<tr><th>販売業者</th><td>日下武紀</td></tr><tr><th>運営責任者</th><td>日下武紀</td></tr><tr><th>所在地</th><td>請求があり次第、遅滞なく開示します（<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法-所在地">ganbari.quest.support@gmail.com</a> までご連絡ください）<br><small>※特商法第 11 条 + 同法施行規則第 23 条に基づく省略表示。請求受付後、遅滞なく所在地を書面・メール等にて開示いたします</small></td></tr><tr><th>電話番号</th><td>請求があり次第、遅滞なく開示します（<a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法-電話番号">ganbari.quest.support@gmail.com</a> までご連絡ください）<br>受付時間: 平日 10:00〜18:00（土日祝・年末年始を除く）<br>※お問い合わせはメールを推奨いたします（即日〜翌営業日に返信）<br><small>※特商法第 11 条 + 同法施行規則第 23 条に基づく省略表示。請求受付後、遅滞なく電話番号を書面・メール等にて開示いたします</small></td></tr><tr><th>メールアドレス</th><td><a href="mailto:ganbari.quest.support@gmail.com" data-contact-context="特商法">ganbari.quest.support@gmail.com</a></td></tr><tr><th>URL</th><td><a href="https://www.ganbari-quest.com">https://www.ganbari-quest.com</a></td></tr><tr><th>販売価格</th><td>無料プラン: 無料<br>スタンダードプラン: 月額500円（税込） / 年額5,000円（税込）<br>ファミリープラン: 月額780円（税込） / 年額7,800円（税込）</td></tr><tr><th>支払方法</th><td>クレジットカード（Visa, Mastercard, JCB, American Express）<br>※Stripe決済サービス経由</td></tr><tr><th>支払時期</th><td>初回: 7 日間無料トライアルから開始。トライアル終了後は自動的に無料プランに移行し、自動課金は発生しません。有料プランへの移行はお客さまご自身で管理画面より手続きしていただく必要があります。<br>月額プラン: 毎月契約日に自動課金<br>年額プラン: 毎年契約日に自動課金</td></tr><tr><th>サービス提供時期</th><td>お申込み後、即時ご利用いただけます（有料プランは 7 日間無料トライアルから開始）</td></tr><tr><th>返品・キャンセル</th><td>デジタルサービスのため返品はお受けしておりません。<br>有料プランの解約（中途解約）は、管理画面の「プラン変更・支払い管理」からいつでも可能です。<br>解約後は現在の請求期間終了まで引き続きご利用いただけます。日割り計算による返金は行いません。<br><br><strong>解約後のデータ削除について（#1643 R38 整合）</strong>：解約後はプランに応じた読み取り専用の猶予期間（スタンダードプラン: 7 日 / ファミリープラン: 30 日）が設けられ、その猶予期間の経過後にすべてのお客様データが完全に削除されます（復旧不可）。猶予期間中は読み取り専用でデータエクスポートが可能です。なお、無料プランの場合は解約と同時にデータが削除されます。</td></tr><tr><th>無料トライアル</th><td>初回お申込み時に 7 日間無料トライアルをご利用いただけます。<br>トライアル期間中にキャンセルされた場合、料金は発生しません。<br>トライアル終了後は自動的に無料プランに移行します。自動課金は一切ありません。</td></tr><tr><th>追加料金</th><td>表示価格以外の追加料金はございません。<br>（インターネット接続に必要な通信料等は利用者のご負担となります）</td></tr><tr><th>動作環境</th><td>Chrome, Safari, Firefox, Edge の最新版<br>インターネット接続が必要です</td></tr>',
	effective: '<p>制定日: 2026年3月31日</p><p>最終改定日: 2026年4月9日</p>',
} as const;
