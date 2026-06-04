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
	// #2097 ADR-0048: AUTH_MODE='anonymous' を追加 (demo Lambda 用、AnonymousAuthProvider 選択)
	AUTH_MODE: z.enum(['local', 'cognito', 'anonymous']).default('local'),
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
	// #2097 ADR-0048: DATA_SOURCE='demo' を追加 (demo Lambda 用、stateless fixture Repository 選択)
	DATA_SOURCE: z.enum(['sqlite', 'dynamodb', 'demo']).default('sqlite'),
	SCHEMA_VALIDATION_MODE: z.enum(['warn', 'strict']).optional(),

	// ----- Stripe -----
	STRIPE_SECRET_KEY: z.string().optional(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	// #2719 (Phase 7 PR-3b prerequisite、Pre-PMF YAGNI 整合):
	// Phase 1 補強 2 FR-2 (`phase1-plan-naming-pricing-axis-requirements.md`) + 補強 PR #2684
	// で「課金期間 = 月額のみ」が確定 (年額プラン物理削除方針)。
	// 旧 yearly env var 4 種 (`STRIPE_PRICE_*_YEARLY` + legacy `STRIPE_PRICE_MONTHLY` /
	// `STRIPE_PRICE_YEARLY`) は本 PR で物理削除し、code 側 yearly 経路の silent failure
	// risk を解消する (QA #2722 BLOCK V-3 直対処)。
	//
	// 維持される 2 env var は `config.ts` `buildPlanConfigs()` / `getPriceId()` / Phase 7
	// PR-3a lookup_key 経路 (USE_LOOKUP_KEY=true 時の fallback) で参照される。
	//
	// 注: Production Stripe Dashboard の旧 yearly Price (4 件) archive は PR-5 cleanup
	// で実施。本 PR は code 側削除のみ。
	STRIPE_PRICE_STANDARD_MONTHLY: z.string().optional(),
	STRIPE_PRICE_FAMILY_MONTHLY: z.string().optional(),
	STRIPE_MOCK: booleanStringSchema,

	// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract。AWS_LICENSE_SECRET (HMAC 署名秘密鍵) /
	// ALLOW_LEGACY_LICENSE_KEYS (旧形式受入フラグ) を env schema から撤去。コード参照は 0 件、
	// entitlement は Stripe Subscription (tenant.status) が唯一 SSOT。GitHub Secrets / CDK 側の実体撤去は
	// PR body「PO 手動操作」セクション参照。

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

	// ----- Analytics (#1591 / ADR-0023 I2) -----
	// AWS 内完結 (DynamoDB) のみ。umami / Sentry は #1591 で削除済み。
	// 外部 SaaS analytics を再導入する場合は ADR-0023 §3.4 ホワイトリストの更新と
	// ADR-0010 過剰防衛禁止の照らし合わせを先に行うこと。
	ANALYTICS_ENABLED: booleanStringSchema,
	ANALYTICS_TABLE_NAME: z.string().optional(),

	// ----- Context Token -----
	CONTEXT_TOKEN_SECRET: z.string().optional(),

	// ----- GitHub API (#1201 / ADR-0044 /ops admin bypass metrics) -----
	GITHUB_TOKEN: z.string().optional(),
	GH_TOKEN: z.string().optional(),

	// ----- App URL (#1598 / ADR-0023 I7) -----
	// 本番では `https://ganbari-quest.com` を CDK context 経由で注入。
	// 未設定時は本番 URL にフォールバック (email-service.ts と整合)。
	APP_BASE_URL: z.string().url().optional(),

	// ----- Parent-Gate Session (#2310 / ADR-0050) -----
	/**
	 * /admin/* PIN gate の cookie 署名キー (cookie-signature HMAC-SHA256)。
	 * production cognito mode で未設定だと起動時 throw。dev / test は fallback secret で動作。
	 * 配布: AWS Secrets Manager / SSM Parameter Store (`/ganbari-quest/prod/parent_gate_cookie_secret`)
	 */
	PARENT_GATE_COOKIE_SECRET: z.string().min(16).optional(),
	/**
	 * cognito-dev mode で PIN gate を強制 ON にする (手動 dogfood / SS 撮影用)。
	 * 通常の cognito-dev では既存 E2E 全 spec を破壊しないため gate 無効。
	 */
	PARENT_GATE_FORCE_ACTIVE: booleanStringSchema,

	// ----- Test runtime -----
	/** vitest 自動設定 (`process.env.VITEST = "true"`)。production 判定の例外用 */
	VITEST: z.string().optional(),
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
