/**
 * Cognito Admin API client wrapper for E2E tests (ADR-0030 D-2 / D-5).
 *
 * Production User Pool への誤操作を「物理」と「ランタイム」の二重で防ぐ:
 *   - IAM: CDK の E2EAdminRole は staging User Pool ARN のみ Allow (ADR-0030 D-2)
 *   - Runtime: このクラスの production guard が pool ID を検査し throw
 *
 * 禁止 (ADR-0030):
 *   - production User Pool Id を渡すこと (即 throw)
 *   - @ganbari-quest.com ドメインの email を作成すること (呼び出し側で防ぐ)
 *   - 静的 Access Key を使うこと (OIDC 経由で credentials を取得)
 */

import {
	AdminAddUserToGroupCommand,
	AdminCreateUserCommand,
	AdminDeleteUserCommand,
	AdminGetUserCommand,
	AdminRemoveUserFromGroupCommand,
	AdminSetUserPasswordCommand,
	CognitoIdentityProviderClient,
	ListUsersCommand,
	type UserType,
} from '@aws-sdk/client-cognito-identity-provider';

export type CognitoAdminClientOptions = {
	region: string;
	userPoolId: string;
};

export type AdminCreateUserOptions = {
	email: string;
	password: string;
	groups?: string[];
	attributes?: Record<string, string>;
};

export type AdminCreateUserResult = {
	userId: string;
	email: string;
	enabled: boolean;
};

/**
 * Runtime guard: production User Pool Id を弾く。
 * IAM 側で既に防がれているが、開発者が誤って prod pool id を config に書いても
 * AWS へ到達する前にここで例外を投げる (ADR-0030 D-5)。
 */
export function assertNotProductionUserPool(userPoolId: string): void {
	const lowered = userPoolId.toLowerCase();
	if (
		lowered.includes('-prod') ||
		lowered.includes('_prod') ||
		lowered.endsWith('prod') ||
		lowered.includes('production')
	) {
		throw new Error(
			`[CognitoAdminClient] refused to operate on production-looking User Pool: ${userPoolId}. ` +
				'E2E helpers may only target staging / e2e User Pools (ADR-0030 D-2 / D-5).',
		);
	}
}

export class CognitoAdminClient {
	readonly region: string;
	readonly userPoolId: string;
	private readonly client: CognitoIdentityProviderClient;

	constructor(options: CognitoAdminClientOptions) {
		assertNotProductionUserPool(options.userPoolId);
		this.region = options.region;
		this.userPoolId = options.userPoolId;
		this.client = new CognitoIdentityProviderClient({ region: options.region });
	}

	async createUser(options: AdminCreateUserOptions): Promise<AdminCreateUserResult> {
		const { email, password, groups = [], attributes = {} } = options;

		const userAttrs = [
			{ Name: 'email', Value: email },
			{ Name: 'email_verified', Value: 'true' },
			...Object.entries(attributes).map(([Name, Value]) => ({ Name, Value })),
		];

		const created = await this.client.send(
			new AdminCreateUserCommand({
				UserPoolId: this.userPoolId,
				Username: email,
				UserAttributes: userAttrs,
				MessageAction: 'SUPPRESS',
				DesiredDeliveryMediums: [],
			}),
		);

		await this.client.send(
			new AdminSetUserPasswordCommand({
				UserPoolId: this.userPoolId,
				Username: email,
				Password: password,
				Permanent: true,
			}),
		);

		for (const group of groups) {
			await this.client.send(
				new AdminAddUserToGroupCommand({
					UserPoolId: this.userPoolId,
					Username: email,
					GroupName: group,
				}),
			);
		}

		const sub =
			created.User?.Attributes?.find((attr) => attr.Name === 'sub')?.Value ??
			created.User?.Username;
		if (!sub) {
			throw new Error(`[CognitoAdminClient] AdminCreateUser returned no sub for ${email}`);
		}

		return {
			userId: sub,
			email,
			enabled: created.User?.Enabled ?? true,
		};
	}

	async deleteUser(email: string): Promise<void> {
		await this.client.send(
			new AdminDeleteUserCommand({
				UserPoolId: this.userPoolId,
				Username: email,
			}),
		);
	}

	async getUser(email: string): Promise<UserType | null> {
		try {
			const res = await this.client.send(
				new AdminGetUserCommand({
					UserPoolId: this.userPoolId,
					Username: email,
				}),
			);
			return {
				Username: res.Username,
				Attributes: res.UserAttributes,
				Enabled: res.Enabled,
				UserStatus: res.UserStatus,
			} satisfies UserType;
		} catch (err) {
			if (isUserNotFoundError(err)) return null;
			throw err;
		}
	}

	async addUserToGroup(email: string, group: string): Promise<void> {
		await this.client.send(
			new AdminAddUserToGroupCommand({
				UserPoolId: this.userPoolId,
				Username: email,
				GroupName: group,
			}),
		);
	}

	async removeUserFromGroup(email: string, group: string): Promise<void> {
		await this.client.send(
			new AdminRemoveUserFromGroupCommand({
				UserPoolId: this.userPoolId,
				Username: email,
				GroupName: group,
			}),
		);
	}

	/**
	 * email prefix で User Pool を scan する。global-teardown と nightly janitor が
	 * orphan を掃除するのに使う (ADR-0030 D-4)。
	 */
	async listUsersByEmailPrefix(prefix: string, limit = 60): Promise<UserType[]> {
		const res = await this.client.send(
			new ListUsersCommand({
				UserPoolId: this.userPoolId,
				Filter: `email ^= "${prefix}"`,
				Limit: limit,
			}),
		);
		return res.Users ?? [];
	}
}

function isUserNotFoundError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const name = (err as { name?: string }).name;
	return name === 'UserNotFoundException';
}
