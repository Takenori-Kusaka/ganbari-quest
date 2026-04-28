// src/lib/server/services/survey-token.ts
// #1598 (ADR-0023 §3.6 §5 I7): PMF 判定アンケートのリンク用 HMAC トークン。
//
// メール本文のリンクから認証なしで回答できるよう、HMAC で署名された
// `<tenantId>.<round>.<sig>` 形式のトークンを発行する。
//
// 設計判断:
//   - `unsubscribe-token.ts` と同じ鍵 (`OPS_SECRET_KEY`/`CRON_SECRET`) を流用
//     (鍵配布経路を増やさない、ADR-0010 Pre-PMF シンプル化)
//   - round (例: "2026-H1") は固定文字列で、メール送信時刻に依存しない
//   - expiry は付けない (メール経由 → 数日〜数週間後の回答も許容)
//
// セキュリティ: トークンを偽造しても他人の tenantId 宛に投票できるだけで、
// PII の漏洩は無い。ops 集計は tenantId × round で重複排除される。

import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '$lib/runtime/env';

// ============================================================
// 内部ヘルパ
// ============================================================

function getSigningSecret(): string {
	const env = getEnv();
	const secret = env.OPS_SECRET_KEY ?? env.CRON_SECRET;
	if (secret && secret.length > 0) return secret;
	if (env.AUTH_MODE === 'local') {
		// ローカル開発時のみの dev fallback。production では compute-stack.ts が
		// `cronSecret || opsSecretKey` を保証するため到達しない。
		return 'local-dev-survey-secret';
	}
	throw new Error(
		'[survey-token] OPS_SECRET_KEY (or CRON_SECRET) is required in non-local environments',
	);
}

function base64UrlEncode(input: Buffer): string {
	return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload: string): string {
	const hmac = createHmac('sha256', getSigningSecret());
	hmac.update(payload);
	return base64UrlEncode(hmac.digest());
}

// ============================================================
// Public API
// ============================================================

export interface SurveyTokenPayload {
	tenantId: string;
	round: string;
}

/** トークン生成。`<tenantId>.<round>.<sig>` 形式。 */
export function generateSurveyToken(payload: SurveyTokenPayload): string {
	const { tenantId, round } = payload;
	if (!tenantId) throw new Error('[survey-token] tenantId is required');
	if (!round) throw new Error('[survey-token] round is required');
	if (tenantId.includes('.')) {
		throw new Error('[survey-token] tenantId must not contain "." (delimiter conflict)');
	}
	if (round.includes('.')) {
		throw new Error('[survey-token] round must not contain "." (delimiter conflict)');
	}
	const body = `${tenantId}.${round}`;
	return `${body}.${sign(body)}`;
}

/**
 * トークン検証 + decode。
 *
 * @returns 検証成功時は payload、失敗時は null。例外は投げない (入力は外部由来)。
 */
export function verifySurveyToken(token: string): SurveyTokenPayload | null {
	if (!token || typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [tenantId, round, sig] = parts;
	if (!tenantId || !round || !sig) return null;

	const expected = sign(`${tenantId}.${round}`);
	const expectedBuf = Buffer.from(expected);
	const actualBuf = Buffer.from(sig);
	if (expectedBuf.length !== actualBuf.length) return null;
	if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

	return { tenantId, round };
}
