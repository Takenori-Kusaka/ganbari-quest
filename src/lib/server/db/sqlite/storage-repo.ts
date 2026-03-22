// src/lib/server/db/sqlite/storage-repo.ts
// ローカルファイルシステム（NUC）向けストレージ実装

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileData, IStorageRepo } from '../interfaces/storage.interface';

const MIME_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	svg: 'image/svg+xml',
};

function getBaseDir(): string {
	return process.env.NODE_ENV === 'production' ? 'client' : 'static';
}

export const saveFile: IStorageRepo['saveFile'] = async (key, data, _contentType) => {
	const fullPath = join(process.cwd(), 'static', key);
	const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(fullPath, data);
};

export const readFile: IStorageRepo['readFile'] = async (key): Promise<FileData | null> => {
	const filePath = join(process.cwd(), getBaseDir(), key);
	if (!existsSync(filePath)) return null;
	const ext = key.split('.').pop()?.toLowerCase() ?? '';
	return {
		data: readFileSync(filePath),
		contentType: MIME_TYPES[ext] ?? 'application/octet-stream',
	};
};

export const fileExists: IStorageRepo['fileExists'] = async (key) => {
	return existsSync(join(process.cwd(), 'static', key));
};
