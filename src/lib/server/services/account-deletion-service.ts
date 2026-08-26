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
import { purgeByPrefix } from '$lib/server/storage';
import { sendDeletionCompleteEmail, sendMemberRemovedEmail } from './email-service';
import type { PlanTier } from './plan-limit-service';
import { cancelSubscription } from './stripe-service';
import {
	deleteAllChildrenData,
	deleteTenantScopedData,
	deleteTenantSettings,
} from './tenant-cleanup-service';

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

/**
 * #4338: 物理削除に至った**経路**。削除記録ログの検索軸になる。
 *
 * - `grace-expiry`: 猶予期間が切れて**定時実行の cron** (`grace-period-deletion`) が消した。
 * - `manual`: 同じ cron endpoint を**人が手で叩いて**消した (期限を待たずに消した / 障害対応の再実行)。
 * - `immediate`: 無料プランの退会で猶予なく即時削除した (`/api/v1/admin/account/delete`)。
 * - `relocation`: 別の家族グループへ引っ越した人が抜けて**無人になった**家族グループを掃除した
 *   (`/auth/invite/[code]` の引っ越し合流、#4642)。退会ではないので削除完了メールは送らない。
 *
 * `grace-expiry` と `manual` は同じ処理を通るが、**記録としては区別する**。
 * 「いつ・どの経路で消えたか」を後から答えるのが記録の目的であり、機械が期限どおり消したのか
 * 人が判断して消したのかは、その問いに対して最も答える価値が高い違いだからである。
 * 判定方法と「marker が無ければ manual」とする理由は `src/lib/server/cron/cron-trigger.ts`。
 *
 * これ以外の削除入口は存在しない。増やすときは列挙も足す (省略可能にしない — 省略できる形に
 * すると新しい入口が黙って記録なしで消せてしまう)。
 */
export type DeletionRoute = 'grace-expiry' | 'manual' | 'immediate' | 'relocation';

/**
 * #4338: 削除記録ログに載せる文脈。**PII は含めない** (#4174 Q3 / #4192)。
 */
export interface DeletionAudit {
	route: DeletionRoute;
	/** 削除時点のプラン。解決できない場合のみ null。 */
	planTier: PlanTier | null;
}

/**
 * #4338: 削除記録ログの検索語 (SSOT)。運用 runbook から grep するときの鍵。
 */
export const TENANT_DELETION_RECORD_LOG_TERM = '[account-deletion] tenant deletion record';

/**
 * #4338: 削除の**直前**に「何を・いつ・どの経路で消したか」を 1 行だけ残す。
 *
 * ## 何のためか
 *
 * 復旧のためではない (データ本体は戻らない)。**説明責任のため**である。
 * 従来は失敗時の warn しか出ておらず、「消えたんですが」と言われたときに
 * いつ・どの経路で消えたのかを答える手段が無かった。
 *
 * ## 何を載せないか
 *
 * 名前 / メールアドレス / 活動内容 / 画像・音声への参照は載せない。載せるほど
 * 「削除した」と言えなくなる。`tenantId` は**サーバーログには載せる** — 認証された場所
 * (CloudWatch Logs) でしか読めず、これが無いと問い合わせと記録を突き合わせられない。
 * 外部 SaaS (Discord) 側では逆に落とす、という線引きは `notify-privacy.ts` が SSOT。
 *
 * 退避先 (S3 / テーブル) は新設しない。サーバーログのみ (#4338 オーナー決裁)。
 */
function logTenantDeletionRecord(
	tenantId: string,
	audit: DeletionAudit,
	childCount: number | null,
): void {
	logger.info(TENANT_DELETION_RECORD_LOG_TERM, {
		context: {
			tenantId,
			route: audit.route,
			planTier: audit.planTier,
			childCount,
			deletedAt: new Date().toISOString(),
		},
	});
}

/**
 * 削除記録に載せる子供の人数 (在籍 + アーカイブ)。
 * 集計に失敗しても削除は止めず、`null` (= 不明) として記録する (0 と区別する)。
 */
