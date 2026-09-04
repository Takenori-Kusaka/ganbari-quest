// src/lib/server/db/s3/storage-repo.ts
// S3（Lambda）向けストレージ実装。DB backend 非依存の S3 層 (#3438 Phase 1 で dynamodb/ から移設)。
// 旧配置は dynamodb/ だが DynamoDB 依存はゼロ (@aws-sdk/client-s3 のみ)。dsql/pglite/dynamodb
// いずれの backend でも本 S3 実装を共有する (factory.ts が注入)。

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
	return (result.Contents ?? []).map((obj) => obj.Key as string).filter(Boolean);
};

/**
 * #3504 (async-backup-export.md §3.4): S3 presigned GET URL を発行し 302 redirect 経路を返す。
 * 対象 key 限定・短命 TTL (opts.expiresIn 秒) で、Lambda body 6MB / 30 秒制約を迂回する (CWE-598 は
 * 呼び出し側 DL route の認証 + tenant 一致 + 短命 TTL で緩和)。
 */
export const getDownloadUrl: IStorageRepo['getDownloadUrl'] = async (key, opts) => {
	const { GetObjectCommand } = await import('@aws-sdk/client-s3');
	const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
	const client = await getS3Client();
	const url = await getSignedUrl(
		client,
		new GetObjectCommand({ Bucket: ASSETS_BUCKET, Key: key }),
		{ expiresIn: opts.expiresIn },
	);
	return { kind: 'redirect', url };
};

export const deleteByPrefix: IStorageRepo['deleteByPrefix'] = async (prefix) => {
	const { DeleteObjectsCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
	const client = await getS3Client();
	let totalDeleted = 0;
	let continuationToken: string | undefined;

	do {
		const listResult = await client.send(
			new ListObjectsV2Command({
				Bucket: ASSETS_BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);

		const keys = (listResult.Contents ?? []).map((obj) => obj.Key).filter((k): k is string => !!k);

		if (keys.length > 0) {
			await client.send(
				new DeleteObjectsCommand({
					Bucket: ASSETS_BUCKET,
					Delete: { Objects: keys.map((Key) => ({ Key })) },
				}),
			);
			totalDeleted += keys.length;
		}

		continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
	} while (continuationToken);

	return totalDeleted;
};

/**
 * prefix 配下を **全バージョン + delete marker まで**物理削除する (#4724)。
 *
 * バージョニングを有効にしたことで `deleteByPrefix` (ListObjectsV2 + DeleteObjects) は
 * 「現行バージョンに delete marker を立てるだけ」になり、実体は lifecycle の 30 日まで残る。
 * 退会は法務文書 (privacy 第 6 条 / 利用規約) が「猶予期間後に完全削除」と約束しているため、
 * **バージョンを名指しして消す経路**が要る。ここが無いとバージョニング有効化が
 * 「約束より 30 日長く保持する」という静かな違反になる。
 *
 * ListObjectVersions は 1 ページ最大 1000 件を Versions / DeleteMarkers の 2 配列で返す。
 * 両方消さないと delete marker だけが残り続ける (中身は無いがオブジェクトとして列挙される)。
 */
export const purgeByPrefix: IStorageRepo['purgeByPrefix'] = async (prefix) => {
	const { DeleteObjectsCommand, ListObjectVersionsCommand } = await import('@aws-sdk/client-s3');
	const client = await getS3Client();
	let totalDeleted = 0;
	let keyMarker: string | undefined;
	let versionIdMarker: string | undefined;

	do {
		const listResult = await client.send(
			new ListObjectVersionsCommand({
				Bucket: ASSETS_BUCKET,
				Prefix: prefix,
				KeyMarker: keyMarker,
				VersionIdMarker: versionIdMarker,
			}),
		);

		const targets = [...(listResult.Versions ?? []), ...(listResult.DeleteMarkers ?? [])]
			.filter((v) => !!v.Key && !!v.VersionId)
			.map((v) => ({ Key: v.Key as string, VersionId: v.VersionId as string }));

		if (targets.length > 0) {
			const deleteResult = await client.send(
				new DeleteObjectsCommand({
					Bucket: ASSETS_BUCKET,
					Delete: { Objects: targets },
				}),
			);
			// #4767 QM: **DeleteObjects は個々のキーの失敗を例外にしない**。AccessDenied /
			// object lock / MFA delete で消せなかったものは HTTP 200 の応答本文の `Errors[]` に
			// 並ぶだけなので、ここを見ないと「消せていないのに全件削除できた」と報告してしまう
			// (呼び出し元は完全 PII の ZIP が残ったまま DB 行を消す = 誰も辿れない孤児になる)。
			// 1 件でも残ったら失敗として投げ、呼び出し元の fail-closed 経路に載せる。
			const errors = deleteResult?.Errors ?? [];
			if (errors.length > 0) {
				const detail = errors
					.slice(0, 3)
					.map((e) => `${e.Key ?? '?'}:${e.Code ?? '?'}`)
					.join(', ');
				throw new Error(
					`S3 purge partially failed: ${errors.length}/${targets.length} objects remain (${detail})`,
				);
			}
			totalDeleted += targets.length;
		}

		keyMarker = listResult.IsTruncated ? listResult.NextKeyMarker : undefined;
		versionIdMarker = listResult.IsTruncated ? listResult.NextVersionIdMarker : undefined;
	} while (keyMarker || versionIdMarker);

	return totalDeleted;
};
