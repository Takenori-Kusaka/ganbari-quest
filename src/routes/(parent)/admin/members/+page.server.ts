// /admin/members — メンバー管理（招待・一覧） (#0129)

import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { listInvites } from '$lib/server/services/invite-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const repos = getRepos();

	const [members, invites] = await Promise.all([
		repos.auth.findTenantMembers(tenantId),
		listInvites(tenantId),
	]);

	// メンバーのメール情報を取得
	const membersWithEmail = await Promise.all(
		members.map(async (m) => {
			const user = await repos.auth.findUserById(m.userId);
			return {
				userId: m.userId,
				role: m.role,
				joinedAt: m.joinedAt,
				email: user?.email ?? '(不明)',
			};
		}),
	);

	return {
		members: membersWithEmail,
		invites: invites.filter((i) => i.status === 'pending'),
	};
};
