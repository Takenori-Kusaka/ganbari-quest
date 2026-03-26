#!/usr/bin/env npx tsx
// scripts/seed-cognito-test-data.ts
// Cognito + DynamoDB テストデータ投入スクリプト (#0133)
//
// テスト家族グループ A/B のユーザー・子供・活動データを DynamoDB に投入する。
// Cognito ユーザーは別途 AWS CLI or Console で作成が必要。
//
// Usage:
//   DYNAMODB_TABLE=ganbari-quest npx tsx scripts/seed-cognito-test-data.ts
//   DYNAMODB_TABLE=ganbari-quest npx tsx scripts/seed-cognito-test-data.ts --dry-run
//
// Prerequisites:
//   - AWS credentials configured
//   - DynamoDB table already created (via CDK deploy)
//   - カテゴリ・活動マスタが既に投入済み（migrate-sqlite-to-dynamodb.ts で移行済み）

import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const TABLE_NAME = process.env.DYNAMODB_TABLE ?? 'ganbari-quest';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 25;

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
// Test data definitions (#0133 チケットの設計に基づく)
// ============================================================

const NOW = new Date().toISOString();

/** テスト家族グループ A */
const FAMILY_A = {
	tenantId: 't-test-family-a',
	name: 'テスト家族A',
	owner: {
		userId: 'u-test-owner-a',
		email: 'test-owner@example.com',
		// Cognito password: TestOwner123! (Cognito で別途作成)
	},
	parent: {
		userId: 'u-test-shared-a',
		email: 'test-shared@example.com',
	},
	child: {
		userId: 'u-test-teen-a',
		email: 'test-teen@example.com',
		childId: 2, // 花子に紐付け
	},
	children: [
		{ id: 1, nickname: '太郎', age: 8, theme: 'blue', uiMode: 'kinder' },
		{ id: 2, nickname: '花子', age: 5, theme: 'pink', uiMode: 'kinder' },
	],
	licenseKey: 'GQ-TEST-AAAA-0001',
	plan: 'monthly' as const,
};

/** テスト家族グループ B */
const FAMILY_B = {
	tenantId: 't-test-family-b',
	name: 'テスト家族B',
	owner: {
		userId: 'u-test-owner-b',
		email: 'test-owner-b@example.com',
	},
	children: [{ id: 1, nickname: '一郎', age: 7, theme: 'green', uiMode: 'kinder' }],
	licenseKey: 'GQ-TEST-BBBB-0001',
	plan: 'yearly' as const,
};

/** テスト用ライセンスキー */
const TEST_LICENSES = [
	{ key: 'GQ-TEST-0000-0001', status: 'unused' },
	{ key: 'GQ-TEST-0000-0002', status: 'expired' },
	{ key: 'GQ-TEST-0000-0003', status: 'revoked' },
];

// ============================================================
// Key helpers (inline — matches keys.ts / auth-keys.ts)
// ============================================================

function padId(id: number): string {
	return String(id).padStart(8, '0');
}

function tenantPK(pk: string, tenantId: string): string {
	return `T#${tenantId}#${pk}`;
}

// ============================================================
// Item builders
// ============================================================

