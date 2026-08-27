// src/lib/server/auth/provisioning.ts
// 「自分の家族グループ (テナント) を作る」処理の SSOT (#4636)。
//
// 従来は CognitoAuthProvider の private メソッドにあり、**招待受諾に失敗したときの
// 暗黙のフォールバック**としてだけ呼ばれていた。#4636 でフォールバックを廃止したため、
// 呼び出し元が 2 つになる:
//   1. 招待 Cookie を持たない初回ログイン (通常のサインアップ) — 自動
//   2. `/auth/join` で顧客が「新しく家族グループを作る」を明示的に選んだとき — 手動
// どちらも同じ生成規則で作られる必要があるため、ここに 1 本化する。
//
// 冪等性 (#4636 AC5): 生成前に必ず membership を再確認し、既にあればそれを返す。
// 連打 / リロード / 戻る操作で世帯が二重に作られない。

import type { Membership } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

/**
 * email から内部 AuthUser を確保する (Cognito sub と内部 u-xxx ID は別物のため email が鍵)。
 * 既存ユーザーがいればその userId、いなければ AuthUser を作成して返す。
 */
export async function ensureAuthUser(email: string): Promise<string> {
	const repos = getRepos();
	const existingUser = await repos.auth.findUserByEmail(email);
	if (existingUser) return existingUser.userId;
	const user = await repos.auth.createUser({ email, provider: 'cognito' });
	return user.userId;
}

/**
 * 自分の家族グループを作り owner になる。既に所属テナントがあれば作らずそれを返す (冪等)。
 *
 * @returns 作成 or 既存の membership。失敗時は null (呼び出し側が案内を出す)。
 */
export async function provisionOwnTenant(email: string): Promise<Membership | null> {
	try {
		const repos = getRepos();
		const effectiveUserId = await ensureAuthUser(email);

		// 冪等ガード: 既にテナントに所属していれば新規作成しない (#4636 AC5)
		const existing = await repos.auth.findUserTenants(effectiveUserId);
		if (existing.length > 0) return existing[0] ?? null;

		// Tenant 作成（家族名はメールアドレスのローカル部から仮名を生成）
		const familyName = email.split('@')[0] ?? 'family';
		const tenant = await repos.auth.createTenant({
			name: `${familyName}の家族`,
			ownerId: effectiveUserId,
		});

		const membership = await repos.auth.createMembership({
			userId: effectiveUserId,
			tenantId: tenant.tenantId,
			role: 'owner',
		});

		// #314: サインアップ時の自動トライアル開始を廃止
		// トライアルはユーザーがご家族の見守り画面から明示的に開始する

		logger.info('[AUTH] Provisioned own tenant', {
			context: { userId: effectiveUserId, tenantId: tenant.tenantId, role: 'owner' },
		});

		return membership;
	} catch (e) {
		logger.error('[AUTH] Failed to provision own tenant', {
			error: e instanceof Error ? e.message : String(e),
		});
		return null;
	}
}
