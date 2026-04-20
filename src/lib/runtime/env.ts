/**
 * Typed Config Object (ADR-0040 Phase 1)
 *
 * 環境変数の唯一の読込点。本ファイル以外で `process.env.X` を直接参照することは
 * `scripts/check-no-direct-env-access.mjs` で CI 禁止される（grandfather された
 * 既存ファイルを除く）。
 *
 * 設計:
 * - Zod で型 + バリデーション。起動時に一度だけ parse し、壊れた env は即 throw
 * - `z.string().optional()` を既定にし、必須値は `.min(N)` / `.nonempty()` で明示
 * - `dev` 限定 env (DEBUG_*) は dev 以外で設定されていても無視される設計
 *   （ランタイム側で `dev === true` チェックを継続）
 * - PUBLIC_* は SvelteKit の `$env/static/public` と命名規約一致。ただし
 *   `import.meta.env` ではなく `process.env` 経由で統一する（SSR / Lambda / Node
 *   scripts すべてで動くため）
 *
 * ADR-0029 連携: 新しい required env を追加する PR は `scripts/check-new-required-env.mjs`
 * が PR 本文の「配布済み:」証跡を強制する。本ファイルへの required 追加も同ルールの対象。
 */

import { z } from 'zod';

const booleanStringSchema = z
	.enum(['true', 'false'])
	.transform((v) => v === 'true')
	.optional();

const envSchema = z.object({
	// ----- Runtime mode -----
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

	/**
	 * アプリ実行モード（ADR-0040）。P2 で `resolveRuntimeMode()` が解釈する。
	 * env で明示されない場合は P2 が NODE_ENV / AWS_LAMBDA_FUNCTION_NAME /
	 * IS_NUC_DEPLOY 等から推論する。
	 */
	APP_MODE: z.enum(['build', 'demo', 'local-debug', 'aws-prod', 'nuc-prod']).optional(),

	/** NUC 本番デプロイ判定（IS_NUC_DEPLOY=true で nuc-prod モード） */
	IS_NUC_DEPLOY: booleanStringSchema,

	/** メンテナンスモード */
	MAINTENANCE_MODE: booleanStringSchema,

	// ----- Auth -----
	AUTH_MODE: z.enum(['local', 'cognito']).default('local'),
	COGNITO_DEV_MODE: booleanStringSchema,
	COGNITO_USER_POOL_ID: z.string().optional(),
	COGNITO_CLIENT_ID: z.string().optional(),
	COGNITO_CLIENT_SECRET: z.string().optional(),
	COGNITO_DOMAIN: z.string().optional(),
	COGNITO_CALLBACK_URL: z.string().url().optional(),
	COGNITO_LOGOUT_URL: z.string().url().optional(),

	// ----- AWS -----
	AWS_REGION: z.string().default('us-east-1'),
	AWS_LAMBDA_FUNCTION_NAME: z.string().optional(),
	DYNAMODB_TABLE: z.string().optional(),
	DYNAMODB_TABLE_NAME: z.string().optional(),
	TABLE_NAME: z.string().optional(),
	DYNAMODB_ENDPOINT: z.string().url().optional(),
	ASSETS_BUCKET: z.string().optional(),

	// ----- Database -----
	DATABASE_URL: z.string().default('./data/ganbari-quest.db'),
	DATA_SOURCE: z.enum(['sqlite', 'dynamodb']).default('sqlite'),
	SCHEMA_VALIDATION_MODE: z.enum(['warn', 'strict']).optional(),

	// ----- Stripe -----
	STRIPE_SECRET_KEY: z.string().optional(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_PRICE_MONTHLY: z.string().optional(),
	STRIPE_PRICE_YEARLY: z.string().optional(),
	STRIPE_PRICE_FAMILY_MONTHLY: z.string().optional(),
	STRIPE_PRICE_FAMILY_YEARLY: z.string().optional(),
	STRIPE_MOCK: booleanStringSchema,

	// ----- License (ADR-0026) -----
	AWS_LICENSE_SECRET: z.string().min(32).optional(),
	ALLOW_LEGACY_LICENSE_KEYS: booleanStringSchema,

	// ----- Ops (ADR-0033) -----
	CRON_SECRET: z.string().min(32).optional(),
	OPS_SECRET_KEY: z.string().optional(),
	OPS_DOMAIN_COST_JPY: z.coerce.number().int().default(117),
	OPS_VIRTUAL_OFFICE_COST_JPY: z.coerce.number().int().default(0),

	// ----- Debug (dev only, #758) -----
	DEBUG_PLAN: z.enum(['free', 'standard', 'family']).optional(),
	DEBUG_TRIAL: z.enum(['active', 'expired', 'not-started']).optional(),
	DEBUG_TRIAL_TIER: z.enum(['standard', 'family']).optional(),

	// ----- Logger -----
	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),

	// ----- Push Notification -----
	VAPID_PUBLIC_KEY: z.string().optional(),
	VAPID_PRIVATE_KEY: z.string().optional(),
	VAPID_SUBJECT: z.string().default('mailto:noreply@ganbari-quest.com'),

	// ----- AI Provider -----
	AI_PROVIDER: z.enum(['gemini', 'bedrock', 'mock']).optional(),
	GEMINI_API_KEY: z.string().optional(),
	GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
	BEDROCK_MODEL_ID: z.string().default('us.anthropic.claude-haiku-4-5-20251001-v1:0'),
	BEDROCK_REGION: z.string().optional(),
	BEDROCK_DISABLED: booleanStringSchema,

	// ----- Analytics -----
	ANALYTICS_ENABLED: booleanStringSchema,
	ANALYTICS_TABLE_NAME: z.string().optional(),
	UMAMI_API_KEY: z.string().optional(),
	PUBLIC_UMAMI_WEBSITE_ID: z.string().optional(),
	PUBLIC_UMAMI_HOST: z.string().url().optional(),
	PUBLIC_SENTRY_DSN: z.string().optional(),

	// ----- Context Token -----
	CONTEXT_TOKEN_SECRET: z.string().optional(),

	// ----- GitHub API (#1201 / ADR-0044 /ops admin bypass metrics) -----
	GITHUB_TOKEN: z.string().optional(),
	GH_TOKEN: z.string().optional(),
});

export type TypedEnv = z.infer<typeof envSchema>;

let cached: TypedEnv | null = null;

/**
 * env を 1 回だけ parse してキャッシュする。バリデーション失敗時は詳細な
 * エラーメッセージ付きで throw する（起動を止める）。
 *
 * テスト時に env を切り替えたい場合は `resetEnvForTesting()` を呼ぶこと。
 */
export function getEnv(): TypedEnv {
	if (cached) return cached;
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
			.join('\n');
		throw new Error(
			`[runtime/env] Environment variable validation failed:\n${issues}\n\nSee src/lib/runtime/env.ts for the schema.`,
		);
	}
	cached = result.data;
	return cached;
}

/**
 * テスト専用: キャッシュをリセットして次回 `getEnv()` で再 parse させる。
 * production / dev コードから呼んではならない。
 */
export function resetEnvForTesting(): void {
	cached = null;
}

/**
 * Top-level export for ergonomics: `import { env } from '$lib/runtime/env'`.
 *
 * 注意: module load 時に getEnv() が走るため、env が不正な状態でこのモジュールが
 * import されるとアプリ起動が止まる（狙った挙動）。テストで env をモックしたい
 * 場合は `getEnv()` / `resetEnvForTesting()` を明示的に呼ぶこと。
 */
export const env: TypedEnv = getEnv();
