// src/routes/ops/pmf-survey/+page.server.ts
// #1598 (ADR-0023 §3.6 §5 I7): PMF 判定アンケート集計ダッシュボード。
//
// 配信実績と回答集計を表示する ops 限定ページ。
// 認証は親 layout (`/ops/+layout.server.ts`) の Cognito ops group チェック。
//
// Query parameters:
//   round: YYYY-H1 / YYYY-H2 (default: current round)
//   q: 自由記述検索キーワード (Q2 ベネフィット / Q4 離脱要因 / tenantId に対する case-insensitive 部分一致、
//      最大 100 文字。AC12 Issue #1598 PO 承認 2026-04-29)

import {
	aggregateSurveyResponses,
	filterFreeTextByQuery,
	getCurrentRound,
} from '$lib/server/services/pmf-survey-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// クエリパラメータで round を上書き可能 (デフォルト: 現在 round)
	const requestedRound = url.searchParams.get('round');
	const round =
		requestedRound && /^\d{4}-H[12]$/.test(requestedRound) ? requestedRound : getCurrentRound();

	const rawAggregation = await aggregateSurveyResponses(round);

	// 自由記述検索 (AC12): Q2 / Q4 を q キーワードで絞り込み (最大 100 文字、DoS 抑制)
	const rawQuery = (url.searchParams.get('q') ?? '').trim();
	const searchQuery = rawQuery.length > 0 ? rawQuery.slice(0, 100) : '';

	const aggregation = searchQuery
		? {
				...rawAggregation,
				q2Texts: filterFreeTextByQuery(rawAggregation.q2Texts, searchQuery),
				q4Texts: filterFreeTextByQuery(rawAggregation.q4Texts, searchQuery),
			}
		: rawAggregation;

	// 過去 4 round 分の選択肢を生成 (現在 round + 過去 3)
	const availableRounds = buildAvailableRounds(round);

	return {
		aggregation,
		availableRounds,
		selectedRound: round,
		searchQuery,
		// 検索適用前のフルカウント (UI で「N 件中 M 件表示」を出すため)
		q2TotalCount: rawAggregation.q2Texts.length,
		q4TotalCount: rawAggregation.q4Texts.length,
	};
};

function buildAvailableRounds(currentRound: string): string[] {
	const match = currentRound.match(/^(\d{4})-H([12])$/);
	if (!match?.[1] || !match[2]) return [currentRound];
	let year = Number.parseInt(match[1], 10);
	let half = Number.parseInt(match[2], 10);
	const rounds: string[] = [];
	for (let i = 0; i < 6; i++) {
		rounds.push(`${year}-H${half}`);
		half = half === 1 ? 2 : 1;
		if (half === 2) year--;
	}
	return rounds;
}
