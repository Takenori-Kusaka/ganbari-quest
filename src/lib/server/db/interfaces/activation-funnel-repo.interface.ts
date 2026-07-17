// src/lib/server/db/interfaces/activation-funnel-repo.interface.ts
// EPIC #3424 / #3805: on-demand activation funnel repo 抽象。
//
// 分析基盤の on-demand DSQL 化 (#3805)。従来 DynamoDB に continuous 収集していた
// activation funnel イベントを撤去し、main data (families / children / activity_logs) から
// **必要時に単一集約 SQL で導出**する read-only 抽象。常設収集 / cron / dashboard は持たない。
//
// cross-tenant 集計: signup 起点コホート (families.created_at >= since) を横断走査する
// PO KPI 分析用途 (cancellation-reason-repo.aggregateRecent / searchFreeText と同じ §11.2
// 例外クラス)。フルスキャンではなく created_at range + 単一 GROUP BY 集約 (ADR-0065 整合、
// N+1 禁止)。on-demand ゆえ常時コストは 0。

/** activation funnel の各段の家庭 (tenant) 件数。cohort 起点で段階的に絞り込まれる。 */
export interface ActivationFunnelCounts {
	/** ① signup: since 以降に登録した家庭数 (cohort size)。 */
	signupCount: number;
	/** ② 初回家庭メンバー登録: cohort のうち子供を 1 人以上持つ家庭数。 */
	firstChildCount: number;
	/** ③ 初回活動完了: cohort のうち非取消の活動記録が 1 件以上ある家庭数。 */
	firstActivityCount: number;
	/** ④ N 日継続 (retention): cohort のうち signup から retentionDays 以内に活動した家庭数。 */
	retained7dCount: number;
}

export interface IActivationFunnelRepo {
	/**
	 * signup 起点コホート (families.created_at >= sinceIso) の activation funnel 件数を
	 * **単一集約 SQL** で返す (ADR-0065: N+1 禁止 / on-demand ゆえ常時コスト 0)。
	 *
	 * @param sinceIso コホート起点 (ISO8601 UTC)。この時刻以降に登録した家庭のみを cohort とする。
	 * @param retentionDays retention 判定窓 (日)。signup から本日数以内の活動があれば retained。
	 */
	getActivationFunnelCounts(
		sinceIso: string,
		retentionDays: number,
	): Promise<ActivationFunnelCounts>;
}