function buildAuthItems(): Record<string, unknown>[] {
	const items: Record<string, unknown>[] = [];

	// --- Family A ---
	const fa = FAMILY_A;

	// Users
	for (const user of [fa.owner, fa.parent, fa.child]) {
		items.push({
			PK: `USER#${user.userId}`,
			SK: 'PROFILE',
			userId: user.userId,
			email: user.email,
			provider: 'cognito',
			displayName: user.email.split('@')[0],
			createdAt: NOW,
			updatedAt: NOW,
		});
		items.push({
			PK: `USER#${user.userId}`,
			SK: `EMAIL#${user.email}`,
			userId: user.userId,
			email: user.email,
		});
	}

	// Tenant A
	items.push({
		PK: `TENANT#${fa.tenantId}`,
		SK: 'META',
		tenantId: fa.tenantId,
		name: fa.name,
		ownerId: fa.owner.userId,
		status: 'active',
		licenseKey: fa.licenseKey,
		plan: fa.plan,
		planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
		createdAt: NOW,
		updatedAt: NOW,
	});

	// Memberships A
	const membershipsA = [
		{ userId: fa.owner.userId, role: 'owner' },
		{ userId: fa.parent.userId, role: 'parent' },
		{ userId: fa.child.userId, role: 'child', childId: fa.child.childId },
	];
	for (const m of membershipsA) {
		// User → Tenant
		items.push({
			PK: `USER#${m.userId}`,
			SK: `TENANT#${fa.tenantId}`,
			userId: m.userId,
			tenantId: fa.tenantId,
			role: m.role,
			childId: 'childId' in m ? m.childId : undefined,
			joinedAt: NOW,
		});
		// Tenant → Member
		items.push({
			PK: `TENANT#${fa.tenantId}`,
			SK: `MEMBER#${m.userId}`,
			userId: m.userId,
			tenantId: fa.tenantId,
			role: m.role,
			childId: 'childId' in m ? m.childId : undefined,
			joinedAt: NOW,
		});
	}

	// License A
	items.push({
		PK: `LICENSE#${fa.licenseKey}`,
		SK: 'META',
		licenseKey: fa.licenseKey,
		tenantId: fa.tenantId,
		status: 'active',
		plan: fa.plan,
		createdAt: NOW,
	});

	// --- Family B ---
	const fb = FAMILY_B;

	// User B
	items.push({
		PK: `USER#${fb.owner.userId}`,
		SK: 'PROFILE',
		userId: fb.owner.userId,
		email: fb.owner.email,
		provider: 'cognito',
		displayName: fb.owner.email.split('@')[0],
		createdAt: NOW,
		updatedAt: NOW,
	});
	items.push({
		PK: `USER#${fb.owner.userId}`,
		SK: `EMAIL#${fb.owner.email}`,
		userId: fb.owner.userId,
		email: fb.owner.email,
	});

	// Tenant B
	items.push({
		PK: `TENANT#${fb.tenantId}`,
		SK: 'META',
		tenantId: fb.tenantId,
		name: fb.name,
		ownerId: fb.owner.userId,
		status: 'active',
		licenseKey: fb.licenseKey,
		plan: fb.plan,
		planExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
		createdAt: NOW,
		updatedAt: NOW,
	});

	// Membership B
	items.push({
		PK: `USER#${fb.owner.userId}`,
		SK: `TENANT#${fb.tenantId}`,
		userId: fb.owner.userId,
		tenantId: fb.tenantId,
		role: 'owner',
		joinedAt: NOW,
	});
	items.push({
		PK: `TENANT#${fb.tenantId}`,
		SK: `MEMBER#${fb.owner.userId}`,
		userId: fb.owner.userId,
		tenantId: fb.tenantId,
		role: 'owner',
		joinedAt: NOW,
	});

	// License B
	items.push({
		PK: `LICENSE#${fb.licenseKey}`,
		SK: 'META',
		licenseKey: fb.licenseKey,
		tenantId: fb.tenantId,
		status: 'active',
		plan: fb.plan,
		createdAt: NOW,
	});

	// --- Test license keys ---
	for (const lic of TEST_LICENSES) {
		items.push({
			PK: `LICENSE#${lic.key}`,
			SK: 'META',
			licenseKey: lic.key,
			status: lic.status,
			createdAt: NOW,
		});
	}

	return items;
}

