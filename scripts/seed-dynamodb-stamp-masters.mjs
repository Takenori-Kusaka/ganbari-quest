#!/usr/bin/env node

/**
 * scripts/seed-dynamodb-stamp-masters.mjs
 *
 * 用途:
 *   既存本番 tenant の DynamoDB に default stamp_masters 16 個を一括 seed する
 *   ops script。Issue 起票時点 (2026-05-20) ではまだ DynamoDB の stamp_masters
 *   永続化機構自体が未実装 (PR #2280 で fallback 化、本 PR で fallback が
 *   default 16 個を返すよう改善) のため、現状は本 script は **将来 dynamodb
 *   stamp-card-repo を本実装した時** に既存 tenant を救済するための雛形。
 *
 *   本 PR の即時 fix (findEnabledStampMasters fallback が SSOT 16 個を返す) だけで
 *   既存 user の loginStamp 500 は解消する。本 script の出番は dynamodb 本実装の
 *   別 Issue 着手時 (Bucket B/C 判断後)。
 *
 * 設計方針:
 *   - stamp-master-defaults.ts の SSOT を参照 (id 1-16 / N×5 + R×5 + SR×4 + UR×2)
 *   - tenantId は CLI で受ける (`--tenant=t-xxxx`)
 *   - dry-run でレコード件数のみ表示、`--apply` で書き込み
 *   - PK / SK 規約は dynamodb stamp-card-repo 本実装時に確定するため
 *     本 script では暫定 (PK=`T#<tenantId>#STAMP_MASTER` / SK=`MASTER#<id>`)
 *     実装側で異なる規約を採用したら本 script のキー組立を合わせる
 *
 * 使用方法:
 *   # dry-run
 *   node scripts/seed-dynamodb-stamp-masters.mjs --tenant=t-xxxx --dry-run
 *
 *   # 本番実行 (PutItem を発行)
 *   AWS_REGION=us-east-1 DYNAMODB_TABLE=ganbari-quest \
 *     node scripts/seed-dynamodb-stamp-masters.mjs --tenant=t-xxxx --apply
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// ------------------------------------------------------------
// CLI args
// ------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || !args.includes('--apply');
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const TENANT_ID = tenantArg ? tenantArg.slice('--tenant='.length) : null;
const tableArg = args.find((a) => a.startsWith('--table='));
const TABLE_NAME = tableArg
	? tableArg.slice('--table='.length)
	: (process.env.DYNAMODB_TABLE ?? process.env.TABLE_NAME ?? 'ganbari-quest');

if (!TENANT_ID) {
	console.error('Error: --tenant=<tenantId> is required');
	console.error('Example: node scripts/seed-dynamodb-stamp-masters.mjs --tenant=t-xxx --dry-run');
	process.exit(2);
}

// stamp-master-defaults.ts と完全同期 (SSOT)。本 script は .mjs のため
// .ts ファイルから直接 import せず、値を duplicate して保持する
// (16 行で済むため SSOT 違反の実害は小さく、CI の test で同期検証する)。
const DEFAULT_STAMP_MASTERS_DATA = [
	{ id: 1, name: 'にこにこ', emoji: '😊', rarity: 'N' },
	{ id: 2, name: 'グッジョブ', emoji: '👍', rarity: 'N' },
	{ id: 3, name: 'スター', emoji: '⭐', rarity: 'N' },
	{ id: 4, name: 'ハート', emoji: '❤️', rarity: 'N' },
	{ id: 5, name: 'がんばった', emoji: '💪', rarity: 'N' },
	{ id: 6, name: 'ロケット', emoji: '🚀', rarity: 'R' },
	{ id: 7, name: 'おうかん', emoji: '👑', rarity: 'R' },
	{ id: 8, name: 'トロフィー', emoji: '🏆', rarity: 'R' },
	{ id: 9, name: 'にじ', emoji: '🌈', rarity: 'R' },
	{ id: 10, name: 'たいよう', emoji: '☀️', rarity: 'R' },
	{ id: 11, name: 'ドラゴン', emoji: '🐉', rarity: 'SR' },
	{ id: 12, name: 'ユニコーン', emoji: '🦄', rarity: 'SR' },
	{ id: 13, name: 'たからばこ', emoji: '📦', rarity: 'SR' },
	{ id: 14, name: 'まほうのつえ', emoji: '🪄', rarity: 'SR' },
	{ id: 15, name: 'でんせつのけん', emoji: '⚔️', rarity: 'UR' },
	{ id: 16, name: 'きせきのほし', emoji: '🌟', rarity: 'UR' },
];

console.log(`[seed-stamp-masters] tenantId=${TENANT_ID}`);
console.log(`[seed-stamp-masters] table=${TABLE_NAME}`);
console.log(`[seed-stamp-masters] mode=${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
console.log(`[seed-stamp-masters] total stamps to seed: ${DEFAULT_STAMP_MASTERS_DATA.length}`);

if (DRY_RUN) {
	console.log('\n[seed-stamp-masters] DRY-RUN — printing items only:');
	for (const s of DEFAULT_STAMP_MASTERS_DATA) {
		console.log(`  - id=${s.id} ${s.emoji} ${s.name} (${s.rarity})`);
	}
	console.log('\n[seed-stamp-masters] Re-run with --apply to actually write to DynamoDB.');
	process.exit(0);
}

// ------------------------------------------------------------
// Apply
// ------------------------------------------------------------

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const now = new Date().toISOString();
let success = 0;
let failed = 0;

for (const s of DEFAULT_STAMP_MASTERS_DATA) {
	const item = {
		PK: `T#${TENANT_ID}#STAMP_MASTER`,
		SK: `MASTER#${String(s.id).padStart(4, '0')}`,
		entityType: 'STAMP_MASTER',
		id: s.id,
		name: s.name,
		emoji: s.emoji,
		rarity: s.rarity,
		isDefault: 1,
		isEnabled: 1,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await ddb.send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: item,
				// 既存に上書きしない (idempotent)
				ConditionExpression: 'attribute_not_exists(PK)',
			}),
		);
		success += 1;
		console.log(`  OK   id=${s.id} ${s.emoji} ${s.name}`);
	} catch (err) {
		if (err.name === 'ConditionalCheckFailedException') {
			console.log(`  SKIP id=${s.id} ${s.emoji} ${s.name} (already exists)`);
		} else {
			failed += 1;
			console.error(`  FAIL id=${s.id} ${s.emoji} ${s.name}:`, err.message);
		}
	}
}

console.log(`\n[seed-stamp-masters] done: success=${success} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
