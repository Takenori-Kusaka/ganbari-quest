import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import type { Invite, Membership, Tenant } from '../../../src/lib/server/auth/entities';
import type { IAuthRepo } from '../../../src/lib/server/db/interfaces/auth-repo.interface';
import { assertError, assertSuccess } from '../helpers/assert-result';

// モック用のインメモリストア
let inviteStore: Map<string, Invite>;
let membershipStore: Membership[];
let tenantStore: Map<string, Tenant>;
let userTenantStore: Map<string, Membership[]>;

// #3585: inviteId は管理鍵、inviteCode は raw code。unit mock では inviteId を code から
// 派生 (id-<code>) して一意にし「service が inviteId を渡す (code ではない)」ことを検証可能にする。
function makePendingInvite(overrides: Partial<Invite> = {}): Invite {
	const inviteCode = overrides.inviteCode ?? 'test-code-123';
	return {
		inviteId: `id-${inviteCode}`,
		inviteCode,
		tenantId: 't-test',
		invitedBy: 'user-owner',
		role: 'parent',
		status: 'pending',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		...overrides,
	};
}

const mockAuthRepo: Partial<IAuthRepo> = {
	createInvite: vi.fn(async (input) => {
		const inviteCode = `inv-${Date.now()}`;
		const invite: Invite = {
			inviteId: `id-${inviteCode}`,
			inviteCode,
			tenantId: input.tenantId,
			invitedBy: input.invitedBy,
			role: input.role,
			childId: input.childId,
			status: 'pending',
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		};
		inviteStore.set(invite.inviteCode, invite);
		return invite;
	}),
	findInviteByCode: vi.fn(async (code: string) => {
		return inviteStore.get(code);
	}),
	// #3585: 管理系は inviteId 鍵。store は inviteCode で引くため inviteId で線形検索する。
	// #3588: tenant scope は tenantId 引数 (family_id 述語相当) で他 tenant の invite を弾く。
	updateInviteStatus: vi.fn(
		async (inviteId: string, tenantId: string, status: string, acceptedBy?: string) => {
			const invite = [...inviteStore.values()].find(
				(i) => i.inviteId === inviteId && i.tenantId === tenantId,
			);
			if (invite) {
				invite.status = status as Invite['status'];
				if (acceptedBy) {
					invite.acceptedBy = acceptedBy;
					invite.acceptedAt = new Date().toISOString();
				}
			}
		},
	),
	findTenantInvites: vi.fn(async (tenantId: string) => {
		return Array.from(inviteStore.values()).filter((i) => i.tenantId === tenantId);
	}),
	findUserTenants: vi.fn(async (userId: string) => {
		return userTenantStore.get(userId) ?? [];
	}),
	findTenantById: vi.fn(async (tenantId: string) => {
		return tenantStore.get(tenantId);
	}),
	createMembership: vi.fn(async (input) => {
		const membership: Membership = {
			userId: input.userId,
			tenantId: input.tenantId,
			role: input.role,
			joinedAt: new Date().toISOString(),
			invitedBy: input.invitedBy,
		};
		membershipStore.push(membership);
		return membership;
	}),
	// #4039: 受諾は「invite の accepted 化 + membership INSERT」を単一 txn で行う repo 契約
	// (dsql-data-model.md §6.6)。mock も 1 呼び出しで両方を反映し、業務失敗時は何も書かない
	// (部分コミットが起きえないことを service 層の test から観測できるようにする)。
	acceptInviteTransactional: vi.fn(async (input) => {
		const invite = [...inviteStore.values()].find((i) => i.inviteId === input.inviteId);
		if (
			!invite ||
			invite.status !== 'pending' ||
			new Date(invite.expiresAt) < new Date(input.now)
		) {
			return { ok: false as const, reason: 'INVALID_OR_EXPIRED' as const };
		}
		if (membershipStore.some((m) => m.tenantId === invite.tenantId && m.userId === input.userId)) {
			// membership の PK 重複 (23505) 相当。invite の accepted 化ごと rollback される。
			return { ok: false as const, reason: 'ALREADY_IN_TENANT' as const };
		}
		invite.status = 'accepted';
		invite.acceptedBy = input.userId;
		invite.acceptedAt = input.now;
		membershipStore.push({
			userId: input.userId,
			tenantId: invite.tenantId,
			role: invite.role,
			joinedAt: input.now,
			invitedBy: invite.invitedBy,
		});
		return {
			ok: true as const,
			familyId: invite.tenantId,
			role: invite.role,
			invitedBy: invite.invitedBy,
			joinedAt: input.now,
		};
	}),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: mockAuthRepo }),
}));

