import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityPack } from '$lib/domain/activity-pack.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const packPath = join(process.cwd(), 'static', 'activity-packs', `${params.packId}.json`);

	if (!existsSync(packPath)) {
		error(404, 'パックが見つかりません');
	}

	const raw = readFileSync(packPath, 'utf-8');
	const pack: ActivityPack = JSON.parse(raw);

	return { pack };
};
