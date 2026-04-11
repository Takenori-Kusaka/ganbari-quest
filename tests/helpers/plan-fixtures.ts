// tests/helpers/plan-fixtures.ts
// Plan seed fixtures for vitest / Playwright (#759)
//
// ## 設計メモ（オリジナル Issue からのスコープ調整）
//
// Issue 本文は「licenses / trial_history / tenants テーブルを populate する」
// と書かれているが、ローカル SQLite には `licenses` / `tenants` テーブルは存在
// しない。これらは Cognito モード専用で DynamoDB の LICENSE# / TENANT# エンティ
// ティ側にしかない。
//
// ローカルテスト環境での「プラン」は次の 2 つだけで決まる:
//   1. `AuthContext.licenseStatus` / `AuthContext.plan`（メモリ上の値）
//   2. `trial_history` テーブル（実 DB レコード）
//
// そのため本ヘルパは以下を提供する:
//   - AuthContext コンストラクタ（`makeFreeContext` / `makeStandardContext` /
//     `makeFamilyContext`）— DB I/O なし、純粋な値ファクトリ
//   - `trial_history` seeder（`seedTrialActive` / `seedTrialExpired`）—
//     better-sqlite3 インスタンスを受け取り行を挿入
//   - 両者を組み合わせた便宜ヘルパ（`seedTrialActiveContext`）
//
// ## E2E (Playwright) での使い方
//
// E2E のローカル認証モードは常に `plan='family'` を返すため、この seeder を
// 直接呼び出しても意味がない場面がある。E2E からプラン状態を切り替えたい場合は
// DEBUG_PLAN / DEBUG_TRIAL の env 変数（#758）を使うこと。
//
//   DEBUG_PLAN=free    → licenseStatus=none, plan=undefined
//   DEBUG_PLAN=standard→ licenseStatus=active, plan=monthly
//   DEBUG_PLAN=family  → licenseStatus=active, plan=family-monthly
//   DEBUG_TRIAL=active → trial_history 相当の擬似ステータスを注入
//
// 詳細: `src/lib/server/debug-plan.ts` / `.env.example`

import type Database from 'better-sqlite3';
import type { AuthContext, Role } from '../../src/lib/server/auth/types';
import type { TrialSource, TrialTier } from '../../src/lib/server/services/trial-service';

export type TestSqlite = InstanceType<typeof Database>;

export interface ContextOverrides {
	tenantId?: string;
	role?: Role;
	childId?: number;
}

const DEFAULT_TENANT_ID = 'test-tenant-1';

// ============================================================
// AuthContext コンストラクタ（DB I/O なし）
// ============================================================

/**
 * Free プラン相当の `AuthContext` を返す。
 *
 * `resolveFullPlanTier(tenantId, ctx.licenseStatus, ctx.plan)` は、
 * 同 tenantId に対してアクティブな trial_history が無ければ `'free'` を返す。
 *
 * **注意**: 本番環境（AUTH_MODE=cognito）では `licenseStatus` は Cognito
 * カスタム属性から取得されるため、テストでの `'none'` 固定値と異なる場合がある。
 */
export function makeFreeContext(overrides: ContextOverrides = {}): AuthContext {
	return {
		tenantId: overrides.tenantId ?? DEFAULT_TENANT_ID,
		role: overrides.role ?? 'owner',
		childId: overrides.childId,
		licenseStatus: 'none',
		plan: undefined,
	};
}

/**
 * Standard プラン相当の `AuthContext` を返す。
 *
 * plan は `'monthly'` — `resolvePlanTier` は `family` 接頭辞でない plan を
 * 全て standard として扱うため、実際の Stripe plan ID と 1:1 対応する必要はない。
 */
export function makeStandardContext(overrides: ContextOverrides = {}): AuthContext {
	return {
		tenantId: overrides.tenantId ?? DEFAULT_TENANT_ID,
		role: overrides.role ?? 'owner',
		childId: overrides.childId,
		licenseStatus: 'active',
		plan: 'monthly',
	};
}

/**
 * Family プラン相当の `AuthContext` を返す。
 *
 * plan は `'family-monthly'` — `resolvePlanTier` は `family` 接頭辞で family tier と判定する。
 */
