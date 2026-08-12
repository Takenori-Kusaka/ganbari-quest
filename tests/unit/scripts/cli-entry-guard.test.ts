/**
 * tests/unit/scripts/cli-entry-guard.test.ts (#3969)
 *
 * gate script が「何も検査しないまま exit 0 (= PASS)」を返す事故の class-lock。
 *
 * ## 背景
 *
 * `scripts/` 配下の各 script は末尾で自前の直接実行判定を持っていた。代表例:
 *
 * ```js
 * const isMain = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
 * ```
 *
 * `import.meta.url` は Node が **実体パス**へ解決するのに対し、`process.argv[1]` は
 * ユーザーが与えたパスのまま絶対化されるだけである。そのため symlink / junction 経由で
 * repo を開いていると判定が必ず false になり、`main()` が呼ばれず、
 * **1 件も検査しないまま exit 0** になっていた（実測 41 / 53 ファイル）。
 *
 * gate が「落ちる」のではなく「黙って通る」ため誰も気付けない。誤った値を黙って書き込む
 * silent fallback と同じ class の事故である。
 *
 * ## 本 test が守る 3 層
 *
 * 1. **判定 SSOT** — `scripts/lib/is-main.mjs` の `isMain()` が symlink 経由でも
 *    実体経由でも同じ結論を出す
 * 2. **再混入 gate** — `scripts/check-cli-entry-guard.mjs` の検出ロジックと、
 *    現在の tree が違反 0 件であること
 * 3. **meta-gate** — 代表 gate が「必ず失敗する入力」で exit != 0 を返す。
 *    1 が直っても別経路で同じ沈黙が起き得るため、gate が本当に判定へ到達しているかを見る
 *
 * 1 と 3 は Linux CI 上で一時 symlink を張って検証するため、Windows runner なしで効く。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SCAN_ROOTS, scanSource } from '../../../scripts/check-cli-entry-guard.mjs';
import { isMain } from '../../../scripts/lib/is-main.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const HELPER_URL = pathToFileURL(path.join(SCRIPTS_DIR, 'lib', 'is-main.mjs')).href;

const tempDirs: string[] = [];

afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
	const d = mkdtempSync(path.join(tmpdir(), prefix));
	tempDirs.push(d);
	return d;
}

/** symlink を張れない環境 (権限のない Windows 等) では symlink 系ケースを skip する */
function canSymlink(): boolean {
	const dir = mkdtempSync(path.join(tmpdir(), 'gq-symlink-probe-'));
	try {
		mkdirSync(path.join(dir, 'target'));
		symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'), 'junction');
		return true;
	} catch {
		return false;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const SYMLINK_OK = canSymlink();

/**
 * skip 条件そのものの健全性を CI で固定する。
 *
 * `SYMLINK_OK` が false になると symlink 経路の検証ケースが全て無言 skip になり、
 * 「1 件も検証しないまま緑」= 本 test が塞いでいる事故と同じ形になる。
 * ローカルは権限差があるため条件付きだが、CI では probe が true であることを assert する。
 */
describe('skip 条件の健全性 (#3969)', () => {
	// skip 条件: CI 以外 (ローカルは symlink 権限が環境依存のため) — ADR-0006 metadata
	//   Issue: #3969 / owner: @Takenori-Kusaka / deadline: なし (恒久的な環境条件 skip)
	//   CI (ubuntu-latest) では常時実行される
	it.skipIf(!process.env.CI)(
		'CI では symlink/junction を作成できる (symlink 系ケースが無言 skip にならない)',
		() => {
			expect(SYMLINK_OK).toBe(true);
		},
	);
});

/** `isMain(import.meta.url)` の結果だけを stdout に出す probe script を書き出す */
function writeProbe(dir: string): string {
	const script = path.join(dir, 'probe.mjs');
	writeFileSync(
		script,
		[
			`import { isMain } from ${JSON.stringify(HELPER_URL)};`,
			'process.stdout.write(isMain(import.meta.url) ? "MAIN" : "NOT_MAIN");',
		].join('\n'),
	);
	return script;
}

function runNode(script: string, cwd: string): string {
	return `${spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' }).stdout ?? ''}`.trim();
}

// ---------------------------------------------------------------------------
// 1. 判定 SSOT
// ---------------------------------------------------------------------------

describe('isMain() — CLI 直接実行判定 (#3969)', () => {
	it('実体パスで起動された script は main と判定する', () => {
		const dir = makeTempDir('gq-is-main-real-');
		expect(runNode(writeProbe(dir), dir)).toBe('MAIN');
	});

	// skip 条件: symlink/junction を作成できない環境のみ (ADR-0006 metadata)
	//   Issue: #3969 / owner: @Takenori-Kusaka / deadline: なし (恒久的な環境条件 skip)
	//   CI (ubuntu-latest) では常時実行される — 本 Issue の再発検出はここが担保する
	it.skipIf(!SYMLINK_OK)('symlink 経由で起動されても main と判定する (本 Issue の再発防止)', () => {
		const dir = makeTempDir('gq-is-main-link-');
		const realDir = path.join(dir, 'real');
		mkdirSync(realDir);
		const script = writeProbe(realDir);
		symlinkSync(realDir, path.join(dir, 'link'), 'junction');

		// 実体経由と symlink 経由で結論が一致すること。
		// 修正前はここが 'MAIN' / 'NOT_MAIN' に割れ、後者で main() が呼ばれず黙って PASS していた。
		expect(runNode(script, dir)).toBe('MAIN');
		expect(runNode(path.join(dir, 'link', 'probe.mjs'), dir)).toBe('MAIN');
	});

	it('import 経由 (argv[1] が別ファイル) では main と判定しない', () => {
		const selfUrl = pathToFileURL(path.join(SCRIPTS_DIR, 'pre-ready.mjs')).href;
		expect(isMain(selfUrl, path.join(SCRIPTS_DIR, 'check-pr-body.mjs'))).toBe(false);
	});

	it('相対パスで起動されても実体と同一なら main と判定する', () => {
		const selfUrl = pathToFileURL(path.join(SCRIPTS_DIR, 'pre-ready.mjs')).href;
		expect(isMain(selfUrl, path.join(SCRIPTS_DIR, '..', 'scripts', 'pre-ready.mjs'))).toBe(true);
	});

	it('argv[1] が未定義 / 空文字でも例外を投げず false を返す', () => {
		expect(isMain(import.meta.url, undefined)).toBe(false);
		expect(isMain(import.meta.url, '')).toBe(false);
	});

	it('不正な URL を渡しても例外を投げず false を返す', () => {
		expect(isMain('not-a-url', process.argv[1])).toBe(false);
		expect(isMain('', process.argv[1])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 2. 再混入 gate
// ---------------------------------------------------------------------------

describe('check-cli-entry-guard scanSource() — 自前判定の再混入検出 (#3969)', () => {
	it('argv[1] の直接参照を検出する', () => {
		const src = 'const isMain = fileURLToPath(import.meta.url) === process.argv[1];\n';
		const found = scanSource('scripts/sample.mjs', src);
		expect(found).toHaveLength(1);
		expect(found[0]?.rule).toBe('argv1');
		expect(found[0]?.line).toBe(1);
	});

	it('手組みの file:// テンプレート URL を検出する', () => {
		// gate が検出すべき「違反コードそのもの」を fixture として持つ必要があるため、
		// ここでの ${...} は意図した文字列リテラルであり template literal ではない。
		// biome-ignore lint/suspicious/noTemplateCurlyInString: gate の検出対象を再現する fixture
		const src = 'if (import.meta.url === `file://${entry}`) main();\n';
		const found = scanSource('scripts/sample.mjs', src);
		expect(found.map((v) => v.rule)).toContain('file-url');
	});

	it("手組みの 'file://' 文字列連結も検出する", () => {
		const src = "if (import.meta.url === 'file://' + entry) main();\n";
		expect(scanSource('scripts/sample.mjs', src).map((v) => v.rule)).toContain('file-url');
	});

	it('コメント中の記述例は違反にしない', () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: gate の検出対象を再現する fixture
		const src = '// const isMain = ... === process.argv[1];\n * `file://${x}` は禁止\n';
		expect(scanSource('scripts/sample.mjs', src)).toEqual([]);
	});

	it('理由付き opt-out マーカーがあれば許可する', () => {
		const inline =
			'const entry = process.argv[1]; // allow-argv1: CLI 引数として entry path を表示するため\n';
		expect(scanSource('scripts/sample.mjs', inline)).toEqual([]);

		const preceding = [
			'// allow-argv1: usage 表示に起動コマンドをそのまま出すため',
			'const entry = process.argv[1];',
		].join('\n');
		expect(scanSource('scripts/sample.mjs', preceding)).toEqual([]);
	});

	it('理由が空のマーカーは opt-out として認めない (無言の抑止を防ぐ)', () => {
		const src = 'const entry = process.argv[1]; // allow-argv1:\n';
		expect(scanSource('scripts/sample.mjs', src)).toHaveLength(1);
	});

	it('判定 SSOT (scripts/lib/is-main.mjs) 自身は対象外', () => {
		const src = 'const argv1 = process.argv[1];\n';
		expect(scanSource(path.join('scripts', 'lib', 'is-main.mjs'), src)).toEqual([]);
	});

	// scripts / src / infra / .claude 配下を全走査するため既定の 5s では足りない (実測 ~8s)。
	it('現在の tree は違反 0 件 (gate 本体を repo 全体に対して実行)', () => {
		const res = spawnSync(process.execPath, ['scripts/check-cli-entry-guard.mjs'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		expect(res.status, `違反が検出されました:\n${res.stdout ?? ''}${res.stderr ?? ''}`).toBe(0);
	}, 60_000);
});

// ---------------------------------------------------------------------------
// 2b. 走査範囲 (SCAN_ROOTS / SKIP_DIRS)
// ---------------------------------------------------------------------------

/**
 * 走査範囲は「実行経路」ではなく「壊れたときに無言で PASS するか」で決めている。
 * `.claude/hooks/gate-approve.mjs` は ADR-0056 evidence を検証して QM の approve を止める hook で、
 * 事故形のままだと junction 経由で approve を素通しする。SCAN_ROOTS の外にあると gate が
 * それを検出できないため、範囲そのものを test で固定する (レビュー指摘 PR #3979)。
 */
describe('check-cli-entry-guard 走査範囲 — .claude を含み worktrees を除く (#3969)', () => {
	const GATE = path.join(SCRIPTS_DIR, 'check-cli-entry-guard.mjs');

	/** 実在した事故形 (.claude/hooks/gate-approve.mjs の修正前の式) をそのまま fixture にする */
	const ACCIDENT_FORM = [
		"import { fileURLToPath } from 'node:url';",
		'const isDirectInvocation =',
		'\tprocess.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];',
		'if (isDirectInvocation) main();',
		'',
	].join('\n');

	function fixtureTree(relPath: string): string {
		const root = makeTempDir('gq-scan-roots-');
		const abs = path.join(root, ...relPath.split('/'));
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, ACCIDENT_FORM);
		return root;
	}

	function runGate(cwd: string) {
		return spawnSync(process.execPath, [GATE], { cwd, encoding: 'utf8' });
	}

	it('.claude/hooks/ 配下の事故形を検出する (SCAN_ROOTS に .claude が無いと素通りする)', () => {
		const res = runGate(fixtureTree('.claude/hooks/gate-approve.mjs'));
		expect(res.status, `検出されませんでした:\n${res.stdout ?? ''}${res.stderr ?? ''}`).toBe(1);
		expect(`${res.stderr ?? ''}`).toContain('.claude/hooks/gate-approve.mjs');
	}, 30_000);

	/**
	 * fixture の中身は `.claude/worktrees/agent-x/scripts/` — git worktree 実体には
	 * scripts/ src/ infra/ が dot なしで並ぶため、SKIP_DIRS で切らないと本ブランチと
	 * 無関係な違反を報告する。`collectFiles` の「dot ディレクトリを飛ばす」規則では
	 * 止まらない配置を意図的に選んでいる (規則に従わないが実在する形を fixture にする)。
	 */
	it('.claude/worktrees/ 配下は走査しない (他ブランチの実体を重複報告しない)', () => {
		const res = runGate(fixtureTree('.claude/worktrees/agent-x/scripts/gate-approve.mjs'));
		expect(res.status, `worktrees 配下を走査しています:\n${res.stderr ?? ''}`).toBe(0);
	}, 30_000);

	/**
	 * PASS 文言に走査量を含める。件数が無いと「違反 0 件」と「1 ファイルも走査していない」が
	 * 区別できず、SCAN_ROOT が checkout に無い状態を PASS と読み違える (レビュー指摘 PR #3979)。
	 */
	it('PASS 時に root ごとの走査件数を出力する (0 件走査と違反 0 件を区別できる)', () => {
		const res = spawnSync(process.execPath, [GATE], { cwd: REPO_ROOT, encoding: 'utf8' });
		expect(res.status, `${res.stdout ?? ''}${res.stderr ?? ''}`).toBe(0);
		for (const root of SCAN_ROOTS) {
			expect(res.stdout, `${root} の走査件数が出力されていません: ${res.stdout}`).toMatch(
				new RegExp(`${root.replace('.', '\\.')}=\\d+`),
			);
		}
	}, 60_000);
});

// ---------------------------------------------------------------------------
// 2b. CI 発火条件
// ---------------------------------------------------------------------------

/**
 * gate の走査範囲 (`SCAN_ROOTS`) と CI の発火条件 (`paths-filter` の `app`) の対応を固定する。
 *
 * `check-cli-entry-guard` を実行するのは `ci.yml` の `lint-and-test` job だけで、この job は
 * `changes` の 4 filter (app / deps / stories / docs) がすべて false なら **job ごと skip** される。
 * SCAN_ROOTS を広げても filter を広げ忘れると、その root だけを変更した PR で gate が
 * **1 度も走らない**。守る対象が ADR-0056 の approve gate 本体 (`.claude/hooks/gate-approve.mjs`)
 * なので、対応漏れは「gate があるのに発火しない」= 本 test が塞ぐ class に戻る
 * (レビュー指摘 PR #3979 BLOCK 4)。
 */
describe('CI 発火条件 — SCAN_ROOTS が paths-filter の app に列挙されている (#3969)', () => {
	/**
	 * `filters: |` block scalar 内の 1 named filter からパスパターンを抜く。
	 * 完全な YAML parse はしない (依存を増やさない)。名前行より深い字下げの `- '...'` を拾い、
	 * 字下げが名前行以下に戻った時点で終端する。
	 */
	function extractFilterPaths(yaml: string, name: string): string[] {
		const lines = yaml.split(/\r?\n/);
		const start = lines.findIndex((l) => new RegExp(`^(\\s+)${name}:\\s*$`).test(l));
		if (start < 0) return [];
		const baseIndent = (lines[start]?.match(/^\s*/)?.[0] ?? '').length;
		const paths: string[] = [];
		for (let i = start + 1; i < lines.length; i++) {
			const line = lines[i] ?? '';
			if (line.trim() === '') continue;
			const indent = (line.match(/^\s*/)?.[0] ?? '').length;
			if (indent <= baseIndent) break;
			const m = line.trim().match(/^-\s*'([^']+)'\s*$/);
			if (m?.[1]) paths.push(m[1]);
		}
		return paths;
	}

	const CI_YML = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
	const appPaths = extractFilterPaths(CI_YML, 'app');

	// 陽性対照: parser が空配列を返しているだけの偽 PASS を防ぐ (proposal 005 / #3979)。
	it('app filter を抽出できている (parser 自体の健全性)', () => {
		expect(appPaths.length).toBeGreaterThan(5);
		expect(appPaths).toContain('src/**');
	});

	for (const root of SCAN_ROOTS) {
		it(`app filter が '${root}/**' を含む`, () => {
			expect(
				appPaths,
				`SCAN_ROOTS に '${root}' があるのに ci.yml の paths-filter app に '${root}/**' がありません。` +
					`'${root}/**' だけを変更した PR で lint-and-test が skip され、gate が走りません。`,
			).toContain(`${root}/**`);
		});
	}
});

// ---------------------------------------------------------------------------
// 3. meta-gate
// ---------------------------------------------------------------------------

describe('meta-gate — gate が no-op で exit 0 を返さない (#3969)', () => {
	/**
	 * 「必ず失敗する既知の不正入力」を与えて exit != 0 を確認する。
	 * gate 個別のロジックではなく **gate が起動して判定に到達しているか** を見ている。
	 * no-op に退化すると exit 0 かつ無出力になるため、両方を assert する。
	 */
	const CASES: Array<{ script: string; args: string[] }> = [
		{
			script: 'check-pr-body.mjs',
			args: ['--body-file', '__gq_missing_body__.md', '--skip-mergeable'],
		},
		{ script: 'check-ac-verification-map.mjs', args: ['--body-file', '__gq_missing_body__.md'] },
		{ script: 'check-cli-entry-guard.mjs', args: ['--__gq_unknown_flag__'] },
		{ script: 'check-workflow-sparse-checkout-closure.mjs', args: ['--__gq_unknown_flag__'] },
	];

	for (const { script, args } of CASES) {
		it(`${script} は起動して判定に到達する (no-op で無出力 exit 0 にならない)`, () => {
			const res = spawnSync(process.execPath, [path.join('scripts', script), ...args], {
				cwd: REPO_ROOT,
				encoding: 'utf8',
			});
			const combined = `${res.stdout ?? ''}${res.stderr ?? ''}`;
			expect(combined.trim(), 'gate が無出力でした (main() 未実行の疑い)').not.toBe('');
		});
	}

	it('check-pr-body.mjs は存在しない body-file で exit != 0 を返す', () => {
		const res = spawnSync(
			process.execPath,
			['scripts/check-pr-body.mjs', '--body-file', '__gq_missing_body__.md', '--skip-mergeable'],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		);
		expect(
			res.status,
			`exit 0 で返りました (no-op の疑い)。出力:\n${`${res.stdout ?? ''}${res.stderr ?? ''}`.slice(0, 2000)}`,
		).not.toBe(0);
	});

	// skip 条件: symlink/junction を作成できない環境のみ (ADR-0006 metadata)
	//   Issue: #3969 / owner: @Takenori-Kusaka / deadline: なし (恒久的な環境条件 skip)
	it.skipIf(!SYMLINK_OK)('symlink 経由の repo からでも gate が同じ結果を返す', () => {
		const dir = makeTempDir('gq-repo-link-');
		const link = path.join(dir, 'repo');
		symlinkSync(REPO_ROOT, link, 'junction');

		const args = [
			'scripts/check-pr-body.mjs',
			'--body-file',
			'__gq_missing_body__.md',
			'--skip-mergeable',
		];
		const viaReal = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
		const viaLink = spawnSync(process.execPath, args, { cwd: link, encoding: 'utf8' });

		expect(viaLink.status, 'symlink 経由で exit code が変わりました').toBe(viaReal.status);
		expect(viaLink.status, 'symlink 経由で exit 0 (no-op) になりました').not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 4. symlink / 実体 の結果一致 (主要 gate、AC3)
// ---------------------------------------------------------------------------

/**
 * 主要 gate を「実体パス」と「symlink 経由パス」の両方から起動し、
 * **出力が非空かつ完全一致** することを確認する。
 *
 * `--help` を渡しても大半の gate は本走査まで実行するため、
 * 「main() に到達したか」の probe として十分機能する (修正前は無出力 exit 0)。
 *
 * ## coverage の境界 (意図的に絞っている)
 *
 * `scripts/check-*.mjs` は全 54 本あるが、全件を両経路で起動すると実測 ~5.5 分かかる
 * (単経路で 2m42s)。unit test に載せられないため、ここでは **重要度の高い 12 本** に限定する。
 * 残りは静的 gate (`scripts/check-cli-entry-guard.mjs`) が判定 SSOT 利用を全件強制することで
 * カバーする — 「代表 12 本しか動的検証していない」ことを明示しておく。
 *
 * 除外: `claude-hook-prevent-qa-account-pr.mjs` は通過時に**意図的に無出力 exit 0** を返す
 * PreToolUse hook なので、本 probe では判定できない (静的 gate 側でカバー)。
 *
 * skip 条件: symlink/junction を作成できない環境のみ (ADR-0006 metadata)
 *   Issue: #3969 / owner: @Takenori-Kusaka / deadline: なし (恒久的な環境条件 skip)
 *   CI (ubuntu-latest) では常時実行される
 */
describe.skipIf(!SYMLINK_OK)(
	'symlink 経由と実体経由で主要 gate の結果が一致する (#3969 AC3)',
	() => {
		const PROBE_SCRIPTS = [
			'pre-ready.mjs',
			'check-pr-body.mjs',
			'check-cdk-replacement.mjs',
			'check-gh-account-before-pr.mjs',
			'check-cli-entry-guard.mjs',
			'check-new-required-env.mjs',
			'check-pr-screenshot.mjs',
			'check-ac-verification-map.mjs',
			'check-license-key-leak.mjs',
			'check-action-sha-pin.mjs',
			'check-no-direct-env-access.mjs',
		];

		let linkedRoot: string;

		beforeAll(() => {
			const dir = makeTempDir('gq-gate-equiv-');
			linkedRoot = path.join(dir, 'repo');
			symlinkSync(REPO_ROOT, linkedRoot, 'junction');
		});

		for (const script of PROBE_SCRIPTS) {
			it(`${script}`, () => {
				const args = [path.join('scripts', script), '--help'];
				const viaReal = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
				const viaLink = spawnSync(process.execPath, args, { cwd: linkedRoot, encoding: 'utf8' });

				const realOut = `${viaReal.stdout ?? ''}${viaReal.stderr ?? ''}`.trim();
				const linkOut = `${viaLink.stdout ?? ''}${viaLink.stderr ?? ''}`.trim();

				// 実体経由で無出力なら probe 自体が無効なので、まずそこを守る
				expect(realOut, '実体経由で無出力 (probe が無効)').not.toBe('');
				// 本 Issue の事故形: symlink 経由だけ main() 未実行で無出力 exit 0 になる
				expect(linkOut, 'symlink 経由で無出力 (main() 未実行の疑い)').not.toBe('');
				expect(linkOut).toBe(realOut);
				expect(viaLink.status).toBe(viaReal.status);
			});
		}
	},
);
