import { asChildId } from '$lib/domain/ids';
// src/lib/server/auth/context-token.ts
// サーバーサイド Context トークン（署名付き短命トークン）
// JWE ではなく HMAC-SHA256 で署名した JSON。サーバーサイドのみで使用。

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthContext } from './types';

/** Context トークンの有効期限（秒） */
export const CONTEXT_TTL = {
	parent: 30 * 60, // 親モード（共用アカウント）: 30分
	owner: 24 * 60 * 60, // owner: 24時間
	child: 24 * 60 * 60, // 子供モード: 24時間
} as const;

/**
 * 署名用シークレット。
 * 環境変数から取得、なければランダム生成（プロセス再起動で無効化）。
 */
let _secret: string | null = null;
function getSecret(): string {
	if (_secret) return _secret;
	_secret = process.env.CONTEXT_TOKEN_SECRET ?? randomBytes(32).toString('hex');
	return _secret;
}

/**
 * トークンに載せる claim (#3963)。
 *
 * **`plan` / `licenseStatus` / `tenantStatus` は意図的に含めない。** これらは
 * Stripe webhook / 解約 / 再開で随時変わる「状態」であり、TTL 付きトークンに
 * 焼き込むと DB 反映後も最大 24 時間 (owner の TTL) 古い値が使われ続ける。
 * 課金状態の解決 SSOT は `./tenant-entitlement.ts`（毎リクエスト DB 解決）。
 */
export type ContextTokenClaims = Pick<
	AuthContext,
	'tenantId' | 'role' | 'childId' | 'mfaAuthenticated'
>;

interface ContextPayload extends ContextTokenClaims {
	exp: number; // Unix timestamp (seconds)
	iat: number;
}

/** Context を署名付きトークンにエンコード */
export function signContext(context: ContextTokenClaims): string {
	const now = Math.floor(Date.now() / 1000);
	const ttl = CONTEXT_TTL[context.role] ?? CONTEXT_TTL.child;
	// #3963: 明示的に claim を列挙する。spread にすると呼び出し側が AuthContext を
	// 渡したときに plan / licenseStatus が黙って載り、本 Issue が再発する。
	const payload: ContextPayload = {
		tenantId: context.tenantId,
		role: context.role,
		childId: context.childId,
		// #4266: MFA を経てセッションを開始したか。true のときだけ載せる (旧トークンとの
		// 互換は「載っていない = undefined = 拒否側」で成立する、fail-closed)。
		mfaAuthenticated: context.mfaAuthenticated === true ? true : undefined,
		iat: now,
		exp: now + ttl,
	};
	const json = JSON.stringify(payload);
	const encoded = Buffer.from(json).toString('base64url');
	const signature = createHmac('sha256', getSecret()).update(encoded).digest('base64url');
	return `${encoded}.${signature}`;
}

/**
 * トークンを検証してデコード。無効なら null。
 *
 * #3963: 返すのは claim のみ。課金状態は含まれないため、呼び出し側は
 * `resolveTenantEntitlement()` で DB から補完してから `AuthContext` を組み立てる。
 * 旧形式トークン（plan / licenseStatus 入り）も署名は有効なので受理されるが、
 * ここで焼き込み値を読まないため、古い値が使われることはない。
 */
export function verifyContext(token: string): ContextTokenClaims | null {
	const dotIndex = token.indexOf('.');
	if (dotIndex === -1) return null;

	const encoded = token.substring(0, dotIndex);
	const signature = token.substring(dotIndex + 1);
	if (!encoded || !signature) return null;

	const expected = createHmac('sha256', getSecret()).update(encoded).digest('base64url');
	const sigBuf = Buffer.from(signature);
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

	try {
		const json = Buffer.from(encoded, 'base64url').toString();
		const payload = JSON.parse(json) as ContextPayload;

		// 期限切れチェック
		const now = Math.floor(Date.now() / 1000);
		if (payload.exp <= now) return null;

		return {
			tenantId: payload.tenantId,
			role: payload.role,
			childId: payload.childId === undefined ? undefined : asChildId(payload.childId),
			// #4266: 真偽が明示された true のみ採用する (欠落 / 非 boolean は undefined = 拒否側)
			mfaAuthenticated: payload.mfaAuthenticated === true ? true : undefined,
		};
	} catch {
		return null;
	}
}

/** Context トークンの MaxAge（秒）を取得 */
export function getContextMaxAge(context: ContextTokenClaims): number {
	return CONTEXT_TTL[context.role] ?? CONTEXT_TTL.child;
}
