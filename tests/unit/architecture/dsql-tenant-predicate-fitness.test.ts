// tests/unit/architecture/dsql-tenant-predicate-fitness.test.ts
// EPIC #3424 / M4-E item 10 / 設計 SSOT: m3-physical-model.md §3.4 / ADR-0063
//
// **family_id 述語 fitness function (RLS 非対応の代替防御線、§3.4 [4])**:
//   DSQL は RLS 非対応 (spike#1 実機 [0A000]) のため、テナント分離は app 層の
//   「全クエリに family_id 述語を注入する」規律に依存する。WHERE 書き忘れ 1 箇所が
//   cross-tenant データ露出になるため、本 fitness が **dsql module の全 SQL 文を静的走査し、
//   tenant 表への SELECT/UPDATE/DELETE で family_id 述語欠如 / INSERT で family_id 列欠如を
//   CI hard-fail** する (ADR-0061 same-class-N→guard)。
//
// **例外は閉じた allowlist (§3.4 明示列挙、open な判定禁止)**:
//   - グローバル表 (tenant 非依存): 走査対象外
//   - capability / global-UNIQUE lookup (token / pin_code / endpoint / user_id / token_hash /
//     stripe_customer_id): 無 tenant 単点 lookup。**取得行の family_id への再スコープ義務**は
//     §3.4 不変条件 (repo 呼び出し側契約 + cross-tenant E2E) が担う
//   - cross-tenant scan (cron / PO KPI 集計): §11.2 明示例外のみ
//   新規の述語なしクエリは allowlist に「理由付きで」追記しない限り CI で落ちる。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	GLOBAL_MASTER_PK_MANIFEST,
	PK_FREEZE_MANIFEST,
} from '../../../src/lib/server/db/pk-freeze-manifest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DSQL_DIR = resolve(REPO_ROOT, 'src/lib/server/db/dsql');

// ── 表の分類 (SSOT = pk-freeze-manifest。手書き列挙の drift を避ける) ──

/** tenant 表 = PK 凍結 manifest (family_id 先頭) + auth 系 family スコープ表 (§6.6 manifest 例外)。 */
const TENANT_TABLES = new Set<string>([
	...Object.keys(PK_FREEZE_MANIFEST),
	// auth 5 表のうち family スコープのもの (manifest は「family_id 先頭 PK」でないため対象外だが、
	// テナントデータを含む以上 述語規律の対象。users はグローバルのため除外)
	'families',
	'memberships',
	'invites',
	'consents',
]);

/** グローバル表 (§3.4 allowlist 第 1-2 分類): family_id 述語自体が存在しない。 */
const GLOBAL_TABLES = new Set<string>([
	...Object.keys(GLOBAL_MASTER_PK_MANIFEST),
	'users',
	'email_login_lockouts',
]);

// ── 閉じた allowlist (§3.4): file × table × marker。これ以外の述語なしは hard-fail ──

interface AllowlistEntry {
	file: string; // basename
	table: string;
	/** 当該 SQL 文をこの例外と同定する marker (statement 本文に含まれること) */
	marker: RegExp;
	reason: string;
}

