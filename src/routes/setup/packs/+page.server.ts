import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityPack, ActivityPackIndex } from '$lib/domain/activity-pack';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	importActivities,
	previewActivityImport,
} from '$lib/server/services/activity-import-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function loadPackIndex(): ActivityPackIndex {
	const indexPath = join(process.cwd(), 'static', 'activity-packs', 'index.json');
	return JSON.parse(readFileSync(indexPath, 'utf-8'));
}

function loadPack(packId: string): ActivityPack {
	const packPath = join(process.cwd(), 'static', 'activity-packs', `${packId}.json`);
	return JSON.parse(readFileSync(packPath, 'utf-8'));
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);

	// Guard: No children -> go back to step 1
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	const packIndex = loadPackIndex();

	// Compute child age range for recommendations
	const ages = children.map((c) => c.age);
	const minAge = Math.min(...ages);
	const maxAge = Math.max(...ages);

	return {
		packs: packIndex.packs,
		childAgeMin: minAge,
		childAgeMax: maxAge,
	};
};

export const actions: Actions = {
	importPacks: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const packIds = formData.getAll('packIds').map((v) => v.toString());

		if (packIds.length === 0) {
			// Skip selected — no packs to import
			redirect(302, '/setup/complete');
		}

		let totalImported = 0;
		let totalSkipped = 0;
		const allErrors: string[] = [];

		for (const packId of packIds) {
			try {
				const pack = loadPack(packId);
				const preview = await previewActivityImport(pack.activities, tenantId);

				if (preview.newActivities > 0) {
					const result = await importActivities(pack.activities, tenantId);
					totalImported += result.imported;
					totalSkipped += result.skipped;
					allErrors.push(...result.errors);
				} else {
					totalSkipped += preview.total;
				}
			} catch {
				allErrors.push(`パック「${packId}」の読み込みに失敗しました`);
			}
		}

		trackSetupFunnel('setup_packs_selected', tenantId, {
			packCount: packIds.length,
			imported: totalImported,
		});
		redirect(302, `/setup/first-adventure?imported=${totalImported}&skipped=${totalSkipped}`);
	},

	skip: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_packs_skipped', tenantId);
		redirect(302, '/setup/first-adventure');
	},
};
