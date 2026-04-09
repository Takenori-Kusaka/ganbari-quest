import type { ParamMatcher } from '@sveltejs/kit';
import { LEGACY_UI_MODE_MAP, UI_MODES } from '$lib/domain/validation/age-tier';

export const match: ParamMatcher = (param) => {
	return UI_MODES.includes(param as (typeof UI_MODES)[number]) || param in LEGACY_UI_MODE_MAP;
};
