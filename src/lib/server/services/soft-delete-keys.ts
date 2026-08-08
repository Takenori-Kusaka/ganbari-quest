// src/lib/server/services/soft-delete-keys.ts
// #4338: 物理削除の途中で残す `settings` キーの SSOT (leaf module。同じく leaf の
// marketing-suppression-keys.ts 以外に依存しない)。
//
// 定義をここに置くのは import cycle を避けるためである。判定側 (grace-period-service) と
// 削除側 (tenant-cleanup-service) の両方がこの値を要るが、grace-period-service は
// account-deletion-service → tenant-cleanup-service を辿るため、tenant-cleanup が
// grace-period から import すると循環する。値だけを leaf に置けば両者が同じ 1 本を見られる。

import { getMarketingSuppressionKeys } from './marketing-suppression-keys';

/**
 * soft-delete の**判定材料**となる settings キー。
 *
 * `getGracePeriodStatus` はこの 3 キーだけを読んで「削除予約中か / いつ消してよいか」を決める。
 * **定義を 1 本に保つことが目的**で、判定キーを増やしたのに削除側の除外リストを直し忘れて
 * 判定材料ごと消してしまう (= #4327 の宙吊り行を再生産する) 経路を構造的に作れなくする。
 *
 * 逆向き (削除側にだけ足す) の漏れは起こらない。削除は「残すキー以外を全部消す」
 * 反転方式であり、新しいキーは何もしなくても削除対象に入るため。
 */
export const GRACE_PERIOD_JUDGMENT_KEYS = [
	'soft_deleted_at',
	'deletion_grace_plan_tier',
	'physical_deletion_date',
] as const;

/**
 * 物理削除の途中で**最後まで残さなければならない** settings キー (#4338)。
 *
 * 2 種類ある。どちらも「families 行は残っているのに settings だけ消えた」中間状態
 * (= 後続ステップが失敗したときにできる、この削除順序が存在する理由そのものの窓) で
 * 顧客に実害が出るものである。
 *
 * 1. **判定材料** ({@link GRACE_PERIOD_JUDGMENT_KEYS}) — 消すと再削除も復元もできない宙吊り行になる
 * 2. **配信抑止記録** ({@link getMarketingSuppressionKeys}) — 消すと、退会を申し出て配信停止まで
 *    していた家族が翌日の lifecycle-emails cron に拾われ、販促メールの送信対象に戻る
 *
 * ## これらが最終的に消える場所
 *
 * `families` 行を消した**後**の {@link deleteTenantSettings} (settings 全削除) で消える。
 * その最終ステップ自体が失敗した場合だけ、本リストのキーが孤児として残る。残るのは
 * 日時・プラン名・送信回数だけで、メールアドレスも認証情報も子供の情報も含まないため、
 * #4338 が潰そうとしている「孤児に機微情報が残る」には当たらない (許容する)。
 *
 * @param now 現在時刻 (年カウンタのキー解決に使う。テスト用に注入可能)
 */
export function getSettingsKeysToKeepDuringDeletion(now: Date = new Date()): readonly string[] {
	return [...GRACE_PERIOD_JUDGMENT_KEYS, ...getMarketingSuppressionKeys(now)];
}
