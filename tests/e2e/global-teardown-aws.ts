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
	console.log(`[AWS E2E Teardown] Manual cleanup may be needed for test user: ${TEST_EMAIL}`);
}

// ============================================================
// 戦略1: API 経由でアカウント削除
// ============================================================

async function tryApiDeletion(): Promise<boolean> {
	if (!fs.existsSync(STORAGE_STATE_PATH)) {
		console.log('[AWS E2E Teardown] storageState not found, cannot use API deletion.');
		return false;
	}

	let browser: import('@playwright/test').Browser | undefined;
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
			const fullDeleteRes = await apiContext.post(`${BASE_URL}/api/v1/admin/account/delete`, {
				data: { pattern: 'owner-full-delete' },
			});
			if (fullDeleteRes.status() === 200) {
				console.log('[AWS E2E Teardown] Account deleted via API (full-delete pattern).');
				return true;
			}
		}

		const errorBody = await response.text().catch(() => '');
		console.log(`[AWS E2E Teardown] API deletion returned status ${status}: ${errorBody}`);
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
			console.log('[AWS E2E Teardown] COGNITO_USER_POOL_ID not set, skipping Cognito cleanup.');
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
		const { AdminDeleteUserCommand, CognitoIdentityProviderClient } = await import(
			'@aws-sdk/client-cognito-identity-provider'
		);

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

// ============================================================
// DynamoDB ヘルパー: ページング付き Query → 全件削除
// ============================================================

type DocClient = import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient;

/** Query でパーティション内のアイテムを全件取得（ページング対応） */
async function queryAllItems(
	doc: DocClient,
	tableName: string,
	keyConditionExpression: string,
	expressionAttributeValues: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
	const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
	const items: Record<string, unknown>[] = [];
	let lastEvaluatedKey: Record<string, unknown> | undefined;

	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: tableName,
				KeyConditionExpression: keyConditionExpression,
				ExpressionAttributeValues: expressionAttributeValues,
				ExclusiveStartKey: lastEvaluatedKey,
			}),
		);
		items.push(...((result.Items ?? []) as Record<string, unknown>[]));
		lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastEvaluatedKey);

	return items;
}

/** 指定されたアイテムを全件削除 */
async function deleteItems(
	doc: DocClient,
	tableName: string,
	items: Record<string, unknown>[],
): Promise<number> {
	const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
	let deleted = 0;
	for (const item of items) {
		await doc.send(
			new DeleteCommand({
				TableName: tableName,
				Key: { PK: item.PK, SK: item.SK },
			}),
		);
		deleted++;
	}
	return deleted;
}

/** GSI を使った Query（ページング対応） */
async function queryAllItemsGSI(
	doc: DocClient,
	tableName: string,
	indexName: string,
	keyConditionExpression: string,
	expressionAttributeValues: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
	const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
	const items: Record<string, unknown>[] = [];
	let lastEvaluatedKey: Record<string, unknown> | undefined;

	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: tableName,
				IndexName: indexName,
				KeyConditionExpression: keyConditionExpression,
				ExpressionAttributeValues: expressionAttributeValues,
				ExclusiveStartKey: lastEvaluatedKey,
			}),
		);
		items.push(...((result.Items ?? []) as Record<string, unknown>[]));
		lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastEvaluatedKey);

	return items;
}

// ============================================================
// DynamoDB テストデータ削除
// ============================================================

/** DynamoDB から E2E テストユーザーのデータを検索・削除 */
async function deleteDynamoDbTestData(
	tableName: string,
	region: string,
	email: string,
): Promise<void> {
	const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
	const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

	const baseClient = new DynamoDBClient({ region });
	const doc = DynamoDBDocumentClient.from(baseClient, {
		marshallOptions: { removeUndefinedValues: true },
		unmarshallOptions: { wrapNumbers: false },
	});

	// GSI1 (inverted index: PK=SK) でメールからユーザーを検索（ページング対応）
	const userItems = await queryAllItemsGSI(doc, tableName, 'GSI1', 'SK = :sk', {
		':sk': `EMAIL#${email}`,
	});

	if (userItems.length === 0) {
		console.log(`[AWS E2E Teardown] No DynamoDB user found for: ${email}`);
		return;
	}

	for (const userItem of userItems) {
		const userId = userItem.userId as string;
		const userPK = `USER#${userId}`;

		// ユーザーのテナントメンバーシップを検索（ページング対応）
		const membershipItems = await queryAllItems(
			doc,
			tableName,
			'PK = :pk AND begins_with(SK, :prefix)',
			{ ':pk': userPK, ':prefix': 'TENANT#' },
		);

		const tenantIds: string[] = [];
		for (const item of membershipItems) {
			const tenantId = item.tenantId as string;
			if (tenantId) tenantIds.push(tenantId);
		}

		// User-tenant membership を削除
		await deleteItems(doc, tableName, membershipItems);

		// 各テナントのクリーンアップ
		for (const tenantId of tenantIds) {
			await cleanupTenantData(doc, tableName, tenantId);
		}

		// ユーザー関連の全アイテムを削除（ページング対応）
		const userAllItems = await queryAllItems(doc, tableName, 'PK = :pk', { ':pk': userPK });
		await deleteItems(doc, tableName, userAllItems);

		console.log(
			`[AWS E2E Teardown] DynamoDB user cleaned: ${userId} (${tenantIds.length} tenant(s))`,
		);
	}

	baseClient.destroy();
}

