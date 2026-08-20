// src/lib/server/cron/schedule-registry.ts
// #1375: cron ジョブ定義の SSOT
//
// NUC scheduler コンテナ (scripts/scheduler.ts) と AWS EventBridge (#1376) の
// 両方がここを参照することで、スケジュール定義の二重管理を防ぐ。
//
// cronExpression は Asia/Tokyo タイムゾーンで解釈される（コンテナ TZ=Asia/Tokyo）。
// AWS EventBridge は UTC 固定のため、Sub A-2 (#1376) 実装時に utcExpression も参照すること。
//
// 新規 cron ジョブ追加 checklist (#3695、規約 SSOT: 13-AWS設計書 §3.3「Cron ジョブ実行時間予算」):
//   1. 【30 秒予算】全 cron の実処理は Function URL 経由でアプリ Lambda (timeout 30 秒) 上で
//      走る。dispatcher の timeout (5 分) は「504 を待つだけ」で救済にならない — 30 秒予算で
//      設計すること (「cron だから長く走れる」前提は誤り)。
//   2. 【self-limiting + 持ち越し】処理量がデータ量 (テナント数 / pending 件数等) に比例する
//      ジョブは、1 回の実行で処理する量に件数上限 + 時間予算 ($lib/server/cron/time-budget.ts
//      createTimeBudget) を設け、残りは次回実行に持ち越す。持ち越し件数は log + レスポンスで
//      必ず報告する (silent 持ち越し禁止)。
//      **テナント単位の上限は `$lib/server/cron/tenant-slice.ts` の `selectTenantSlice` を使う**
//      (#4682)。`tenants.slice(0, limit)` は上限超過分が永久に処理されないのに「次回へ持ち越し」と
//      log に書く嘘になる。前例: cloud-export-service.drainPendingExports /
//      grace-period-service.purgeExpiredSoftDeletedTenants /
//      age-recalc-service.recalcAllChildrenAges (処理済みが消えないジョブで「同じ先頭 N 件」を
//      繰り返さないための、実行日から決まる決定的スライス周回の例)。
//   3. 【並行登録】KNOWN_ENDPOINTS (infra/lambda/cron-dispatcher/index.ts) + CRON_JOBS
//      (infra/lib/compute-stack.ts) にも登録し、13-AWS設計書 §3.3 の Cron ジョブ一覧表を更新
//      (tests/unit/cron/schedule-consistency.test.ts が整合検証)。

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

// Epic #2525 Phase 7 PR-L3 (#2818): license key 全廃に伴い `license-expire` ジョブを撤去。
// 期限管理は `customer.subscription.deleted` webhook (Phase 5 archive 機構) に代替。
export const scheduleRegistry: CronJob[] = [
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
		// #2399: 猶予期間中のテナントへ「データ削除予定日」を 1 度だけ予告する。
		// 他の日次 cron が 09:00 / 09:30 に寄っているため 10:00 にずらし、30 秒予算の食い合いを避ける。
		name: 'deletion-warning-emails',
		endpoint: '/api/cron/deletion-warning-emails',
		cronExpression: '0 10 * * *', // 毎日 10:00 JST
		utcCronExpression: 'cron(0 1 * * ? *)', // 毎日 01:00 UTC = 10:00 JST
		description: 'アカウント削除予告メール (#2399, deletion-warning-service.ts)',
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
		// #3504 (async-backup-export.md §3.2): クラウドエクスポートの背景 build。
		// status='pending' を拾って ZIP 生成 → S3/FS 保存 → 'ready' に遷移する。
		// 起票からの体感待ち時間を短くするため 5 分毎に回す。
		name: 'export-build',
		endpoint: '/api/cron/export-build',
		cronExpression: '*/5 * * * *', // 5 分毎 (JST)
		utcCronExpression: 'cron(0/5 * * * ? *)', // 5 分毎 (UTC、JST と同一間隔)
		description: 'クラウドエクスポート非同期 build バッチ (#3504)',
	},
	{
		// #3959: Stripe webhook が Lambda に到達していない (沈黙) を外から検知する。
		// 検知遅延 1 時間以内という要件から毎時実行。毎時 5 分に寄せているのは、他の日次 cron が
		// 00 分に集中しており同時実行で 30 秒予算を圧迫するのを避けるため。
		name: 'stripe-webhook-delivery-check',
		endpoint: '/api/cron/stripe-webhook-delivery-check',
		cronExpression: '5 * * * *', // 毎時 5 分 (JST)
		utcCronExpression: 'cron(5 * * * ? *)', // 毎時 5 分 (UTC、JST と同一間隔)
		description: 'Stripe webhook 未達の検知バッチ (#3959)',
	},
	{
		// #4682 F3: 30 日以上 pending の交換申請を expired に移す。旧実装は registry に載らず
		// どの runtime でもスケジュールされていなかったため、子供のごほうびが「うけとりまち」の
		// まま無期限に残り、履歴の「きげんぎれ」ラベルが到達不能だった。
		// 他の日次 cron が 00 / 30 分に寄っているため 03:00 にずらし、30 秒予算の食い合いを避ける。
		name: 'expire-redemptions',
		endpoint: '/api/cron/expire-redemptions',
		cronExpression: '0 3 * * *', // 毎日 03:00 JST
		utcCronExpression: 'cron(0 18 * * ? *)', // 毎日 18:00 UTC = 翌日 03:00 JST
		description: '30 日超の未処理ごほうび交換申請を期限切れにするバッチ (#1337 / #4682)',
	},
];