function buildChildItems(): Record<string, unknown>[] {
	const items: Record<string, unknown>[] = [];

	// Family A children
	for (const child of FAMILY_A.children) {
		items.push({
			PK: tenantPK(`CHILD#${child.id}`, FAMILY_A.tenantId),
			SK: 'PROFILE',
			id: child.id,
			nickname: child.nickname,
			age: child.age,
			theme: child.theme,
			ui_mode: child.uiMode,
			created_at: NOW,
			is_active: 1,
		});

		// Initial status values (5 categories)
		for (let catId = 1; catId <= 5; catId++) {
			items.push({
				PK: tenantPK(`CHILD#${child.id}`, FAMILY_A.tenantId),
				SK: `STATUS#${catId}`,
				child_id: child.id,
				category_id: catId,
				value: 25.0,
				updated_at: NOW,
			});
		}

		// Point balance
		items.push({
			PK: tenantPK(`CHILD#${child.id}`, FAMILY_A.tenantId),
			SK: 'BALANCE',
			child_id: child.id,
			balance: 0,
			total_earned: 0,
			total_spent: 0,
			updated_at: NOW,
		});
	}

	// Family B children
	for (const child of FAMILY_B.children) {
		items.push({
			PK: tenantPK(`CHILD#${child.id}`, FAMILY_B.tenantId),
			SK: 'PROFILE',
			id: child.id,
			nickname: child.nickname,
			age: child.age,
			theme: child.theme,
			ui_mode: child.uiMode,
			created_at: NOW,
			is_active: 1,
		});

		for (let catId = 1; catId <= 5; catId++) {
			items.push({
				PK: tenantPK(`CHILD#${child.id}`, FAMILY_B.tenantId),
				SK: `STATUS#${catId}`,
				child_id: child.id,
				category_id: catId,
				value: 25.0,
				updated_at: NOW,
			});
		}

		items.push({
			PK: tenantPK(`CHILD#${child.id}`, FAMILY_B.tenantId),
			SK: 'BALANCE',
			child_id: child.id,
			balance: 0,
			total_earned: 0,
			total_spent: 0,
			updated_at: NOW,
		});
	}

	return items;
}

function buildActivityLogItems(): Record<string, unknown>[] {
	const items: Record<string, unknown>[] = [];
	const today = new Date();

	// Family A: 各子供に 30 日分の活動データ
	for (const child of FAMILY_A.children) {
		let logId = 1;
		for (let daysAgo = 0; daysAgo < 30; daysAgo++) {
			const date = new Date(today);
			date.setDate(date.getDate() - daysAgo);
			const dateStr = date.toISOString().slice(0, 10);

			// 1日あたり 2〜3 件の活動記録
			const activitiesPerDay = 2 + (daysAgo % 2);
			for (let a = 0; a < activitiesPerDay; a++) {
				const actId = (a % 5) + 1; // 活動ID 1〜5 をローテーション
				const points = 5 + (actId * 2);

				items.push({
					PK: tenantPK(`CHILD#${child.id}`, FAMILY_A.tenantId),
					SK: `LOG#${dateStr}#${padId(logId)}`,
					GSI2PK: tenantPK(`CAT#${Math.ceil(actId / 2)}`, FAMILY_A.tenantId),
					GSI2SK: `LOG#${dateStr}#${padId(logId)}`,
					id: logId,
					child_id: child.id,
					activity_id: actId,
					recorded_date: dateStr,
					base_points: points,
					bonus_points: 0,
					total_points: points,
					created_at: new Date(date.getTime() + a * 3600000).toISOString(),
				});
				logId++;
			}
		}
	}

	// Family B: 子供に 10 日分の活動データ
	for (const child of FAMILY_B.children) {
		let logId = 1;
		for (let daysAgo = 0; daysAgo < 10; daysAgo++) {
			const date = new Date(today);
			date.setDate(date.getDate() - daysAgo);
			const dateStr = date.toISOString().slice(0, 10);

			const activitiesPerDay = 2;
			for (let a = 0; a < activitiesPerDay; a++) {
				const actId = (a % 3) + 1;
				const points = 5 + (actId * 2);

				items.push({
					PK: tenantPK(`CHILD#${child.id}`, FAMILY_B.tenantId),
					SK: `LOG#${dateStr}#${padId(logId)}`,
					GSI2PK: tenantPK(`CAT#${Math.ceil(actId / 2)}`, FAMILY_B.tenantId),
					GSI2SK: `LOG#${dateStr}#${padId(logId)}`,
					id: logId,
					child_id: child.id,
					activity_id: actId,
					recorded_date: dateStr,
					base_points: points,
					bonus_points: 0,
					total_points: points,
					created_at: new Date(date.getTime() + a * 3600000).toISOString(),
				});
				logId++;
			}
		}
	}

	return items;
}