// invite-service のインポート（mock の後）
import {
	acceptInvite,
	createInvite,
	getInvite,
	listInvites,
	revokeInvite,
} from '../../../src/lib/server/services/invite-service';

beforeEach(() => {
	inviteStore = new Map();
	membershipStore = [];
	tenantStore = new Map();
	userTenantStore = new Map();
	vi.clearAllMocks();
});

describe('createInvite', () => {
	it('parent ロールで招待を作成できる', async () => {
		const invite = await createInvite('t-test', 'user-owner', 'parent');
		expect(invite.tenantId).toBe('t-test');
		expect(invite.invitedBy).toBe('user-owner');
		expect(invite.role).toBe('parent');
		expect(invite.status).toBe('pending');
	});

	it('child ロールで招待を作成できる', async () => {
		const invite = await createInvite('t-test', 'user-owner', 'child', asChildId(5));
		expect(invite.role).toBe('child');
		expect(invite.childId).toBe('5');
	});

	it('owner ロールでの招待はエラー', async () => {
		await expect(createInvite('t-test', 'user-owner', 'owner')).rejects.toThrow(
			'ownerロールでの招待はできません',
		);
	});
});

describe('getInvite', () => {
	it('有効な招待コードで招待を取得できる', async () => {
		const invite = makePendingInvite();
		inviteStore.set('test-code-123', invite);

		const result = await getInvite('test-code-123');
		expect(result).not.toBeNull();
		expect(result?.inviteCode).toBe('test-code-123');
	});

	it('存在しないコードは null を返す', async () => {
		const result = await getInvite('nonexistent');
		expect(result).toBeNull();
	});

	it('accepted 状態の招待は null を返す', async () => {
		inviteStore.set('used', makePendingInvite({ inviteCode: 'used', status: 'accepted' }));
		const result = await getInvite('used');
		expect(result).toBeNull();
	});

	it('expired 状態の招待は null を返す', async () => {
		inviteStore.set('exp', makePendingInvite({ inviteCode: 'exp', status: 'expired' }));
		const result = await getInvite('exp');
		expect(result).toBeNull();
	});

	it('期限切れの pending 招待は expired に更新して null を返す', async () => {
		const expired = makePendingInvite({
			inviteCode: 'past',
			expiresAt: new Date(Date.now() - 1000).toISOString(),
		});
		inviteStore.set('past', expired);

		const result = await getInvite('past');
		expect(result).toBeNull();
		// #3585: 状態遷移は inviteId 鍵 (code ではなく invite.inviteId を渡す)
		expect(mockAuthRepo.updateInviteStatus).toHaveBeenCalledWith('id-past', 't-test', 'expired');
	});
});

