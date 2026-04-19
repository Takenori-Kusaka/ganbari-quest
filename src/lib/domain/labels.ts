// src/lib/domain/labels.ts
// 用語辞書 — UI表示ラベルの Single Source of Truth
// 全てのUIラベルはこのファイルからインポートすること。ハードコード禁止。

import type { UiMode } from './validation/age-tier-types';
// #980: age-tier-types.ts に型・正規化関数を集約し循環依存を解消
import { normalizeUiMode } from './validation/age-tier-types';

// ============================================================
// ナビゲーションカテゴリ
// ============================================================

export const NAV_CATEGORIES = {
	monitor: { label: '記録・分析', icon: '📊' },
	encourage: { label: '応援・報酬', icon: '💬' },
	customize: { label: '活動設定', icon: '🎮' },
	settings: { label: 'アカウント', icon: '⚙️' },
} as const;

export type NavCategoryId = keyof typeof NAV_CATEGORIES;

// ============================================================
// ナビゲーション項目ラベル
// ============================================================

export const NAV_ITEM_LABELS = {
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
	baby: '乳幼児（0〜2歳）',
	preschool: '幼児（3〜5歳）',
	elementary: '小学生（6〜12歳）',
	junior: '中学生（13〜15歳）',
	senior: '高校生（16〜18歳）',
};

/** 年齢区分の短縮ラベル（一覧表示・コンパクト表示向け） */
export const AGE_TIER_SHORT_LABELS: Record<UiMode, string> = {
	baby: '0〜2歳',
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
	plan: 'プラン',
	members: 'メンバー',
	dataExport: 'データエクスポート',
	aiActivitySuggest: 'AI による活動提案',
} as const;

// ============================================================
// チェックリスト種別ラベル（#1168: 持ち物 / ルーティン分離）
// ============================================================

export const CHECKLIST_KIND_LABELS = {
	item: '持ち物チェックリスト',
	routine: 'ルーティン',
} as const;

export const CHECKLIST_KIND_SHORT_LABELS = {
	item: '持ち物',
	routine: 'ルーティン',
} as const;

export const CHECKLIST_KIND_ICONS = {
	item: '🎒',
	routine: '📋',
} as const;

export type ChecklistKind = keyof typeof CHECKLIST_KIND_LABELS;

export function getChecklistKindLabel(kind: string): string {
	return CHECKLIST_KIND_LABELS[kind as ChecklistKind] ?? CHECKLIST_KIND_LABELS.routine;
}

export function getChecklistKindShortLabel(kind: string): string {
	return CHECKLIST_KIND_SHORT_LABELS[kind as ChecklistKind] ?? CHECKLIST_KIND_SHORT_LABELS.routine;
}

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
	submitting: '開始中...',
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
	bannerTitleNotStarted: `7日間、全機能を${ACTION_LABELS.freeTrialWord}ます`,
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
