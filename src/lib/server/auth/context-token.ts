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

interface ContextPayload extends AuthContext {
	exp: number; // Unix timestamp (seconds)
	iat: number;
}

/** Context を署名付きトークンにエンコード */
export function signContext(context: AuthContext): string {
	const now = Math.floor(Date.now() / 1000);
	const ttl = CONTEXT_TTL[context.role] ?? CONTEXT_TTL.child;
	const payload: ContextPayload = {
		...context,
		iat: now,
		exp: now + ttl,
	};
	const json = JSON.stringify(payload);
	const encoded = Buffer.from(json).toString('base64url');
	const signature = createHmac('sha256', getSecret()).update(encoded).digest('base64url');
	return `${encoded}.${signature}`;
}

/** トークンを検証してデコード。無効なら null。 */
export function verifyContext(token: string): AuthContext | null {
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
			childId: payload.childId,
			licenseStatus: payload.licenseStatus,
			tenantStatus: payload.tenantStatus,
			plan: payload.plan,
		};
	} catch {
		return null;
	}
}

/** Context トークンの MaxAge（秒）を取得 */
export function getContextMaxAge(context: AuthContext): number {
	return CONTEXT_TTL[context.role] ?? CONTEXT_TTL.child;
}
