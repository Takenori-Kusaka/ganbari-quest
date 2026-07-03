// src/lib/server/db/sqlite/storage-repo.ts
// ローカルファイルシステム（NUC）向けストレージ実装

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { FileData, IStorageRepo } from '../interfaces/storage.interface';

/**
 * #3504 (async-backup-export.md §3.5): cloud-export の子供データ ZIP を web 配信対象の
 * `static/` に置くと無認証で配信され得る (CWE-598)。`exports/` prefix の key は `static/` の外
 * (`data/exports/…`) に保存し、DL は認証済の proxy route (getDownloadUrl → readFile stream) 経由に限る。
 * それ以外の key (画像アセット等) は従来どおり web 配信対象の `static/` に保存する。
 */
const CLOUD_EXPORT_PREFIX = 'exports/';

/** key の格納ベースディレクトリ名 (`static` = web 配信 / `data` = 非配信、cloud export 専用)。 */
function storageBaseName(key: string): 'static' | 'data' {
	return key.startsWith(CLOUD_EXPORT_PREFIX) ? 'data' : 'static';
}

/**
 * key が格納ベースディレクトリ配下に収まることを保証して絶対パスを返す (zip-slip 防御)。
 * `..` 等でベースを抜け出す key は拒否する (import 経由の悪意ある ZIP からの path escape 阻止)。
 * ベースは `storageBaseName` で決定 (cloud export = `data/`、その他 = `static/`)。
 */
function resolveContainedPath(key: string): string {
	const base = resolve(process.cwd(), storageBaseName(key));
	// OS 非依存の事前拒否 (Linux では `\` がファイル名のリテラル文字となり path.resolve の
	// containment では escape を検知できないため、`\` を含む key は無条件で弾く)。
	// 絶対パス・Windows ドライブレターも `path.resolve` 前に拒否して防御を多層化する。
	if (
		key.includes('\\') || // backslash (Windows separator / Linux ではリテラル文字)
		key.startsWith('/') || // 絶対パス (POSIX)
		/^[a-zA-Z]:/.test(key) // Windows ドライブレター
	) {
		throw new Error(`storage key が ${storageBaseName(key)}/ ディレクトリを逸脱しています: ${key}`);
	}
	const dest = resolve(base, key);
	if (dest !== base && !dest.startsWith(base + sep)) {
		throw new Error(`storage key が ${storageBaseName(key)}/ ディレクトリを逸脱しています: ${key}`);
	}
	return dest;
}

const MIME_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	zip: 'application/zip',
	json: 'application/json',
};

export const saveFile: IStorageRepo['saveFile'] = async (key, data, _contentType) => {
	// zip-slip 防御: key がベース配下に収まることを書き込み前に検証する。
	const fullPath = resolveContainedPath(key);
	const dir = dirname(fullPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(fullPath, data);
};

export const readFile: IStorageRepo['readFile'] = async (key): Promise<FileData | null> => {
	// zip-slip 防御 + cloud export の非配信ベース (data/) を含めて解決する。
	const filePath = resolveContainedPath(key);
	if (!existsSync(filePath)) return null;
	const ext = key.split('.').pop()?.toLowerCase() ?? '';
	return {
		data: readFileSync(filePath),
		contentType: MIME_TYPES[ext] ?? 'application/octet-stream',
	};
};

export const fileExists: IStorageRepo['fileExists'] = async (key) => {
	return existsSync(resolveContainedPath(key));
};

export const deleteFile: IStorageRepo['deleteFile'] = async (key) => {
	const fullPath = resolveContainedPath(key);
	if (existsSync(fullPath)) {
		unlinkSync(fullPath);
	}
};

/**
 * #3504: NUC は presigned URL を発行できないため常に proxy 経路を返す。
 * DL route が readFile から認証済で stream する (static/ 直配信しない)。
 */
export const getDownloadUrl: IStorageRepo['getDownloadUrl'] = async () => {
	return { kind: 'proxy' };
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
	const baseDir = resolve(process.cwd(), storageBaseName(prefix));
	const searchDir = join(baseDir, prefix);

	// prefix がディレクトリを指す場合（末尾スラッシュ等）: 再帰列挙
	if (existsSync(searchDir) && statSync(searchDir).isDirectory()) {
		return walkDir(searchDir).map((f) => relative(baseDir, f).replace(/\\/g, '/'));
	}

	// 従来動作: prefix の親ディレクトリ内でファイル名マッチ
	const dir = join(baseDir, dirname(prefix));
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
	const baseDir = resolve(process.cwd(), storageBaseName(prefix));
	const files = await listFiles(prefix);
	let deleted = 0;
	for (const file of files) {
		const fullPath = join(baseDir, file);
		if (existsSync(fullPath)) {
			unlinkSync(fullPath);
			deleted++;
		}
	}
	return deleted;
};