const PREDICATE_ALLOWLIST: AllowlistEntry[] = [
	// ── capability / global-UNIQUE lookup (§3.4 第 3 分類。後段の family_id 再スコープ義務あり) ──
	{
		file: 'viewer-token-repo.ts',
		table: 'viewer_tokens',
		marker: /WHERE\s+token\s*=/,
		reason: 'capability lookup: 共有リンク token 単点照合 (取得行 family_id へ再スコープ)',
	},
	{
		file: 'cloud-export-repo.ts',
		table: 'cloud_exports',
		marker: /WHERE\s+pin_code\s*=/,
		reason: 'capability lookup: export PIN 単点照合 (取得行 family_id へ再スコープ)',
	},
	{
		file: 'push-subscription-repo.ts',
		table: 'push_subscriptions',
		marker: /WHERE\s+endpoint\s*=/,
		reason:
			'capability lookup: push endpoint global-UNIQUE (§3.4 明示。browser 発行の偽造不能 URL)',
	},
	{
		file: 'auth-repo.ts',
		table: 'invites',
		marker: /token_hash\s*=/,
		reason: 'capability lookup: 招待コード hash 照合 (§3.4 明示。受諾 txn 側で family 束縛)',
	},
	{
		file: 'auth-repo.ts',
		table: 'memberships',
		marker: /WHERE\s+user_id\s*=/,
		reason:
			'capability lookup: 認証済 principal 本人の user_id に限定した所属テナント列挙 (§3.4 明示)',
	},
	{
		file: 'auth-repo.ts',
		table: 'families',
		marker: /stripe_customer_id\s*=/,
		reason:
			'capability lookup: Stripe webhook の customer_id → family 解決 (global-UNIQUE、行自体が tenant)',
	},
	{
		file: 'invite-accept.ts',
		table: 'invites',
		marker: /WHERE\s+invite_id\s*=.*status\s*=\s*'pending'/s,
		reason:
			'再スコープの実装形: invite_id (uuid 単点、capability 由来) で条件付き UPDATE し RETURNING family_id で以降の membership 作成を束縛する (§3.4 不変条件を txn 内で充足)',
	},
	// ── families: PK = family_id 単独のため「family_id = ctx」以外の形が正当なもの ──
	{
		file: 'auth-repo.ts',
		table: 'families',
		marker: /FROM\s+families\s+ORDER\s+BY\s+created_at/,
		reason:
			'ops 全テナント列挙 (listAllTenants、interface 契約)。cursor 化は cutover 配線後の interface 進化課題 (§6.6)',
	},
	// ── cross-tenant scan (cron / PO KPI、§11.2 明示例外) ──
	{
		file: 'trial-history-repo.ts',
		table: 'trial_history',
		marker: /WHERE\s+end_date\s*>=/,
		reason: 'cross-tenant cron scan: 有効 trial の一括走査 (findActiveTrials、§11.2 明示例外)',
	},
	{
		file: 'cancellation-reason-repo.ts',
		table: 'cancellation_reasons',
		marker: /GROUP\s+BY\s+category|free_text\s+IS\s+NOT\s+NULL|created_at\s*>=/i,
		reason: 'cross-tenant PO KPI 集計 (aggregateRecent / searchFreeText、sqlite backend と同契約)',
	},
	{
		file: 'settings-repo.ts',
		table: 'settings',
		marker: /COUNT\(\*\)\s+FILTER\s+\(WHERE\s+starts_with\(value/i,
		reason:
			'cross-tenant ops 監査集計: 継続月キーの prefix 無し在庫を数える (#4269 ①)。ops 認可下・COUNT 2 スカラーのみ返却で個票非露出 (§11.2 明示例外、cancellation-reason-repo.aggregateRecent と同クラス)',
	},
	{
		file: 'graduation-consent-repo.ts',
		table: 'graduation_consent',
		marker: /consented_at\s*>=|consented\s*=\s*true/,
		reason: 'cross-tenant 集計: 卒業同意の公開サンプル/統計 (§11.2 #3557)',
	},
	{
		file: 'cloud-export-repo.ts',
		table: 'cloud_exports',
		marker: /status\s*=\s*'pending'|status\s*=\s*'building'|expires_at\s*</,
		reason:
			'cross-tenant cron worker: build キュー取得 / stale building 回収 / 期限切れ削除 (#3504/#3509 state machine)',
	},
	// ── activation-funnel-repo: PO KPI activation funnel の cross-tenant 集計 (#3819 QM Tier2 指摘 ②) ──
	//   families / children / activity_logs を cohort (since 以降登録の全テナント家庭) で横断集計する
	//   単一集約 SQL。ops 認可下・count のみ返却で個票非露出 (§11.2 明示例外、cancellation-reason-repo
	//   .aggregateRecent と同クラス)。marker は CTE 名 (cohort / child_flag / first_activity) を anchor
	//   とし、JOIN 句の `family_id =` 記法 (HAS_FAMILY_PREDICATE への偶発マッチ) に依存しない明示登録。
	//   これにより将来 JOIN を USING(family_id) 等へ書き換えても保護挙動が不定にならない。
	{
		file: 'activation-funnel-repo.ts',
		table: 'families',
		marker: /WITH\s+cohort\s+AS[\s\S]*?FROM\s+families/i,
		reason:
			'cross-tenant PO KPI 集計: activation funnel の cohort (since 以降登録の全テナント家庭) 走査。ops 認可下・count のみ・個票非露出 (§11.2 明示例外、#3805 Sub-A)',
	},
	{
		file: 'activation-funnel-repo.ts',
		table: 'children',
		marker: /child_flag\s+AS[\s\S]*?FROM\s+children/i,
		reason:
			'cross-tenant PO KPI 集計: cohort 家庭の子供有無フラグ (child_flag CTE)。cohort JOIN で cohort 家庭に限定・count のみ (§11.2 明示例外、#3805 Sub-A)',
	},
	{
		file: 'activation-funnel-repo.ts',
		table: 'activity_logs',
		marker: /first_activity\s+AS[\s\S]*?FROM\s+activity_logs/i,
		reason:
			'cross-tenant PO KPI 集計: cohort 家庭の初回 (非取消) 活動時刻 (first_activity CTE)。cohort JOIN で限定・count/retention のみ (§11.2 明示例外、#3805 Sub-A)',
	},
];

/**
 * INSERT で family_id 列を要求しない表: families のみ (tenant 誕生 = family_id は
 * DB default gen_random_uuid() で採番される)。
 */
const INSERT_FAMILY_ID_EXEMPT = new Set(['families']);

// ── SQL template 抽出 (sql`...`。${...} interpolation 内の nested template を skip) ──

interface SqlStatement {
	file: string;
	line: number;
	text: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: template literal の nesting 状態機械 (fitness 専用 parser)
function extractSqlTemplates(source: string, file: string): SqlStatement[] {
	const results: SqlStatement[] = [];
	const re = /\bsql`/g;
	let m = re.exec(source);
	while (m) {
		let i = m.index + m[0].length;
		let depth = 0;
		let out = '';
		while (i < source.length) {
			const ch = source[i];
			if (depth === 0 && ch === '`') break;
			if (ch === '$' && source[i + 1] === '{') {
				depth++;
				out += '${';
				i += 2;
				continue;
			}
			if (depth > 0 && ch === '}') {
				depth--;
				out += '}';
				i++;
				continue;
			}
			if (depth > 0 && ch === '`') {
				// interpolation 内の nested template literal は本文でないため読み飛ばす
				i++;
				while (i < source.length && source[i] !== '`') i++;
				i++;
				continue;
			}
			out += ch;
			i++;
		}
		const line = source.slice(0, m.index).split('\n').length;
		results.push({ file, line, text: out });
		m = re.exec(source);
	}
	return results;
}

/** SQL 文から参照 tenant/global 表を抽出する (既知表名のみ。キーワード誤捕捉は無視される)。 */
function referencedTables(text: string): { table: string; kind: 'read' | 'insert' }[] {
	const found: { table: string; kind: 'read' | 'insert' }[] = [];
	const tableRe = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/gi;
	let m = tableRe.exec(text);
	while (m) {
		const table = (m[1] ?? '').toLowerCase();
		if (TENANT_TABLES.has(table) || GLOBAL_TABLES.has(table)) {
			const kind = /\bINTO\b/i.test(m[0]) ? 'insert' : 'read';
			found.push({ table, kind });
		}
		m = tableRe.exec(text);
	}
	return found;
}

const HAS_FAMILY_PREDICATE = /family_id\s*(?:=|IN\s*\()/i;
const HAS_FAMILY_COLUMN = /family_id/i;
/**
 * 動的 WHERE fragment の命名規約: `${tenantWhere}` / `${sql.join(tenantConditions, ...)}` 等、
 * interpolation 式に tenant を含む fragment は「family_id 述語を内包する契約」として受理する。
 * fragment 構築側 (`sql\`family_id = ${tenantId}\``) が起点に family_id を積むことはコードレビュー
 * + 本規約の改名強制で担保 (無名 `${where}` は hard-fail するため、契約が命名で可視化される)。
 */
const HAS_TENANT_FRAGMENT = /\$\{[^}]*tenant[^}]*\}/i;

