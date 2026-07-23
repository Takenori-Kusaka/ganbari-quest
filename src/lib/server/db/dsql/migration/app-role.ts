// src/lib/server/db/dsql/migration/app-role.ts
// EPIC #3424 M5 / #3646 — アプリ実行 role (app_user) の provisioning。
//
// DSQL の IAM 認可仕様 (AWS 公式 authentication-authorization.html):
//   - `admin` role で接続 = IAM action `dsql:DbConnectAdmin` が必要
//   - custom database role で接続 = `dsql:DbConnect` + 事前の `AWS IAM GRANT <role> TO '<arn>'`
// compute-stack (#3637) は Lambda に DbConnect のみ付与する (M3 §3.4 B6 最小権限) ため、
// 対応する custom role を本 module が provisioning しないと Lambda は一切接続できない
// (staging cycle 4 で実機露呈: health probe 接続不能 → 503 → LWA readiness 未達 → 502)。
//
// GRANT 方針 (M3 §3.4「追記性の物理担保」を実装事実に整合させた確定形):
//   - UPDATE 除外表 (下記 UPDATE_EXCLUDED_TABLES): SELECT/INSERT/DELETE のみ付与。
//     台帳・同意・履歴の**書き換え (UPDATE) を DB GRANT で物理的に不能**にする。
//     DELETE は除外しない — 退会 (tenant 全削除) / retention cleanup (ADR-0049 物理削除) /
//     child 削除の正当業務経路が DELETE を発行するため (M3 §3.4 の「UPDATE/DELETE 除外」は
//     ADR-0049 と矛盾しており、DELETE 許可へ是正。#3646 記録)。
//   - UPDATE 許可表 (下記 UPDATE_ALLOWED_TABLES): SELECT/INSERT/UPDATE/DELETE を付与。
//   - #3658 deny-by-default: 旧来は「除外リストに無い表 = UPDATE 付与」の fail-open だったが、
//     新表を追加したとき除外/許可の分類判断が誰にも強制されず、追記型の新表が既定で全権 GRANT
//     され台帳改竄防御から silent に漏れうる問題を是正。UPDATE は **allowlist 明示付与のみ**とし、
//     どちらの集合にも無い未分類表は UPDATE 抜き (= append-only 側に倒れる安全側) に GRANT する。
//     分類の網羅・排他は静的 fitness (dsql-append-only-update-fitness.test.ts) が CI 強制する。
//   - 表列挙は information_schema から動的に行う (migration で新表が増えても再実行で自動 cover、
//     GRANT は冪等)。dsql_migrations (適用管理表) はアプリ経路に不要のため付与しない。
//
// 実行経路: dsql-migrate と同じ DbConnectAdmin credential (deploy workflow / 運用者)。
// アプリ実行 role からは到達不能 (M3 §3.4 B6 経路分離)。

import type { RawSqlExecutor } from './async-index-poll';

/** postgres identifier として安全な形式のみ許可する (SQL injection 防御、raw executor のため)。 */
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function assertIdent(name: string, label: string): void {
	if (!IDENT_RE.test(name)) {
		throw new Error(`[app-role] ${label} が identifier 形式ではありません: ${name}`);
	}
}

/** IAM role ARN の許容形式 (AWS IAM GRANT に埋め込むため厳格に検証する)。 */
const ARN_RE = /^arn:aws:iam::\d{12}:(role|user)\/[\w+=,.@/-]+$/;

/**
 * UPDATE を GRANT しない表 (= SELECT/INSERT/DELETE のみ)。
 * M3 §3.4 の append-only 群のうち、**実装 (dsql repos) が UPDATE を発行しない表**に限定する。
 * activity_logs (cancelled soft-cancel) / trial_history (状態更新) は実装が UPDATE を必要と
 * するため除外リストに入れない。この集合の表に将来 UPDATE を書くと staging/本番で権限エラーに
 * なる = 追記性違反の物理検出として機能する (対応する静的検査:
 * tests/unit/architecture/dsql-append-only-update-fitness.test.ts)。
 */
export const UPDATE_EXCLUDED_TABLES: ReadonlySet<string> = new Set([
	'point_ledger',
	'consents',
	'status_history',
	'checklist_logs',
	'notification_logs',
	'usage_logs',
	'cancellation_reasons',
	'graduation_consent',
]);

/**
 * UPDATE を GRANT する表 (= SELECT/INSERT/UPDATE/DELETE 全付与)。
 * #3658 deny-by-default 化: UPDATE 権限は「除外リストに無い表」への暗黙付与 (fail-open) をやめ、
 * **本 allowlist に明示列挙した表にのみ付与**する。新表を schema に追加したとき、
 * UPDATE 除外 (append-only) / UPDATE 許可 のいずれに分類するかを開発者に強制するためのもの。
 * どちらの集合にも無い新表は runtime で UPDATE を得られない (= append-only 側に倒れる安全側)。
 *
 * 分類の網羅・排他は tests/unit/architecture/dsql-append-only-update-fitness.test.ts の
 * no-silent-gap fitness が CI 強制する (#3134 同型): schema.ts の全表が
 * UPDATE_EXCLUDED_TABLES ∪ UPDATE_ALLOWED_TABLES に一致し、両集合が disjoint であること。
 * 未分類の新表があれば CI red で分類判断を強制する。
 */
