// #704: デモ画面の もちものチェック ページ
// 本番版 (src/routes/(child)/checklist/+page.server.ts) と URL 構造を揃え、
// /demo/checklist?childId=... で動作する。

import { getDemoTodayChecklistsForChild } from '$lib/server/demo/demo-service.js';
import { getCurrentTimeSlot } from '$lib/server/services/checklist-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) {
		return { checklists: [], currentTimeSlot: getCurrentTimeSlot() };
	}
	return {
		checklists: getDemoTodayChecklistsForChild(child.id),
		currentTimeSlot: getCurrentTimeSlot(),
	};
};
