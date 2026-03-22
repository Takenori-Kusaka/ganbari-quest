// src/lib/server/storage.ts
// Unified storage abstraction: local filesystem (NUC) or S3 (Lambda)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_SOURCE = process.env.DATA_SOURCE ?? 'sqlite';
const ASSETS_BUCKET = process.env.ASSETS_BUCKET ?? '';

function isS3Mode(): boolean {
	return DATA_SOURCE === 'dynamodb' && !!ASSETS_BUCKET;
}

// Lazy-load S3 client to avoid import errors on NUC
let _s3Client: import('@aws-sdk/client-s3').S3Client | null = null;
async function getS3Client(): Promise<import('@aws-sdk/client-s3').S3Client> {
	if (!_s3Client) {
		const { S3Client } = await import('@aws-sdk/client-s3');
		_s3Client = new S3Client({});
	}
	return _s3Client;
}

/** Save a file to storage (local FS or S3) */
export async function saveFile(key: string, data: Buffer, contentType: string): Promise<void> {
	if (isS3Mode()) {
		const { PutObjectCommand } = await import('@aws-sdk/client-s3');
		const client = await getS3Client();
		await client.send(
			new PutObjectCommand({
				Bucket: ASSETS_BUCKET,
				Key: key,
				Body: data,
				ContentType: contentType,
			}),
		);
	} else {
		const dir = join(process.cwd(), 'static', key.substring(0, key.lastIndexOf('/')));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(join(process.cwd(), 'static', key), data);
	}
}

/** Read a file from storage (local FS or S3). Returns null if not found. */
export async function readFile(
	key: string,
): Promise<{ data: Buffer; contentType: string } | null> {
	if (isS3Mode()) {
		try {
			const { GetObjectCommand } = await import('@aws-sdk/client-s3');
			const client = await getS3Client();
			const result = await client.send(
				new GetObjectCommand({
					Bucket: ASSETS_BUCKET,
					Key: key,
				}),
			);
			if (!result.Body) return null;
			const bytes = await result.Body.transformToByteArray();
			return {
				data: Buffer.from(bytes),
				contentType: result.ContentType ?? 'application/octet-stream',
			};
		} catch (err: unknown) {
			const code = (err as { name?: string }).name;
			if (code === 'NoSuchKey' || code === 'NotFound') return null;
			throw err;
		}
	} else {
		const baseDir = process.env.NODE_ENV === 'production' ? 'client' : 'static';
		const filePath = join(process.cwd(), baseDir, key);
		if (!existsSync(filePath)) return null;
		const ext = key.split('.').pop()?.toLowerCase() ?? '';
		const mimeTypes: Record<string, string> = {
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			png: 'image/png',
			webp: 'image/webp',
			svg: 'image/svg+xml',
		};
		return {
			data: readFileSync(filePath),
			contentType: mimeTypes[ext] ?? 'application/octet-stream',
		};
	}
}

/** Check if a file exists in storage */
export async function fileExists(key: string): Promise<boolean> {
	if (isS3Mode()) {
		try {
			const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
			const client = await getS3Client();
			await client.send(
				new HeadObjectCommand({
					Bucket: ASSETS_BUCKET,
					Key: key,
				}),
			);
			return true;
		} catch {
			return false;
		}
	} else {
		return existsSync(join(process.cwd(), 'static', key));
	}
}
