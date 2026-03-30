import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityPackIndex } from '$lib/domain/activity-pack.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const indexPath = join(process.cwd(), 'static', 'activity-packs', 'index.json');
	const raw = readFileSync(indexPath, 'utf-8');
	const index: ActivityPackIndex = JSON.parse(raw);

	return {
		packs: index.packs,
	};
};
