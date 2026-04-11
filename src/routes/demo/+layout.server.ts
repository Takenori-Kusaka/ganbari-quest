// src/routes/demo/+layout.server.ts
// #760: デモプランを layout に渡して、プラン切替トグル UI が現在の選択を表示できるようにする。

import { DEMO_PLAN_COOKIE, resolveDemoPlan } from '$lib/server/demo/demo-plan';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ url, cookies }) => {
	const planQuery = url.searchParams.get('plan');
	const planCookie = cookies.get(DEMO_PLAN_COOKIE);
	const demoPlan = resolveDemoPlan(planQuery, planCookie);
	return { demoPlan };
};
