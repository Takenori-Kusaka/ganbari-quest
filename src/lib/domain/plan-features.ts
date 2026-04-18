// src/lib/domain/plan-features.ts
// プラン別機能リストの Single Source of Truth（#762）
//
// これまで料金プラン機能リストは以下の 4 箇所で並行実装されていた:
//  - src/routes/pricing/+page.svelte
//  - src/lib/features/admin/components/PremiumWelcome.svelte
//  - src/routes/(parent)/admin/license/+page.svelte
//  - site/index.html, site/pricing.html, site/pamphlet.html（LP）
//
// このファイルを SSOT とし、アプリ側（TS/Svelte）の features 配列は
// 必ずここから import する。LP 側（site/*.html）は静的 HTML のため
// scripts/generate-lp-labels.mjs で site/shared-labels.js に同期させる
// か、あるいは手動同期を継続する（parallel-implementations.md 参照）。
//
// プラン機能を追加・変更する際は、以下のチェックリストに従うこと:
//  1. `src/lib/server/services/plan-limit-service.ts` の PLAN_LIMITS を更新
//  2. このファイル（plan-features.ts）の該当プランを更新
//  3. FEATURE_LABELS（labels.ts）にラベルを追加
//  4. LP 側（site/*.html）を手動同期
//  5. tests/unit/domain/plan-features.test.ts の期待値を更新

import type { PlanKey } from './labels';
import { ACTION_LABELS, TRIAL_LABELS } from './labels';

/**
 * プラン料金カードに表示する機能リスト（/pricing/+page.svelte 用）
 *
 * ユーザーがプラン購入を検討する際に参照する「そのプランで何ができるか」の
 * 網羅リスト。マーケティング文言としての読みやすさを優先する。
 */
export const PRICING_PAGE_FEATURES: Record<PlanKey, readonly string[]> = {
	free: [
		'お子さまの登録：2人まで',
		'プリセット活動の利用',
		'オリジナル活動の作成：3個まで',
		'レベル・ポイント・シールガチャ',
		'ログインボーナス・コンボ',
		'チェックリスト（持ち物/ルーティン 合計3個/子まで）',
		'90日間の履歴保持',
	],
	standard: [
		'お子さまの登録人数：無制限',
		'オリジナル活動の作成：無制限',
		'チェックリスト自由作成（無制限）',
		'特別なごほうび設定（即時付与）',
		'データの自動バックアップ（3回分）',
		'データのダウンロード',
		'1年間の履歴保持',
		'メールサポート',
	],
	family: [
		'スタンダードの全機能',
		'✨ AI 自動提案（活動・ごほうび・チェックリスト）',
		'きょうだいランキング',
		'ひとことメッセージ（自由テキスト）',
		'データの自動バックアップ（10回分）',
		'無制限の履歴保持',
		'メールサポート',
	],
} as const;

// 注: 本 SSOT は #792 の棚卸しで plan-gate 実装と一致させている。
// - `plan-features-audit.md` に棚卸し表を記載済み
// - 月次比較レポート / 5つのチカラの成長グラフは plan-gate されていないため掲載から除外
// - アバターアップロードは全プランで利用可能（#866: canCustomAvatar デッドコンフィグを削除）
// - 週次メールレポートは cron が未稼働のため掲載保留（実稼働後に復活）
// - ひとことメッセージ（自由テキスト）は #772、きょうだいランキングは #782 で family 専用化済み

/**
 * 管理画面のプラン選択カード（/admin/license/+page.svelte）に表示する
 * 短い機能ハイライトリスト。料金ページよりも簡潔な 4〜5 項目に絞る。
 */
export const LICENSE_PAGE_HIGHLIGHTS: Record<'standard' | 'family', readonly string[]> = {
	standard: [
		'子供の登録数 無制限',
		'カスタム活動 無制限',
		'データ保持 1年間',
		'データのダウンロード',
	],
	family: [
		'スタンダードの全機能',
		'祖父母・家族向け閲覧リンク',
		'ひとことメッセージ（自由テキスト）',
		'きょうだいランキング',
		'データ保持 無制限',
	],
} as const;

/**
 * プランアップグレード直後の Welcome ダイアログ（PremiumWelcome.svelte）で
 * 「解放された機能」として表示する項目。
 *
 * family の場合は standard の全機能に加えて family 固有機能を含めるのではなく、
 * 「そのプランで使える主要機能」を短くまとめたリストを表示する。
 */
export interface UnlockedFeatureItem {
	text: string;
	icon: string;
}

export const PREMIUM_UNLOCKED_FEATURES: Record<
	'standard' | 'family',
	readonly UnlockedFeatureItem[]
