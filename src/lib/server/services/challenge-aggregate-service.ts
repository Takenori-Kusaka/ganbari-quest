// src/lib/server/services/challenge-aggregate-service.ts
//
// #1742: Challenge 事前集計サービス (PR #1696 analytics-aggregate と同パターン)
//
// EventBridge cron (gq-challenge-aggregator-daily / 03:30 JST = 18:30 UTC) から
// 呼び出され、当日時点の全テナントの `questionnaire_challenges` 設定値を 1 配列に
// 集計して DynamoDB の `PK=CHALLENGE_AGG#<YYYY-MM-DD>` に書き込む。
//
// 設計:
//   - cron は **当日 1 日分のスナップショット** を 1 日 1 回書く
//   - read 側 (`ops-analytics-service.fetchChallengesPerTenant`) は **直近の集計レコード**
//     を優先取得し、見つからない場合のみライブ集計 (settings repo を tenant ごと N+1) で fallback
//   - レコードは TTL 365 日で自動失効
//
// Pre-PMF (ADR-0010, ~100 テナント想定):
//   - 1 日あたり 1 レコード × 数百 tenant CSV ≒ 数 KB / レコード
//   - テナント数 1,000+ で N+1 GetItem の表示遅延が顕在化する想定
//   - 13-AWSサーバレス §6.x ops/analytics 節で「事前集計テーブル方式へ移行」と明記済み
//
// Idempotency:
//   - 同じ date を 2 回処理しても DynamoDB Put は同じキーで上書きされるため安全
//   - dryRun=true は実書込みを行わず計算結果だけを返す (smoke test 用)

import {
	type ChallengeDailyAggregate,
	putChallengeAggregate,
} from '$lib/analytics/providers/dynamo';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

export interface ChallengeAggregateRunResult {
	ok: boolean;
	targetDate: string;
	dryRun: boolean;
	totalTenants: number;
	challengesPerTenantCount: number;
	written: boolean;
	error: string | null;
}

export interface RunChallengeAggregationOptions {
	dryRun?: boolean;
	/** Override target date (UTC YYYY-MM-DD); default = 当日 (UTC 基準, スナップショット time-of-day 中立) */
	targetDate?: string;
}

/**
 * 当日 (UTC) の YYYY-MM-DD を返す
 *
 * 注: analytics-aggregate-service は前日分を集計するが、本 service は
 * 「設定値の現在スナップショット」が目的のため当日基準で書く (再計算しても結果は変わらない冪等性)。
 */
function defaultTargetDate(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * 全テナントの `questionnaire_challenges` 設定値を取得し、CSV 文字列の配列にする (#1742)。
 *
 * これは ops-analytics-service.fetchChallengesPerTenant のロジックと同一だが、cron で
 * 1 日 1 回だけ実行するためライブ画面では使わない (cron バッチ専用)。
 *
 * 失敗時は空配列 + error を返す (cron 全体は continue)。
 */
async function gatherChallengesPerTenant(): Promise<{
	totalTenants: number;
	challengesPerTenant: string[];
	error: string | null;
}> {
	const repos = getRepos();
	let tenants: Tenant[];
	try {
		tenants = await repos.auth.listAllTenants();
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		logger.error('[challenge-aggregate] Failed to list tenants', {
			service: 'challenge-aggregate',
			error,
		});
		return { totalTenants: 0, challengesPerTenant: [], error };
	}

	const challengesPerTenant: string[] = [];
	for (const t of tenants) {
		try {
			const value = await repos.settings.getSetting('questionnaire_challenges', t.tenantId);
			challengesPerTenant.push(value ?? '');
		} catch (e) {
			logger.warn('[challenge-aggregate] Failed to read questionnaire_challenges', {
				context: { tenantId: t.tenantId, error: e instanceof Error ? e.message : String(e) },
			});
			challengesPerTenant.push('');
		}
	}
	return { totalTenants: tenants.length, challengesPerTenant, error: null };
}

/**
 * 当日分の challenge 集計を計算して DynamoDB に書き込む (#1742)。
 *
 * cron Lambda (`/api/cron/challenge-aggregate`) から呼ばれる。
 * dryRun=true なら計算のみ実行し、書込みはスキップする。
 */
export async function runChallengeAggregation(
	options: RunChallengeAggregationOptions = {},
): Promise<ChallengeAggregateRunResult> {
	const dryRun = options.dryRun === true;
	const targetDate = options.targetDate ?? defaultTargetDate();

	const result: ChallengeAggregateRunResult = {
		ok: true,
		targetDate,
		dryRun,
		totalTenants: 0,
		challengesPerTenantCount: 0,
		written: false,
		error: null,
	};

	try {
		const gathered = await gatherChallengesPerTenant();
		result.totalTenants = gathered.totalTenants;
		result.challengesPerTenantCount = gathered.challengesPerTenant.length;
		if (gathered.error) {
			result.error = gathered.error;
			result.ok = false;
			return result;
		}

		const payload: ChallengeDailyAggregate = {
			date: targetDate,
			challengesPerTenant: gathered.challengesPerTenant,
			totalTenants: gathered.totalTenants,
		};

		if (!dryRun) {
			const putRes = await putChallengeAggregate(targetDate, payload);
			result.written = putRes.ok;
			if (!putRes.ok && putRes.error) {
				result.error = putRes.error;
				result.ok = false;
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		result.error = message;
		result.ok = false;
		logger.error('[challenge-aggregate] aggregation failed', {
			service: 'challenge-aggregate',
			error: message,
		});
	}

	return result;
}
