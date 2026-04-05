// tests/e2e/global-teardown-aws.ts
// AWS 本番環境 E2E テスト後のクリーンアップ
// DynamoDB テナント・ユーザーデータ + Cognito ユーザーを削除
//
// 2段階のクリーンアップ戦略:
// 1. 認証済み storageState を使って API 経由でアカウント削除（推奨）
// 2. フォールバック: AWS SDK で直接 DynamoDB + Cognito を操作

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'https://ganbari-quest.com';
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-test@ganbari-quest.com';
const STORAGE_STATE_PATH = path.resolve('tests/e2e/.auth/aws-storage-state.json');

/** E2E テスト用データのクリーンアップを無効にする環境変数 */
const SKIP_TEARDOWN = process.env.E2E_SKIP_TEARDOWN === 'true';

export default async function globalTeardown() {
	if (SKIP_TEARDOWN) {
		console.log('[AWS E2E Teardown] E2E_SKIP_TEARDOWN=true, skipping cleanup.');
		return;
	}

	console.log('[AWS E2E Teardown] Starting cleanup...');

	// 戦略1: API 経由でアカウント削除
	const apiSuccess = await tryApiDeletion();
	if (apiSuccess) {
		console.log('[AWS E2E Teardown] API-based cleanup succeeded.');
		return;
	}

	// 戦略2: AWS SDK 直接操作（フォールバック）
	console.log('[AWS E2E Teardown] API cleanup failed, trying direct SDK cleanup...');
	const sdkSuccess = await trySdkDeletion();
	if (sdkSuccess) {
		console.log('[AWS E2E Teardown] SDK-based cleanup succeeded.');
		return;
	}

	// 両方失敗しても、teardown の失敗でテストスイートを落とさない
	console.log(
		'[AWS E2E Teardown] WARNING: Cleanup failed. Orphaned test data may remain in DynamoDB/Cognito.',
	);
	console.log(
		`[AWS E2E Teardown] Manual cleanup may be needed for test user: ${TEST_EMAIL}`,
	);
}

// ============================================================
// 戦略1: API 経由でアカウント削除
// ============================================================

async function tryApiDeletion(): Promise<boolean> {
	if (!fs.existsSync(STORAGE_STATE_PATH)) {
		console.log('[AWS E2E Teardown] storageState not found, cannot use API deletion.');
		return false;
	}

	let browser;
	try {
		browser = await chromium.launch();
		const context = await browser.newContext({
			baseURL: BASE_URL,
			storageState: STORAGE_STATE_PATH,
			ignoreHTTPSErrors: true,
		});

		const apiContext = context.request;

		// アカウント削除 API を呼び出す (Pattern 1: owner-only)
		const response = await apiContext.post(`${BASE_URL}/api/v1/admin/account/delete`, {
			data: { pattern: 'owner-only' },
		});

		const status = response.status();
		if (status === 200) {
			const body = await response.json();
			console.log(
				`[AWS E2E Teardown] Account deleted via API: ${body.itemsDeleted ?? 0} items, ${body.filesDeleted ?? 0} files`,
			);
			return true;
		}

		// 403 → owner でない可能性（テスト用ユーザーが owner ではない場合）
		// owner-full-delete を試す
		if (status === 403) {
			const fullDeleteRes = await apiContext.post(
				`${BASE_URL}/api/v1/admin/account/delete`,
				{
					data: { pattern: 'owner-full-delete' },
				},
			);
			if (fullDeleteRes.status() === 200) {
				console.log('[AWS E2E Teardown] Account deleted via API (full-delete pattern).');
				return true;
			}
		}

		const errorBody = await response.text().catch(() => '');
		console.log(
			`[AWS E2E Teardown] API deletion returned status ${status}: ${errorBody}`,
		);
		return false;
	} catch (err) {
		console.log(`[AWS E2E Teardown] API deletion error: ${String(err)}`);
		return false;
	} finally {
		await browser?.close();
	}
}

// ============================================================
// 戦略2: AWS SDK 直接操作
// ============================================================

async function trySdkDeletion(): Promise<boolean> {
	const userPoolId = process.env.COGNITO_USER_POOL_ID;
	const region = process.env.AWS_REGION ?? 'us-east-1';
	const tableName = process.env.DYNAMODB_TABLE ?? process.env.TABLE_NAME ?? 'ganbari-quest';

	try {
		// Cognito ユーザーを削除
		if (userPoolId) {
			await deleteCognitoTestUser(userPoolId, region, TEST_EMAIL);
		} else {
			console.log(
				'[AWS E2E Teardown] COGNITO_USER_POOL_ID not set, skipping Cognito cleanup.',
			);
		}

		// DynamoDB からテストユーザーのデータを削除
		await deleteDynamoDbTestData(tableName, region, TEST_EMAIL);

		return true;
	} catch (err) {
		console.log(`[AWS E2E Teardown] SDK cleanup error: ${String(err)}`);
		return false;
	}
}

