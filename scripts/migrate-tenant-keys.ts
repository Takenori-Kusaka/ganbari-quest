#!/usr/bin/env npx tsx

// scripts/migrate-tenant-keys.ts
// DynamoDB テナントプレフィックス移行スクリプト
//
// 既存の PK (例: CHILD#00000001) を T#<tenantId>#CHILD#00000001 に移行する。
// GSI2PK (CAT#<catId>) も同様に T#<tenantId>#CAT#<catId> に移行する。
//
// Usage:
//   # Dry-run (変更なし、移行対象件数の確認のみ)
//   DYNAMODB_TABLE=ganbari-quest npx tsx scripts/migrate-tenant-keys.ts --dry-run --tenant-id t-xxxxx
//
//   # 実行
//   DYNAMODB_TABLE=ganbari-quest npx tsx scripts/migrate-tenant-keys.ts --tenant-id t-xxxxx
//
//   # ロールバック (T#<tenantId># プレフィックスを除去)
//   DYNAMODB_TABLE=ganbari-quest npx tsx scripts/migrate-tenant-keys.ts --rollback --tenant-id t-xxxxx
//
// Prerequisites:
//   - AWS credentials configured (AWS_PROFILE or env vars)
//   - DynamoDB table already exists

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

// ============================================================
// Configuration
// ============================================================

const TABLE_NAME = process.env.DYNAMODB_TABLE ?? 'ganbari-quest';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const BATCH_SIZE = 25; // DynamoDB BatchWrite limit

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ROLLBACK = args.includes('--rollback');
const tenantIdIdx = args.indexOf('--tenant-id');
const TENANT_ID = tenantIdIdx !== -1 ? args[tenantIdIdx + 1] : undefined;

if (!TENANT_ID) {
	console.error('Error: --tenant-id <tenantId> is required');
	console.error(
		'Usage: npx tsx scripts/migrate-tenant-keys.ts --tenant-id t-xxxxx [--dry-run] [--rollback]',
	);
	process.exit(1);
}

console.log(`\n=== DynamoDB Tenant Key Migration ===`);
console.log(`Table: ${TABLE_NAME}`);
console.log(`Region: ${REGION}`);
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : ROLLBACK ? 'ROLLBACK' : 'MIGRATE'}`);
console.log('');

// ============================================================
// DynamoDB client
// ============================================================

const config: ConstructorParameters<typeof DynamoDBClient>[0] = { region: REGION };
if (ENDPOINT) {
	config.endpoint = ENDPOINT;
	config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
}
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient(config), {
	marshallOptions: { removeUndefinedValues: true },
});

// ============================================================
// Tenant-scoped PK prefixes (items that need migration)
// ============================================================

// These PKs are tenant-scoped and need T#<tenantId># prefix
const TENANT_SCOPED_PK_PREFIXES = [
	'CHILD#', // child profiles + child sub-entities (logs, points, status, etc.)
	'ACTIVITY#', // activity masters
	'SETTING', // settings (exact match)
	'COUNTER', // ID counters (exact match)
	'CKTPL#', // checklist template items
];

// These PKs are global and should NOT be migrated
const _GLOBAL_PK_PREFIXES = [
	'CATEGORY#',
	'ACHIEVEMENT#',
	'TITLE#',
	'AVITEM#',
	'BENCH#',
	'USER#',
	'TENANT#',
	'LICENSE#',
	'INVITE#',
	'T#', // already migrated items
];

// GSI2PK prefixes that need migration
const TENANT_SCOPED_GSI2_PREFIXES = ['CAT#'];

// ============================================================
// Helper functions
// ============================================================

function isTenantScoped(pk: string): boolean {
	return TENANT_SCOPED_PK_PREFIXES.some(
		(prefix) => pk.startsWith(prefix) || pk === prefix.replace(/#$/, ''),
	);
}

function isAlreadyMigrated(pk: string): boolean {
	return pk.startsWith('T#');
}

function addTenantPrefix(pk: string, tenantId: string): string {
	return `T#${tenantId}#${pk}`;
}

function removeTenantPrefix(pk: string, tenantId: string): string {
	const prefix = `T#${tenantId}#`;
	if (pk.startsWith(prefix)) {
		return pk.slice(prefix.length);
	}
	return pk;
}

// ============================================================
// Scan all items from DynamoDB
// ============================================================

async function scanAll(): Promise<Record<string, unknown>[]> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await docClient.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				ExclusiveStartKey: lastKey,
			}),
		);
		if (result.Items) {
			items.push(...(result.Items as Record<string, unknown>[]));
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	return items;
}

// ============================================================
// BatchWrite helper (put + delete in same batch)
// ============================================================

interface WriteRequest {
	PutRequest?: { Item: Record<string, unknown> };
	DeleteRequest?: { Key: Record<string, unknown> };
}

async function batchWrite(requests: WriteRequest[]): Promise<number> {
	let processed = 0;
	for (let i = 0; i < requests.length; i += BATCH_SIZE) {
		const batch = requests.slice(i, i + BATCH_SIZE);
		let retries = 0;
		let unprocessed: WriteRequest[] | undefined = batch;

		do {
			const result = await docClient.send(
				new BatchWriteCommand({
					RequestItems: { [TABLE_NAME]: unprocessed },
				}),
			);
			const remaining = result.UnprocessedItems?.[TABLE_NAME] as WriteRequest[] | undefined;
			if (remaining && remaining.length > 0) {
				unprocessed = remaining;
				retries++;
				await new Promise((r) => setTimeout(r, 100 * 2 ** retries));
			} else {
				break;
			}
		} while (retries < 5);

		processed += batch.length;
		if (processed % 100 === 0) {
			console.log(`  ... ${processed}/${requests.length} requests processed`);
		}
	}
	return processed;
}

