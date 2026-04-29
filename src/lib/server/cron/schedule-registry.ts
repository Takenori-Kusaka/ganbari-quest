// src/lib/server/cron/schedule-registry.ts
// #1375: cron ジョブ定義の SSOT
//
// NUC scheduler コンテナ (scripts/scheduler.ts) と AWS EventBridge (#1376) の
// 両方がここを参照することで、スケジュール定義の二重管理を防ぐ。
//
// cronExpression は Asia/Tokyo タイムゾーンで解釈される（コンテナ TZ=Asia/Tokyo）。
// AWS EventBridge は UTC 固定のため、Sub A-2 (#1376) 実装時に utcExpression も参照すること。

export interface CronJob {
	/** ジョブ識別名（ログ・監視用） */
	name: string;
	/** 呼び出す SvelteKit cron エンドポイントのパス */
	endpoint: string;
	/** cron 式（Asia/Tokyo）*/
	cronExpression: string;
	/** AWS EventBridge 用 UTC cron 式（"cron(分 時 日 月 ? 年)" 形式）*/
	utcCronExpression: string;
	/** 概要説明 */
	description: string;
}

export const scheduleRegistry: CronJob[] = [
	{
		name: 'license-expire',
		endpoint: '/api/cron/license-expire',
		cronExpression: '0 0 * * *', // 毎日 00:00 JST
		utcCronExpression: 'cron(0 15 * * ? *)', // 毎日 15:00 UTC = 翌日 00:00 JST
		description: 'ライセンスキー期限切れ自動失効バッチ (#821)',
	},
	{
		name: 'retention-cleanup',
		endpoint: '/api/cron/retention-cleanup',
		cronExpression: '0 1 * * *', // 毎日 01:00 JST
		utcCronExpression: 'cron(0 16 * * ? *)', // 毎日 16:00 UTC = 翌日 01:00 JST
		description: '保存期間超過データの自動削除バッチ (#717, #729)',
	},
	{
		name: 'trial-notifications',
		endpoint: '/api/cron/trial-notifications',
		cronExpression: '0 9 * * *', // 毎日 09:00 JST
		utcCronExpression: 'cron(0 0 * * ? *)', // 毎日 00:00 UTC = 09:00 JST
		description: 'トライアル終了通知バッチ (#737)',
	},
	{
		name: 'age-recalc',
		endpoint: '/api/cron/age-recalc',
		cronExpression: '0 0 * * *', // 毎日 00:00 JST
		utcCronExpression: 'cron(0 15 * * ? *)', // 毎日 15:00 UTC = 翌日 00:00 JST
		description: '子供の年齢自動インクリメント (#1381)',
	},
	{
		name: 'lifecycle-emails',
		endpoint: '/api/cron/lifecycle-emails',
		cronExpression: '30 9 * * *', // 毎日 09:30 JST
		utcCronExpression: 'cron(30 0 * * ? *)', // 毎日 00:30 UTC = 09:30 JST
		description: '期限切れ前リマインド + 休眠復帰メール (#1601, ADR-0023 I11)',
	},
	{
		name: 'grace-period-deletion',
		endpoint: '/api/cron/grace-period-deletion',
		cronExpression: '0 2 * * *', // 毎日 02:00 JST
		utcCronExpression: 'cron(0 17 * * ? *)', // 毎日 17:00 UTC = 翌日 02:00 JST
		description:
			'グレースピリオド期限切れテナントの物理削除バッチ (#1648 R43, grace-period-service.ts)',
	},
	{
		name: 'pmf-survey',
		endpoint: '/api/cron/pmf-survey',
		// 6/1 と 12/1 の 09:00 JST のみ起動する (年 2 回)。
		// pmf-survey-service は (tenantId × round) で重複送信ガードを持つため、
		// 万が一同じ日に複数回起動しても 2 通目は送らない。
		cronExpression: '0 9 1 6,12 *', // 6/1 と 12/1 の 09:00 JST
		utcCronExpression: 'cron(0 0 1 6,12 ? *)', // 6/1 と 12/1 の 00:00 UTC = 09:00 JST
		description: 'PMF 判定アンケート (Sean Ellis Test) 年 2 回配信 (#1598, ADR-0023 I7)',
	},
	{
		// #1693 (#1639 follow-up): /admin/analytics の DynamoDB 集計負荷削減のため、
		// 前日分の activation funnel + cancellation reason を 1 日 1 回事前集計し、
		// `PK=ANALYTICS_AGG#<date>` に書き込む (TTL 365 日)。read 側 (analytics-service) は
		// 集計レコードを優先取得し、無い分のみライブ計算で補う設計。
		name: 'analytics-aggregator-daily',
		endpoint: '/api/cron/analytics-aggregate',
		cronExpression: '0 3 * * *', // 毎日 03:00 JST
		utcCronExpression: 'cron(0 18 * * ? *)', // 毎日 18:00 UTC = 翌日 03:00 JST
		description: 'analytics 事前集計バッチ (#1693, #1639 follow-up — Pre-PMF 移行用)',
	},
];
