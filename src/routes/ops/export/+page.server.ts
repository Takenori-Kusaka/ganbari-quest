// src/routes/ops/export/+page.server.ts
// CSVエクスポートページ (#0176 Phase 4)

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const now = new Date();
	return {
		currentYear: now.getFullYear(),
		currentMonth: now.getMonth() + 1,
	};
};
