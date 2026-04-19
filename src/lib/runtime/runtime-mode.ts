/**
 * Runtime Mode (ADR-0040 Phase 2)
 *
 * アプリ実行モードの判定。5 モードは互いに排他的で、capability gate (P4) や
 * Playwright テストマトリクス (P5) の基礎となる。
 *
 * | Mode        | 条件                                                                    |
 * | ----------- | ----------------------------------------------------------------------- |
 * | build       | Vite build / SvelteKit prerender 中                                     |
 * | demo        | `/demo` 配下のリクエスト（匿名、DB なし、読み取り専用）                  |
 * | local-debug | `npm run dev` 環境（local auth / sqlite / AUTH_MODE=local）             |
 * | aws-prod    | AWS Lambda ランタイム（AWS_LAMBDA_FUNCTION_NAME が設定されている）      |
 * | nuc-prod    | NUC on-prem 本番（IS_NUC_DEPLOY=true）                                  |
 *
 * 判定は **純関数** として実装する（process.env / building / url に直接依存しない）。
 * テスト容易性と、将来 EvaluationContext (P3) 経由で差し替え可能にするため。
 *
 * 優先順位:
 * 1. `env.APP_MODE` が明示設定されていれば、無条件でそれを返す（override）
 * 2. `isBuilding === true` なら `'build'`
 * 3. `isDemoRequest === true`（hooks.server.ts で resolveDemoActive から決まる）なら `'demo'`
 * 4. `isDemoRequest` 未指定 + pathname が `/demo` / `/demo/...` なら `'demo'`（後方互換）
 * 5. `env.IS_NUC_DEPLOY === true` なら `'nuc-prod'`
 * 6. `env.AWS_LAMBDA_FUNCTION_NAME` が設定されていれば `'aws-prod'`
 * 7. それ以外は `'local-debug'`
 *
 * 設計上の注意:
 * - NUC と AWS Lambda が同時に true になることは物理的にない（排他性は運用で担保）
 * - デモ + `IS_NUC_DEPLOY` が同時に成立する場合は `'demo'` を優先する。
 *   nuc-prod の本番環境でデモを公開するユースケースがあり得るため。
 * - `APP_MODE` が最優先なのは、テスト／デバッグで意図的にモードを固定したい場合に
 *   他の条件（Lambda か否か等）と戦わずに済むようにするため。
 * - `isDemoRequest` は ADR-0039 / #1199 準拠。hooks.server.ts が `?mode=demo` /
 *   cookie `gq_demo=1` / `/demo/*` から解決した `event.locals.isDemo` を渡す想定。
 *   pathname フォールバックは非 HTTP コンテキスト（テスト、build script）用。
 */

import type { TypedEnv } from './env';

export const RUNTIME_MODES = ['build', 'demo', 'local-debug', 'aws-prod', 'nuc-prod'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/**
 * resolveRuntimeMode の入力。純関数として扱えるよう、すべて明示的に渡す。
 */
export interface ResolveRuntimeModeInput {
	/** Typed env のうち mode 判定に関係するフィールドのみ */
	env: Pick<TypedEnv, 'APP_MODE' | 'IS_NUC_DEPLOY' | 'AWS_LAMBDA_FUNCTION_NAME' | 'NODE_ENV'>;
	/** リクエスト URL の pathname。build 時や CLI 呼び出しでは undefined を渡す */
	pathname?: string;
	/** `$app/environment` の `building` フラグ。Node scripts からは false でよい */
	isBuilding?: boolean;
	/**
	 * ADR-0039 / #1199: hooks.server.ts で resolveDemoActive から決まる isDemo 結果。
	 * 指定された場合は pathname の `/demo` フォールバックよりも優先される。
	 */
	isDemoRequest?: boolean;
}

export function resolveRuntimeMode(input: ResolveRuntimeModeInput): RuntimeMode {
	const { env, pathname, isBuilding, isDemoRequest } = input;

	if (env.APP_MODE) return env.APP_MODE;
	if (isBuilding) return 'build';
	if (isDemoRequest === true) return 'demo';
	if (
		isDemoRequest === undefined &&
		pathname &&
		(pathname === '/demo' || pathname.startsWith('/demo/'))
	) {
		return 'demo';
	}
	if (env.IS_NUC_DEPLOY === true) return 'nuc-prod';
	if (env.AWS_LAMBDA_FUNCTION_NAME && env.AWS_LAMBDA_FUNCTION_NAME.length > 0) return 'aws-prod';
	return 'local-debug';
}

/**
 * モードごとの永続化／認証／決済の標準的な挙動。P4 の Policy Gate が参照する想定。
 * 本ファイルでは型と素朴なプロパティのみ提供し、実際の可否判断は P4 の `can()` が行う。
 */
export const RUNTIME_MODE_PROFILES: Record<
	RuntimeMode,
	{
		persistence: 'none' | 'local-sqlite' | 'dynamodb';
		authMode: 'none' | 'local' | 'cognito';
		acceptsWrites: boolean;
	}
> = {
	build: { persistence: 'none', authMode: 'none', acceptsWrites: false },
	demo: { persistence: 'none', authMode: 'none', acceptsWrites: false },
	'local-debug': { persistence: 'local-sqlite', authMode: 'local', acceptsWrites: true },
	'aws-prod': { persistence: 'dynamodb', authMode: 'cognito', acceptsWrites: true },
	'nuc-prod': { persistence: 'local-sqlite', authMode: 'cognito', acceptsWrites: true },
};
