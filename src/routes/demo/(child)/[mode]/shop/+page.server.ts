// #2097: demo ショップタブ (PO 8 回目指摘の構造的修正)
// 本番 `src/routes/(child)/[uiMode=uiMode]/shop/+page.server.ts` と同じ shape を返す。
// rewards は marketplace `*-rewards.json` から age mode 別に load。

import { fail } from '@sveltejs/kit';
import elementaryRewards from '$lib/data/marketplace/reward-sets/elementary-rewards.json' assert { type: 'json' };
import experienceRewards from '$lib/data/marketplace/reward-sets/experience-rewards.json' assert { type: 'json' };
import foodRewards from '$lib/data/marketplace/reward-sets/food-rewards.json' assert { type: 'json' };
import juniorRewards from '$lib/data/marketplace/reward-sets/junior-rewards.json' assert { type: 'json' };
import type { Actions, PageServerLoad } from './$types';

type DemoReward = {
	id: number;
	title: string;
	points: number;
	icon: string;
	category: string;
	description?: string;
	latestRequestStatus?: 'pending_parent_approval' | 'approved' | 'rejected' | null;
	latestRequestId?: number | null;
};

function rewardsForMode(mode: string): DemoReward[] {
	const baseRewardsByMode: Record<string, Array<{ rewards: Array<Record<string, unknown>> }>> = {
		baby: [foodRewards.payload],
		kinder: [foodRewards.payload, experienceRewards.payload],
		lower: [elementaryRewards.payload, foodRewards.payload, experienceRewards.payload],
		upper: [juniorRewards.payload, experienceRewards.payload],
		teen: [juniorRewards.payload, experienceRewards.payload],
	};

	const setsForMode = baseRewardsByMode[mode] ?? baseRewardsByMode.lower;
	const allRewards: DemoReward[] = [];
	let nextId = 1;
	for (const set of setsForMode) {
		for (const r of set.rewards) {
			allRewards.push({
				id: nextId++,
				title: String(r.title ?? ''),
				points: Number(r.points ?? 0),
				icon: String(r.icon ?? '🎁'),
				category: String(r.category ?? 'other'),
				description: r.description ? String(r.description) : undefined,
				latestRequestStatus: null,
				latestRequestId: null,
			});
		}
	}
	return allRewards;
}

export const load: PageServerLoad = async ({ params, parent }) => {
	const { child, balance } = await parent();
	const mode = params.mode ?? 'lower';
	const rewards = rewardsForMode(mode);
	return {
		rewards,
		balance: typeof balance === 'number' ? balance : (child?.totalPoints ?? 0),
		redemptionRequests: [],
	};
};

export const actions: Actions = {
	requestRedemption: async ({ request }) => {
		// demo では sessionStorage / in-memory で完結 (server に persist しない)
		const formData = await request.formData();
		const rewardId = Number(formData.get('rewardId'));
		if (Number.isNaN(rewardId)) return fail(400, { error: 'パラメータが不正です' });
		// demo は実体 DB を持たないため、success のみ返す (client が UI 反映)
		return { success: true, rewardId };
	},
};
