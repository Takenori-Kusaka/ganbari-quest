// src/lib/server/cron/time-budget.ts
// #3695: cron ジョブの 30 秒 self-limiting + 持ち越し規約の実装ヘルパ。
//
// 全 cron ジョブの実処理は EventBridge → cron-dispatcher → HTTP POST → アプリ Lambda
// (timeout 30 秒) 上で走るため、dispatcher 側の timeout (5 分) は救済にならず
// 全ジョブが実質 30 秒制約下にある。処理量がデータ量に比例するジョブは本ヘルパで
// 「予算内に処理できた分だけ処理し、残りは次回実行に持ち越す」。
// 規約 SSOT: docs/design/13-AWSサーバレスアーキテクチャ設計書.md §3.3
// 「Cron ジョブ実行時間予算」。

/**
 * cron ジョブが item ループで消費してよい既定時間予算 (20 秒)。
 *
 * アプリ Lambda timeout 30 秒から、認証 / 前処理 I/O / 処理中 item の完走 /
 * レスポンス直列化のヘッドルーム 10 秒を差し引いた値。予算超過チェックは
 * item 間 (ループ先頭) で行い、処理中の item は中断しない。
 */
export const CRON_TIME_BUDGET_MS = 20_000;

/** {@link createTimeBudget} が返す時間予算トラッカー。 */
export interface TimeBudget {
	/** 予算を使い切ったら true。item ループの先頭で確認する。 */
	exceeded(): boolean;
	/** 開始からの経過 ms (持ち越しログ用)。 */
	elapsedMs(): number;
}

/**
 * 時間予算トラッカーを生成する。cron endpoint 起動直後に 1 つ作り、
 * service 層の item ループへ渡す。テストでは fake 実装
 * (`{ exceeded: () => true, elapsedMs: () => 0 }`) を注入して予算超過経路を検証する。
 */
export function createTimeBudget(budgetMs: number = CRON_TIME_BUDGET_MS): TimeBudget {
	const start = Date.now();
	return {
		exceeded: () => Date.now() - start >= budgetMs,
		elapsedMs: () => Date.now() - start,
	};
}
