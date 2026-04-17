#!/usr/bin/env npx tsx
// scripts/migrate-s3-paths.ts
// AWS S3 + DynamoDB: ファイルパスをテナントプレフィックス付きに移行
//
// 旧パス: uploads/avatars/avatar-{childId}-{timestamp}.{ext}
//         generated/avatar-{childId}-{hash}.{ext}
// 新パス: tenants/{tenantId}/avatars/{childId}/{uuid}.{ext}
//         tenants/{tenantId}/generated/{childId}/{hash}.{ext}
//
// Usage:
//   # Dry-run (変更なし、移行対象確認のみ)
//   DYNAMODB_TABLE=ganbari-quest ASSETS_BUCKET=ganbari-quest-assets-443370718249 \
//     npx tsx scripts/migrate-s3-paths.ts --tenant-id t-xxxxx --dry-run
//
//   # 実行
//   DYNAMODB_TABLE=ganbari-quest ASSETS_BUCKET=ganbari-quest-assets-443370718249 \
//     npx tsx scripts/migrate-s3-paths.ts --tenant-id t-xxxxx
//
// Prerequisites:
//   - AWS credentials configured
//   - DynamoDB table and S3 bucket exist

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
	CopyObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
	S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

// ============================================================
// Configuration
// ============================================================

const TABLE_NAME = process.env.DYNAMODB_TABLE ?? 'ganbari-quest';
const BUCKET_NAME = process.env.ASSETS_BUCKET ?? '';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tenantIdIdx = args.indexOf('--tenant-id');
const TENANT_ID = tenantIdIdx !== -1 ? args[tenantIdIdx + 1] : undefined;

if (!TENANT_ID) {
	console.error('Error: --tenant-id <tenantId> is required');
	console.error('Usage: npx tsx scripts/migrate-s3-paths.ts --tenant-id t-xxxxx [--dry-run]');
	process.exit(1);
}

if (!BUCKET_NAME) {
	console.error('Error: ASSETS_BUCKET environment variable is required');
	process.exit(1);
}

console.log(`\n=== S3 File Path Migration ===`);
console.log(`Table: ${TABLE_NAME}`);
console.log(`Bucket: ${BUCKET_NAME}`);
console.log(`Region: ${REGION}`);
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
console.log('');

// ============================================================
// AWS Clients
// ============================================================

const s3 = new S3Client({ region: REGION });
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
	marshallOptions: { removeUndefinedValues: true },
});

// ============================================================
// Helper: List all S3 objects with prefix
// ============================================================

async function listAllObjects(prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;

	do {
		const res = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET_NAME,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of res.Contents ?? []) {
			if (obj.Key) keys.push(obj.Key);
		}
		continuationToken = res.NextContinuationToken;
	} while (continuationToken);

	return keys;
}

// ============================================================
// Helper: Copy S3 object
// ============================================================

async function copyObject(oldKey: string, newKey: string): Promise<void> {
	await s3.send(
		new CopyObjectCommand({
			Bucket: BUCKET_NAME,
			CopySource: `${BUCKET_NAME}/${oldKey}`,
			Key: newKey,
		}),
	);
}

async function deleteObject(key: string): Promise<void> {
	await s3.send(
		new DeleteObjectCommand({
			Bucket: BUCKET_NAME,
			Key: key,
		}),
	);
}

// ============================================================
// Helper: DynamoDB tenant prefix
// ============================================================

function padId(id: number): string {
	return String(id).padStart(8, '0');
}

function childKey(childId: number): { PK: string; SK: string } {
	return { PK: `T#${TENANT_ID}#CHILD#${padId(childId)}`, SK: 'PROFILE' };
}

// ============================================================
// Phase 1: Find and migrate avatar files
// ============================================================

interface MigrationItem {
	oldKey: string;
	newKey: string;
	childId: number;
	newUrl: string;
}