/**
 * dsql 配下の .ts を **再帰** 収集する (#4030 A-2 / 先例 #3658 AC2)。
 *
 * 旧実装は `readdirSync` 非再帰で、実 SQL を持つ `migration/` 配下を
 * **一度も検査していなかった**。母数が閉じていない guard は「違反 0 件」と
 * 「そもそも見ていない」を区別できない。
 */
function listDsqlSourceFiles(dir: string = DSQL_DIR, acc: string[] = []): string[] {
	if (!existsSync(dir)) return acc;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) listDsqlSourceFiles(full, acc);
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(full);
	}
	return acc;
}

interface Violation {
	file: string;
	line: number;
	table: string;
	kind: string;
	snippet: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: kind 別判定の列挙 (fitness 中核ロジック)
function collectViolations(statements: SqlStatement[]): Violation[] {
	const violations: Violation[] = [];
	for (const stmt of statements) {
		for (const { table, kind } of referencedTables(stmt.text)) {
			if (GLOBAL_TABLES.has(table)) continue; // グローバル表は述語対象外
			if (kind === 'insert') {
				if (INSERT_FAMILY_ID_EXEMPT.has(table)) continue;
				if (!HAS_FAMILY_COLUMN.test(stmt.text)) {
					violations.push({
						file: stmt.file,
						line: stmt.line,
						table,
						kind: 'INSERT (family_id 列欠如)',
						snippet: stmt.text.slice(0, 160).replace(/\s+/g, ' '),
					});
				}
				continue;
			}
			// 閉じた allowlist を最優先で評価する (#3819 QM Tier2 指摘 ②)。cross-tenant scan
			// (families 横断の PO KPI 集計等) は JOIN 句の `family_id =` に偶発マッチして
			// HAS_FAMILY_PREDICATE を通過しうるが、その偶発マッチに依存せず「§3.4 の閉じた
			// allowlist に理由付きで明示登録された例外」として pass することを保証する
			// (将来 JOIN 記法変更で保護挙動が不定になるのを防ぐ)。allowlist 非該当の通常
			// tenant-scoped クエリは従来どおり HAS_FAMILY_PREDICATE / HAS_TENANT_FRAGMENT で pass する。
			const allowed = PREDICATE_ALLOWLIST.some(
				(a) => a.file === stmt.file && a.table === table && a.marker.test(stmt.text),
			);
			if (allowed) continue;
			if (HAS_FAMILY_PREDICATE.test(stmt.text)) continue;
			if (HAS_TENANT_FRAGMENT.test(stmt.text)) continue;
			violations.push({
				file: stmt.file,
				line: stmt.line,
				table,
				kind: 'SELECT/UPDATE/DELETE (family_id 述語欠如)',
				snippet: stmt.text.slice(0, 160).replace(/\s+/g, ' '),
			});
		}
	}
	return violations;
}

describe('DSQL tenant 述語 fitness (§3.4 / ADR-0063、RLS 非対応の代替防御線)', () => {
	const files = listDsqlSourceFiles();
	const statements = files.flatMap((f) =>
		extractSqlTemplates(readFileSync(f, 'utf-8'), basename(f)),
	);

	it('[armed] dsql module と SQL 文が実在する (armed-before-use)', () => {
		expect(files.length).toBeGreaterThan(20);
		expect(statements.length).toBeGreaterThan(100);
	});

	it('[fixture] 述語欠如を検出できる (非トートロジー証明)', () => {
		const bad = collectViolations([
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture は SQL template の ${} を文字列として検証する
			{ file: 'fixture-repo.ts', line: 1, text: 'SELECT * FROM children WHERE child_id = ${id}' },
			{ file: 'fixture-repo.ts', line: 2, text: 'DELETE FROM point_ledger' },
			{
				file: 'fixture-repo.ts',
				line: 3,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture は SQL template の ${} を文字列として検証する
				text: 'INSERT INTO children (child_id, nickname) VALUES (${a}, ${b})',
			},
		]);
		expect(bad).toHaveLength(3);
		// 述語ありは検出しない
		const good = collectViolations([
			{
				file: 'fixture-repo.ts',
				line: 4,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture は SQL template の ${} を文字列として検証する
				text: 'SELECT * FROM children WHERE family_id = ${t} AND child_id = ${id}',
			},
		]);
		expect(good).toHaveLength(0);
	});

	it('[main] tenant 表への全 SQL 文が family_id 述語/列を持つ (allowlist 例外は閉集合)', () => {
		const violations = collectViolations(statements);
		expect(
			violations,
			[
				'family_id 述語欠如を検出 (cross-tenant 露出リスク、§3.4 / ADR-0063)。',
				'正当な例外なら PREDICATE_ALLOWLIST に「理由付き」で追記すること:',
				...violations.map((v) => `  ${v.file}:${v.line} [${v.table}] ${v.kind}: ${v.snippet}`),
			].join('\n'),
		).toEqual([]);
	});

	it('[allowlist-live] allowlist の全 entry が実在する SQL に対応する (dead entry 検出)', () => {
		const dead = PREDICATE_ALLOWLIST.filter(
			(a) =>
				!statements.some(
					(s) => s.file === a.file && a.marker.test(s.text) && s.text.includes(a.table),
				),
		);
		expect(
			dead,
			`allowlist に対応 SQL が存在しない dead entry があります (削除するか marker を是正):\n${dead
				.map((d) => `  ${d.file} [${d.table}] ${d.marker}`)
				.join('\n')}`,
		).toEqual([]);
	});
});

// #4030 A-2: 母数がサブディレクトリを取りこぼしていないこと。
//
// `src/lib/server/db/dsql/migration/` には実 SQL を持つ file が存在する
// (`provision.ts` の `INSERT INTO dsql_migrations` 等)。非再帰走査だと**この層が
// 一度も検査されない**。先例は `dsql-append-only-update-fitness.test.ts` (#3658 AC2)。
//
// 母数の assertion を置かないと「違反 0 件」が「守られている」なのか
// 「そもそも見ていない」なのか区別できない (#4084 と同じ形)。
//
// 期待値は **実 FS から導出する** (literal 固定にすると file 追加で陳腐化する、#4030 A-1 と同じ轍)。
describe('#4030 母数: dsql 配下をサブディレクトリまで走査している', () => {
	it('migration/ 配下の .ts が母数にすべて入っている', () => {
		const migrationDir = resolve(DSQL_DIR, 'migration');
		const expected = readdirSync(migrationDir)
			.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
			.map((f) => resolve(migrationDir, f))
			.sort();
		expect(
			expected.length,
			'migration/ に .ts が 1 つも無い (母数の前提が崩れている)',
		).toBeGreaterThan(0);

		const collected = new Set(listDsqlSourceFiles());
		const missing = expected.filter((f) => !collected.has(f));
		expect(
			missing,
			'dsql/migration/ 配下が母数から漏れています。非再帰走査だとこの層が一度も検査されません (#4030 A-2)',
		).toEqual([]);
	});
});

// #4030 AC5 — 除外理由が「あることになっている」だけの状態を潰す。
//
// 本 allowlist は `reason` を持つが、**value を読む assertion が無く空文字でも通っていた**。
// 理由なしの除外は、次に読む人が「意図的な例外」と「消し忘れ」を区別できない。
//
// 判定ロジックは `exclusion-reason-nonempty.test.ts` の `findReasonDefect` と同型
// (空 / 定型 stub / 極端な短文を弾く)。**import しないのは、test file 同士を import すると
// describe が二重実行されるため** (データを持つ file が自分で守る、#4030 class B)。
const REASON_STUBS = ['todo', 'tbd', 'n/a', 'na', '-', '未定', 'なし'];

function reasonDefect(reason: unknown): string | null {
	if (typeof reason !== 'string') return `文字列ではありません (${typeof reason})`;
	const t = reason.trim();
	if (t.length === 0) return '空です';
	if (REASON_STUBS.includes(t.toLowerCase())) return `定型 stub です (「${t}」)`;
	if (t.length < 8) return `短すぎます (${t.length} 字: 「${t}」)`;
	return null;
}

describe('#4030 AC5 PREDICATE_ALLOWLIST の除外理由が実質空でない', () => {
	it('全 entry が理由を持つ', () => {
		const entries = PREDICATE_ALLOWLIST;
		// 母数が空なら「違反 0」ではなく「検査していない」(#4084 と同じ形)
		expect(entries.length, '母数が空です').toBeGreaterThan(0);

		const defects = entries
			.map((e) => {
				const d = reasonDefect(e.reason);
				return d ? `${e.file} / ${e.table}: ${d}` : null;
			})
			.filter((v): v is string => v !== null);

		expect(defects, '除外理由が実質空です。**なぜ例外なのか**を書いてください').toEqual([]);
	});
});
