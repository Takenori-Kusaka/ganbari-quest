// src/lib/server/services/optional-write-alert.ts
// EPIC #3424 / 実装 #3550 ① / 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#11
//
// optional 書込 (combo / mission / challenge / certificate / special_reward / 通知) の
// 欠落観測カウンタの service 層 bind。db 層 (optional-write-guard.ts) は analytics /
// logger に依存しない (層分離) ため、onFailure の実体はここで結線する:
//
//   1. `logger.error` — structured context (kind / name / childId / tenantId / cause)。
//      CloudWatch Logs Insights で `filter context.kind = "optional-write-failed"` query 可能。
//   2. `sendDiscordAlert` — fire-and-forget (stripe/alert.ts と同 pattern)。alert 失敗は
//      記録フローをブロックしない。throttle は discord-alert.ts 側が担う。
//
// fitness#14 (total_point 突合) は「行が書かれない欠落」を drift=0 で検出できないため、
// 本カウンタが欠落率の唯一の可観測点になる (§13.1 fitness#11)。silent swallow 禁止。

import type { OptionalWriteFailureHandler } from '$lib/server/db/dsql/optional-write-guard';
import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';

export interface OptionalWriteAlertContext {
	childId: string;
	tenantId: string;
}

/**
 * runOptionalWrite に渡す onFailure handler を生成する (fitness#11 counter emitter)。
 * handler 自体は同期 signature (`(name, error) => void`) のため Discord 通知は
 * fire-and-forget で起動する。
 */
export function createOptionalWriteFailureHandler(
	ctx: OptionalWriteAlertContext,
): OptionalWriteFailureHandler {
	return (name, error) => {
		const cause = error instanceof Error ? error.message : String(error);

		// 1. structured logger (検索 key: context.kind / context.name)
		logger.error(`[optional-write] ${name} の optional 書込が欠落 (core commit 済、fitness#11)`, {
			tenantId: ctx.tenantId,
			service: 'activity-record',
			context: {
				kind: 'optional-write-failed',
				name,
				childId: ctx.childId,
				cause,
			},
		});

		// 2. Discord alert (fire-and-forget、記録フローをブロックしない)
		void sendDiscordAlert({
			level: 'error',
			message: `[optional-write-failed] ${name} (recordActivity optional 欠落)`,
			// #4192: tenantId / childId は Discord に載せない (#4174 Q3)。上の logger.error が保持する。
			errorSummary: cause,
		}).catch((err) => {
			// alert 自体の失敗は logger.warn に留める (recursive alert を避ける)
			logger.warn(`[optional-write] Discord alert dispatch failed for ${name}: ${String(err)}`);
		});
	};
}