> = {
	standard: [
		{ text: 'オリジナル活動の追加（無制限）', icon: '✅' },
		{ text: 'チェックリストの自由作成', icon: '✅' },
		{ text: '特別なごほうび設定', icon: '✅' },
		{ text: '1年間のデータ保持', icon: '✅' },
	],
	family: [
		{ text: 'オリジナル活動の追加（無制限）', icon: '✅' },
		{ text: 'チェックリストの自由作成', icon: '✅' },
		{ text: 'AI 自動提案（活動・ごほうび・チェックリスト）', icon: '✨' },
		{ text: 'ごほうびのカスタマイズ', icon: '✅' },
		{ text: 'きょうだいランキング', icon: '✅' },
		{ text: 'ひとことメッセージ（自由テキスト）', icon: '✅' },
		{ text: 'データの永久保持', icon: '✅' },
		{ text: 'こどもの登録（無制限）', icon: '✅' },
	],
} as const;

/**
 * 料金ページ (/pricing) に表示する 1 プランの全メタ情報。
 * #765: プラン名・価格・CTA 等のハードコードを排除するため SSOT 化。
 *
 * - `name` / `shortDescription` は料金ページの見出し用。PLAN_LABELS との違いに注意：
 *   料金ページではブランディング観点で「フリー」を使うが、PLAN_LABELS は
 *   「無料プラン」を使う（#749 ブランドガイドライン §7.1 参照）。
 * - `price` / `unit` / `yearlyPrice` は表記揺れ防止のため文字列で持つ（#749 §7.2）。
 * - `ctaLabel` / `ctaHref` は CTA ボタン文言のハードコード禁止（#749 §7.3「無料体験」統一）。
 * - `recommended` = true のプランのみ `badge` が表示される（#749 §7.4）。
 */
export interface PricingPageMeta {
	id: PlanKey;
	name: string;
	price: string;
	unit: string;
	yearlyPrice?: string;
	shortDescription: string;
	ctaLabel: string;
	ctaHref: string;
	recommended: boolean;
	badge?: string;
}

export const PRICING_PAGE_META: Record<PlanKey, PricingPageMeta> = {
	free: {
		id: 'free',
		name: 'フリー',
		price: '¥0',
		unit: '',
		shortDescription: '基本機能で気軽にスタート。冒険体験は一切制限なし。',
		ctaLabel: '無料ではじめる',
		ctaHref: '/auth/signup',
		recommended: false,
	},
	standard: {
		id: 'standard',
		name: 'スタンダード',
		price: '¥500',
		unit: '/月',
		yearlyPrice: '年額 ¥5,000（2ヶ月分お得）',
		shortDescription: 'カスタマイズ自由自在。お子さまにぴったりの環境を。',
		ctaLabel: `${TRIAL_LABELS.durationDays}日間 ${ACTION_LABELS.freeTrial}`,
		ctaHref: '/auth/signup?plan=standard',
		recommended: true,
		badge: 'おすすめ',
	},
	family: {
		id: 'family',
		name: 'ファミリー',
		price: '¥780',
		unit: '/月',
		yearlyPrice: '年額 ¥7,800（2ヶ月分お得）',
		shortDescription: '全機能解放。きょうだいの成長をまとめて見守れます。',
		ctaLabel: `${TRIAL_LABELS.durationDays}日間 ${ACTION_LABELS.freeTrial}`,
		ctaHref: '/auth/signup?plan=family',
		recommended: false,
	},
} as const;

/**
 * 料金ページの機能リストを取得する薄いヘルパー。
 * Svelte の `$derived` 等からも呼びやすいよう値コピーで返さず定数を返す。
 */
export function getPricingFeatures(plan: PlanKey): readonly string[] {
	return PRICING_PAGE_FEATURES[plan];
}

/** 料金ページの 1 プランのメタ情報を取得 */
export function getPricingMeta(plan: PlanKey): PricingPageMeta {
	return PRICING_PAGE_META[plan];
}

/** 料金ページに表示する全プランのメタ情報を表示順で取得（free → standard → family） */
export function getPricingPagePlans(): readonly PricingPageMeta[] {
	return [PRICING_PAGE_META.free, PRICING_PAGE_META.standard, PRICING_PAGE_META.family];
}

/** 管理画面のプランハイライトを取得 */
export function getLicenseHighlights(plan: 'standard' | 'family'): readonly string[] {
	return LICENSE_PAGE_HIGHLIGHTS[plan];
}

/** アップグレード完了時の解放機能リストを取得 */
export function getUnlockedFeatures(plan: 'standard' | 'family'): readonly UnlockedFeatureItem[] {
	return PREMIUM_UNLOCKED_FEATURES[plan];
}