async function findAvatarFiles(): Promise<MigrationItem[]> {
	console.log('--- Phase 1: Avatar files in S3 ---');
	const items: MigrationItem[] = [];

	const oldKeys = await listAllObjects('uploads/avatars/');
	console.log(`Old avatar files found: ${oldKeys.length}`);

	for (const oldKey of oldKeys) {
		// Pattern: uploads/avatars/avatar-{childId}-{timestamp}.{ext}
		const match = oldKey.match(/^uploads\/avatars\/avatar-(\d+)-[^.]+\.(\w+)$/);
		if (!match) {
			console.log(`  [SKIP] ${oldKey}: pattern not recognized`);
			continue;
		}
		const childId = parseInt(match[1], 10);
		const ext = match[2];
		const uuid = randomUUID();
		const newKey = `tenants/${TENANT_ID}/avatars/${childId}/${uuid}.${ext}`;
		const newUrl = `/${newKey}`;

		items.push({ oldKey, newKey, childId, newUrl });
		console.log(`  [MOVE] ${oldKey} → ${newKey}`);
	}

	return items;
}

// ============================================================
// Phase 2: Find and migrate generated image files
// ============================================================

async function findGeneratedFiles(): Promise<MigrationItem[]> {
	console.log('\n--- Phase 2: Generated image files in S3 ---');
	const items: MigrationItem[] = [];

	const oldKeys = await listAllObjects('generated/');
	console.log(`Old generated files found: ${oldKeys.length}`);

	for (const oldKey of oldKeys) {
		// Pattern: generated/avatar-{childId}-{hash}.{ext}
		const match = oldKey.match(/^generated\/avatar-(\d+)-([^.]+)\.(\w+)$/);
		if (!match) {
			console.log(`  [SKIP] ${oldKey}: pattern not recognized`);
			continue;
		}
		const childId = parseInt(match[1], 10);
		const hash = match[2];
		const ext = match[3];
		const newKey = `tenants/${TENANT_ID}/generated/${childId}/${hash}.${ext}`;
		const newUrl = `/${newKey}`;

		items.push({ oldKey, newKey, childId, newUrl });
		console.log(`  [MOVE] ${oldKey} → ${newKey}`);
	}

	return items;
}

// ============================================================
// Phase 3: Find DynamoDB child items with old avatar URLs
// ============================================================

interface DbUpdate {
	pk: string;
	sk: string;
	childId: number;
	oldUrl: string;
	newUrl: string;
}