function buildSettingsItems(): Record<string, unknown>[] {
	const items: Record<string, unknown>[] = [];

	// Family A settings
	const settingsA = [
		{ key: 'point_unit_mode', value: 'point' },
		{ key: 'point_currency', value: 'JPY' },
		{ key: 'point_rate', value: '1' },
	];
	for (const s of settingsA) {
		items.push({
			PK: tenantPK('SETTING', FAMILY_A.tenantId),
			SK: `KEY#${s.key}`,
			key: s.key,
			value: s.value,
			updated_at: NOW,
		});
	}

	// Family B settings
	for (const s of settingsA) {
		items.push({
			PK: tenantPK('SETTING', FAMILY_B.tenantId),
			SK: `KEY#${s.key}`,
			key: s.key,
			value: s.value,
			updated_at: NOW,
		});
	}

	// Counters
	for (const tenant of [FAMILY_A, FAMILY_B]) {
		items.push({
			PK: tenantPK('COUNTER', tenant.tenantId),
			SK: 'ACTIVITY_LOG',
			currentId: 100, // 十分な初期値
		});
		items.push({
			PK: tenantPK('COUNTER', tenant.tenantId),
			SK: 'CHILD',
			currentId: tenant.children.length,
		});
	}

	return items;
}

// ============================================================
// BatchWrite helper
// ============================================================

async function batchPut(items: Record<string, unknown>[]): Promise<number> {
	if (DRY_RUN) return items.length;

	let written = 0;
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		const request = {
			RequestItems: {
				[TABLE_NAME]: batch.map((item) => ({
					PutRequest: { Item: item },
				})),
			},
		};

		let unprocessed: typeof request | null = request;
		let retries = 0;
		do {
			const result = await docClient.send(new BatchWriteCommand(unprocessed));
			const remaining = result.UnprocessedItems?.[TABLE_NAME];
			if (remaining && remaining.length > 0) {
				unprocessed = { RequestItems: { [TABLE_NAME]: remaining } };
				retries++;
				await new Promise((r) => setTimeout(r, 100 * 2 ** retries));
			} else {
				unprocessed = null;
			}
		} while (unprocessed && retries < 5);

		written += batch.length;
	}
	return written;
}

// ============================================================
// Main
// ============================================================

async function main() {
	console.log('=== Cognito + DynamoDB テストデータ投入 ===');
	console.log(`テーブル: ${TABLE_NAME}`);
	console.log(`リージョン: ${REGION}`);
	if (ENDPOINT) console.log(`エンドポイント: ${ENDPOINT}`);
	if (DRY_RUN) console.log('⚠️  DRY RUN モード（書き込みなし）');
	console.log('');

	// 1. Auth items (users, tenants, memberships, licenses)
	const authItems = buildAuthItems();
	console.log(`[1/4] 認証データ: ${authItems.length} items`);
	const authWritten = await batchPut(authItems);
	console.log(`  → ${authWritten} items written`);

	// 2. Child items (profiles, statuses, balances)
	const childItems = buildChildItems();
	console.log(`[2/4] 子供データ: ${childItems.length} items`);
	const childWritten = await batchPut(childItems);
	console.log(`  → ${childWritten} items written`);

	// 3. Activity log items
	const logItems = buildActivityLogItems();
	console.log(`[3/4] 活動ログ: ${logItems.length} items`);
	const logWritten = await batchPut(logItems);
	console.log(`  → ${logWritten} items written`);

	// 4. Settings & counters
	const settingsItems = buildSettingsItems();
	console.log(`[4/4] 設定・カウンタ: ${settingsItems.length} items`);
	const settingsWritten = await batchPut(settingsItems);
	console.log(`  → ${settingsWritten} items written`);

	const total = authWritten + childWritten + logWritten + settingsWritten;
	console.log('');
	console.log(`✅ 合計 ${total} items ${DRY_RUN ? '(dry run)' : 'written'}`);
	console.log('');
	console.log('📋 テストアカウント:');
	console.log('  Family A:');
	console.log('    owner:  test-owner@example.com / TestOwner123!');
	console.log('    parent: test-shared@example.com / TestShared123!');
	console.log('    child:  test-teen@example.com / TestTeen123!');
	console.log('  Family B:');
	console.log('    owner:  test-owner-b@example.com / TestOwnerB123!');
	console.log('');
	console.log('⚠️  Cognito ユーザーは別途 AWS CLI で作成してください:');
	console.log('  aws cognito-idp admin-create-user --user-pool-id <POOL_ID> \\');
	console.log('    --username test-owner@example.com --temporary-password TestOwner123! \\');
	console.log('    --user-attributes Name=email,Value=test-owner@example.com Name=email_verified,Value=true');
}

main().catch((err) => {
	console.error('❌ エラー:', err);
	process.exit(1);
});
