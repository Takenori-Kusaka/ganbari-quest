#!/usr/bin/env node

/**
 * scripts/migrate-dynamodb-push-subscriber-role.mjs
 *
 * #1666 (#1593 follow-up — ADR-0023 I6 / COPPA / ADR-0012 Anti-engagement)
 *
 * 用途:
 *   本番 DynamoDB の既存 push_subscription レコードに対して、
 *   `subscriberRole` 属性が不在 / NULL / 空文字列のレコードを抽出し、
 *   `'parent'` に backfill する一回限りの migration script。
 *
 * 設計方針 (本 PR の制約):
 *   - DynamoDB 側 push-subscription-repo.ts は現在 stub（#1021 段階的対応禁止）。
 *     本 script は **DynamoDB 実装本体マージ後** に一度だけ実行する想定。
 *   - 実装本体は別 Issue (本 PR 末尾で起票) で扱う。
 *   - 本 script はキー設計に **直接依存しない**。`entityType = 'PUSH_SUB'` 属性
 *     または SK が `PUSH_SUB#` から始まる item を Scan で抽出する汎用設計。
 *     実装本体側で同じ属性 / SK 規約を採用すること。
 *
 * AC (Issue #1666):
 *   1. 既存 push_subscription レコード件数を確認
 *   2. subscriberRole 不在 / NULL のレコードを抽出
 *   3. 全レコードを 'parent' で backfill
 *   4. notification-service の "[notification] 非 parent/owner role" warn ログ件数 0 を CloudWatch で確認
 *
 * 使用方法:
 *   # dry-run (件数のみ表示。書き込みなし)
 *   node scripts/migrate-dynamodb-push-subscriber-role.mjs --dry-run
 *
 *   # 本番実行 (UpdateItem を発行)
 *   AWS_REGION=us-east-1 DYNAMODB_TABLE=ganbari-quest \
 *     node scripts/migrate-dynamodb-push-subscriber-role.mjs
 *
 *   # テーブル名を CLI で指定
 *   node scripts/migrate-dynamodb-push-subscriber-role.mjs --table=ganbari-quest --dry-run
 *
 * Idempotent:
 *   既に subscriberRole が 'parent' / 'owner' で設定済のレコードは skip する。
 *   何度実行しても安全。
 *
 * Rate limit:
 *   UpdateItem は 1 件ずつ直列で発行 (BatchWrite は UpdateItem に対応していないため)。
 *   テーブルが provisioned mode の場合は WCU を超過しないよう exponential backoff で retry。
 *   on-demand mode (本プロダクトの想定) では実質無制限。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// ------------------------------------------------------------
// CLI args
// ------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tableArg = args.find((a) => a.startsWith('--table='));
const TABLE_NAME = tableArg
	? tableArg.slice('--table='.length)
	: (process.env.DYNAMODB_TABLE ?? process.env.TABLE_NAME ?? 'ganbari-quest');
const REGION = process.env.AWS_REGION ?? 'us-east-1';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const DEFAULT_ROLE = 'parent';
const VALID_ROLES = new Set(['parent', 'owner']);
const PUSH_SUB_SK_PREFIX = 'PUSH_SUB#';
const PUSH_SUB_ENTITY_TYPE = 'PUSH_SUB';
const MAX_BACKOFF_MS = 30_000;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function buildClient() {
	const base = new DynamoDBClient({ region: REGION });
	return DynamoDBDocumentClient.from(base, {
		marshallOptions: { removeUndefinedValues: true },
		unmarshallOptions: { wrapNumbers: false },
	});
}

/**
 * @param {string} level
 * @param {string} msg
 * @param {Record<string, unknown>} [extra]
 */
function log(level, msg, extra) {
	const line = `[migrate-push-role] ${level.toUpperCase()} ${msg}`;
	if (extra) {
		console.log(line, JSON.stringify(extra));
	} else {
		console.log(line);
	}
}

/**
 * @param {unknown} item
 * @returns {boolean}
 */
function isPushSubscriptionItem(item) {
	if (!item || typeof item !== 'object') return false;
	const record = /** @type {Record<string, unknown>} */ (item);
	if (record.entityType === PUSH_SUB_ENTITY_TYPE) return true;
	if (typeof record.SK === 'string' && record.SK.startsWith(PUSH_SUB_SK_PREFIX)) return true;
	return false;
}

/**
 * @param {{ subscriberRole?: unknown }} item
 * @returns {boolean}
 */
