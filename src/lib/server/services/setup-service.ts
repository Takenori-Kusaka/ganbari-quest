import { getSetting } from '$lib/server/db/settings-repo';
import { getAllChildren } from '$lib/server/services/child-service';

/**
 * Returns true if the initial setup wizard has not been completed yet.
 * Setup is required when no PIN is set AND no children are registered.
 */
export async function isSetupRequired(): Promise<boolean> {
	const pinHash = await getSetting('pin_hash');
	const children = await getAllChildren();
	return !pinHash && children.length === 0;
}