// ============================================================
// Migration: add tenant prefix
// ============================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コード、別Issueで対応予定
async function migrate(items: Record<string, unknown>[], tenantId: string) {
	const toMigrate: { oldItem: Record<string, unknown>; newItem: Record<string, unknown> }[] = [];

	for (const item of items) {
		const pk = item.PK as string;
		const _sk = item.SK as string;

		// Skip already migrated or global items
		if (isAlreadyMigrated(pk) || !isTenantScoped(pk)) {
			continue;
		}

		const newItem = { ...item };
		newItem.PK = addTenantPrefix(pk, tenantId);

		// Migrate GSI2PK if present
		if (typeof newItem.GSI2PK === 'string') {
			const gsi2pk = newItem.GSI2PK as string;
			if (TENANT_SCOPED_GSI2_PREFIXES.some((p) => gsi2pk.startsWith(p))) {
				newItem.GSI2PK = addTenantPrefix(gsi2pk, tenantId);
			}
		}

		toMigrate.push({ oldItem: item, newItem });
	}

	// Summary
	const pkGroups = new Map<string, number>();
	for (const { oldItem } of toMigrate) {
		const pk = oldItem.PK as string;
		const prefix = pk.split('#').slice(0, 1).join('#');
		pkGroups.set(prefix, (pkGroups.get(prefix) ?? 0) + 1);
	}

	console.log(`\n--- Migration Summary ---`);
	console.log(`Total items to migrate: ${toMigrate.length}`);
	for (const [prefix, count] of [...pkGroups.entries()].sort()) {
		console.log(`  ${prefix}#*: ${count} items`);
	}

	if (DRY_RUN) {
		console.log('\n[DRY RUN] No changes were made.');
		// Show sample items
		if (toMigrate.length > 0) {
			console.log('\nSample migrations (first 5):');
			for (const { oldItem, newItem } of toMigrate.slice(0, 5)) {
				console.log(`  ${oldItem.PK}/${oldItem.SK} → ${newItem.PK}/${newItem.SK}`);
				if (oldItem.GSI2PK && oldItem.GSI2PK !== newItem.GSI2PK) {
					console.log(`    GSI2PK: ${oldItem.GSI2PK} → ${newItem.GSI2PK}`);
				}
			}
		}
		return;
	}

	if (toMigrate.length === 0) {
		console.log('Nothing to migrate.');
		return;
	}

	// Execute: PUT new items first, then DELETE old items
	// (PUT first to avoid data loss on partial failure)
	console.log('\n[Step 1/2] Writing new items with tenant prefix...');
	const putRequests: WriteRequest[] = toMigrate.map(({ newItem }) => ({
		PutRequest: { Item: newItem },
	}));
	await batchWrite(putRequests);

	console.log('[Step 2/2] Deleting old items without tenant prefix...');
	const deleteRequests: WriteRequest[] = toMigrate.map(({ oldItem }) => ({
		DeleteRequest: {
			Key: { PK: oldItem.PK, SK: oldItem.SK },
		},
	}));
	await batchWrite(deleteRequests);

	console.log(`\nMigration complete: ${toMigrate.length} items migrated.`);
}

// ============================================================
// Rollback: remove tenant prefix
// ============================================================

async function rollback(items: Record<string, unknown>[], tenantId: string) {
	const prefix = `T#${tenantId}#`;
	const toRollback: { oldItem: Record<string, unknown>; newItem: Record<string, unknown> }[] = [];

	for (const item of items) {
		const pk = item.PK as string;

		// Only process items with our tenant prefix
		if (!pk.startsWith(prefix)) {
			continue;
		}

		const newItem = { ...item };
		newItem.PK = removeTenantPrefix(pk, tenantId);

		// Rollback GSI2PK if present
		if (typeof newItem.GSI2PK === 'string') {
			const gsi2pk = newItem.GSI2PK as string;
			if (gsi2pk.startsWith(prefix)) {
				newItem.GSI2PK = removeTenantPrefix(gsi2pk, tenantId);
			}
		}

		toRollback.push({ oldItem: item, newItem });
	}

	console.log(`\n--- Rollback Summary ---`);
	console.log(`Total items to rollback: ${toRollback.length}`);

	if (DRY_RUN) {
		console.log('\n[DRY RUN] No changes were made.');
		if (toRollback.length > 0) {
			console.log('\nSample rollbacks (first 5):');
			for (const { oldItem, newItem } of toRollback.slice(0, 5)) {
				console.log(`  ${oldItem.PK}/${oldItem.SK} → ${newItem.PK}/${newItem.SK}`);
			}
		}
		return;
	}

	if (toRollback.length === 0) {
		console.log('Nothing to rollback.');
		return;
	}

	// PUT restored items first, then DELETE tenant-prefixed items
	console.log('\n[Step 1/2] Writing items without tenant prefix...');
	const putRequests: WriteRequest[] = toRollback.map(({ newItem }) => ({
		PutRequest: { Item: newItem },
	}));
	await batchWrite(putRequests);

	console.log('[Step 2/2] Deleting items with tenant prefix...');
	const deleteRequests: WriteRequest[] = toRollback.map(({ oldItem }) => ({
		DeleteRequest: {
			Key: { PK: oldItem.PK, SK: oldItem.SK },
		},
	}));
	await batchWrite(deleteRequests);

	console.log(`\nRollback complete: ${toRollback.length} items restored.`);
}

// ============================================================
// Main
// ============================================================

async function main() {
	console.log('Scanning DynamoDB table...');
	const items = await scanAll();
	console.log(`Found ${items.length} total items.`);

	if (ROLLBACK) {
		await rollback(items, TENANT_ID);
	} else {
		await migrate(items, TENANT_ID);
	}
}

main().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
