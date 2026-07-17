// tests/e2e/global-teardown-aws.ts
// AWS 本番環境 E2E テスト後のクリーンアップ
//
// 2段階のクリーンアップ戦略:
// 1. 認証済み storageState を使って API 経由でアカウント削除（推奨、DB データを含む）
// 2. フォールバック: AWS SDK で Cognito テストユーザーを直接削除
//
// #3438 (EPIC #3424): DB backend が DynamoDB → Aurora DSQL に移管されたため、旧 SDK 直接
// DynamoDB 削除 (戦略 2 の DynamoDB 掃除) を撤去。テナント / 子供 / 活動などの DB データは
// 戦略 1 (API 経由アカウント削除) が DSQL に対して削除する。SDK フォールバックは Cognito
// ユーザー削除のみを担う (DSQL には teardown 用の破壊的 admin API を持たせないため、SDK 直
// 掃除は Cognito に限定する)。

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

	// 戦略1: API 経由でアカウント削除 (DB データ含む)
	const apiSuccess = await tryApiDeletion();
	if (apiSuccess) {
		console.log('[AWS E2E Teardown] API-based cleanup succeeded.');
		return;
	}

	// 戦略2: AWS SDK 直接操作 (Cognito ユーザー削除のフォールバック)
	console.log('[AWS E2E Teardown] API cleanup failed, trying direct SDK cleanup...');
	const sdkSuccess = await trySdkDeletion();
	if (sdkSuccess) {
		console.log('[AWS E2E Teardown] SDK-based Cognito cleanup succeeded.');
		return;
	}

	// 両方失敗しても、teardown の失敗でテストスイートを落とさない
	console.log('[AWS E2E Teardown] WARNING: Cleanup failed. Orphaned test data may remain.');
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
// 戦略2: AWS SDK 直接操作 (Cognito ユーザー削除のみ)
// ============================================================

async function trySdkDeletion(): Promise<boolean> {
	const userPoolId = process.env.COGNITO_USER_POOL_ID;
	const region = process.env.AWS_REGION ?? 'us-east-1';

	if (!userPoolId) {
		console.log('[AWS E2E Teardown] COGNITO_USER_POOL_ID not set, skipping Cognito cleanup.');
		return false;
	}

	try {
		await deleteCognitoTestUser(userPoolId, region, TEST_EMAIL);
		return true;
	} catch (err) {
		console.log(`[AWS E2E Teardown] SDK Cognito cleanup error: ${String(err)}`);
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
