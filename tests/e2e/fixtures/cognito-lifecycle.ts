/**
 * Playwright fixtures for Cognito E2E test-user lifecycle (ADR-0030 D-5).
 *
 * 使い方:
 *   import { test, expect } from './fixtures/cognito-lifecycle';
 *
 *   test('ops signin with group-based auth', async ({ page, opsUser }) => {
 *     await page.goto('/ops');
 *     // opsUser is auto-created with ops group, cleaned up after test.
 *   });
 *
 * 要求 env (staging only — ADR-0030 D-2 により prod User Pool は IAM で禁止):
 *   - AWS_REGION
 *   - COGNITO_E2E_USER_POOL_ID   (staging pool の ID — prod は throw される)
 *   - AWS credentials: OIDC 経由で自動注入 (GitHub Actions の `aws-actions/configure-aws-credentials`)
 */

import { test as base } from '@playwright/test';
import { CognitoAdminClient } from '../helpers/cognito-admin-client';
import {
	type CreateTestUserOptions,
	createTestUser,
	type TestUser,
} from '../helpers/test-user-factory';

type TestFixtures = {
	/** 標準テスト用ユーザー (グループなし) */
	testUser: TestUser;
	/** ops グループ所属ユーザー (ADR-0030 + #820) */
	opsUser: TestUser;
	/** 任意グループ構成のユーザーを作る factory */
	makeTestUser: (opts?: Partial<CreateTestUserOptions>) => Promise<TestUser>;
};

type WorkerFixtures = {
	cognitoAdminClient: CognitoAdminClient;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
	cognitoAdminClient: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures require ({ deps }, use) signature
		async ({}, use) => {
			const region = process.env.AWS_REGION;
			const userPoolId = process.env.COGNITO_E2E_USER_POOL_ID;
			if (!region || !userPoolId) {
				throw new Error(
					'[cognito-lifecycle] AWS_REGION and COGNITO_E2E_USER_POOL_ID must be set for AWS E2E fixtures (ADR-0030 D-2). ' +
						'Run non-AWS tests via cognito-dev mode instead.',
				);
			}
			const client = new CognitoAdminClient({ region, userPoolId });
			await use(client);
		},
		{ scope: 'worker' },
	],

	makeTestUser: async ({ cognitoAdminClient }, use) => {
		const created: TestUser[] = [];
		const factory = async (opts: Partial<CreateTestUserOptions> = {}) => {
			const user = await createTestUser({
				adminClient: cognitoAdminClient,
				...opts,
			});
			created.push(user);
			return user;
		};
		await use(factory);
		for (const user of created) {
			await user.cleanup().catch((err: unknown) => {
				// D-4 3段構え: spec-local cleanup が失敗しても global-teardown + nightly janitor で補完
				console.warn(`[cognito-lifecycle] cleanup failed for ${user.email}:`, err);
			});
		}
	},

	testUser: async ({ makeTestUser }, use) => {
		const user = await makeTestUser();
		await use(user);
	},

	opsUser: async ({ makeTestUser }, use) => {
		const user = await makeTestUser({ groups: ['ops'] });
		await use(user);
	},
});

export { expect } from '@playwright/test';
