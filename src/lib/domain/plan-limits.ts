// src/lib/domain/plan-limits.ts
// プラン別の上限・機能フラグ表 (`PLAN_LIMITS`) の SSOT。
//
// # なぜ domain leaf に置くか (#4704)
//
// 上限値そのものは **環境にも DB にも依存しない純粋な表**である。にもかかわらず長らく
// `server/services/plan-limit-service.ts` に置かれていたため、「上限値を 1 つ読みたいだけ」の
// 呼び手が service 層ごと引き込むことになっていた。実害が 2 つ同時に出た:
//
//   1. **循環依存**: `db/dsql/invite-accept.ts` → `services/plan-limit-service.ts` →
//      `db/factory.ts` → `db/dsql/auth-repo.ts` → `db/dsql/invite-accept.ts`
//      (dependency-cruiser `no-circular` が 6 件 error)
//   2. **`$app` の CLI 流入**: service は `server/debug-plan.ts` 経由で `$app/environment` を
//      import する。SvelteKit の外 (tsx で動く NUC cutover CLI) から repo 層を読むと
import { SUBSCRIPTION_PLAN, type SubscriptionPlan } from './constants/subscription-plan';
//      `Cannot find package '$app'` で落ちる
//
// 値の表は依存を持たない葉なので、ここに置けば「上限を知りたいだけ」の層は service を
// 経由しなくてよい。再発は `.dependency-cruiser.cjs` の `db-no-services` が機械で止める。
//
// tier の解決 (trial / debug plan / セルフホスト等、環境に依存する判断) は従来どおり
// `plan-limit-service.ts` の責務であり、ここには置かない。

import { FAMILY_MEMBER_LIMIT } from './constants/family-member-limit';
import { FREE_PLAN_QUOTA } from './constants/plan-quota';
import { PLAN_HISTORY_RETENTION_DAYS } from './constants/plan-retention';
import type { PlanTier } from './constants/plan-tier';
import { isCustomRewardUnlocked } from './custom-reward-gate';
import { isFreeTextMessageUnlocked } from './free-text-message-gate';

export interface PlanLimits {
	maxChildren: number | null; // null = 無制限
	maxActivities: number | null;
	maxChecklistTemplates: number | null; // 1子あたりのチェックリストテンプレート数 (#723)
	maxFamilyMembers: number | null; // null = 無制限, 招待によるメンバー上限（owner含む） (#1111)
	historyRetentionDays: number | null;
	canExport: boolean;
	canFreeTextMessage: boolean; // 自由テキストメッセージ（PLAN_LABELS.family 限定）
	/**
	 * 特別なごほうび設定（スタンダード以上、#728）。
	 *
	 * #4584: 値は `isCustomRewardUnlocked` から導出する。旧実装はここに真偽値を直書きし、
	 * 実際の拒否は admin/rewards が `isPaidTier` を直接呼んでいたため、**このフラグは
	 * 誰にも読まれていなかった** (参照ゼロ)。フラグと実装が別々の真実になっていた。
	 */
	canCustomReward: boolean;
	canSiblingRanking: boolean; // きょうだいランキング（PLAN_LABELS.family 限定） #782
	maxCloudExports: number; // クラウド保管の同時保管数上限
}

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
	free: {
		// 値の SSOT は domain/constants/plan-quota.ts (ページガイドの上限表示も同じ定数から引く、#4655)
		maxChildren: FREE_PLAN_QUOTA.maxChildren,
		maxActivities: FREE_PLAN_QUOTA.maxActivities,
		// #723: Free は pricing で「チェックリスト（テンプレート）」と表記。
		// 現状 preset テンプレ機構がないため、maxActivities と同様に「少数で自由作成可」に寄せ、
		// 1子あたり 3 テンプレまでに制限（朝/昼/夜 の 3 枠想定）。
		maxChecklistTemplates: FREE_PLAN_QUOTA.maxChecklistTemplates,
		// #1111: フリープランは招待不可（owner のみ）
		maxFamilyMembers: FAMILY_MEMBER_LIMIT.free,
		// 値の SSOT は domain/constants/plan-retention.ts (LP / 機能リストの表示も同じ定数から引く、#4477)
		historyRetentionDays: PLAN_HISTORY_RETENTION_DAYS.free,
		canExport: false,
		// #4504: 値は述語 SSOT から導出する (定義だけで参照ゼロのデッド設定だった)
		canFreeTextMessage: isFreeTextMessageUnlocked('free'),
		canCustomReward: isCustomRewardUnlocked('free'),
		canSiblingRanking: false,
		maxCloudExports: 0,
	},
	standard: {
		maxChildren: null,
		maxActivities: null,
		maxChecklistTemplates: null,
		// #1111: スタンダードは owner + 3人 = 計4人まで（核家族想定）
		// #4500: 数値の SSOT は domain leaf。LP / labels もここから引く
		maxFamilyMembers: FAMILY_MEMBER_LIMIT.standard,
		historyRetentionDays: PLAN_HISTORY_RETENTION_DAYS.standard,
		canExport: true,
		canFreeTextMessage: isFreeTextMessageUnlocked('standard'),
		canCustomReward: isCustomRewardUnlocked('standard'),
		canSiblingRanking: false,
		maxCloudExports: 3,
	},
	family: {
		maxChildren: null,
		maxActivities: null,
		maxChecklistTemplates: null,
		// #1111: PLAN_LABELS.family は無制限
		maxFamilyMembers: FAMILY_MEMBER_LIMIT.family,
		historyRetentionDays: PLAN_HISTORY_RETENTION_DAYS.family,
		canExport: true,
		canFreeTextMessage: isFreeTextMessageUnlocked('family'),
		canCustomReward: isCustomRewardUnlocked('family'),
		canSiblingRanking: true,
		maxCloudExports: 10,
	},
};

