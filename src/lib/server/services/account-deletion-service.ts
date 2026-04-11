// src/lib/server/services/account-deletion-service.ts
// アカウント削除サービス (#458)
// 4つの削除パターンに対応:
//   Pattern 1: Owner のみの家族グループ → Owner 削除
//   Pattern 2: 他メンバーがいる家族グループ → Owner 削除（移譲 or 全削除）
//   Pattern 3: 子供アカウント削除
//   Pattern 4: Viewer / 一般親アカウント削除

import {
	AdminDeleteUserCommand,
	CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Membership } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { invalidateRequestCaches } from '$lib/server/request-context';
import { deleteByPrefix } from '$lib/server/storage';
import { deleteChildFiles } from './child-service';
import { notifyDeletionComplete } from './discord-notify-service';
import { sendMemberRemovedEmail } from './email-service';
import { cancelSubscription } from './stripe-service';

// ============================================================
// Types
// ============================================================

export type DeletionPattern =
	| 'owner-only'
	| 'owner-with-transfer'
	| 'owner-full-delete'
	| 'child'
	| 'member';

export interface DeletionResult {
	success: boolean;
	pattern: DeletionPattern;
	/** Items deleted from DB */
	itemsDeleted: number;
	/** Files deleted from storage */
	filesDeleted: number;
	/** Members who became unaffiliated */
	unaffiliatedMembers: string[];
}

export interface OwnerDeletionInfo {
	/** Whether the owner is the only member */
	isOnlyMember: boolean;
	/** Other members in the family group (excluding owner) */
	otherMembers: Array<{
		userId: string;
		role: Membership['role'];
		email?: string;
		displayName?: string;
	}>;
}

// ============================================================
// Helpers
// ============================================================

const repos = () => getRepos();

/** Cognito ユーザーを AdminDeleteUser で削除する */
async function deleteCognitoUser(userId: string): Promise<void> {
	const userPoolId = process.env.COGNITO_USER_POOL_ID;
	const region = process.env.AWS_REGION ?? 'us-east-1';

	if (!userPoolId) {
		logger.warn('[account-deletion] COGNITO_USER_POOL_ID not set, skipping Cognito deletion');
		return;
	}

	// Cognito の Username は userId (sub) ではなくメールアドレスの場合がある
	// findUserById で email を取得して使う
	const user = await repos().auth.findUserById(userId);
	if (!user) {
		logger.warn('[account-deletion] User not found in DB, skipping Cognito deletion', {
			context: { userId },
		});
		return;
	}

	const client = new CognitoIdentityProviderClient({ region });

	try {
		await client.send(
			new AdminDeleteUserCommand({
				UserPoolId: userPoolId,
				Username: user.email,
			}),
		);
		logger.info('[account-deletion] Cognito ユーザー削除完了', {
			context: { userId, email: user.email },
		});
	} catch (err) {
		const errorName = (err as { name?: string })?.name ?? '';
		if (errorName === 'UserNotFoundException') {
			logger.info('[account-deletion] Cognito ユーザーは既に存在しない', {
				context: { userId },
			});
			return;
		}
		logger.error('[account-deletion] Cognito ユーザー削除失敗', {
			error: String(err),
			context: { userId },
		});
		throw err;
	}
}

/** テナント内の全子供データとファイルを削除する */
async function deleteAllChildrenData(tenantId: string): Promise<number> {
	const children = await repos().child.findAllChildren(tenantId);
	let deleted = 0;

	for (const child of children) {
		try {
			await deleteChildFiles(child.id, tenantId);
			await repos().child.deleteChild(child.id, tenantId);
			deleted++;
		} catch (err) {
			logger.warn(`[account-deletion] 子供データ削除失敗 childId=${child.id}: ${String(err)}`);
		}
	}

	return deleted;
}

/** テナント内の全メンバーシップを削除する */
async function deleteAllMemberships(tenantId: string): Promise<number> {
	const members = await repos().auth.findTenantMembers(tenantId);
	let deleted = 0;

	for (const member of members) {
		try {
			await repos().auth.deleteMembership(member.userId, tenantId);
			deleted++;
		} catch (err) {
			logger.warn(
				`[account-deletion] メンバーシップ削除失敗 userId=${member.userId}: ${String(err)}`,
			);
		}
	}

	return deleted;
}

