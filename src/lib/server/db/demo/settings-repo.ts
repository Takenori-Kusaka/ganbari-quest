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
	// #2353 設計欠陥 6: demo / 試用環境では PIN gate 初心者導線 dialog を非表示。
	// 「親が初めて子供画面に遷移したときの導線」目的の dialog で、demo 訪問者は実セットアップ未経由のため対象外。
	pin_gate_onboarding_seen: 'true',
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

/**
 * key 一致行の前方一致集計 (#4269 ①)。demo は固定 fixture のみを持つ stateless Fake なので、
 * DEMO_SETTINGS に無い key は「保存 0 件」として 0 / 0 を返す (在庫監査の行は 0 件として出る)。
 */
export async function countValuesByPrefix(
	key: string,
	valuePrefix: string,
): Promise<{ total: number; withPrefix: number }> {
	const value = DEMO_SETTINGS[key];
	if (value === undefined) return { total: 0, withPrefix: 0 };
	return { total: 1, withPrefix: value.startsWith(valuePrefix) ? 1 : 0 };
}

export async function deleteByTenantIdExcept(
	_tenantId: string,
	_keepKeys: readonly string[],
): Promise<void> {
	// Stub: no-op (demo Lambda は stateless。書き込み系は全て no-op、ADR-0048 §決定 §2)
}
