// src/routes/ops/export/+page.server.ts
// CSVエクスポートページ (#0176 Phase 4)

import { jstYearMonth } from '$lib/domain/date-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// 既定年月は JST SSOT 経由 (#4015)
	const { year, month } = jstYearMonth();
	return {
		currentYear: year,
		currentMonth: month,
	};
};
