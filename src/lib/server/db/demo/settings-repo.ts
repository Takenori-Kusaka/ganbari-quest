// Demo ISettingsRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

export async function getSetting(_key: string, _tenantId: string): Promise<string | undefined> {
	return undefined;
}

export async function setSetting(_key: string, _value: string, _tenantId: string): Promise<void> {
	// Stub: no-op (Lambda stateless, ADR-0048 §決定 §2)
}

export async function getSettings(
	keys: string[],
	_tenantId: string,
): Promise<Record<string, string>> {
	// Empty fixture — demo Lambda は settings を持たない
	void keys;
	return {};
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
