// src/lib/server/auth/auth-mode.ts
// 認証モードの判定だけを持つモジュール (#4723)。
//
// `factory.ts` は AuthProvider の実体 (cognito / local / anonymous) を import するため、
// そこから `getAuthMode()` を取ると **provider 一式が芋づるで付いてくる**。
// 判定自体は env を読むだけなので、provider に依存しないここへ置く。
//
// これがないと `auth/factory → providers/cognito → services/… → plan-limit-service →
// auth/factory` の循環が生まれる (dependency-cruiser `no-circular` が検出する)。

import { getEnv, type TypedEnv } from '$lib/runtime/env';
import { resolveRuntimeMode } from '$lib/runtime/runtime-mode';
import { logger } from '$lib/server/logger';
import type { AuthMode } from './types';

/** 現在の認証モードを取得 */
export function getAuthMode(): AuthMode {
	return getEnv().AUTH_MODE;
}

/**
 * 顧客が触る deploy で COGNITO_DEV_MODE=true を拒否する理由。null なら dev mode に入ってよい。
 *
 * 判定は resolveRuntimeMode だけに頼らず **生の AWS_LAMBDA_FUNCTION_NAME / IS_NUC_DEPLOY を先に見る**
 * (pglite/connection.ts の Lambda 拒否と同じ判断): resolveRuntimeMode は APP_MODE override を
 * Lambda 判定より先に評価するため、Lambda 上に APP_MODE=local-debug が紛れると 'aws-prod' 判定が
 * bypass される。AWS_LAMBDA_FUNCTION_NAME は Lambda ランタイム自身が必ず設定する env で config では
 * 解除できないので、これを最も強い不変条件にする。
 */
export function cognitoDevModeDenialReason(
	env: Pick<TypedEnv, 'APP_MODE' | 'IS_NUC_DEPLOY' | 'AWS_LAMBDA_FUNCTION_NAME' | 'NODE_ENV'>,
): string | null {
	if (env.AWS_LAMBDA_FUNCTION_NAME && env.AWS_LAMBDA_FUNCTION_NAME.length > 0) {
		return 'AWS_LAMBDA_FUNCTION_NAME が設定されている (AWS Lambda)';
	}
	if (env.IS_NUC_DEPLOY === true) return 'IS_NUC_DEPLOY=true (NUC 本番)';
	const mode = resolveRuntimeMode({ env });
	if (mode === 'aws-prod' || mode === 'nuc-prod') return `APP_MODE=${mode}`;
	return null;
}

let devModeDenialLogged = false;

/**
 * 開発モード（COGNITO_DEV_MODE=true）かどうか。
 *
 * 顧客が触る deploy (Lambda / NUC) では env に COGNITO_DEV_MODE=true が紛れ込んでも dev mode に
 * 入らない (fail-closed)。dev mode は固定パスワードの DEV_USERS で誰でもログインでき、/auth/login が
 * その資格情報を HTML に出すため、env の設定ミス 1 つで顧客 tenant が開く経路を「設定されていない
 * こと」だけに頼らず遮断する (adv-4834 / docs/security FINDING-12)。hooks.server.ts の rate limit /
 * 再同意 gate の dev 除外も本関数を使う (判定の SSOT を 1 箇所にする)。
 * NODE_ENV では判定しない — `vite preview` (e2e-cognito-dev lane) は NODE_ENV=production で
 * COGNITO_DEV_MODE=true を正当に使う。
 * 拒否したときはプロセスで 1 回 warn を出す (NUC 実機や .env.local の APP_MODE 残置で
 * dev:cognito の案内が消えた理由を log で追えるように)。
 */
export function isCognitoDevMode(): boolean {
	const env = getEnv();
	if (env.COGNITO_DEV_MODE !== true) return false;
	const reason = cognitoDevModeDenialReason(env);
	if (reason === null) return true;
	if (!devModeDenialLogged) {
		devModeDenialLogged = true;
		logger.warn(
			'[auth-mode] COGNITO_DEV_MODE=true を無視しました: 顧客が触る deploy では dev mode に入りません (fail-closed)',
			{ context: { code: 'cognito_dev_mode_denied', reason } },
		);
	}
	return false;
}
