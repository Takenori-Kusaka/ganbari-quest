// src/lib/server/storage.ts — Facade (delegates to factory)

import { getRepos } from './db/factory';

export async function saveFile(key: string, data: Buffer, contentType: string): Promise<void> {
	return getRepos().storage.saveFile(key, data, contentType);
}

export async function readFile(
	key: string,
): Promise<{ data: Buffer; contentType: string } | null> {
	return getRepos().storage.readFile(key);
}

export async function fileExists(key: string): Promise<boolean> {
	return getRepos().storage.fileExists(key);
}
