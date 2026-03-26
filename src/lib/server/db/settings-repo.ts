// src/lib/server/db/settings-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function getSetting(key: string, tenantId: string) {
	return getRepos().settings.getSetting(key, tenantId);
}
export async function setSetting(key: string, value: string, tenantId: string) {
	return getRepos().settings.setSetting(key, value, tenantId);
}
export async function getSettings(keys: string[], tenantId: string) {
	return getRepos().settings.getSettings(keys, tenantId);
}