/** プラン別制限を取得 */
export function getPlanLimits(tier: PlanTier): PlanLimits {
	return PLAN_LIMITS[tier];
}

/**
 * 課金中 (licenseStatus=ACTIVE) のテナントの plan 値を tier に畳む。
 *
 * `plan` は Stripe 上の課金プラン値 (`standard_monthly` / `family_yearly` 等) なので、
 * monthly / yearly を同じ tier に畳む判断がここに要る。`resolvePlanTier` (service) と
 * 受諾 txn の両方が同じ規則を読む — 旧実装は両方に `startsWith('family')` を書いており、
 * 片方だけ直せば静かにずれた。
 */
export function resolvePaidPlanTier(planId: string | null | undefined): PlanTier {
	if (planId && Object.hasOwn(PAID_PLAN_TIER, planId)) {
		return PAID_PLAN_TIER[planId as SubscriptionPlan];
	}
	// 表に無い値 (旧 Stripe 語彙 / 欠落)。黙って写像せず既定 tier に倒す規則をここに閉じる。
	return FALLBACK_PAID_TIER;
}

/**
 * 課金プラン値 → tier の写像 (#4505 GAMMA2-PLANKEY-03 / 05)。
 *
 * `Record<SubscriptionPlan, PlanTier>` なので **プラン値を足すとここがコンパイルエラーになり**、
 * 新しい語彙 (将来の 'premium' 等) が黙って standard に降格することが構造的に起きない
 * (旧実装は `startsWith('family')` の接頭辞一致で、'lifetime' も将来の値も無言で standard だった)。
 *
 * `lifetime` (買い切り) の tier は PO 判断待ち: 現行挙動 (standard) を **明示して** 維持する。
 * 変えるときはこの 1 行だけを直す。
 */
const PAID_PLAN_TIER: Record<SubscriptionPlan, PlanTier> = {
	[SUBSCRIPTION_PLAN.MONTHLY]: 'standard',
	[SUBSCRIPTION_PLAN.YEARLY]: 'standard',
	[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]: 'family',
	[SUBSCRIPTION_PLAN.FAMILY_YEARLY]: 'family',
	[SUBSCRIPTION_PLAN.LIFETIME]: 'standard',
};

/** 表に無い plan 値 (旧語彙 / 欠落) の既定。課金中 (ACTIVE) の顧客なので free には落とさない。 */
const FALLBACK_PAID_TIER: PlanTier = 'standard';