export const UPDATE_ALLOWED_TABLES: ReadonlySet<string> = new Set([
	'children',
	'users',
	'families',
	'memberships',
	'invites',
	'child_activities',
	'activity_logs',
	'statuses',
	'activity_mastery',
	'daily_missions',
	'stamp_cards',
	'stamp_entries',
	'checklist_templates',
	'checklist_template_items',
	'checklist_template_assignments',
	'evaluations',
	'rest_days',
	'daily_battles',
	'enemy_collection',
	'checklist_overrides',
	'child_activity_preferences',
	'login_streaks',
	'certificates',
	'special_rewards',
	'reward_redemption_requests',
	'parent_messages',
	'sibling_cheers',
	'character_images',
	'child_custom_voices',
	'child_challenges',
	'market_benchmarks',
	'settings',
	'push_subscriptions',
	'trial_history',
	'viewer_tokens',
	'cloud_exports',
	'inquiries',
	'parent_gate_credentials',
	'loyalty_state',
	'account_lifecycle',
	'decay_policy',
	'approval_policy',
	'point_conversion_policy',
	'notification_settings',
	'bonus_rules',
	'email_login_lockouts',
	'categories',
	'stamp_masters',
	'plans',
	'plan_tiers',
	'stripe_webhook_events',
]);

export interface AppRoleProvisionOptions {
	/** 作成する db role 名 (既定 'app_user')。 */
	roleName?: string;
	/** 指定時、この IAM role/user ARN に AWS IAM GRANT で紐付ける (Lambda 実行 role)。 */
	iamRoleArn?: string;
}

export interface AppRoleProvisionResult {
	roleName: string;
	roleCreated: boolean;
	iamGranted: boolean;
	granted: { table: string; privileges: string }[];
}

/** アプリ実行 role の既定名。compute-stack が Lambda env DSQL_USER に注入する値と一致させる。 */
export const APP_ROLE_NAME = 'app_user';

/**
 * app role を provisioning する (冪等 — role/mapping は存在チェック、GRANT は重複適用が no-op)。
 * 1 文ずつ autocommit 適用する (DSQL は 1txn 1DDL、runner と同じ前提)。
 */
export async function provisionAppRole(
	executor: RawSqlExecutor,
	opts: AppRoleProvisionOptions = {},
): Promise<AppRoleProvisionResult> {
	const roleName = opts.roleName ?? APP_ROLE_NAME;
	assertIdent(roleName, 'roleName');
	if (opts.iamRoleArn && !ARN_RE.test(opts.iamRoleArn)) {
		throw new Error(
			`[app-role] iamRoleArn が IAM role/user ARN 形式ではありません: ${opts.iamRoleArn}`,
		);
	}

	// 1) role 作成 (存在チェック → CREATE。DSQL/pg に CREATE ROLE IF NOT EXISTS は無い)
	const existing = await executor.execute(`SELECT 1 FROM pg_roles WHERE rolname = '${roleName}'`);
	const roleCreated = existing.rows.length === 0;
	if (roleCreated) {
		await executor.execute(`CREATE ROLE ${roleName} WITH LOGIN`);
	}

	// 2) IAM mapping (指定時のみ)。sys.iam_pg_role_mappings で冪等化 —
	//    AWS IAM GRANT の重複適用挙動は公式 doc に明記が無いため、既存 mapping はスキップする。
	let iamGranted = false;
	if (opts.iamRoleArn) {
		const mapped = await executor.execute(
			`SELECT 1 FROM sys.iam_pg_role_mappings WHERE arn = '${opts.iamRoleArn}' AND pg_role_name = '${roleName}'`,
		);
		if (mapped.rows.length === 0) {
			await executor.execute(`AWS IAM GRANT ${roleName} TO '${opts.iamRoleArn}'`);
			iamGranted = true;
		}
	}

	// 3) 表 GRANT (information_schema から動的列挙、冪等)。
	//    `GRANT USAGE ON SCHEMA public` は発行しない — DSQL では public schema が system entity
	//    (0A000 feature not supported、実機確認 #3646)。pg 系では public の USAGE は PUBLIC role
	//    に既定付与されるため、表 GRANT のみでアクセス可能になる (dsql-app-role.test.ts [G2]/[G3]
	//    が実権限を assert)。
	const tables = await executor.execute(
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		 ORDER BY table_name`,
	);
	const granted: AppRoleProvisionResult['granted'] = [];
	for (const row of tables.rows as { table_name: string }[]) {
		const table = row.table_name;
		if (table === 'dsql_migrations') continue; // 適用管理表はアプリ経路に不要
		assertIdent(table, 'table_name');
		// #3658 deny-by-default: UPDATE は allowlist 明示付与のみ (fail-open 廃止)。
		// 未分類の新表 (どちらの集合にも無い) は UPDATE 抜き = append-only 側に倒れる安全側。
		const privileges = UPDATE_ALLOWED_TABLES.has(table)
			? 'SELECT, INSERT, UPDATE, DELETE'
			: 'SELECT, INSERT, DELETE';
		await executor.execute(`GRANT ${privileges} ON ${table} TO ${roleName}`);
		granted.push({ table, privileges });
	}

	return { roleName, roleCreated, iamGranted, granted };
}
