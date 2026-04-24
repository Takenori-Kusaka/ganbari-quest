/**
 * Unit tests for CognitoAdminClient (ADR-0030 D-5).
 *
 * Production guard が真っ先に効くことを証明する。AWS への実際の SDK 呼び出しは
 * `@aws-sdk/client-cognito-identity-provider` 全体を vi.mock で差し替え。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
	class FakeClient {
		send = sendMock;
	}
	class Cmd {
		_kind: string;
		input: unknown;
		constructor(kind: string, input: unknown) {
			this._kind = kind;
			this.input = input;
		}
	}
	return {
		CognitoIdentityProviderClient: FakeClient,
		AdminCreateUserCommand: class extends Cmd {
			constructor(input: unknown) {
				super('AdminCreateUser', input);
			}
		},
		AdminSetUserPasswordCommand: class extends Cmd {
			constructor(input: unknown) {
				super('AdminSetUserPassword', input);
			}
		},
		AdminDeleteUserCommand: class extends Cmd {
			constructor(input: unknown) {
				super('AdminDeleteUser', input);
			}
		},
		AdminGetUserCommand: class extends Cmd {
			constructor(input: unknown) {
				super('AdminGetUser', input);
			}
		},
		AdminAddUserToGroupCommand: class extends Cmd {
			constructor(input: unknown) {
				super('AdminAddUserToGroup', input);
			}
		},
		AdminRemoveUserFromGroupCommand: class extends Cmd {
			constructor(input: unknown) {
				super('AdminRemoveUserFromGroup', input);
			}
		},
		ListUsersCommand: class extends Cmd {
			constructor(input: unknown) {
				super('ListUsers', input);
			}
		},
	};
});

import {
	assertNotProductionUserPool,
	CognitoAdminClient,
} from '../../../tests/e2e/helpers/cognito-admin-client';

describe('assertNotProductionUserPool', () => {
	it('accepts staging / e2e pool ids', () => {
		expect(() => assertNotProductionUserPool('ap-northeast-1_stagingPool')).not.toThrow();
		expect(() => assertNotProductionUserPool('ap-northeast-1_e2epool1')).not.toThrow();
		expect(() => assertNotProductionUserPool('ap-northeast-1_devPool')).not.toThrow();
	});

	it('throws on production-looking pool ids', () => {
		expect(() => assertNotProductionUserPool('ap-northeast-1_ganbari-prod')).toThrow(/production/i);
		expect(() => assertNotProductionUserPool('ap-northeast-1_myPoolProd')).toThrow(/production/i);
		expect(() => assertNotProductionUserPool('ap-northeast-1_productionPool')).toThrow(
			/production/i,
		);
		expect(() => assertNotProductionUserPool('ap-northeast-1_prod_pool')).toThrow(/production/i);
	});

	it('is case-insensitive', () => {
		expect(() => assertNotProductionUserPool('AP-NORTHEAST-1_POOL-PROD')).toThrow(/production/i);
		expect(() => assertNotProductionUserPool('ap-northeast-1_PRODUCTIONpool')).toThrow(
			/production/i,
		);
	});
});

describe('CognitoAdminClient constructor', () => {
	beforeEach(() => {
		sendMock.mockReset();
	});

	it('rejects production User Pool in constructor', () => {
		expect(
			() =>
				new CognitoAdminClient({
					region: 'ap-northeast-1',
					userPoolId: 'ap-northeast-1_ganbari-prod',
				}),
		).toThrow(/production/i);
	});

	it('accepts staging User Pool', () => {
		expect(
			() =>
				new CognitoAdminClient({
					region: 'ap-northeast-1',
					userPoolId: 'ap-northeast-1_stagingPool',
				}),
		).not.toThrow();
	});
});

describe('CognitoAdminClient.createUser', () => {
	const region = 'ap-northeast-1';
	const userPoolId = 'ap-northeast-1_stagingPool';

	beforeEach(() => {
		sendMock.mockReset();
	});

	it('calls AdminCreateUser with SUPPRESS + AdminSetUserPassword Permanent', async () => {
		sendMock
			.mockResolvedValueOnce({
				User: {
					Username: 'user-abc',
					Attributes: [{ Name: 'sub', Value: 'sub-123' }],
					Enabled: true,
				},
			})
			.mockResolvedValueOnce({});

		const client = new CognitoAdminClient({ region, userPoolId });
		const result = await client.createUser({
			email: 'e2e-2026-04-16-abc1234-0-w0-deadbeef@ganbari-quest.test',
			password: 'E2e!secretValueXxxxAx9',
		});

		expect(result.userId).toBe('sub-123');
		expect(sendMock).toHaveBeenCalledTimes(2);

		const createCommand = sendMock.mock.calls[0]?.[0]!;
		expect(createCommand._kind).toBe('AdminCreateUser');
		expect(createCommand.input.UserPoolId).toBe(userPoolId);
		expect(createCommand.input.MessageAction).toBe('SUPPRESS');
		expect(createCommand.input.DesiredDeliveryMediums).toEqual([]);
		expect(createCommand.input.UserAttributes).toEqual(
			expect.arrayContaining([
				{ Name: 'email', Value: 'e2e-2026-04-16-abc1234-0-w0-deadbeef@ganbari-quest.test' },
				{ Name: 'email_verified', Value: 'true' },
			]),
		);

		const setPwCommand = sendMock.mock.calls[1]?.[0]!;
		expect(setPwCommand._kind).toBe('AdminSetUserPassword');
		expect(setPwCommand.input.Permanent).toBe(true);
	});

	it('adds user to groups when requested', async () => {
		sendMock
			.mockResolvedValueOnce({
				User: { Username: 'u', Attributes: [{ Name: 'sub', Value: 'sub-1' }], Enabled: true },
			})
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({});

		const client = new CognitoAdminClient({ region, userPoolId });
		await client.createUser({
			email: 'e2e-foo@ganbari-quest.test',
			password: 'E2e!xxxxxxxxxxxxxxxxAx9',
			groups: ['ops', 'admin'],
		});

		expect(sendMock).toHaveBeenCalledTimes(4);
		const group1 = sendMock.mock.calls[2]?.[0]!;
		const group2 = sendMock.mock.calls[3]?.[0]!;
		expect(group1._kind).toBe('AdminAddUserToGroup');
		expect(group1.input.GroupName).toBe('ops');
		expect(group2.input.GroupName).toBe('admin');
	});

	it('throws when AdminCreateUser returns no sub', async () => {
		sendMock
			.mockResolvedValueOnce({ User: { Username: undefined, Attributes: [] } })
			.mockResolvedValueOnce({});

		const client = new CognitoAdminClient({ region, userPoolId });
		await expect(
			client.createUser({
				email: 'e2e-no-sub@ganbari-quest.test',
				password: 'E2e!xxxxxxxxxxxxxxxxAx9',
			}),
		).rejects.toThrow(/no sub/);
	});
});

describe('CognitoAdminClient.getUser', () => {
	beforeEach(() => {
		sendMock.mockReset();
	});

	it('returns null when UserNotFoundException is thrown', async () => {
		const notFound = Object.assign(new Error('not found'), { name: 'UserNotFoundException' });
		sendMock.mockRejectedValueOnce(notFound);

		const client = new CognitoAdminClient({
			region: 'ap-northeast-1',
			userPoolId: 'ap-northeast-1_stagingPool',
		});
		const result = await client.getUser('missing@ganbari-quest.test');
		expect(result).toBeNull();
	});

	it('rethrows other errors', async () => {
		sendMock.mockRejectedValueOnce(new Error('boom'));

		const client = new CognitoAdminClient({
			region: 'ap-northeast-1',
			userPoolId: 'ap-northeast-1_stagingPool',
		});
		await expect(client.getUser('x@ganbari-quest.test')).rejects.toThrow(/boom/);
	});
});

describe('CognitoAdminClient.listUsersByEmailPrefix', () => {
	beforeEach(() => {
		sendMock.mockReset();
	});

	it('passes email prefix filter to ListUsersCommand', async () => {
		sendMock.mockResolvedValueOnce({ Users: [{ Username: 'user-1' }, { Username: 'user-2' }] });

		const client = new CognitoAdminClient({
			region: 'ap-northeast-1',
			userPoolId: 'ap-northeast-1_stagingPool',
		});
		const users = await client.listUsersByEmailPrefix('e2e-', 30);

		expect(users).toHaveLength(2);
		const cmd = sendMock.mock.calls[0]?.[0]!;
		expect(cmd._kind).toBe('ListUsers');
		expect(cmd.input.Filter).toBe('email ^= "e2e-"');
		expect(cmd.input.Limit).toBe(30);
	});
});
