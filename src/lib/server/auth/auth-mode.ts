// src/lib/server/auth/auth-mode.ts
// 認証モードの判定だけを持つモジュール (#4723)。
//
// `factory.ts` は AuthProvider の実体 (cognito / local / anonymous) を import するため、
// そこから `getAuthMode()` を取ると **provider 一式が芋づるで付いてくる**。
// 判定自体は env を読むだけなので、provider に依存しないここへ置く。
//
// これがないと `auth/factory → providers/cognito → services/… → plan-limit-service →
// auth/factory` の循環が生まれる (dependency-cruiser `no-circular` が検出する)。

import type { AuthMode } from './types';

/** 現在の認証モードを取得 */
export function getAuthMode(): AuthMode {
	return (process.env.AUTH_MODE ?? 'local') as AuthMode;
}

/** 開発モード（COGNITO_DEV_MODE=true）かどうか */
export function isCognitoDevMode(): boolean {
	return process.env.COGNITO_DEV_MODE === 'true';
}