/** テナント内の全招待を無効化し、物理削除する */
async function revokeAndDeleteAllInvites(tenantId: string): Promise<number> {
	const invites = await repos().auth.findTenantInvites(tenantId);
	let deleted = 0;

	for (const invite of invites) {
		try {
			// まずステータスを revoked に（pending の場合のみ条件付き更新）
			if (invite.status === 'pending') {
				try {
					await repos().auth.updateInviteStatus(invite.inviteCode, 'revoked');
				} catch {
					// conditional write failure は無視
				}
			}
			// 物理削除: 招待レコード自体を削除（テナント側・招待コード側の両方）
			await repos().auth.deleteInvite(invite.inviteCode, tenantId);
			deleted++;
		} catch (err) {
			logger.warn(
				`[account-deletion] 招待削除失敗 inviteCode=${invite.inviteCode}: ${String(err)}`,
			);
		}
	}

	return deleted;
}

/**
 * テナントスコープの全データを削除する（子供・認証以外）。
 * 各リポジトリの deleteByTenantId メソッドを使用してテナント全データをクリーンアップする。
 * 各リポジトリの削除は独立しており、個別の失敗が他の削除をブロックしない。
 */
async function deleteTenantScopedData(tenantId: string): Promise<number> {
	let deleted = 0;
	const r = repos();

	// Activities（テナントスコープで find + delete 可能）
	try {
		const activities = await r.activity.findActivities(tenantId);
		for (const act of activities) {
			await r.activity.deleteActivity(act.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[account-deletion] activities 削除失敗: ${String(err)}`);
	}

	// Viewer tokens（findByTenant + deleteById 可能）
	try {
		const tokens = await r.viewerToken.findByTenant(tenantId);
		for (const token of tokens) {
			await r.viewerToken.deleteById(token.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[account-deletion] viewerTokens 削除失敗: ${String(err)}`);
	}

	// Cloud exports（findByTenant + deleteById 可能）
	try {
		const exports = await r.cloudExport.findByTenant(tenantId);
		for (const exp of exports) {
			await r.cloudExport.deleteById(exp.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[account-deletion] cloudExports 削除失敗: ${String(err)}`);
	}

	// Push subscriptions（findByTenant + deleteByEndpoint 可能）
	try {
		const subs = await r.pushSubscription.findByTenant(tenantId);
		for (const sub of subs) {
			await r.pushSubscription.deleteByEndpoint(sub.endpoint, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[account-deletion] pushSubscriptions 削除失敗: ${String(err)}`);
	}

	// Voice（子供ごとに deleteByChild 可能）
	try {
		const children = await r.child.findAllChildren(tenantId);
		for (const child of children) {
			await r.voice.deleteByChild(child.id, tenantId);
			deleted++;
		}
	} catch (err) {
		logger.warn(`[account-deletion] voice 削除失敗: ${String(err)}`);
	}

	// Settings
	try {
		await r.settings.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] settings 削除失敗: ${String(err)}`);
	}

	// Checklists（templates, items, logs, overrides）
	try {
		await r.checklist.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] checklists 削除失敗: ${String(err)}`);
	}

	// Daily missions
	try {
		await r.dailyMission.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] dailyMissions 削除失敗: ${String(err)}`);
	}

	// Evaluations（evaluations + rest_days）
	try {
		await r.evaluation.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] evaluations 削除失敗: ${String(err)}`);
	}

	// Points（point_ledger）
	try {
		await r.point.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] points 削除失敗: ${String(err)}`);
	}

	// Stamp cards + entries
	try {
		await r.stampCard.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] stampCards 削除失敗: ${String(err)}`);
	}

	// Status（statuses + status_history + market_benchmarks）
	try {
		await r.status.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] status 削除失敗: ${String(err)}`);
	}

	// Login bonuses
	try {
		await r.loginBonus.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] loginBonus 削除失敗: ${String(err)}`);
	}

	// Special rewards
	try {
		await r.specialReward.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] specialReward 削除失敗: ${String(err)}`);
	}

	// Activity preferences（pin settings）
	try {
		await r.activityPref.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] activityPref 削除失敗: ${String(err)}`);
	}

	// Activity mastery
	try {
		await r.activityMastery.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] activityMastery 削除失敗: ${String(err)}`);
	}

	// Parent messages
	try {
		await r.message.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] message 削除失敗: ${String(err)}`);
	}

	// Tenant events + progress
	try {
		await r.tenantEvent.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] tenantEvent 削除失敗: ${String(err)}`);
	}

	// Trial history
	try {
		await r.trialHistory.deleteByTenantId(tenantId);
		// #788: 同一リクエスト内のキャッシュも破棄（後続処理が stale 値を見ないよう防衛）
		invalidateRequestCaches(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] trialHistory 削除失敗: ${String(err)}`);
	}

	// Sibling challenges + progress
	try {
		await r.siblingChallenge.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] siblingChallenge 削除失敗: ${String(err)}`);
	}

	// Sibling cheers
	try {
		await r.siblingCheer.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] siblingCheer 削除失敗: ${String(err)}`);
	}

	// Auto challenges
	try {
		await r.autoChallenge.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] autoChallenge 削除失敗: ${String(err)}`);
	}

	// Report daily summaries
	try {
		await r.reportDailySummary.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] reportDailySummary 削除失敗: ${String(err)}`);
	}

	// Season events + child_event_progress
	try {
		await r.seasonEvent.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] seasonEvent 削除失敗: ${String(err)}`);
	}

	// Character images
	try {
		await r.image.deleteByTenantId(tenantId);
		deleted++;
	} catch (err) {
		logger.warn(`[account-deletion] image 削除失敗: ${String(err)}`);
	}

	return deleted;
}

/** テナント全体のデータ削除 + Cognito ユーザー削除 */
async function fullTenantDeletion(
	tenantId: string,
	_ownerId: string,
): Promise<{ itemsDeleted: number; filesDeleted: number }> {
	// 0. Stripe Subscription キャンセル (#741)
	// DB 削除の前に Stripe 側をキャンセルする。
	// Stripe 呼び出しが失敗したら例外が投げられ、DB 削除は実行されない
	// (ユーザーの課金継続クレームを防ぐため、整合性を優先する)。
	await cancelSubscription(tenantId);

	let itemsDeleted = 0;

	// 1. S3 / ストレージファイル削除
	const filesDeleted = await deleteByPrefix(`tenants/${tenantId}/`);

	// 2. テナントスコープのデータ削除（activities, viewerTokens, cloudExports, pushSubscriptions, voice 等）
	itemsDeleted += await deleteTenantScopedData(tenantId);

	// 3. 子供データ削除
	itemsDeleted += await deleteAllChildrenData(tenantId);

	// 4. 全メンバーの Cognito ユーザー削除 + メンバーシップ削除
	const members = await repos().auth.findTenantMembers(tenantId);
	for (const member of members) {
		try {
			await deleteCognitoUser(member.userId);
			await repos().auth.deleteUser(member.userId);
		} catch (err) {
			logger.warn(`[account-deletion] ユーザー削除失敗 userId=${member.userId}: ${String(err)}`);
		}
	}
	itemsDeleted += await deleteAllMemberships(tenantId);

	// 5. 招待リンク無効化 + 物理削除
	itemsDeleted += await revokeAndDeleteAllInvites(tenantId);

	// 6. テナント削除
	await repos().auth.deleteTenant(tenantId);
	itemsDeleted++;

	// 7. 通知
	notifyDeletionComplete(tenantId, { items: itemsDeleted, files: filesDeleted }).catch(() => {});

	return { itemsDeleted, filesDeleted };
}

// ============================================================
// Public API
// ============================================================

/**
 * Owner の削除情報を取得する（UI でダイアログ表示判定に使用）
 */
export async function getOwnerDeletionInfo(
	tenantId: string,
	ownerId: string,
): Promise<OwnerDeletionInfo> {
	const members = await repos().auth.findTenantMembers(tenantId);
	const otherMembers = members.filter((m) => m.userId !== ownerId);

	const enrichedMembers = await Promise.all(
		otherMembers.map(async (m) => {
			const user = await repos().auth.findUserById(m.userId);
			return {
				userId: m.userId,
				role: m.role,
				email: user?.email,
				displayName: user?.displayName,
			};
		}),
	);

	return {
		isOnlyMember: otherMembers.length === 0,
		otherMembers: enrichedMembers,
	};
}

/**
 * Pattern 1: Owner のみの家族グループ → 全データ削除
 */
export async function deleteOwnerOnlyAccount(
	tenantId: string,
	ownerId: string,
): Promise<DeletionResult> {
	logger.info('[account-deletion] Pattern 1: Owner のみ削除開始', {
		context: { tenantId, ownerId },
	});

	// Verify owner is the only member
	const members = await repos().auth.findTenantMembers(tenantId);
	if (members.length > 1) {
		throw new Error('他のメンバーが存在します。先に移譲するか全削除を選択してください。');
	}

	const { itemsDeleted, filesDeleted } = await fullTenantDeletion(tenantId, ownerId);

	logger.info('[account-deletion] Pattern 1: 削除完了', {
		context: { tenantId, itemsDeleted, filesDeleted },
	});

	return {
		success: true,
		pattern: 'owner-only',
		itemsDeleted,
		filesDeleted,
		unaffiliatedMembers: [],
	};
}

/**
 * Pattern 2a: Owner が他メンバーに権限移譲して離脱
 */
export async function transferOwnershipAndLeave(
	tenantId: string,
	ownerId: string,
	newOwnerId: string,
): Promise<DeletionResult> {
	logger.info('[account-deletion] Pattern 2a: 権限移譲 + Owner 離脱', {
		context: { tenantId, ownerId, newOwnerId },
	});

	// Verify new owner exists in the tenant
	const newOwnerMembership = await repos().auth.findMembership(newOwnerId, tenantId);
	if (!newOwnerMembership) {
		throw new Error('移譲先のメンバーが見つかりません。');
	}

	// Child cannot become owner
	if (newOwnerMembership.role === 'child') {
		throw new Error('子供アカウントにはオーナー権限を移譲できません。');
	}

	// Transfer ownership
	// 1. Update tenant ownerId
	await repos().auth.updateTenantOwner(tenantId, newOwnerId);

	// 2. Update new owner's membership role
	await repos().auth.deleteMembership(newOwnerId, tenantId);
	await repos().auth.createMembership({
		userId: newOwnerId,
		tenantId,
		role: 'owner',
	});

	// 3. Remove old owner's membership
	await repos().auth.deleteMembership(ownerId, tenantId);

	// 4. Delete old owner from DB + Cognito
	await deleteCognitoUser(ownerId);
	await repos().auth.deleteUser(ownerId);

	logger.info('[account-deletion] Pattern 2a: 移譲 + 離脱完了', {
		context: { tenantId, newOwnerId },
	});

	return {
		success: true,
		pattern: 'owner-with-transfer',
		itemsDeleted: 2, // membership + user
		filesDeleted: 0,
		unaffiliatedMembers: [],
	};
}

/**
 * Pattern 2b: Owner が全削除（他メンバーは所属なし状態に）
 */
export async function deleteOwnerFullDelete(
	tenantId: string,
	ownerId: string,
): Promise<DeletionResult> {
	logger.info('[account-deletion] Pattern 2b: Owner 全削除（メンバー所属解除）', {
		context: { tenantId, ownerId },
	});

	// Collect other members before deletion (they will become unaffiliated)
	const members = await repos().auth.findTenantMembers(tenantId);
	const otherMembers = members.filter((m) => m.userId !== ownerId);
	const unaffiliatedMembers = otherMembers.map((m) => m.userId);

	// メール通知先の情報を先に収集（削除後は取得不能）
	// 送信自体は Stripe キャンセル・DB 削除成功後に行う (#741 Copilot [must])
	const tenant = await repos().auth.findTenantById(tenantId);
	const memberEmails: Array<{ email: string; tenantName: string }> = [];
	for (const member of otherMembers) {
		const user = await repos().auth.findUserById(member.userId);
		if (user?.email) {
			memberEmails.push({ email: user.email, tenantName: tenant?.name ?? '家族グループ' });
		}
	}

	// 0. Stripe Subscription キャンセル (#741)
	// DB 削除の前に Stripe 側をキャンセルする。失敗したら例外が投げられ
	// DB 削除は実行されない (課金継続クレーム防止)。
	await cancelSubscription(tenantId);

	// Full deletion of tenant data, but only delete owner's Cognito account
	let itemsDeleted = 0;

	// 1. Storage files
	const filesDeleted = await deleteByPrefix(`tenants/${tenantId}/`);

	// 2. テナントスコープのデータ削除（activities, viewerTokens, cloudExports, pushSubscriptions, voice 等）
	itemsDeleted += await deleteTenantScopedData(tenantId);

	// 3. Children data
	itemsDeleted += await deleteAllChildrenData(tenantId);

	// 4. Revoke + 物理削除 invites
	itemsDeleted += await revokeAndDeleteAllInvites(tenantId);

	// 5. Delete all memberships (other members become unaffiliated)
	itemsDeleted += await deleteAllMemberships(tenantId);

	// 6. Delete owner from Cognito + DB
	await deleteCognitoUser(ownerId);
	await repos().auth.deleteUser(ownerId);
	itemsDeleted++;

	// 7. Delete tenant
	await repos().auth.deleteTenant(tenantId);
	itemsDeleted++;

	// 8. Notify (Discord)
	notifyDeletionComplete(tenantId, { items: itemsDeleted, files: filesDeleted }).catch(() => {});

	// 9. メンバーへのメール通知（Stripe + DB 削除成功確定後に送信）
	for (const { email, tenantName } of memberEmails) {
		sendMemberRemovedEmail(email, tenantName).catch(() => {});
	}

	logger.info('[account-deletion] Pattern 2b: 全削除完了', {
		context: { tenantId, itemsDeleted, filesDeleted, unaffiliatedMembers },
	});

	return {
		success: true,
		pattern: 'owner-full-delete',
		itemsDeleted,
		filesDeleted,
		unaffiliatedMembers,
	};
}

/**
 * Pattern 3: 子供アカウント削除
 */
export async function deleteChildAccount(
	tenantId: string,
	childUserId: string,
): Promise<DeletionResult> {
	logger.info('[account-deletion] Pattern 3: 子供アカウント削除', {
		context: { tenantId, childUserId },
	});

	let itemsDeleted = 0;

	// 1. Find child linked to this user
	const child = await repos().child.findChildByUserId(childUserId, tenantId);
	if (child) {
		// Unlink child from user (set userId to null)
		await repos().child.updateChild(child.id, { userId: null }, tenantId);
		itemsDeleted++;
	}

	// 2. Remove membership
	await repos().auth.deleteMembership(childUserId, tenantId);
	itemsDeleted++;

	// 3. Delete from Cognito + DB
	await deleteCognitoUser(childUserId);
	await repos().auth.deleteUser(childUserId);
	itemsDeleted++;

	logger.info('[account-deletion] Pattern 3: 子供アカウント削除完了', {
		context: { tenantId, childUserId, itemsDeleted },
	});

	return {
		success: true,
		pattern: 'child',
		itemsDeleted,
		filesDeleted: 0,
		unaffiliatedMembers: [],
	};
}

/**
 * Pattern 4: Viewer / 一般親アカウント削除
 */
export async function deleteMemberAccount(
	tenantId: string,
	userId: string,
): Promise<DeletionResult> {
	logger.info('[account-deletion] Pattern 4: メンバーアカウント削除', {
		context: { tenantId, userId },
	});

	let itemsDeleted = 0;

	// 1. Remove membership
	await repos().auth.deleteMembership(userId, tenantId);
	itemsDeleted++;

	// 2. Delete from Cognito + DB
	await deleteCognitoUser(userId);
	await repos().auth.deleteUser(userId);
	itemsDeleted++;

	logger.info('[account-deletion] Pattern 4: メンバーアカウント削除完了', {
		context: { tenantId, userId, itemsDeleted },
	});

	return {
		success: true,
		pattern: 'member',
		itemsDeleted,
		filesDeleted: 0,
		unaffiliatedMembers: [],
	};
}
