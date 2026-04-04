// /admin/members — メンバー管理（招待・一覧） (#0129, #0156, #371)

import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { listInvites } from '$lib/server/services/invite-service';
import { listViewerTokens } from '$lib/server/services/viewer-token-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const tenantId = requireTenantId(locals);
	const repos = getRepos();
	const parentData = await parent();

	const isFamily = parentData.planTier === 'family';

	const [members, invites, children, viewerTokens] = await Promise.all([
		repos.auth.findTenantMembers(tenantId),
		listInvites(tenantId),
		getAllChildren(tenantId),
		isFamily ? listViewerTokens(tenantId) : Promise.resolve([]),
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

	const currentUserId = locals.identity?.type === 'cognito' ? locals.identity.userId : undefined;
	const currentRole = locals.context?.role ?? 'parent';

	return {
		members: membersWithEmail,
		invites: invites.filter((i) => i.status === 'pending'),
		children: children.map((c) => ({ id: c.id, nickname: c.nickname, userId: c.userId })),
		currentUserId,
		currentRole,
		isFamily,
		viewerTokens: viewerTokens.map((t) => ({
			id: t.id,
			label: t.label,
			expiresAt: t.expiresAt,
			createdAt: t.createdAt,
			isRevoked: !!t.revokedAt,
			isExpired: t.expiresAt ? new Date(t.expiresAt) < new Date() : false,
		})),
	};
};
