// src/routes/ops/pmf-survey/+page.server.ts
// #1598 (ADR-0023 §3.6 §5 I7): PMF 判定アンケート集計ダッシュボード。
//
// 配信実績と回答集計を表示する ops 限定ページ。
// 認証は親 layout (`/ops/+layout.server.ts`) の Cognito ops group チェック。

import { aggregateSurveyResponses, getCurrentRound } from '$lib/server/services/pmf-survey-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// クエリパラメータで round を上書き可能 (デフォルト: 現在 round)
	const requestedRound = url.searchParams.get('round');
	const round =
		requestedRound && /^\d{4}-H[12]$/.test(requestedRound) ? requestedRound : getCurrentRound();

	const aggregation = await aggregateSurveyResponses(round);

	// 過去 4 round 分の選択肢を生成 (現在 round + 過去 3)
	const availableRounds = buildAvailableRounds(round);

	return {
		aggregation,
		availableRounds,
		selectedRound: round,
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
