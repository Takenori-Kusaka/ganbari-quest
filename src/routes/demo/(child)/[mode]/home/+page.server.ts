/**
 * Issue #2097: 真の child home UI 統合 (6 回目指摘)
 *
 * demo home page server load も本番 `(child)/[uiMode]/home/+page.server.ts` と
 * 同等のフィールドを返す。本番固有 feature (pin / mission badge / xp animation /
 * baby inline form / event badge / sibling ranking / monthly reward 等) を
 * 共通 `DashboardView.svelte` が demo 側でも描画できるよう、不足フィールドを
 * null / 空配列 / 既定値で mock する。
 *
 * **逆方向 (本番を demo に寄せる) は機能退行のため禁止 (Issue #2097 §統合方針)**
 *
 * Form actions は demo-service の thin wrapper (in-memory + sessionStorage)。
 */

import { fail } from '@sveltejs/kit';
import {
	demoCancelRecord,
	demoClaimLoginBonus,
	demoRecordActivity,
	demoTogglePin,
	getDemoHomeData,
} from '$lib/server/demo/demo-service.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	const home = child ? getDemoHomeData(child.id) : getDemoHomeData(0);

	// #2097: 本番 home page が返す追加フィールドを demo でも提供
	return {
		...home,
		// 本番固有 feature が要求するフィールド (demo では null / 空)
		categoryXp: null,
		gameLoopHints: null,
		isFirstTime: false,
		focusMode: false,
		recommendedActivityIds: [] as number[],
		birthdayBonus: null,
		activeEvents: [] as never[],
		activeChallenges: [] as never[],
		siblingRanking: null,
		unshownCheers: [] as never[],
		familyStreak: null,
		monthlyPremiumReward: null,
		specialRewardProgress: null,
		latestMessage: null,
		stampCard: null,
	};
};

export const actions: Actions = {
	record: async ({ request }) => {
		const formData = await request.formData();
		const activityId = Number(formData.get('activityId'));
		if (Number.isNaN(activityId)) return fail(400, { error: 'パラメータが不正です' });
		return demoRecordActivity(activityId);
	},

	cancelRecord: async () => {
		return demoCancelRecord();
	},

	claimBonus: async () => {
		return demoClaimLoginBonus();
	},

	togglePin: async ({ request }) => {
		const formData = await request.formData();
		const pinned = formData.get('pinned') === 'true';
		return demoTogglePin(pinned);
	},
};