export function makeFamilyContext(overrides: ContextOverrides = {}): AuthContext {
	return {
		tenantId: overrides.tenantId ?? DEFAULT_TENANT_ID,
		role: overrides.role ?? 'owner',
		childId: overrides.childId,
		licenseStatus: 'active',
		plan: 'family-monthly',
	};
}

// ============================================================
// trial_history seeders
// ============================================================

export interface SeedTrialOptions {
	tenantId?: string;
	tier?: TrialTier;
	/**
	 * active 時: 終了日が今日から何日後か（default: 7）
	 * expired 時: 終了日が今日から何日前か（default: 1）
	 */
	daysOffset?: number;
	source?: TrialSource;
	campaignId?: string | null;
}

export interface SeededTrial {
	tenantId: string;
	startDate: string;
	endDate: string;
	tier: TrialTier;
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function insertTrialRow(
	sqlite: TestSqlite,
	row: {
		tenantId: string;
		startDate: string;
		endDate: string;
		tier: TrialTier;
		source: TrialSource;
		campaignId: string | null;
	},
): void {
	sqlite
		.prepare(
			`INSERT INTO trial_history (tenant_id, start_date, end_date, tier, source, campaign_id)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(row.tenantId, row.startDate, row.endDate, row.tier, row.source, row.campaignId);
}

/**
 * アクティブなトライアル履歴を seed する。
 *
 * 挿入後は `getTrialStatus(tenantId)` が `isTrialActive=true` を返し、
 * `resolveFullPlanTier(tenantId, 'none')` は指定した tier を返すようになる。
 *
 * @param sqlite   test-db の `createTestDb()` が返す `sqlite` インスタンス
 * @param options  tenantId / tier / 日数オフセット等
 * @returns 挿入したレコードの要約
 */
export function seedTrialActive(sqlite: TestSqlite, options: SeedTrialOptions = {}): SeededTrial {
	const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
	const tier = options.tier ?? 'standard';
	const daysOffset = options.daysOffset ?? 7;

	const today = new Date();
	const start = new Date(today);
	const end = new Date(today);
	end.setDate(end.getDate() + daysOffset);

	const startDate = formatDate(start);
	const endDate = formatDate(end);

	insertTrialRow(sqlite, {
		tenantId,
		startDate,
		endDate,
		tier,
		source: options.source ?? 'user_initiated',
		campaignId: options.campaignId ?? null,
	});

	return { tenantId, startDate, endDate, tier };
}

/**
 * 終了済みのトライアル履歴を seed する。
 *
 * 挿入後は `getTrialStatus(tenantId)` が `isTrialActive=false, trialUsed=true` を
 * 返し、`resolveFullPlanTier(tenantId, 'none')` は `'free'` を返す。
 * トライアル再利用制限（`user_initiated` の再開始拒否）のテストに使う。
 */
export function seedTrialExpired(sqlite: TestSqlite, options: SeedTrialOptions = {}): SeededTrial {
	const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
	const tier = options.tier ?? 'standard';
	const daysOffset = options.daysOffset ?? 1;

	const end = new Date();
	end.setDate(end.getDate() - daysOffset);
	const start = new Date(end);
	start.setDate(start.getDate() - 7);

	const startDate = formatDate(start);
	const endDate = formatDate(end);

	insertTrialRow(sqlite, {
		tenantId,
		startDate,
		endDate,
		tier,
		source: options.source ?? 'user_initiated',
		campaignId: options.campaignId ?? null,
	});

	return { tenantId, startDate, endDate, tier };
}

// ============================================================
// 組み合わせヘルパ
// ============================================================

export interface SeedTrialContextResult {
	context: AuthContext;
	trial: SeededTrial;
}

/**
 * アクティブなトライアルを seed した上で、対応する `AuthContext` を返す。
 *
 * `licenseStatus` は `'none'` のままなので、プラン解決は trial_history 経由で
 * 行われる（ライセンスが切れた直後にトライアルに入るシナリオの再現用）。
 */
export function seedTrialActiveContext(
	sqlite: TestSqlite,
	options: SeedTrialOptions & ContextOverrides = {},
): SeedTrialContextResult {
	const trial = seedTrialActive(sqlite, {
		tenantId: options.tenantId,
		tier: options.tier,
		daysOffset: options.daysOffset,
		source: options.source,
		campaignId: options.campaignId,
	});
	const context = makeFreeContext({
		tenantId: trial.tenantId,
		role: options.role,
		childId: options.childId,
	});
	return { context, trial };
}
