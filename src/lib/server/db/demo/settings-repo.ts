// Demo ISettingsRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { getDemoMarketplaceRewardTemplatesForTenant } from '$lib/server/demo/demo-data';

/**
 * #2097 Phase B-7: marketplace reward-set 由来の reward_templates を build 時に serialize。
 * `getRewardTemplates(tenantId)` が JSON.parse する形式に合わせる。
 * 全子供分 (902/903/904/906) の reward-set を集合化、title 重複は除外済。
 */
const DEMO_REWARD_TEMPLATES_JSON = JSON.stringify(getDemoMarketplaceRewardTemplatesForTenant());

const DEMO_SETTINGS: Record<string, string> = {
	reward_templates: DEMO_REWARD_TEMPLATES_JSON,
};

export async function getSetting(key: string, _tenantId: string): Promise<string | undefined> {
	return DEMO_SETTINGS[key];
}

export async function setSetting(_key: string, _value: string, _tenantId: string): Promise<void> {
	// Stub: no-op (Lambda stateless, ADR-0048 §決定 §2)
}

export async function getSettings(
	keys: string[],
	_tenantId: string,
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const key of keys) {
		const value = DEMO_SETTINGS[key];
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