describe('acceptInvite', () => {
	it('有効な招待でテナントに参加できる', async () => {
		const invite = makePendingInvite({ inviteCode: 'acc-1' });
		inviteStore.set('acc-1', invite);
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		const result = assertSuccess(await acceptInvite('acc-1', 'new-user'));
		expect(result.membership.tenantId).toBe('t-test');
		expect(result.membership.role).toBe('parent');
	});

	// #4039: 受諾経路が「単一 txn の repo 契約」に結線されていることを固定する。
	// 旧実装 (createMembership → updateInviteStatus の 2 回呼び、後者の失敗は握り潰し) に
	// 戻ると、membership だけ commit されて invite が pending のまま残る部分コミットが
	// 復活する。本 test は結線が外れた瞬間に落ちる。
	it('受諾は単一 txn の acceptInviteTransactional 経由で行う (部分コミット禁止、§6.6)', async () => {
		inviteStore.set('acc-txn', makePendingInvite({ inviteCode: 'acc-txn' }));
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		assertSuccess(await acceptInvite('acc-txn', 'txn-user'));

		expect(mockAuthRepo.acceptInviteTransactional).toHaveBeenCalledWith(
			expect.objectContaining({ inviteId: 'id-acc-txn', userId: 'txn-user' }),
		);
		// 受諾を 2 回の書込に分解しない (membership 作成と invite 遷移は txn 側の責務)
		expect(mockAuthRepo.createMembership).not.toHaveBeenCalled();
		expect(mockAuthRepo.updateInviteStatus).not.toHaveBeenCalled();
		// 片方だけ commit された状態にならない
		expect(inviteStore.get('acc-txn')?.status).toBe('accepted');
		expect(membershipStore).toHaveLength(1);
	});

	it('txn が業務失敗を返したら membership も invite 遷移も起きない (ALREADY_IN_TENANT)', async () => {
		inviteStore.set('acc-dup', makePendingInvite({ inviteCode: 'acc-dup' }));
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);
		membershipStore.push({
			userId: 'dup-user',
			tenantId: 't-test',
			role: 'parent',
			joinedAt: new Date().toISOString(),
		});

		const result = assertError(await acceptInvite('acc-dup', 'dup-user'));
		expect(result.error).toBe('ALREADY_IN_TENANT');
		expect(inviteStore.get('acc-dup')?.status).toBe('pending');
		expect(membershipStore).toHaveLength(1);
	});

	it('無効な招待コードはエラー', async () => {
		const result = assertError(await acceptInvite('bad-code', 'user'));
		expect(result.error).toBe('INVALID_OR_EXPIRED');
	});

	it('既にテナントに所属しているユーザーはエラー', async () => {
		inviteStore.set('acc-2', makePendingInvite({ inviteCode: 'acc-2' }));
		userTenantStore.set('existing-user', [
			{
				userId: 'existing-user',
				tenantId: 't-other',
				role: 'parent',
				joinedAt: new Date().toISOString(),
			},
		]);

		const result = assertError(await acceptInvite('acc-2', 'existing-user'));
		expect(result.error).toBe('ALREADY_IN_TENANT');
	});

	it('テナントが存在しない場合はエラー', async () => {
		inviteStore.set('acc-3', makePendingInvite({ inviteCode: 'acc-3' }));

		const result = assertError(await acceptInvite('acc-3', 'user'));
		expect(result.error).toBe('TENANT_NOT_FOUND');
	});

	it('自分で作成した招待は受諾できない (#0203)', async () => {
		inviteStore.set(
			'self-inv',
			makePendingInvite({ inviteCode: 'self-inv', invitedBy: 'user-owner' }),
		);

		const result = assertError(await acceptInvite('self-inv', 'user-owner'));
		expect(result.error).toBe('SELF_INVITE_NOT_ALLOWED');
	});

	it('owner は招待でダウングレードされない (#0203)', async () => {
		inviteStore.set(
			'downgrade',
			makePendingInvite({ inviteCode: 'downgrade', tenantId: 't-test' }),
		);
		userTenantStore.set('owner-user', [
			{
				userId: 'owner-user',
				tenantId: 't-test',
				role: 'owner',
				joinedAt: new Date().toISOString(),
			},
		]);

		const result = assertError(await acceptInvite('downgrade', 'owner-user'));
		expect(result.error).toBe('OWNER_CANNOT_BE_DOWNGRADED');
	});
});

