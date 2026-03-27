// src/lib/server/db/dynamodb/storage-repo.ts
// S3（Lambda）向けストレージ実装

import type { FileData, IStorageRepo } from '../interfaces/storage.interface';

const ASSETS_BUCKET = process.env.ASSETS_BUCKET ?? '';

let _s3Client: import('@aws-sdk/client-s3').S3Client | null = null;
async function getS3Client(): Promise<import('@aws-sdk/client-s3').S3Client> {
	if (!_s3Client) {
		const { S3Client } = await import('@aws-sdk/client-s3');
		_s3Client = new S3Client({});
	}
	return _s3Client;
}

export const saveFile: IStorageRepo['saveFile'] = async (key, data, contentType) => {
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
};

export const readFile: IStorageRepo['readFile'] = async (key): Promise<FileData | null> => {
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
};

export const fileExists: IStorageRepo['fileExists'] = async (key) => {
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
};

export const deleteFile: IStorageRepo['deleteFile'] = async (key) => {
	const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
	const client = await getS3Client();
	await client.send(
		new DeleteObjectCommand({
			Bucket: ASSETS_BUCKET,
			Key: key,
		}),
	);
};

export const listFiles: IStorageRepo['listFiles'] = async (prefix) => {
	const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
	const client = await getS3Client();
	const result = await client.send(
		new ListObjectsV2Command({
			Bucket: ASSETS_BUCKET,
			Prefix: prefix,
		}),
	);
	return (result.Contents ?? []).map((obj) => obj.Key!).filter(Boolean);
};
