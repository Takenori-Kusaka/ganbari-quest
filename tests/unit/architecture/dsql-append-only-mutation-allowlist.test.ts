// tests/unit/architecture/dsql-append-only-mutation-allowlist.test.ts
// EPIC #3424 / M4-E item 10 / 設計 SSOT: m3-physical-model.md §3.4 [must]B6 / ADR-0063
//
// **append-only 表への mutation 閉じた allowlist (3 層防御の repo/AST 層)**:
//   consents / point_ledger / status_history / *_logs / trial_history / cancellation_reasons /
//   graduation_consent は「追記のみ」が業務不変条件 (同意の改竄・台帳改竄・履歴改竄の防止)。
//   M3 §3.4 B6 の 3 層 = ①repo 層で業務 mutation を定義しない (本 fitness) ②DB GRANT 除外
//   (cutover 時の実 IAM/GRANT、hard blocker) ③cross-tenant E2E。
//
//   ただし「append-only」は業務 path の話であり、**ライフサイクル削除は正当**:
//   テナント削除 (COPPA/退会 PII 消去) / child 削除 cascade / retention pruning (ADR-0049) /
//   親資源削除 cascade。これらを閉じた allowlist に明示列挙し、**新規の UPDATE/DELETE 経路が
//   allowlist なしで生えたら CI hard-fail** する (ADR-0061 same-class-N→guard)。
//   例: point_ledger の「残高調整 UPDATE」や consents の「同意书き換え UPDATE」は
//   allowlist に無いため即検出される。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DSQL_DIR = resolve(REPO_ROOT, 'src/lib/server/db/dsql');

/** append-only 表 (M3 §3.4 B6 名指し集合)。 */
const APPEND_ONLY_TABLES = [
	'consents',
	'point_ledger',
	'status_history',
	'activity_logs',
	'checklist_logs',
	'notification_logs',
	'usage_logs',
	'trial_history',
	'cancellation_reasons',
	'graduation_consent',
] as const;

interface MutationAllowlistEntry {
	file: string; // basename
	table: string;
	op: 'UPDATE' | 'DELETE';
	/** 当該 SQL 文をこの例外と同定する marker */
	marker: RegExp;
	reason: string;
}

/**
 * 閉じた allowlist: ライフサイクル削除 + 設計済み状態遷移のみ。
 * 新規 entry の追加は「業務データの書き換えでない」ことを PR で立証すること。
 */
