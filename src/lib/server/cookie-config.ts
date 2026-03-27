// src/lib/server/cookie-config.ts
// Cookie設定のセキュリティフラグ
// Lambda環境（CloudFront + HTTPS）ではsecure: true
// NUC/ローカル環境（HTTP）ではsecure: false

export const COOKIE_SECURE = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
