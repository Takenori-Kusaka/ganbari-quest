import { getAllChildren } from '$lib/server/services/child-service';

/**
 * Returns true if the initial setup wizard has not been completed yet.
 * Setup is required when no children are registered.
 * (#0123: PIN認証廃止 — セットアップは子供登録のみが条件)
 */
export async function isSetupRequired(): Promise<boolean> {
	const children = await getAllChildren();
	return children.length === 0;
}