const MUTATION_ALLOWLIST: MutationAllowlistEntry[] = [
	// ── テナント削除 (退会 PII 消去、ADR-0049 / COPPA)。全 append-only 表に存在し得る ──
	{
		file: 'auth-repo.ts',
		table: 'consents',
		op: 'DELETE',
		marker: /WHERE\s+family_id\s*=\s*\$\{tenantId\}\s*$/m,
		reason: 'テナント削除 cascade (deleteTenant txn 内、PII 消去)',
	},
	{
		file: 'point-repo.ts',
		table: 'point_ledger',
		op: 'DELETE',
		marker: /WHERE\s+family_id\s*=\s*\$\{tenantId\}\s*$/m,
		reason: 'テナント削除 (deleteByTenantId、PII 消去 #3593)',
	},
	{
		file: 'status-repo.ts',
		table: 'status_history',
		op: 'DELETE',
		marker: /WHERE\s+family_id\s*=\s*\$\{tenantId\}\s*$/m,
		reason: 'テナント削除 (deleteByTenantId)',
	},
	{
		file: 'trial-history-repo.ts',
		table: 'trial_history',
		op: 'DELETE',
		marker: /WHERE\s+family_id\s*=\s*\$\{tenantId\}\s*$/m,
		reason: 'テナント削除 (deleteByTenantId)',
	},
	{
		file: 'cancellation-reason-repo.ts',
		table: 'cancellation_reasons',
		op: 'DELETE',
		marker: /WHERE\s+family_id\s*=\s*\$\{tenantId\}\s*$/m,
		reason: 'テナント削除 (deleteByTenantId)',
	},
	{
		file: 'graduation-consent-repo.ts',
		table: 'graduation_consent',
		op: 'DELETE',
		marker: /WHERE\s+family_id\s*=\s*\$\{tenantId\}\s*$/m,
		reason: 'テナント削除 (deleteByTenantId)',
	},
	{
		file: 'checklist-repo.ts',
		table: 'checklist_logs',
		op: 'DELETE',
		marker: /WHERE\s+family_id\s*=\s*\$\{tenantId\}\s*$/m,
		reason: 'テナント削除 (deleteByTenantId txn 内)',
	},
	// ── child 削除 cascade (集約削除 txn、§P4 明示 DELETE) ──
	{
		file: 'child-repo.ts',
		table: 'activity_logs',
		op: 'DELETE',
		marker: /child_id\s*=\s*\$\{id\}/,
		reason: 'child 集約削除 cascade (deleteChild txn 内、§P4)',
	},
	{
		file: 'child-repo.ts',
		table: 'point_ledger',
		op: 'DELETE',
		marker: /child_id\s*=\s*\$\{id\}/,
		reason: 'child 集約削除 cascade (deleteChild txn 内、§P4)',
	},
	// ── 親資源削除 cascade ──
	{
		file: 'checklist-repo.ts',
		table: 'checklist_logs',
		op: 'DELETE',
		marker: /template_id\s*=\s*\$\{id\}/,
		reason: 'テンプレート削除 cascade (親資源と同 txn、§P4)',
	},
	// ── retention pruning (ADR-0049 プラン別履歴保持) ──
	{
		file: 'activity-repo.ts',
		table: 'activity_logs',
		op: 'DELETE',
		marker: /recorded_date\s*</,
		reason: 'retention pruning (ADR-0049、保持期間外の物理削除)',
	},
	{
		file: 'point-repo.ts',
		table: 'point_ledger',
		op: 'DELETE',
		// #3593 ②: cutoff を JST 深夜 0:00 の instant に TZ-qualify (session TZ 非依存)。
		marker: /created_at\s*<\s*\(\$\{cutoffDate\}\s*\|\|\s*'T00:00:00\+09:00'\)/,
		reason:
			'retention pruning (ADR-0049、保持期間外の物理削除。child 単位 + JST-qualified cutoff 述語、#3593 ②)',
	},
	{
		file: 'status-repo.ts',
		table: 'status_history',
		op: 'DELETE',
		marker: /recorded_at\s*<\s*\$\{cutoffDate\}/,
		reason:
			'retention pruning (ADR-0049、保持期間外の物理削除。child 単位 + recorded_at cutoff 述語、#3518-2)',
	},
	// ── 設計済み状態遷移 (行の業務データ本体は不変、フラグ/紐付けのみ) ──
	{
		file: 'activity-repo.ts',
		table: 'activity_logs',
		op: 'UPDATE',
		marker: /SET\s+cancelled\s*=\s*true/,
		reason:
			'記録取消の soft-cancel flip (P7 設計済み遷移。行は削除せず cancelled=true、台帳側は相殺行を追記)',
	},
	{
		file: 'cancel-activity-core.ts',
		table: 'activity_logs',
		op: 'UPDATE',
		marker: /SET\s+cancelled\s*=\s*true/,
		reason:
			'記録取消の単一 txn core (#3596 ②) の soft-cancel flip (activity-repo.ts と同一遷移。cancelled=false 条件で冪等 guard を兼ねる。台帳側は相殺行を追記)',
	},
	{
		file: 'trial-history-repo.ts',
		table: 'trial_history',
		op: 'UPDATE',
		marker: /SET\s+stripe_subscription_id\s*=/,
		reason: 'trial→有償転換の紐付け更新 (updateConversion。trial 事実は不変、転換メタの追記的更新)',
	},
];

// ── SQL 抽出 (tenant-predicate fitness と同機構) ──

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

