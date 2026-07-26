// tests/unit/auth/context-entitlement-freshness.test.ts
// #3963 AC2 / AC1: context_token Cookie が有効なままでも、課金状態は必ず DB の現在値に
// なることを CognitoAuthProvider.resolveContext のレベルで担保する。
//
// 本 Issue の事故は「Cookie が有効なら DB を一切見ずに返す」実装だったため、
// Stripe webhook / 解約 / 再開が DB を更新しても最大 24 時間 (owner TTL) 古い値が
// 使われ続けたこと。以下を機械的に固定する:
//
// - 解約方向: DB が suspended なら、Cookie が active を焼き込んでいても剥奪される
// - 決済方向: DB が active なら、Cookie が none を焼き込んでいても即座に有効になる
// - 旧形式 Cookie (plan / licenseStatus 入り) の焼き込み値が読まれないこと
// - DB 解決に失敗したら context を発行しない (fail-closed)

import { createHmac } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_LICENSE_STATUS } from '../../../src/lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '../../../src/lib/domain/constants/subscription-status';
import { asChildId } from '../../../src/lib/domain/ids';
import { CONTEXT_COOKIE_NAME } from '../../../src/lib/domain/validation/auth';
import type { Tenant } from '../../../src/lib/server/auth/entities';

// context-token.ts の getSecret() は初回呼び出し時に env を読んでキャッシュするため、
// 動的 import より前に固定しておく (未設定だとランダム鍵になり旧形式トークンを作れない)。
const TEST_SECRET = 'test-secret-key-for-entitlement-freshness';
process.env.CONTEXT_TOKEN_SECRET = TEST_SECRET;

// ---------- mocks ----------

const findTenantById = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { findTenantById, findUserByEmail: vi.fn(), findUserTenants: vi.fn() },
		child: { findChildByUserId: vi.fn() },
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { CognitoAuthProvider } = await import('../../../src/lib/server/auth/providers/cognito');
const { signContext } = await import('../../../src/lib/server/auth/context-token');
const { runWithRequestContext } = await import('../../../src/lib/server/request-context');

const identity = {
	type: 'cognito' as const,
	userId: 'u-1',
	email: 'owner@example.com',
};

