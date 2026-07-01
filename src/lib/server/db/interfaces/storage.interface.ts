// src/lib/server/db/interfaces/storage.interface.ts
// ファイルストレージのインターフェース定義

export interface FileData {
	data: Buffer;
	contentType: string;
}

/**
 * getDownloadUrl の戻り値 (async-backup-export.md §3.4)。
 * - `redirect`: 一時 presigned URL へ 302 redirect できる (S3/AWS)。Lambda body 6MB / 30 秒制約を迂回する。
 * - `proxy`: 一時 URL を発行できない runtime (NUC ローカル FS)。呼び出し側 (DL route) が
 *   `readFile` から認証済で stream する。
 */
export type StorageDownloadUrl = { kind: 'redirect'; url: string } | { kind: 'proxy' };

export interface IStorageRepo {
	saveFile(key: string, data: Buffer, contentType: string): Promise<void>;
	readFile(key: string): Promise<FileData | null>;
	fileExists(key: string): Promise<boolean>;
	deleteFile(key: string): Promise<void>;
	listFiles(prefix: string): Promise<string[]>;
	/** プレフィックスに一致する全ファイルを一括削除し、削除件数を返す */
	deleteByPrefix(prefix: string): Promise<number>;
	/**
	 * key に対する一時ダウンロード経路を返す (async-backup-export.md §3.4、CWE-598)。
	 * - AWS (S3): `getSignedUrl(GetObjectCommand)` で対象 key 限定・短命 TTL の presigned URL を発行し
	 *   `{ kind: 'redirect', url }` を返す。
	 * - NUC (ローカル FS): presigned 不在のため `{ kind: 'proxy' }` を返し、呼び出し側が readFile で stream する。
	 * @param opts.expiresIn presigned URL の有効秒数 (60〜300 秒程度、redirect 経路のみ有効)。
	 */
	getDownloadUrl(key: string, opts: { expiresIn: number }): Promise<StorageDownloadUrl>;
}