interface Mutation {
	file: string;
	line: number;
	table: string;
	op: 'UPDATE' | 'DELETE';
	text: string;
}

function findAppendOnlyMutations(statements: SqlStatement[]): Mutation[] {
	const found: Mutation[] = [];
	for (const stmt of statements) {
		for (const table of APPEND_ONLY_TABLES) {
			if (new RegExp(`\\bUPDATE\\s+${table}\\b`, 'i').test(stmt.text)) {
				found.push({ ...stmt, table, op: 'UPDATE' });
			}
			if (new RegExp(`\\bDELETE\\s+FROM\\s+${table}\\b`, 'i').test(stmt.text)) {
				found.push({ ...stmt, table, op: 'DELETE' });
			}
		}
	}
	return found;
}

function collectViolations(statements: SqlStatement[]): Mutation[] {
	return findAppendOnlyMutations(statements).filter(
		(mut) =>
			!MUTATION_ALLOWLIST.some(
				(a) =>
					a.file === mut.file &&
					a.table === mut.table &&
					a.op === mut.op &&
					a.marker.test(mut.text),
			),
	);
}

function listDsqlSourceFiles(): string[] {
	if (!existsSync(DSQL_DIR)) return [];
	return readdirSync(DSQL_DIR)
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
		.map((f) => resolve(DSQL_DIR, f));
}

describe('DSQL append-only 表 mutation allowlist (§3.4 B6 3 層防御の repo/AST 層)', () => {
	const files = listDsqlSourceFiles();
	const statements = files.flatMap((f) =>
		extractSqlTemplates(readFileSync(f, 'utf-8'), basename(f)),
	);

	it('[armed] dsql module と SQL 文が実在する (armed-before-use)', () => {
		expect(files.length).toBeGreaterThan(20);
		expect(statements.length).toBeGreaterThan(100);
	});

	it('[fixture] 業務 mutation を検出できる (非トートロジー証明)', () => {
		const bad = collectViolations([
			{
				file: 'fixture-repo.ts',
				line: 1,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture は SQL template の ${} を文字列として検証する
				text: 'UPDATE point_ledger SET amount = ${v} WHERE family_id = ${t}',
			},
			{
				file: 'fixture-repo.ts',
				line: 2,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture は SQL template の ${} を文字列として検証する
				text: 'UPDATE consents SET consented = false WHERE family_id = ${t}',
			},
		]);
		expect(bad).toHaveLength(2);
	});

	it('[main] append-only 表への UPDATE/DELETE は閉じた allowlist のみ (業務 mutation 0 件)', () => {
		const violations = collectViolations(statements);
		expect(
			violations,
			[
				'append-only 表への未許可 mutation を検出 (§3.4 B6: 同意/台帳/履歴の改竄防止)。',
				'ライフサイクル削除等の正当な経路なら MUTATION_ALLOWLIST に「理由付き」で追記すること:',
				...violations.map(
					(v) =>
						`  ${v.file}:${v.line} ${v.op} [${v.table}]: ${v.text.slice(0, 140).replace(/\s+/g, ' ')}`,
				),
			].join('\n'),
		).toEqual([]);
	});

	it('[allowlist-live] allowlist の全 entry が実在する SQL に対応する (dead entry 検出)', () => {
		const mutations = findAppendOnlyMutations(statements);
		const dead = MUTATION_ALLOWLIST.filter(
			(a) =>
				!mutations.some(
					(m) => m.file === a.file && m.table === a.table && m.op === a.op && a.marker.test(m.text),
				),
		);
		expect(
			dead,
			`allowlist に対応 SQL が存在しない dead entry があります:\n${dead
				.map((d) => `  ${d.file} ${d.op} [${d.table}] ${d.marker}`)
				.join('\n')}`,
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

describe('#4030 AC5 MUTATION_ALLOWLIST の除外理由が実質空でない', () => {
	it('全 entry が理由を持つ', () => {
		const entries = MUTATION_ALLOWLIST;
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
