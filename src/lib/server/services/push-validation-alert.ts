// src/lib/server/services/push-validation-alert.ts
// #3404 item3: subscribe endpoint での INVALID_ENDPOINT / INVALID_KEY 発生の可視化。
//
// 背景: push service ベンダーが endpoint host を新設 / 移行すると、静的 allowlist
// (push-endpoint-validation.ts) が正規ブラウザの subscribe を拒否し、その browser セグメントの
// 通知が「無言で」止まる事業継続リスクがある。拒否は 400 で返るだけで運用が気づけないため、
// 発生を能動的に観測可能にする。
//
// 実装方式 (ADR-0010 Pre-PMF 最小、既存基盤へ合流):
//   1. `logger.warn` — structured context (kind='push-validation-rejected' / code / reason)。
//      CloudWatch Logs Insights で `filter context.kind = "push-validation-rejected"` query 可能
//      (optional-write-alert.ts の fitness#11 counter と同 pattern)。将来 metric filter / alarm を
//      CDK 化する場合もこの stable key を filterPattern にそのまま使える。
//   2. `sendDiscordAlert` — fire-and-forget (stripe/alert.ts / optional-write-alert.ts と同 pattern)。
//      throttle (5 分窓 / 3 件でまとめ通知) は discord-alert.ts 側が担うため、攻撃者による
//      不正 endpoint 連投でも alert が洪水化しない。
//
// custom CloudWatch metric (EMF / putMetricData) + CDK alarm 新設は不採用: repo に custom metric の
// 既存 pattern が無く (ops-stack.ts は AWS 標準 metric のみ、free-tier basic alarm 枠 9/10 使用済)、
// Pre-PMF で新規機構を持ち込むより既存 log + Discord 基盤で可視化する方が導入 / 保守コストが小さい。

import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';

export type PushValidationRejectionCode = 'INVALID_ENDPOINT' | 'INVALID_KEY';

export interface PushValidationRejection {
	tenantId: string;
	code: PushValidationRejectionCode;
	/** 拒否理由 (validatePushEndpoint().reason 等)。server 内部観測用、client には返さない。 */
	reason: string;
}

/**
 * push subscribe の validation 拒否を structured log + Discord alert で観測可能にする。
 * subscribe response をブロックしない (alert は fire-and-forget)。
 */
export function reportPushValidationRejection(rejection: PushValidationRejection): void {
	// 1. structured logger (検索 key: context.kind / context.code)
	logger.warn(`[notifications/subscribe] push validation 拒否 (${rejection.code})`, {
		tenantId: rejection.tenantId,
		service: 'push-subscribe',
		context: {
			kind: 'push-validation-rejected',
			code: rejection.code,
			reason: rejection.reason,
		},
	});

	// 2. Discord alert (fire-and-forget、subscribe response をブロックしない)。
	//    ベンダー host 変更で正規ブラウザが弾かれ始めた場合、同一 reason が連続するため
	//    discord-alert.ts の throttle key (path + errorSummary) でまとめ通知に収束する。
	void sendDiscordAlert({
		level: 'error',
		message: `[push-validation-rejected] ${rejection.code} (push subscribe 拒否 — ベンダー host 変更の可能性を確認)`,
		path: '/api/v1/notifications/subscribe',
		tenantId: rejection.tenantId,
		errorSummary: rejection.reason,
	}).catch((err) => {
		// alert 自体の失敗は warn に留める (recursive alert を避ける)
		logger.warn(`[push-validation-alert] Discord alert dispatch failed: ${String(err)}`);
	});
}
