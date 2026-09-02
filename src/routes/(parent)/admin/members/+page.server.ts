// /admin/members — メンバー管理（招待・一覧） (#0129, #0156, #371)

import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
// #4512: 解決できなかった値の表示は labels SSOT 経由 (docs/DESIGN.md §6 / ADR-0045)
import { UNRESOLVED_ENTITY_LABELS } from '$lib/domain/labels';
import { getAuthMode, requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { listInvites } from '$lib/server/services/invite-service';
import { checkFamilyMemberLimit } from '$lib/server/services/plan-limit-service';
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
				email: user?.email ?? UNRESOLVED_ENTITY_LABELS.email,
			};
		}),
	);

	// #4643: 一覧の userId は users.user_id。IdP の sub を渡していたため「自分」の判定が
	// 常に false になり、自分の行にも削除ボタンが出ていた。
	const currentUserId = locals.context?.userId;
	const currentRole = locals.context?.role ?? 'parent';

	// #4704: 招待フォームは「押して初めて上限で断られる」状態だった。**押す前に**分かるよう、
	// 上限 (メンバー + 未受諾の招待) を load で解決して画面に渡す。
	// #4723: 発行時と同じ数え方 (メンバー + 未受諾の招待) / planId を渡す。数え方がずれると
	// 「画面では出せるのに発行 API が上限で断る」逆の詰まりになる。
	const memberLimit = await checkFamilyMemberLimit(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		{ countPendingInvites: true, planId: locals.context?.plan },
	);
	// #4704: local (NUC セルフホスト) は招待 API 自体が cognito 前提で 401 を返す。
	// 使えない機能のフォームを出して英語の内部エラーを見せない。
	const inviteSupported = getAuthMode() === 'cognito';

	return {
		// #4704: 招待フォームの出し分け (上限到達 / セルフホストでは案内に差し替える)
		memberLimit,
		inviteSupported,
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