async function findChildrenWithOldAvatars(): Promise<DbUpdate[]> {
	console.log('\n--- Phase 3: DynamoDB children with old avatar URLs ---');
	const updates: DbUpdate[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const res = await docClient.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'SK = :sk AND attribute_exists(avatarUrl) AND NOT begins_with(avatarUrl, :newPrefix)',
				ExpressionAttributeValues: {
					':sk': 'PROFILE',
					':newPrefix': `/tenants/${TENANT_ID}/`,
				},
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of res.Items ?? []) {
			const pk = item.PK as string;
			const sk = item.SK as string;
			const avatarUrl = item.avatarUrl as string;
			if (!avatarUrl) continue;

			// Extract childId from PK: T#<tenantId>#CHILD#00000001
			const childIdMatch = pk.match(/CHILD#(\d+)/);
			if (!childIdMatch) continue;
			const childId = parseInt(childIdMatch[1], 10);

			updates.push({ pk, sk, childId, oldUrl: avatarUrl, newUrl: '' }); // newUrl filled later
			console.log(`  [UPDATE] ${pk}: avatarUrl = ${avatarUrl}`);
		}

		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	console.log(`Children with old avatar URLs: ${updates.length}`);
	return updates;
}

// ============================================================
// Phase 4: Find character_images with old URLs
// ============================================================

interface CharImageUpdate {
	pk: string;
	sk: string;
	oldUrl: string;
	newUrl: string;
}

async function findOldCharacterImages(): Promise<CharImageUpdate[]> {
	console.log('\n--- Phase 4: DynamoDB character_images with old URLs ---');
	const updates: CharImageUpdate[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const res = await docClient.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(SK, :skPrefix) AND attribute_exists(imageUrl) AND NOT begins_with(imageUrl, :newPrefix)',
				ExpressionAttributeValues: {
					':skPrefix': 'CHARIMG#',
					':newPrefix': `/tenants/${TENANT_ID}/`,
				},
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of res.Items ?? []) {
			const pk = item.PK as string;
			const sk = item.SK as string;
			const imageUrl = item.imageUrl as string;
			if (!imageUrl) continue;

			updates.push({ pk, sk, oldUrl: imageUrl, newUrl: '' });
			console.log(`  [UPDATE] ${pk}/${sk}: imageUrl = ${imageUrl}`);
		}

		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	console.log(`Character images with old URLs: ${updates.length}`);
	return updates;
}

// ============================================================
// Execute migration
// ============================================================

async function main() {
	// Discover
	const avatarFiles = await findAvatarFiles();
	const generatedFiles = await findGeneratedFiles();
	const childUpdates = await findChildrenWithOldAvatars();
	const charImageUpdates = await findOldCharacterImages();

	// Map avatar file migrations to DB updates
	const avatarUrlMap = new Map<number, string>(); // childId → newUrl
	for (const item of avatarFiles) {
		avatarUrlMap.set(item.childId, item.newUrl);
	}
	for (const update of childUpdates) {
		const newUrl = avatarUrlMap.get(update.childId);
		if (newUrl) {
			update.newUrl = newUrl;
		} else {
			// No matching file found — keep the old URL but log warning
			console.log(`\n  [WARN] Child ${update.childId}: no S3 file found for ${update.oldUrl}`);
		}
	}

	// Map generated file migrations to character image updates
	const generatedUrlMap = new Map<string, string>(); // oldUrl → newUrl
	for (const item of generatedFiles) {
		const oldUrl = `/${item.oldKey}`;
		generatedUrlMap.set(oldUrl, item.newUrl);
	}
	for (const update of charImageUpdates) {
		const newUrl = generatedUrlMap.get(update.oldUrl);
		if (newUrl) {
			update.newUrl = newUrl;
		}
	}

	// Summary
	console.log('\n=== Migration Summary ===');
	console.log(`Avatar files to copy: ${avatarFiles.length}`);
	console.log(`Generated files to copy: ${generatedFiles.length}`);
	console.log(`Child avatar URLs to update: ${childUpdates.filter((u) => u.newUrl).length}`);
	console.log(`Character image URLs to update: ${charImageUpdates.filter((u) => u.newUrl).length}`);

	if (DRY_RUN) {
		console.log('\n=== DRY RUN — no changes made ===');
		return;
	}

	// Execute: Copy S3 files
	console.log('\n--- Copying S3 files ---');
	for (const item of [...avatarFiles, ...generatedFiles]) {
		await copyObject(item.oldKey, item.newKey);
		console.log(`  Copied: ${item.oldKey} → ${item.newKey}`);
	}

	// Execute: Update DynamoDB children avatarUrl
	console.log('\n--- Updating DynamoDB children avatarUrl ---');
	for (const update of childUpdates) {
		if (!update.newUrl) continue;
		await docClient.send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: { PK: update.pk, SK: update.sk },
				UpdateExpression: 'SET avatarUrl = :newUrl',
				ExpressionAttributeValues: { ':newUrl': update.newUrl },
			}),
		);
		console.log(`  Updated: ${update.pk} avatarUrl → ${update.newUrl}`);
	}

	// Execute: Update DynamoDB character_images imageUrl
	console.log('\n--- Updating DynamoDB character_images imageUrl ---');
	for (const update of charImageUpdates) {
		if (!update.newUrl) continue;
		await docClient.send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: { PK: update.pk, SK: update.sk },
				UpdateExpression: 'SET imageUrl = :newUrl',
				ExpressionAttributeValues: { ':newUrl': update.newUrl },
			}),
		);
		console.log(`  Updated: ${update.pk}/${update.sk} imageUrl → ${update.newUrl}`);
	}

	// Execute: Delete old S3 files
	console.log('\n--- Deleting old S3 files ---');
	for (const item of [...avatarFiles, ...generatedFiles]) {
		await deleteObject(item.oldKey);
		console.log(`  Deleted: ${item.oldKey}`);
	}

	console.log('\n=== Migration complete ===');
}

main().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
