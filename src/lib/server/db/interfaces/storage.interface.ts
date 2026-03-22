// src/lib/server/db/interfaces/storage.interface.ts
// ファイルストレージのインターフェース定義

export interface FileData {
	data: Buffer;
	contentType: string;
}

export interface IStorageRepo {
	saveFile(key: string, data: Buffer, contentType: string): Promise<void>;
	readFile(key: string): Promise<FileData | null>;
	fileExists(key: string): Promise<boolean>;
}
