// tests/unit/scripts/nuc-pglite-cutover-cli.test.ts
// EPIC #3620 AC-C4 後段 — cutover CLI の安全装置 (fail-close) の committed 回帰 (QM 推奨)。
//
// CLI (scripts/nuc-pglite-cutover.ts) を**実子プロセス** (tsx) で起動し、移行の不可逆操作を守る
// 安全装置を回帰固定する (ADR-0061。round-trip の内容正当性は pglite-cutover-roundtrip.test.ts、
// 件数突合 module 単体は nuc-cutover-verify.test.ts が担保 — 本テストは CLI 境界の分岐に限定):
//
//   [CLI1] 正常系: 有効な export JSON の import が exit 0 + 件数突合完了 + dataDir 存続
//   [CLI2] 非破壊 gate: 非空 dataDir への import は exit≠0 で拒否 (稼働 DB を上書きしない)
//   [CLI3] errors>0 abort: 壊れた export JSON は exit≠0 + 部分構築 dataDir が削除される
//   (件数不一致分岐は abortAndCleanup を [CLI3] と共有し、突合判定自体は [CV3] unit が担保)
//
// 有効な export JSON は in-process (sqlite test-db mock + exportFamilyData) で生成する
// (手書き JSON は EXPORT_FORMAT/version/migration との drift で偽陽性を生むため実物を使う)。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let testDb: unknown;
let testSqlite: { close(): void } | null = null;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	getOrInitDb() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const REPO_ROOT = resolve(__dirname, '../../..');
const TSX_CLI = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const CUTOVER_CLI = resolve(REPO_ROOT, 'scripts/nuc-pglite-cutover.ts');
const workDirs: string[] = [];

function freshDir(tag: string): string {
	const d = join(tmpdir(), `cutover-cli-${tag}-${process.pid}-${workDirs.length}`);
	workDirs.push(d);
	return d;
}

/** CLI を実子プロセスで起動する (exit code + 出力を返す、throw しない)。 */
function runCli(args: string[]): { status: number; output: string } {
	try {
		const out = execFileSync(process.execPath, [TSX_CLI, CUTOVER_CLI, ...args], {
			cwd: REPO_ROOT,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 120_000,
		});
		return { status: 0, output: out };
	} catch (e) {
		const err = e as { status?: number; stdout?: string; stderr?: string };
		return { status: err.status ?? 1, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
	}
}

let exportJsonPath: string;

beforeAll(async () => {
	// 有効な export JSON を実物 (sqlite test-db + exportFamilyData) で生成
	process.env.DATA_SOURCE = 'sqlite';
	const { createTestDb } = await import('../helpers/test-db');
	const t = createTestDb();
	testDb = t.db;
	testSqlite = t.sqlite;
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	const repos = getRepos();
	// birth_date は #3584 ③ gate (backfill 必須) を通すため設定する (実運用の export と同形)
	const child = await repos.child.insertChild(
		{ nickname: 'CLI検証子', age: 7, birthDate: '2019-01-15' },
		'local',
	);
	await repos.point.insertPointEntry(
		{ childId: child.id, amount: 5, type: 'activity', description: 'x' },
		'local',
	);
	const { exportFamilyData } = await import('../../../src/lib/server/services/export-service');
	const data = await exportFamilyData({ tenantId: 'local' });
	exportJsonPath = join(freshDir('json'), 'export.json');
	mkdirSync(join(exportJsonPath, '..'), { recursive: true });
	writeFileSync(exportJsonPath, JSON.stringify(data));
}, 60_000);

afterAll(() => {
	testSqlite?.close();
	for (const d of workDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('cutover CLI fail-close (#3620 AC-C4 後段、実子プロセス)', () => {
	it('[CLI1] 正常系: import が exit 0 + 件数突合完了 + dataDir 存続', () => {
		const dataDir = freshDir('ok');
		const r = runCli(['import', '--in', exportJsonPath, '--data-dir', dataDir]);
		expect(r.status, r.output).toBe(0);
		expect(r.output).toContain('件数突合 完了');
		expect(existsSync(dataDir)).toBe(true); // 成功時は swap 用に存続
	}, 120_000);

	it('[CLI2] 非破壊 gate: 非空 dataDir への import は拒否される (稼働 DB を上書きしない)', () => {
		const dataDir = freshDir('nonempty');
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(join(dataDir, 'existing.bin'), 'x');
		const r = runCli(['import', '--in', exportJsonPath, '--data-dir', dataDir]);
		expect(r.status).not.toBe(0);
		expect(r.output).toContain('空ではありません');
		expect(readFileSync(join(dataDir, 'existing.bin'), 'utf-8')).toBe('x'); // 既存内容は無傷
	}, 60_000);

	it('[CLI4] #3584 ③ birth_date backfill gate: NULL birth_date の child がいると dataDir 構築前に fail-fast する', () => {
		// 新 model は birth_date が唯一の年齢ソース (compute-on-read §11.1)。NULL のまま cutover
		// すると当該 child は age=0 (preschool UI) 固定 = 中高生が幼児 UI を見せられる誤 tier。
		const noBirth = JSON.parse(readFileSync(exportJsonPath, 'utf-8'));
		noBirth.family.children = [{ ...noBirth.family.children[0], birthDate: null }];
		const noBirthPath = join(freshDir('no-birth-json'), 'no-birth.json');
		mkdirSync(join(noBirthPath, '..'), { recursive: true });
		writeFileSync(noBirthPath, JSON.stringify(noBirth));

		const dataDir = freshDir('no-birth');
		const r = runCli(['import', '--in', noBirthPath, '--data-dir', dataDir]);
		expect(r.status).not.toBe(0);
		expect(r.output).toContain('birth_date 未設定');
		expect(existsSync(dataDir), 'fail-fast のため dataDir は構築されない').toBe(false);
	}, 60_000);

	it('[CLI3] errors>0 abort: 壊れた export JSON は exit≠0 + 部分構築 dataDir が削除される', () => {
		// children を必須 field (nickname) 欠落に破壊 → importFamilyData が errors を返す実経路を通す。
		// birthDate は保持する (#3584 ③ の birth_date gate より先に落ちないよう、import 層の
		// errors>0 abort 経路そのものを検証する)。
		const broken = JSON.parse(readFileSync(exportJsonPath, 'utf-8'));
		broken.family.children = [{ birthDate: '2019-01-15' }];
		const brokenPath = join(freshDir('broken-json'), 'broken.json');
		mkdirSync(join(brokenPath, '..'), { recursive: true });
		writeFileSync(brokenPath, JSON.stringify(broken));

		const dataDir = freshDir('broken');
		const r = runCli(['import', '--in', brokenPath, '--data-dir', dataDir]);
		expect(r.status).not.toBe(0);
		expect(r.output).toContain('中止しました');
		expect(existsSync(dataDir)).toBe(false); // abortAndCleanup が部分構築を削除 (旧 DB 側は本 CLI 対象外で無傷)
	}, 120_000);
});