/** context_token だけを持つ最小の RequestEvent スタブ */
function makeEvent(token: string | undefined): RequestEvent {
	const setCookie = vi.fn();
	return {
		cookies: {
			get: (name: string) => (name === CONTEXT_COOKIE_NAME ? token : undefined),
			set: setCookie,
			delete: vi.fn(),
		},
	} as unknown as RequestEvent;
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
	return {
		tenantId: 't-1',
		name: 'テスト家族',
		ownerId: 'u-1',
		status: SUBSCRIPTION_STATUS.ACTIVE,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

/** 旧形式トークン (課金状態が焼き込まれている) を現在の署名鍵で作る */
function signLegacyToken(claims: Record<string, unknown>): string {
	// signContext は claim を絞るため、焼き込み済みトークンは payload を直接作る
	const now = Math.floor(Date.now() / 1000);
	const encoded = Buffer.from(
		JSON.stringify({ ...claims, iat: now, exp: now + 24 * 60 * 60 }),
	).toString('base64url');
	// context-token.ts と同じ HMAC 鍵で署名する (署名自体は有効な旧形式トークンを作る)
	const signature = createHmac('sha256', TEST_SECRET).update(encoded).digest('base64url');
	return `${encoded}.${signature}`;
}

const provider = new CognitoAuthProvider();

beforeEach(() => {
	findTenantById.mockReset();
});

describe('resolveContext の課金状態は常に DB の現在値 (#3963)', () => {
	// AC2: 解約直後に 24 時間待たずに権限が剥奪される
	it('Cookie が有効でも DB が suspended なら licenseStatus=suspended になる', async () => {
		const token = signContext({ tenantId: 't-1', role: 'owner' });
		findTenantById.mockResolvedValue(
			makeTenant({ status: SUBSCRIPTION_STATUS.SUSPENDED, stripeSubscriptionId: 'sub_1' }),
		);

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(token), identity),
		);

		expect(context?.licenseStatus).toBe(AUTH_LICENSE_STATUS.SUSPENDED);
		expect(context?.tenantStatus).toBe(SUBSCRIPTION_STATUS.SUSPENDED);
		// Cookie を読むだけでは済まず、必ず DB を引いていること
		expect(findTenantById).toHaveBeenCalledWith('t-1');
	});

	// terminated は hooks.server.ts が完全ブロックする status
	it('DB が terminated なら tenantStatus=terminated が即座に反映される', async () => {
		const token = signContext({ tenantId: 't-1', role: 'owner' });
		findTenantById.mockResolvedValue(
			makeTenant({ status: SUBSCRIPTION_STATUS.TERMINATED, stripeSubscriptionId: 'sub_1' }),
		);

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(token), identity),
		);

		expect(context?.tenantStatus).toBe(SUBSCRIPTION_STATUS.TERMINATED);
	});

	// 決済方向: 本 incident (¥280 払ったのに無料プランのまま) の再発防止
	it('Cookie が無料時に発行されたものでも DB が active なら即座に有料になる', async () => {
		// Cookie 発行時点では subscription 無し (無料) だった
		const token = signContext({ tenantId: 't-1', role: 'owner' });
		// その後 Stripe webhook が DB を更新した
		findTenantById.mockResolvedValue(
			makeTenant({
				status: SUBSCRIPTION_STATUS.ACTIVE,
				stripeSubscriptionId: 'sub_1',
				plan: 'monthly',
			}),
		);

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(token), identity),
		);

		expect(context?.licenseStatus).toBe(AUTH_LICENSE_STATUS.ACTIVE);
		expect(context?.plan).toBe('monthly');
	});

	it('grace_period は licenseStatus=active のまま tenantStatus=grace_period で返る', async () => {
		const token = signContext({ tenantId: 't-1', role: 'owner' });
		findTenantById.mockResolvedValue(
			makeTenant({ status: SUBSCRIPTION_STATUS.GRACE_PERIOD, stripeSubscriptionId: 'sub_1' }),
		);

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(token), identity),
		);

		expect(context?.licenseStatus).toBe(AUTH_LICENSE_STATUS.ACTIVE);
		expect(context?.tenantStatus).toBe(SUBSCRIPTION_STATUS.GRACE_PERIOD);
	});

	it('role / tenantId / childId は Cookie の claim をそのまま引き継ぐ', async () => {
		const token = signContext({ tenantId: 't-1', role: 'child', childId: asChildId(42) });
		findTenantById.mockResolvedValue(makeTenant({ stripeSubscriptionId: 'sub_1' }));

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(token), identity),
		);

		expect(context?.tenantId).toBe('t-1');
		expect(context?.role).toBe('child');
		expect(context?.childId).toBe(asChildId(42));
	});

	// fail-closed: DB 障害時に古い Cookie の値で有料機能を通し続けない
	it('DB 解決に失敗したら context を発行しない (null)', async () => {
		const token = signContext({ tenantId: 't-1', role: 'owner' });
		findTenantById.mockRejectedValue(new Error('DSQL unavailable'));

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(token), identity),
		);

		expect(context).toBeNull();
	});

	it('identity が無ければ DB を引かずに null', async () => {
		const token = signContext({ tenantId: 't-1', role: 'owner' });

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(token), null),
		);

		expect(context).toBeNull();
		expect(findTenantById).not.toHaveBeenCalled();
	});

	// 旧形式 Cookie を持つブラウザが、焼き込まれた古い値で有料機能を使い続けないこと
	it('旧形式 Cookie の焼き込み licenseStatus は無視され DB 値が使われる', async () => {
		const legacy = signLegacyToken({
			tenantId: 't-1',
			role: 'owner',
			licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
			tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
			plan: 'family-monthly',
		});
		// DB では既に解約済み
		findTenantById.mockResolvedValue(
			makeTenant({
				status: SUBSCRIPTION_STATUS.SUSPENDED,
				stripeSubscriptionId: 'sub_1',
				plan: 'monthly',
			}),
		);

		const context = await runWithRequestContext(() =>
			provider.resolveContext(makeEvent(legacy), identity),
		);

		expect(context?.licenseStatus).toBe(AUTH_LICENSE_STATUS.SUSPENDED);
		expect(context?.plan).toBe('monthly');
	});
});
