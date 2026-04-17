// src/routes/ops/business/+page.server.ts
// 事業採算性ページ (#836)

import { getBreakevenData } from '$lib/server/services/breakeven-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const breakeven = await getBreakevenData();
	return { breakeven };
};
