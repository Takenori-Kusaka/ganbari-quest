// src/lib/server/db/sqlite/storage-repo.ts
// ローカルファイルシステム（NUC）向けストレージ実装

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
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
	const dir = dirname(fullPath);
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

export const deleteFile: IStorageRepo['deleteFile'] = async (key) => {
	const fullPath = join(process.cwd(), 'static', key);
	if (existsSync(fullPath)) {
		unlinkSync(fullPath);
	}
};

/** 再帰的にディレクトリ配下のファイルを列挙 */
function walkDir(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			results.push(...walkDir(full));
		} else {
			results.push(full);
		}
	}
	return results;
}

export const listFiles: IStorageRepo['listFiles'] = async (prefix) => {
	const staticDir = join(process.cwd(), 'static');
	const searchDir = join(staticDir, prefix);

	// prefix がディレクトリを指す場合（末尾スラッシュ等）: 再帰列挙
	if (existsSync(searchDir) && statSync(searchDir).isDirectory()) {
		return walkDir(searchDir).map((f) => relative(staticDir, f).replace(/\\/g, '/'));
	}

	// 従来動作: prefix の親ディレクトリ内でファイル名マッチ
	const dir = join(staticDir, dirname(prefix));
	if (!existsSync(dir)) return [];
	const baseName = prefix.split('/').pop() ?? '';
	return readdirSync(dir)
		.filter((f) => {
			const full = join(dir, f);
			return f.startsWith(baseName) && existsSync(full) && !statSync(full).isDirectory();
		})
		.map((f) => join(dirname(prefix), f).replace(/\\/g, '/'));
};

export const deleteByPrefix: IStorageRepo['deleteByPrefix'] = async (prefix) => {
	const files = await listFiles(prefix);
	let deleted = 0;
	for (const file of files) {
		const fullPath = join(process.cwd(), 'static', file);
		if (existsSync(fullPath)) {
			unlinkSync(fullPath);
			deleted++;
		}
	}
	return deleted;
};