function needsBackfill(item) {
	const role = item.subscriberRole;
	if (role == null || role === '') return true;
	if (typeof role !== 'string') return true;
	if (!VALID_ROLES.has(role)) return true;
	return false;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {() => Promise<unknown>} fn
 * @param {number} [attempt]
 * @returns {Promise<unknown>}
 */
async function withBackoff(fn, attempt = 0) {
	try {
		return await fn();
	} catch (/** @type {any} */ err) {
		const code = err?.name ?? err?.Code ?? '';
		const isThrottle =
			code === 'ProvisionedThroughputExceededException' ||
			code === 'ThrottlingException' ||
			code === 'RequestLimitExceeded';
		if (!isThrottle || attempt >= 6) throw err;
		const delay = Math.min(MAX_BACKOFF_MS, 2 ** attempt * 100);
		log('warn', `throttle hit, backoff ${delay}ms`, { attempt, code });
		await sleep(delay);
		return withBackoff(fn, attempt + 1);
	}
}

// ------------------------------------------------------------
// Core logic
// ------------------------------------------------------------

/**
 * Scan the table for all push_subscription items. Returns items that need backfill.
 *
 * @param {DynamoDBDocumentClient} doc
 * @returns {Promise<{total:number, needsBackfill: Array<{PK:string, SK:string, currentRole: unknown}>}>}
 */
export async function scanPushSubscriptions(doc, tableName = TABLE_NAME) {
	/** @type {{total: number, needsBackfill: Array<{PK: string, SK: string, currentRole: unknown}>}} */
	const result = { total: 0, needsBackfill: [] };
	/** @type {Record<string, unknown> | undefined} */
	let lastKey;

	do {
		const page = /** @type {import('@aws-sdk/lib-dynamodb').ScanCommandOutput} */ (
			await withBackoff(() =>
				doc.send(
					new ScanCommand({
						TableName: tableName,
						FilterExpression: 'begins_with(SK, :skPrefix) OR entityType = :entityType',
						ExpressionAttributeValues: {
							':skPrefix': PUSH_SUB_SK_PREFIX,
							':entityType': PUSH_SUB_ENTITY_TYPE,
						},
						ExclusiveStartKey: lastKey,
					}),
				),
			)
		);

		for (const item of page.Items ?? []) {
			if (!isPushSubscriptionItem(item)) continue;
			const record = /** @type {Record<string, unknown>} */ (item);
			result.total += 1;
			if (needsBackfill(/** @type {{ subscriberRole?: unknown }} */ (record))) {
				result.needsBackfill.push({
					PK: /** @type {string} */ (record.PK),
					SK: /** @type {string} */ (record.SK),
					currentRole: record.subscriberRole ?? null,
				});
			}
		}
		lastKey = page.LastEvaluatedKey;
	} while (lastKey);

	return result;
}

/**
 * Update one item: set subscriberRole = 'parent'.
 * Idempotent — uses condition expression to skip if already set to a valid value.
 *
 * @param {DynamoDBDocumentClient} doc
 * @param {{PK:string, SK:string}} key
 */
export async function updateSubscriberRole(doc, key, tableName = TABLE_NAME) {
	await withBackoff(() =>
		doc.send(
			new UpdateCommand({
				TableName: tableName,
				Key: { PK: key.PK, SK: key.SK },
				UpdateExpression: 'SET subscriberRole = :role',
				ConditionExpression:
					'attribute_not_exists(subscriberRole) OR subscriberRole = :empty OR (subscriberRole <> :parent AND subscriberRole <> :owner)',
				ExpressionAttributeValues: {
					':role': DEFAULT_ROLE,
					':empty': '',
					':parent': 'parent',
					':owner': 'owner',
				},
			}),
		),
	).catch((/** @type {any} */ err) => {
		// ConditionalCheckFailedException = 既に valid role が設定済 → 期待通り skip
		if (err?.name === 'ConditionalCheckFailedException') return;
		throw err;
	});
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
	log('info', `start (table=${TABLE_NAME}, region=${REGION}, dryRun=${DRY_RUN})`);

	const doc = buildClient();
	const scan = await scanPushSubscriptions(doc);

	log('info', `scan complete`, {
		total: scan.total,
		needsBackfill: scan.needsBackfill.length,
	});

	if (scan.needsBackfill.length === 0) {
		log('info', 'no items need backfill — nothing to do');
		return { total: scan.total, migrated: 0, skipped: scan.total };
	}

	if (DRY_RUN) {
		log('info', 'dry-run mode — sample of items to migrate (first 10):');
		for (const sample of scan.needsBackfill.slice(0, 10)) {
			log('info', `  ${sample.PK} / ${sample.SK} (current=${JSON.stringify(sample.currentRole)})`);
		}
		log('info', `dry-run end (would migrate ${scan.needsBackfill.length} items)`);
		return {
			total: scan.total,
			migrated: 0,
			skipped: scan.total - scan.needsBackfill.length,
			wouldMigrate: scan.needsBackfill.length,
		};
	}

	let migrated = 0;
	for (const target of scan.needsBackfill) {
		await updateSubscriberRole(doc, { PK: target.PK, SK: target.SK });
		migrated += 1;
		if (migrated % 25 === 0) {
			log('info', `progress: ${migrated}/${scan.needsBackfill.length}`);
		}
	}

	log('info', `done`, {
		total: scan.total,
		migrated,
		skipped: scan.total - migrated,
	});
	return { total: scan.total, migrated, skipped: scan.total - migrated };
}

// ------------------------------------------------------------
// Entry point (only when invoked directly)
// ------------------------------------------------------------

const argv1 = process.argv[1] ?? '';
const isDirectInvocation =
	import.meta.url === `file://${argv1}` || import.meta.url.endsWith(argv1.replace(/\\/g, '/'));

if (isDirectInvocation) {
	main()
		.then((summary) => {
			console.log(JSON.stringify({ status: 'ok', ...summary }, null, 2));
			process.exit(0);
		})
		.catch((/** @type {any} */ err) => {
			log('error', 'migration failed', { message: err?.message, stack: err?.stack });
			process.exit(1);
		});
}
