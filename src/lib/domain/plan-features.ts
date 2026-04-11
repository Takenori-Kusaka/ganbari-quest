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
		'チェックリスト（テンプレート）',
		'90日間の履歴保持',
	],
	standard: [
		'お子さまの登録人数：無制限',
		'オリジナル活動の作成：無制限',
		'AI による活動提案',
		'活動アイコンの変更',
		'チェックリスト自由作成',
		'カスタム報酬設定',
		'おうえんスタンプ（全種類）',
		'週次メールレポート',
		'データエクスポート（JSON）',
		'1年間の履歴保持',
		'メール優先サポート',
	],
	family: [
		'スタンダードの全機能',
		'AI による活動提案',
		'月次比較レポート',
		'きょうだいランキング',
		'ひとことメッセージ（自由テキスト）',
		'無制限の履歴保持',
		'メール優先サポート（24時間以内応答）',
	],
} as const;

// 注: ひとことメッセージ（自由テキスト）は #772 の修正としてこの SSOT の
// family プランに含めている。既存のページ側（+page.svelte）の並行実装にも
// 同項目が含まれるようにマージ時は注意すること。

/**
 * 管理画面のプラン選択カード（/admin/license/+page.svelte）に表示する
 * 短い機能ハイライトリスト。料金ページよりも簡潔な 4〜5 項目に絞る。
 */
export const LICENSE_PAGE_HIGHLIGHTS: Record<'standard' | 'family', readonly string[]> = {
	standard: [
		'子供の登録数 無制限',
		'カスタム活動 無制限',
		'データ保持 1年間',
		'データエクスポート対応',
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
		{ text: 'ごほうびのカスタマイズ', icon: '✅' },
		{ text: '詳細な月次レポート', icon: '✅' },
		{ text: '1年間のデータ保持', icon: '✅' },
	],
	family: [
		{ text: 'オリジナル活動の追加（無制限）', icon: '✅' },
		{ text: 'チェックリストの自由作成', icon: '✅' },
		{ text: 'ごほうびのカスタマイズ', icon: '✅' },
		{ text: 'きょうだいランキング', icon: '✅' },
		{ text: 'ひとことメッセージ（自由テキスト）', icon: '✅' },
		{ text: 'データの永久保持', icon: '✅' },
		{ text: 'こどもの登録（無制限）', icon: '✅' },
	],
} as const;

/**
 * 料金ページの機能リストを取得する薄いヘルパー。
 * Svelte の `$derived` 等からも呼びやすいよう値コピーで返さず定数を返す。
 */
export function getPricingFeatures(plan: PlanKey): readonly string[] {
	return PRICING_PAGE_FEATURES[plan];
}

/** 管理画面のプランハイライトを取得 */
export function getLicenseHighlights(plan: 'standard' | 'family'): readonly string[] {
	return LICENSE_PAGE_HIGHLIGHTS[plan];
}

/** アップグレード完了時の解放機能リストを取得 */
export function getUnlockedFeatures(plan: 'standard' | 'family'): readonly UnlockedFeatureItem[] {
	return PREMIUM_UNLOCKED_FEATURES[plan];
}
