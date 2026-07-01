// Demo IStorageRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
//
// Demo Lambda は S3 等の write 権限を持たない (ADR-0048 §決定 §1: grant: read-only)。
// アプリレイヤから storage write が来た場合は no-op で受け流す。

import type { FileData, StorageDownloadUrl } from '../interfaces/storage.interface';

export async function saveFile(_key: string, _data: Buffer, _contentType: string): Promise<void> {
	// Stub: no-op (Lambda has no S3 write permission)
}

export async function readFile(_key: string): Promise<FileData | null> {
	return null;
}

export async function fileExists(_key: string): Promise<boolean> {
	return false;
}

export async function deleteFile(_key: string): Promise<void> {
	// Stub: no-op
}

export async function listFiles(_prefix: string): Promise<string[]> {
	return [];
}

export async function deleteByPrefix(_prefix: string): Promise<number> {
	return 0;
}

export async function getDownloadUrl(
	_key: string,
	_opts: { expiresIn: number },
): Promise<StorageDownloadUrl> {
	// Demo Lambda は cloud export の実体を持たないため proxy 経路 (readFile → null) を返す。
	return { kind: 'proxy' };
}
