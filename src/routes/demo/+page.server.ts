import { DEMO_CHILDREN } from '$lib/server/demo/demo-data.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {
		children: DEMO_CHILDREN,
	};
};
