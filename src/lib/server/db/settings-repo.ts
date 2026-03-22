// src/lib/server/db/settings-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function getSetting(key: string) {
	return getRepos().settings.getSetting(key);
}
export async function setSetting(key: string, value: string) {
	return getRepos().settings.setSetting(key, value);
}
export async function getSettings(keys: string[]) {
	return getRepos().settings.getSettings(keys);
}
