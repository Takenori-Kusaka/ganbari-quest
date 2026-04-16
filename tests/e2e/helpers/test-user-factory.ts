/**
 * E2E test user factory (ADR-0030 D-3 / D-5).
 *
 * - email 命名規則 (ADR-0030 D-3): `e2e-{ISO date}-{sha7}-{run_attempt}-{worker}-{uuid8}@ganbari-quest.test`
 * - `.test` TLD で誤送信リスクなし
 * - sha 入りで「どのコミットが作ったユーザか」が残骸から追跡可能
 * - UUID で同一 run 内の並列衝突を完全排除
 *
 * 使い方:
 *   const user = await createTestUser({ adminClient, groups: ['ops'] });
 *   // ... test ...
 *   await user.cleanup();
 *
 *   // または fixture:
 *   await withTestUser({ adminClient }, async (user) => { ... });
 */

import { randomUUID } from 'node:crypto';
import type { CognitoAdminClient } from './cognito-admin-client';

export type CreateTestUserOptions = {
	adminClient: CognitoAdminClient;
	groups?: string[];
	attributes?: Record<string, string>;
	/** テスト名 / 目的のヒント。email には入らず、metadata として保持される */
	purpose?: string;
};

export type TestUser = {
	email: string;
	password: string;
	userId: string;
	cleanup: () => Promise<void>;
};

/**
 * email 命名規則 (ADR-0030 D-3) のパーツを組み立てる。
 * 環境変数が無い場合は現実的な fallback を使う (ローカル実行でも壊れない)。
 */
export function buildTestUserEmail(
	opts: { workerIndex?: number; runAttempt?: number } = {},
): string {
	const iso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	const sha = (process.env.GITHUB_SHA ?? 'localdev').slice(0, 7);
	const runAttempt = opts.runAttempt ?? Number(process.env.GITHUB_RUN_ATTEMPT ?? '0');
	const worker = opts.workerIndex ?? Number(process.env.TEST_WORKER_INDEX ?? '0');
	const uuid = randomUUID().replace(/-/g, '').slice(0, 8);
	return `e2e-${iso}-${sha}-${runAttempt}-w${worker}-${uuid}@ganbari-quest.test`;
}

/**
 * テストユーザー用 password を生成する。
 * Cognito policy (大文字/小文字/数字/記号/16+ 文字) を満たす。
 */
export function generateTestPassword(): string {
	const uuid = randomUUID().replace(/-/g, '');
	// 固定プレフィックスで policy 要件を確実に満たす
	return `E2e!${uuid.slice(0, 20)}Ax9`;
}

export async function createTestUser(options: CreateTestUserOptions): Promise<TestUser> {
	const { adminClient, groups, attributes } = options;
	const email = buildTestUserEmail();

	if (email.endsWith('@ganbari-quest.com')) {
		throw new Error(
			'[test-user-factory] refused to create user under production domain @ganbari-quest.com (ADR-0030)',
		);
	}

	const password = generateTestPassword();
	const created = await adminClient.createUser({ email, password, groups, attributes });

	return {
		email,
		password,
		userId: created.userId,
		cleanup: async () => {
			try {
				await adminClient.deleteUser(email);
			} catch (err) {
				if (!isUserAlreadyDeleted(err)) {
					throw err;
				}
			}
		},
	};
}

/**
 * fixture-style helper — fn 内で例外が起きても必ず cleanup を走らせる。
 */
export async function withTestUser<T>(
	options: CreateTestUserOptions,
	fn: (user: TestUser) => Promise<T>,
): Promise<T> {
	const user = await createTestUser(options);
	try {
		return await fn(user);
	} finally {
		await user.cleanup();
	}
}

function isUserAlreadyDeleted(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const name = (err as { name?: string }).name;
	return name === 'UserNotFoundException';
}