async function countChildrenForRecord(tenantId: string): Promise<number | null> {
	try {
		const [active, archived] = await Promise.all([
			repos().child.findAllChildren(tenantId),
			repos().child.findArchivedChildren(tenantId),
		]);
		return active.length + archived.length;
	} catch (err) {
		logger.warn(`[account-deletion] 子供人数の集計失敗 (削除は継続): ${String(err)}`);
		return null;
	}
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
			// #3585: 管理鍵は inviteId (findTenantInvites の inviteCode は '' で raw 非露出)。
			// まずステータスを revoked に（pending の場合のみ条件付き更新）
			if (invite.status === 'pending') {
				try {
					// #3588: tenant scope は tenantId (family_id 述語) で query 層が強制する
					await repos().auth.updateInviteStatus(invite.inviteId, tenantId, 'revoked');
				} catch {
					// conditional write failure は無視
				}
			}
			// 物理削除: 招待レコード自体を削除（テナント側・招待コード側の両方）
			await repos().auth.deleteInvite(invite.inviteId, tenantId);
			deleted++;
		} catch (err) {
			logger.warn(`[account-deletion] 招待削除失敗 inviteId=${invite.inviteId}: ${String(err)}`);
		}
	}

	return deleted;
}

/** テナント全体のデータ削除 + Cognito ユーザー削除 */
async function fullTenantDeletion(
	tenantId: string,
	_ownerId: string,
	audit: DeletionAudit,
): Promise<{ itemsDeleted: number; filesDeleted: number }> {
	// 0. Stripe Subscription キャンセル (#741)
	// DB 削除の前に Stripe 側をキャンセルする。
	// Stripe 呼び出しが失敗したら例外が投げられ、DB 削除は実行されない
	// (ユーザーの課金継続クレームを防ぐため、整合性を優先する)。
	await cancelSubscription(tenantId);

	// #4338: 削除記録は「消す直前」に 1 行。Stripe キャンセルが失敗した場合は何も消えないので、
	// その後に置く (消していないのに記録だけ残る、を作らない)。
	logTenantDeletionRecord(tenantId, audit, await countChildrenForRecord(tenantId));

	let itemsDeleted = 0;

	// 1. S3 / ストレージファイル削除
	// #4724: **全バージョンごと物理削除する** (`deleteByPrefix` ではなく `purgeByPrefix`)。
	// バージョニング有効化後の `deleteByPrefix` は delete marker を立てるだけで、実体は
	// lifecycle の 30 日まで残る。退会は「猶予期間後に完全削除」と法務文書で約束しているため、
	// ここだけはバージョンを名指しして消す。
	const filesDeleted = await purgeByPrefix(`tenants/${tenantId}/`);

	// 2. テナントスコープのデータ削除（activities, viewerTokens, cloudExports, pushSubscriptions, voice 等）
	// #4327: `settings` だけは消さない (deferSettings)。`settings` は soft-delete 判定材料
	// (`soft_deleted_at` / `physical_deletion_date`) の置き場であり、ここで消すと後続ステップの
	// 途中失敗が「families / users / memberships は残るが判定材料は無い」宙吊り行を作る
	// (findExpiredSoftDeletedTenants の母集団から外れて二度と消せず、soft_deleted_at も無いので
	// 復元もできない)。判定材料は families 行を消した後に落とす (末尾)。
	itemsDeleted += await deleteTenantScopedData(tenantId, { deferSettings: true });

	// 3. 子供データ削除
	itemsDeleted += await deleteAllChildrenData(tenantId);

	// 4. 全メンバーの メンバーシップ削除 → Cognito / global users 削除 の順 (#3588 ②)。
	// DSQL cutover 安全性: memberships (family_id 述語付き tenant scope) を global users 表の
	// 削除より先に掃除する。FK 非対応 (§P4) ゆえ deleteUser を先に行うと membership 行が
	// 存在しない user_id を指す dangling 窓が生じる。owner_user_id cache は step 6 の
	// deleteTenant (families 行ごと削除) で消えるため別途掃除不要。
	const members = await repos().auth.findTenantMembers(tenantId);
	itemsDeleted += await deleteAllMemberships(tenantId);
	for (const member of members) {
		try {
			await deleteCognitoUser(member.userId);
			await repos().auth.deleteUser(member.userId);
		} catch (err) {
			logger.warn(`[account-deletion] ユーザー削除失敗 userId=${member.userId}: ${String(err)}`);
		}
	}

	// 5. 招待リンク無効化 + 物理削除
	itemsDeleted += await revokeAndDeleteAllInvites(tenantId);

	// 6. テナント削除
	await repos().auth.deleteTenant(tenantId);
	itemsDeleted++;

	// 7. 判定材料 (settings) の削除 — #4327: 必ず families 行の削除より後に置く。
	// ここまで来ていれば「families が残ったまま判定材料だけ消えた」状態は成立しない。
	// 本 step が失敗した場合は settings 行だけが孤児として残るが、例外は握り潰さず
	// 呼び出し元 (purge) の errors[] → alarm に載せる。
	itemsDeleted += await deleteTenantSettings(tenantId);

	// #4192: 削除完了の Discord 通知は**持たないと決めた** (#4174 Q2、churn チャネル)。
	// 削除の事実・件数は呼び出し元の `[account-deletion] ... 削除完了` ログ (tenantId + 件数付き) が残す。

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
 * 削除完了通知の宛先 (オーナーのメールアドレス) を控える (#4507)。
 *
 * **物理削除より前に呼ぶこと** — 削除後は users 行ごと消えるので引けない。
 */
async function resolveOwnerEmail(ownerId: string): Promise<string | null> {
	try {
		const user = await repos().auth.findUserById(ownerId);
		return user?.email ?? null;
	} catch (err) {
		logger.error('[account-deletion] failed to resolve owner email', {
			error: String(err),
			context: { ownerId },
		});
		return null;
	}
}

/**
 * 物理削除の完了をオーナーへ通知する (#4507)。
 *
 * 旧実装ではこの通知が production 呼び出しゼロの dead code で、無料プランの退会
 * (猶予 0 日 = 即時物理削除) は**通知 0 通**でデータが消えていた。
 *
 * 本 helper を即時削除経路 (退会 API) と猶予満了経路 (grace-period cron が
 * 同じ 2 関数を呼ぶ) の両方が通るため、削除経路によらず 1 通は届く。
 * 送信失敗で削除を巻き戻さない (削除は既に確定している)。観測はログで行う。
 */
async function notifyDeletionComplete(tenantId: string, email: string | null): Promise<void> {
	if (!email) {
		logger.warn('[account-deletion] no owner email; deletion completed without notification', {
			context: { tenantId },
		});
		return;
	}
	try {
		const ok = await sendDeletionCompleteEmail(email);
		if (!ok) {
			logger.error('[account-deletion] deletion complete email send failed', {
				context: { tenantId },
			});
		}
	} catch (err) {
		logger.error('[account-deletion] deletion complete email failed', {
			error: String(err),
			context: { tenantId },
		});
	}
}

/**
 * Pattern 1: Owner のみの家族グループ → 全データ削除
 */
export async function deleteOwnerOnlyAccount(
	tenantId: string,
	ownerId: string,
	audit: DeletionAudit,
): Promise<DeletionResult> {
	logger.info('[account-deletion] Pattern 1: Owner のみ削除開始', {
		context: { tenantId, ownerId },
	});

	// Verify owner is the only member
	const members = await repos().auth.findTenantMembers(tenantId);
	if (members.length > 1) {
		throw new Error('他のメンバーが存在します。先に移譲するか全削除を選択してください。');
	}

	// #4507: 宛先は削除前にしか引けないので先に控える（送信は削除確定後）。
	const ownerEmail = await resolveOwnerEmail(ownerId);

	const { itemsDeleted, filesDeleted } = await fullTenantDeletion(tenantId, ownerId, audit);

	logger.info('[account-deletion] Pattern 1: 削除完了', {
		context: { tenantId, itemsDeleted, filesDeleted },
	});

	await notifyDeletionComplete(tenantId, ownerEmail);

	return {
		success: true,
		pattern: 'owner-only',
		itemsDeleted,
		filesDeleted,
		unaffiliatedMembers: [],
	};
}

/**
 * 引っ越し合流でメンバーが 0 人になった家族グループを掃除する (#4642)。
 *
 * 退会 (アカウント削除) とは別事象で、**人は消さない** — 引っ越した本人は合流先で使い続ける。
 * 呼び出し前に本人の membership を削除しておくこと。メンバーが 1 人でも残っていれば
 * 「まだ使われている家族グループ」なので **throw して止める** (誤って生きた世帯を消さない)。
 *
 * 削除そのものは `fullTenantDeletion` (退会と同じ経路) を再利用する — 新しい削除機構を作らない。
 * メンバーが 0 人なので、その中の Cognito / users 削除ループは 1 度も回らない。
 */
export async function deleteVacatedTenant(
	tenantId: string,
	audit: DeletionAudit,
): Promise<DeletionResult> {
	const members = await repos().auth.findTenantMembers(tenantId);
	if (members.length > 0) {
		throw new Error(
			`無人ではない家族グループは掃除できません (tenantId=${tenantId}, members=${members.length})`,
		);
	}

	logger.info('[account-deletion] 引っ越しで無人になった家族グループを削除', {
		context: { tenantId, route: audit.route },
	});

	const { itemsDeleted, filesDeleted } = await fullTenantDeletion(tenantId, '', audit);

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
	audit: DeletionAudit,
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
	const ownerEmail = await resolveOwnerEmail(ownerId); // #4507
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

	// #4338: 削除記録は「消す直前」に 1 行 (fullTenantDeletion と同じ位置づけ)。
	logTenantDeletionRecord(tenantId, audit, await countChildrenForRecord(tenantId));

	// Full deletion of tenant data, but only delete owner's Cognito account
	let itemsDeleted = 0;

	// 1. Storage files
	// #4724: **全バージョンごと物理削除する** (`deleteByPrefix` ではなく `purgeByPrefix`)。
	// バージョニング有効化後の `deleteByPrefix` は delete marker を立てるだけで、実体は
	// lifecycle の 30 日まで残る。退会は「猶予期間後に完全削除」と法務文書で約束しているため、
	// ここだけはバージョンを名指しして消す。
	const filesDeleted = await purgeByPrefix(`tenants/${tenantId}/`);

	// 2. テナントスコープのデータ削除（activities, viewerTokens, cloudExports, pushSubscriptions, voice 等）
	// #4327: `settings` (soft-delete 判定材料) は step 8 まで残す。理由は fullTenantDeletion 参照。
	itemsDeleted += await deleteTenantScopedData(tenantId, { deferSettings: true });

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

	// 8. 判定材料 (settings) の削除 — #4327: 必ず families 行の削除より後。
	itemsDeleted += await deleteTenantSettings(tenantId);

	// #4192: 削除完了の Discord 通知は**持たないと決めた** (#4174 Q2、churn チャネル)。
	// 削除の事実・件数は呼び出し元の `[account-deletion] ... 削除完了` ログが残す。

	// 9. メンバーへのメール通知（Stripe + DB 削除成功確定後に送信）
	for (const { email, tenantName } of memberEmails) {
		sendMemberRemovedEmail(email, tenantName).catch(() => {});
	}

	logger.info('[account-deletion] Pattern 2b: 全削除完了', {
		context: { tenantId, itemsDeleted, filesDeleted, unaffiliatedMembers },
	});

	await notifyDeletionComplete(tenantId, ownerEmail); // #4507

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
