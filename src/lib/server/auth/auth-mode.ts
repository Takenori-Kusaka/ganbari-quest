// src/lib/server/auth/auth-mode.ts
// 認証モードの判定だけを持つモジュール (#4723)。
//
// `factory.ts` は AuthProvider の実体 (cognito / local / anonymous) を import するため、
// そこから `getAuthMode()` を取ると **provider 一式が芋づるで付いてくる**。
// 判定自体は env を読むだけなので、provider に依存しないここへ置く。
//
// これがないと `auth/factory → providers/cognito → services/… → plan-limit-service →
// auth/factory` の循環が生まれる (dependency-cruiser `no-circular` が検出する)。

import { getEnv } from '$lib/runtime/env';
import { resolveRuntimeMode } from '$lib/runtime/runtime-mode';
import type { AuthMode } from './types';

/** 現在の認証モードを取得 */
export function getAuthMode(): AuthMode {
	return getEnv().AUTH_MODE;
}

/**
 * 開発モード（COGNITO_DEV_MODE=true）かどうか。
 *
 * 顧客が触る deploy (`aws-prod` = Lambda / `nuc-prod` = NUC) では env に COGNITO_DEV_MODE=true が
 * 紛れ込んでも dev mode に入らない (fail-closed)。dev mode は固定パスワードの DEV_USERS で誰でも
 * ログインでき、/auth/login がその資格情報を HTML に出すため、env の設定ミス 1 つで顧客 tenant が
 * 開く経路を「設定されていないこと」だけに頼らず遮断する (adv-4834 / FINDING-12)。
 * NODE_ENV では判定しない — `vite preview` (e2e-cognito-dev lane) は NODE_ENV=production で
 * COGNITO_DEV_MODE=true を正当に使う。
 */
export function isCognitoDevMode(): boolean {
	const env = getEnv();
	if (env.COGNITO_DEV_MODE !== true) return false;
	const mode = resolveRuntimeMode({ env });
	return mode !== 'aws-prod' && mode !== 'nuc-prod';
}