// #3585: revoke は inviteId 鍵 (admin 一覧の inviteId を受ける)。tenant scope は
// findTenantInvites (tenant 束縛一覧) に inviteId が存在することで担保する。
describe('revokeInvite (#3585 inviteId 鍵)', () => {
	it('一覧の inviteId で pending の招待を取り消せる', async () => {
		inviteStore.set('rev-1', makePendingInvite({ inviteCode: 'rev-1' }));

		await revokeInvite('id-rev-1', 't-test');
		expect(mockAuthRepo.updateInviteStatus).toHaveBeenCalledWith('id-rev-1', 't-test', 'revoked');
	});

	it('別テナントの inviteId は取り消せない (一覧に無い → no-op、cross-tenant 防止)', async () => {
		inviteStore.set('rev-2', makePendingInvite({ inviteCode: 'rev-2', tenantId: 't-other' }));

		await revokeInvite('id-rev-2', 't-test');
		expect(mockAuthRepo.updateInviteStatus).not.toHaveBeenCalled();
	});

	it('既に accepted の招待は取り消せない (状態機械)', async () => {
		inviteStore.set('rev-3', makePendingInvite({ inviteCode: 'rev-3', status: 'accepted' }));

		await revokeInvite('id-rev-3', 't-test');
		expect(mockAuthRepo.updateInviteStatus).not.toHaveBeenCalled();
	});

	it('存在しない inviteId は no-op', async () => {
		await revokeInvite('id-nonexistent', 't-test');
		expect(mockAuthRepo.updateInviteStatus).not.toHaveBeenCalled();
	});
});

describe('listInvites', () => {
	it('テナントの招待一覧を取得できる', async () => {
		inviteStore.set('l1', makePendingInvite({ inviteCode: 'l1' }));
		inviteStore.set('l2', makePendingInvite({ inviteCode: 'l2' }));
		inviteStore.set('l3', makePendingInvite({ inviteCode: 'l3', tenantId: 't-other' }));

		const result = await listInvites('t-test');
		expect(result).toHaveLength(2);
	});
});

// #3549 判断2 (PO 決裁 2026-07-03) / dsql-data-model.md §6.6 ⚠️:
// invite.email 設定時は受諾 user の email と一致必須 (招待リンク横流しによる別人受諾防止)。
// email 未設定の招待は従来通り (opt-in 束縛、child 招待等 email を持たない受諾者向け)。
describe('招待 email 束縛 (#3549 判断2 / §6.6)', () => {
	it('invite.email 設定 + 受諾者 email 不一致 → INVITE_EMAIL_MISMATCH (membership 未作成)', async () => {
		inviteStore.set(
			'em-1',
			makePendingInvite({ inviteCode: 'em-1', email: 'intended@example.com' }),
		);
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		const result = assertError(await acceptInvite('em-1', 'user-new', 'attacker@example.com'));
		expect(result.error).toBe('INVITE_EMAIL_MISMATCH');
		expect(membershipStore).toHaveLength(0);
		// 招待は pending のまま (再受諾可能性を保持、消費しない)
		expect(inviteStore.get('em-1')?.status).toBe('pending');
	});

	it('大文字小文字差は一致扱い (email_lower と同じ case-insensitive 原則)', async () => {
		inviteStore.set(
			'em-2',
			makePendingInvite({ inviteCode: 'em-2', email: 'Intended@Example.com' }),
		);
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		const result = assertSuccess(await acceptInvite('em-2', 'user-new', 'intended@example.com'));
		expect(result.membership.tenantId).toBe('t-test');
	});

	it('invite.email 設定 + 受諾者 email 未提供 → INVITE_EMAIL_MISMATCH (fail-closed)', async () => {
		inviteStore.set(
			'em-3',
			makePendingInvite({ inviteCode: 'em-3', email: 'intended@example.com' }),
		);
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		const result = assertError(await acceptInvite('em-3', 'user-new'));
		expect(result.error).toBe('INVITE_EMAIL_MISMATCH');
	});

	it('invite.email 未設定 → 従来通り受諾できる (opt-in 束縛)', async () => {
		inviteStore.set('em-4', makePendingInvite({ inviteCode: 'em-4' }));
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		assertSuccess(await acceptInvite('em-4', 'user-new', 'anyone@example.com'));
	});

	it('createInvite が email を trim + 小文字化して repo に引き渡す', async () => {
		await createInvite('t-test', 'user-owner', 'parent', undefined, '  Intended@Example.com ');
		expect(mockAuthRepo.createInvite).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'intended@example.com' }),
		);
	});
});

