import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {
		pointSettings: DEFAULT_POINT_SETTINGS,
		decayIntensity: 'normal',
	};
};
