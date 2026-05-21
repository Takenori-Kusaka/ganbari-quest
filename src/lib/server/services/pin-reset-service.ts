// src/lib/server/services/pin-reset-service.ts
// #2353 設計欠陥 4: PIN 忘れ救済導線 — SES magic link + jose JWT 30 分 token + 1 回限り
//
// 設計方針 (ADR-0050 §4 PIN reset 機構、ADR-0014 OSS 先調査):
//   - 業界標準 (Auth0 / Cognito password reset / NextAuth Email provider / WP password reset) は
//     全て「signed token + email magic link + DB consume 記録」の組み合わせ
//   - 本サービスは既存 jose dependency を流用し、HS256 で署名された JWT を 30 分有効の token とする
//   - 1 回限り消費は settings table の `pin_reset_jti_consumed:<jti>` キーで管理 (consumed JTI)
//   - secret は既存 PARENT_GATE_COOKIE_SECRET を流用 (ADR-0050 §5、配布証跡を二重化しない)
//   - rate limit は既存の global rate-limiter 機構で /api/v1/parent-gate/reset/request 側に適用
//
// 既存 ADR-0050 で β `jose` を session token としては棄却したが、reset token は session token とは
// 別カテゴリ (one-shot / 30 分 expiry / revoke 不要) のため標準パターンとして採用 (ADR-0050 §4 補論)。

import { jwtVerify, SignJWT } from 'jose';
import { getEnv } from '$lib/runtime/env';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';

/** reset token TTL (30 分、業界標準) */
export const RESET_TOKEN_TTL_SEC = 30 * 60;

/** consumed JTI を保持する期間 (token TTL + 1 時間、token expiry 後も再利用攻撃を防ぐ) */
const CONSUMED_JTI_RETAIN_SEC = RESET_TOKEN_TTL_SEC + 60 * 60;

/** dev 環境 fallback secret (production では throw する、ADR-0050 §5 と同方針) */
const DEV_FALLBACK_SECRET = 'dev-parent-gate-secret-DO-NOT-USE-IN-PROD';

/** JWT issuer (audience を分離して cookie session token との混用を構造防止) */
const JWT_ISSUER = 'ganbari-quest';
const JWT_AUDIENCE = 'parent-gate-pin-reset';

/** JWT payload — minimum claims */
export interface PinResetTokenPayload {
	tenantId: string;
	email: string;
}

function getSecretBytes(): Uint8Array {
	const env = getEnv();
	const secret = env.PARENT_GATE_COOKIE_SECRET;
	const isProd = env.NODE_ENV === 'production' && !env.VITEST;
	if (secret && secret.length >= 16) {
		return encodeSecret(secret);
	}
	if (isProd) {
		throw new Error(
			'[PIN_RESET] PARENT_GATE_COOKIE_SECRET env var is required in production (length >= 16)',
		);
	}
	if (!secret) {
		logger.warn(
			'[PIN_RESET] PARENT_GATE_COOKIE_SECRET not set, using dev fallback (dev/test only)',
		);
	}
	return encodeSecret(DEV_FALLBACK_SECRET);
}

/**
 * jose v6 webapi flavor は `Uint8Array<ArrayBuffer>` を要求 (SharedArrayBuffer 拒否)。
 * `new TextEncoder().encode()` の戻り値型 `Uint8Array<ArrayBufferLike>` が型不一致を
 * 起こすため、明示的に ArrayBuffer-backed copy を作って返す。
 */
function encodeSecret(value: string): Uint8Array {
	const tmp = new TextEncoder().encode(value);
	const copy = new Uint8Array(tmp.length);
	copy.set(tmp);
	return copy;
}

/** ランダム JTI (32 桁 hex、64 bit エントロピーを確保) */
function generateJti(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PIN reset token 発行 (JWT、HS256、30 分有効)
 *
 * @returns 署名済 JWT 文字列 (magic link path に直接埋め込む)
 */
export async function issuePinResetToken(payload: PinResetTokenPayload): Promise<string> {
	const jwt = await new SignJWT({
		tid: payload.tenantId,
		email: payload.email,
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setIssuer(JWT_ISSUER)
		.setAudience(JWT_AUDIENCE)
		.setJti(generateJti())
		.setExpirationTime(`${RESET_TOKEN_TTL_SEC}s`)
		.sign(getSecretBytes());
	return jwt;
}

/** verify 失敗の理由 (UI 文言と直接 1:1 対応、PIN_RESET_LABELS error* と整合) */
export type PinResetVerifyError =
	| 'TOKEN_INVALID' // 署名不正 / payload 不正
	| 'TOKEN_EXPIRED' // exp 過ぎ
	| 'TOKEN_ALREADY_USED'; // JTI consumed 済

export interface PinResetVerifyResult {
	ok: boolean;
	payload?: PinResetTokenPayload;
	jti?: string;
	error?: PinResetVerifyError;
}

/**
 * PIN reset token 検証 (consume 前)
 *
 * 副作用なし。consume はバインドされた tenantId で別途 consumePinResetToken を呼ぶこと。
 */
export async function verifyPinResetToken(token: string): Promise<PinResetVerifyResult> {
	let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
	let jti: string | undefined;
	try {
		const result = await jwtVerify(token, getSecretBytes(), {
			issuer: JWT_ISSUER,
			audience: JWT_AUDIENCE,
		});
		payload = result.payload;
		jti = result.payload.jti;
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code === 'ERR_JWT_EXPIRED') {
			return { ok: false, error: 'TOKEN_EXPIRED' };
		}
		logger.info('[PIN_RESET] token verify failed', { context: { code } });
		return { ok: false, error: 'TOKEN_INVALID' };
	}

	if (typeof payload.tid !== 'string' || typeof payload.email !== 'string' || !jti) {
		return { ok: false, error: 'TOKEN_INVALID' };
	}

	// consume 済 JTI の検出 (tenant に紐付けて保存している)
	const consumed = await getSetting(`pin_reset_jti_consumed:${jti}`, payload.tid);
	if (consumed === 'true') {
		return { ok: false, error: 'TOKEN_ALREADY_USED' };
	}

	return {
		ok: true,
		payload: { tenantId: payload.tid, email: payload.email },
		jti,
	};
}

/**
 * PIN reset token を 1 回限り消費 (JTI を tenant scope の settings に記録)
 *
 * 呼び出し側は verify → password 更新 → consume の順で実行する。consume 失敗 (DB エラー等)
 * は logger に残しつつ token を有効扱いに残し、ユーザにエラー返却することで二重消費を防ぐ。
 */
export async function consumePinResetToken(jti: string, tenantId: string): Promise<void> {
	await setSetting(`pin_reset_jti_consumed:${jti}`, 'true', tenantId);
	// CONSUMED_JTI_RETAIN_SEC 経過後の cleanup は別 cron で行う想定 (Pre-PMF では auto-cleanup なし)。
	// 現状の settings table は TTL 概念がないため、JTI consumed 行は手動でも蓄積されるが、
	// JTI は 32 桁 hex 文字列 × user 数 × reset 試行回数のオーダーで実害なし。
	void CONSUMED_JTI_RETAIN_SEC;
}