/** Cognito から E2E テストユーザーを削除 */
async function deleteCognitoTestUser(
	userPoolId: string,
	region: string,
	email: string,
): Promise<void> {
	try {
		const {
			AdminDeleteUserCommand,
			CognitoIdentityProviderClient,
		} = await import('@aws-sdk/client-cognito-identity-provider');

		const client = new CognitoIdentityProviderClient({ region });
		await client.send(
			new AdminDeleteUserCommand({
				UserPoolId: userPoolId,
				Username: email,
			}),
		);
		console.log(`[AWS E2E Teardown] Cognito user deleted: ${email}`);
	} catch (err) {
		const errorName = (err as { name?: string })?.name ?? '';
		if (errorName === 'UserNotFoundException') {
			console.log(`[AWS E2E Teardown] Cognito user already gone: ${email}`);
			return;
		}
		throw err;
	}
}

/** DynamoDB から E2E テストユーザーのデータを検索・削除 */
async function deleteDynamoDbTestData(
	tableName: string,
	region: string,
	email: string,
): Promise<void> {
	const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
	const {
		DynamoDBDocumentClient,
		QueryCommand,
		DeleteCommand,
	} = await import('@aws-sdk/lib-dynamodb');

	const baseClient = new DynamoDBClient({ region });
	const doc = DynamoDBDocumentClient.from(baseClient, {
		marshallOptions: { removeUndefinedValues: true },
		unmarshallOptions: { wrapNumbers: false },
	});

	// GSI1 (inverted index: PK=SK) でメールからユーザーを検索
	const userResult = await doc.send(
		new QueryCommand({
			TableName: tableName,
			IndexName: 'GSI1',
			KeyConditionExpression: 'SK = :sk',
			ExpressionAttributeValues: { ':sk': `EMAIL#${email}` },
		}),
	);

	const userItems = userResult.Items ?? [];
	if (userItems.length === 0) {
		console.log(`[AWS E2E Teardown] No DynamoDB user found for: ${email}`);
		return;
	}

	for (const userItem of userItems) {
		const userId = userItem.userId as string;
		const userPK = `USER#${userId}`;

		// ユーザーのテナントメンバーシップを検索
		const membershipResult = await doc.send(
			new QueryCommand({
				TableName: tableName,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': userPK,
					':prefix': 'TENANT#',
				},
			}),
		);

		const tenantIds: string[] = [];
		for (const item of membershipResult.Items ?? []) {
			const tenantId = item.tenantId as string;
			if (tenantId) tenantIds.push(tenantId);

			// User-tenant membership を削除
			await doc.send(
				new DeleteCommand({
					TableName: tableName,
					Key: { PK: userPK, SK: item.SK },
				}),
			);
		}

		// 各テナントのクリーンアップ
		for (const tenantId of tenantIds) {
			await cleanupTenantData(doc, tableName, tenantId, userId);
		}

		// ユーザー関連の全アイテムを削除
		const userAllItems = await doc.send(
			new QueryCommand({
				TableName: tableName,
				KeyConditionExpression: 'PK = :pk',
				ExpressionAttributeValues: { ':pk': userPK },
			}),
		);

		for (const item of userAllItems.Items ?? []) {
			await doc.send(
				new DeleteCommand({
					TableName: tableName,
					Key: { PK: item.PK, SK: item.SK },
				}),
			);
		}

		console.log(
			`[AWS E2E Teardown] DynamoDB user cleaned: ${userId} (${tenantIds.length} tenant(s))`,
		);
	}

	baseClient.destroy();
}

/** テナント配下の全データを削除 */
async function cleanupTenantData(
	doc: import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
	tableName: string,
	tenantId: string,
	_userId: string,
): Promise<void> {
	const { QueryCommand, DeleteCommand, ScanCommand } = await import('@aws-sdk/lib-dynamodb');
	const tenantAuthPK = `TENANT#${tenantId}`;
	let totalDeleted = 0;

	// 1. Auth パーティション (PK=TENANT#<tenantId>) — メンバー、招待、同意等
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: tableName,
				KeyConditionExpression: 'PK = :pk',
				ExpressionAttributeValues: { ':pk': tenantAuthPK },
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			await doc.send(
				new DeleteCommand({
					TableName: tableName,
					Key: { PK: item.PK, SK: item.SK },
				}),
			);
			totalDeleted++;
		}

		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	// 2. データパーティション (PK begins_with T#<tenantId>#) — 子供、活動、設定等
	// DynamoDB の Query は正確な PK 一致のみ対応するため、Scan + FilterExpression を使用
	const dataPrefix = `T#${tenantId}#`;
	lastKey = undefined;

	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: tableName,
				FilterExpression: 'begins_with(PK, :prefix)',
				ExpressionAttributeValues: { ':prefix': dataPrefix },
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			await doc.send(
				new DeleteCommand({
					TableName: tableName,
					Key: { PK: item.PK, SK: item.SK },
				}),
			);
			totalDeleted++;
		}

		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	if (totalDeleted > 0) {
		console.log(
			`[AWS E2E Teardown] Cleaned ${totalDeleted} item(s) from tenant: ${tenantId}`,
		);
	}
}