// #3555 ②: 招待失効が email mismatch の replay window を上限する regression。
// 期限切れ後は正しい email でも INVALID_OR_EXPIRED になり、横流しリンクの
// 試行可能期間は INVITE_EXPIRY_DAYS (7 日) で必ず閉じる。
describe('招待失効 × email 束縛 (#3555 ②)', () => {
	it('期限切れの email 束縛招待は正しい email でも INVALID_OR_EXPIRED (replay window 上限)', async () => {
		inviteStore.set(
			'exp-em',
			makePendingInvite({
				inviteCode: 'exp-em',
				email: 'intended@example.com',
				expiresAt: new Date(Date.now() - 1000).toISOString(),
			}),
		);
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		const result = assertError(await acceptInvite('exp-em', 'user-new', 'intended@example.com'));
		expect(result.error).toBe('INVALID_OR_EXPIRED');
		// pending のまま放置されず expired に遷移する (getInvite の自動失効、#3585 inviteId 鍵)
		expect(mockAuthRepo.updateInviteStatus).toHaveBeenCalledWith('id-exp-em', 't-test', 'expired');
	});
});

// #3555 ③: email 束縛招待の受諾は検証済み email が前提。email_verified=false の
// provider 構成が将来入った場合、未検証 email での束縛招待受諾を fail-closed で拒否する。
// email_verified 未提供 (undefined) は現行 provider (Cognito は常に claim を含む /
// local・dev は claim なし) との後方互換のため許容する。
describe('email_verified enforcement (#3555 ③)', () => {
	beforeEach(() => {
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);
	});

	it('email 束縛招待 + emailVerified=false → INVITE_EMAIL_UNVERIFIED (fail-closed、membership 未作成)', async () => {
		inviteStore.set(
			'ev-1',
			makePendingInvite({ inviteCode: 'ev-1', email: 'intended@example.com' }),
		);

		const result = assertError(
			await acceptInvite('ev-1', 'user-new', 'intended@example.com', { emailVerified: false }),
		);
		expect(result.error).toBe('INVITE_EMAIL_UNVERIFIED');
		expect(membershipStore).toHaveLength(0);
		// 招待は pending のまま (email 検証完了後の再受諾可能性を保持)
		expect(inviteStore.get('ev-1')?.status).toBe('pending');
	});

	it('email 束縛招待 + emailVerified=true → 受諾できる', async () => {
		inviteStore.set(
			'ev-2',
			makePendingInvite({ inviteCode: 'ev-2', email: 'intended@example.com' }),
		);

		const result = assertSuccess(
			await acceptInvite('ev-2', 'user-new', 'intended@example.com', { emailVerified: true }),
		);
		expect(result.membership.tenantId).toBe('t-test');
	});

	it('email 束縛招待 + emailVerified 未提供 → 従来通り受諾できる (後方互換)', async () => {
		inviteStore.set(
			'ev-3',
			makePendingInvite({ inviteCode: 'ev-3', email: 'intended@example.com' }),
		);

		assertSuccess(await acceptInvite('ev-3', 'user-new', 'intended@example.com'));
	});

	it('email 未束縛の招待は emailVerified=false でも受諾できる (束縛 opt-in と同原則)', async () => {
		inviteStore.set('ev-4', makePendingInvite({ inviteCode: 'ev-4' }));

		assertSuccess(
			await acceptInvite('ev-4', 'user-new', 'anyone@example.com', { emailVerified: false }),
		);
	});
});
