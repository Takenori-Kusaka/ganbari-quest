// src/lib/server/services/soft-delete-keys.ts
// #4338: soft-delete の判定材料となる `settings` キーの SSOT (依存を持たない leaf module)。
//
// 定義をここに置くのは import cycle を避けるためである。判定側 (grace-period-service) と
// 削除側 (tenant-cleanup-service) の両方がこの値を要るが、grace-period-service は
// account-deletion-service → tenant-cleanup-service を辿るため、tenant-cleanup が
// grace-period から import すると循環する。値だけを leaf に置けば両者が同じ 1 本を見られる。

/**
 * soft-delete の**判定材料**となる settings キー。
 *
 * `getGracePeriodStatus` はこの 3 キーだけを読んで「削除予約中か / いつ消してよいか」を決める。
 * 同じ配列を物理削除の「残すキー」にも使う (`deleteTenantSettingsExceptJudgmentKeys`)。
 * **定義を 1 本に保つことが目的**で、判定キーを増やしたのに削除側の除外リストを直し忘れて
 * 判定材料ごと消してしまう (= #4327 の宙吊り行を再生産する) 経路を構造的に作れなくする。
 *
 * 逆向き (削除側にだけ足す) の漏れは起こらない。削除は「ここに挙げたキー以外を全部消す」
 * 反転方式であり、新しいキーは何もしなくても削除対象に入るため。
 */
export const GRACE_PERIOD_JUDGMENT_KEYS = [
	'soft_deleted_at',
	'deletion_grace_plan_tier',
	'physical_deletion_date',
] as const;
