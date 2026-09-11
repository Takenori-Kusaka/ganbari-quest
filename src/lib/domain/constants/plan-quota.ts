// src/lib/domain/constants/plan-quota.ts
// フリープランの「登録件数上限」の値 SSOT (#4655 / #4657 / #4660、EPIC #4650)。
//
// 背景:
//   上限 (お子さま 2 人 / 活動 3 件 / チェックリスト 1 子あたり 3 件) は `plan-limit-service.ts` の
//   PLAN_LIMITS.free に実装値として存在するが、server 専用 module のため domain 層
//   (terms.ts / labels.ts のページガイド文言) から参照できず、ガイドは上限に触れないか数値を
//   直書きするしかなかった。数値を直書きすると PLAN_LIMITS を変えた瞬間にガイドが古い上限を
//   案内し続ける (ADR-0013 と同じ「表示が実装と食い違う」形)。
//   本ファイルを値の唯一の定義とし、実装 (plan-limit-service) と表示 (labels.ts ページガイド) の
//   両方がここから引く (plan-retention.ts #4477 / plan-tier.ts #3963 と同型)。
//
// 置き場所の判断:
//   labels.ts / terms.ts は domain 層であり `$lib/server/**` を import できない。
//   plan-limit-service.ts は server 専用 module。値を domain leaf に降ろし、server 側が import する。

/**
 * フリープランの登録件数上限。**この 3 つの数値がプロダクト全体の SSOT**。
 * 表示文字列側に数値を複製しないこと (ガイド文言は `${FREE_PLAN_QUOTA.maxActivities}` 等で参照する)。
 */
export const FREE_PLAN_QUOTA = {
	/** 登録できるお子さまの人数 */
	maxChildren: 2,
	/** 親が作成できる活動の件数 (PLAN_LIMITS.free.maxActivities) */
	maxActivities: 3,
	/** お子さま 1 人あたりのチェックリスト件数 (PLAN_LIMITS.free.maxChecklistTemplates、#723) */
	maxChecklistTemplates: 3,
} as const;
