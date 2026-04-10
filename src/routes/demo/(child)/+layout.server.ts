import { normalizeUiMode } from '$lib/domain/validation/age-tier';
import { DEMO_CHILDREN } from '$lib/server/demo/demo-data.js';
import { getDemoChildLayoutData } from '$lib/server/demo/demo-service.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ url }) => {
	// childId from query string (set when selecting a child from demo landing)
	const childIdParam = url.searchParams.get('childId');

	// Extract mode from path: /demo/[mode]/...
	const segments = url.pathname.split('/');
	const rawMode = segments[2]; // /demo/[mode]/...
	// Normalize legacy mode names (kinder→preschool, lower→elementary, etc.)
	const mode = rawMode ? normalizeUiMode(rawMode) : undefined;

	let childId: number | null = childIdParam ? Number(childIdParam) : null;

	// If no explicit childId, find the first child matching the mode
	if (!childId && mode) {
		const child = DEMO_CHILDREN.find((c) => c.uiMode === mode);
		childId = child?.id ?? null;
	}

	// Fallback to switch page if no child found
	if (!childId) {
		return getDemoChildLayoutData(0);
	}

	return getDemoChildLayoutData(childId);
};