/** テナント配下の全データを削除（INVITE#/LICENSE# 含む） */
async function cleanupTenantData(
	doc: DocClient,
	tableName: string,
	tenantId: string,
): Promise<void> {
	const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
	let totalDeleted = 0;

	// 1. Auth パーティション (PK=TENANT#<tenantId>) — メンバー、招待、同意等（ページング対応）
	const tenantAuthPK = `TENANT#${tenantId}`;
	const authItems = await queryAllItems(doc, tableName, 'PK = :pk', { ':pk': tenantAuthPK });

	// 招待コードとライセンスキーを収集（グローバルPK アイテム削除用）
	const inviteCodes: string[] = [];
	const licenseKeys: string[] = [];
	for (const item of authItems) {
		const sk = item.SK as string;
		if (sk?.startsWith('INVITE#')) {
			const code = sk.replace('INVITE#', '');
			if (code) inviteCodes.push(code);
		}
		if (sk === 'LICENSE') {
			// tenantLicenseKey の SK は 'LICENSE'（ライセンスキー値は item.licenseKey に格納）
			const key = item.licenseKey as string | undefined;
			if (key) licenseKeys.push(key);
		}
		// META アイテムの licenseKey フィールドも確認
		if (sk === 'META') {
			const key = item.licenseKey as string | undefined;
			if (key) licenseKeys.push(key);
		}
	}

	totalDeleted += await deleteItems(doc, tableName, authItems);

	// 2. INVITE#<code> グローバルアイテムの削除（招待コードの primary item）
	for (const code of inviteCodes) {
		try {
			await doc.send(
				new DeleteCommand({
					TableName: tableName,
					Key: { PK: `INVITE#${code}`, SK: 'META' },
				}),
			);
			totalDeleted++;
		} catch {
			// アイテムが既に削除済みの場合は無視
		}
	}

	// 3. LICENSE#<key> グローバルアイテムの削除（ライセンスキーの primary item）
	for (const key of licenseKeys) {
		try {
			await doc.send(
				new DeleteCommand({
					TableName: tableName,
					Key: { PK: `LICENSE#${key}`, SK: 'META' },
				}),
			);
			totalDeleted++;
		} catch {
			// アイテムが既に削除済みの場合は無視
		}
	}

	// 4. データパーティション (PK=T#<tenantId>#*) — 子供、活動、設定等
	//    DynamoDB の Query は正確な PK 一致のみ対応。テナント配下の既知のパーティションを列挙して削除。
	//    既知のサブパーティション: CHILDREN, ACTIVITIES, SETTINGS, LOGS, STATUSES, STAMPS, CHECKLISTS 等
	const knownSubPartitions = [
		'CHILDREN',
		'ACTIVITIES',
		'SETTINGS',
		'LOGS',
		'STATUSES',
		'STAMPS',
		'CHECKLISTS',
		'ACHIEVEMENTS',
		'SIBLING_CHALLENGES',
		'PUSH_SUBSCRIPTIONS',
		'NOTIFICATION_LOGS',
		'CERTIFICATES',
		'CUSTOM_ACHIEVEMENTS',
		'TRIAL_HISTORY',
		'VIEWER_TOKENS',
		'CUSTOM_VOICES',
		'MASTERY',
	];

	for (const sub of knownSubPartitions) {
		const subPK = `T#${tenantId}#${sub}`;
		const subItems = await queryAllItems(doc, tableName, 'PK = :pk', { ':pk': subPK });
		totalDeleted += await deleteItems(doc, tableName, subItems);
	}

	// 5. T#<tenantId> 直接パーティション（テナントレベルのデータ）
	const directPK = `T#${tenantId}`;
	const directItems = await queryAllItems(doc, tableName, 'PK = :pk', { ':pk': directPK });
	totalDeleted += await deleteItems(doc, tableName, directItems);

	if (totalDeleted > 0) {
		console.log(`[AWS E2E Teardown] Cleaned ${totalDeleted} item(s) from tenant: ${tenantId}`);
	}
}
