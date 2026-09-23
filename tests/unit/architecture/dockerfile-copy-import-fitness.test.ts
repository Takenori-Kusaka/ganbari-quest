// tests/unit/architecture/dockerfile-copy-import-fitness.test.ts
// #3652 / ADR-0061 — Docker image 同梱物 (COPY) と実行時 import 解決の一致 fitness。
//
// 「移設・追加した module が Dockerfile COPY に追随せず、実行時 ERR_MODULE_NOT_FOUND で
// staging/本番 deploy を止める」class が 3 件連続で CI をすり抜けた (prepare.mjs #3642 /
// scripts/lib/runtime/nuc-cutover-verify #3648 / QM が #3642 approve 時に本 fitness を候補化):
//   再発防止が「移設時に Dockerfile も見る」という人の注意依存だったため、image 同梱 CLI の
//   relative import graph を静的解決し、全解決先が COPY 宣言でカバーされることを CI で検証する。
//
// 対象 (entry は Dockerfile の COPY / CMD / lifecycle が SSOT):
//   - Dockerfile (NUC app):     scripts/nuc-pglite-cutover.ts (cutover rehearsal で docker compose run)
//   - Dockerfile.scheduler:     scripts/scheduler.ts (CMD tsx 実行)
//   - 全 Dockerfile:            scripts/prepare.mjs (npm の prepare lifecycle が `npm ci` 中に実行する。
//     deps stage は package*.json + prepare.mjs しか COPY しないため、prepare.mjs に import を
//     足すと image build 自体が ERR_MODULE_NOT_FOUND で落ちる。第 22 回統合監査で実際に発生し
//     docker-build / deploy-aws-staging / deploy-nuc-staging / e2e-demo-lambda の 4 job が落ちた
//     = 本番 deploy を壊す class。entry に加えて class を lock する)
// 対象外:
//   - backup コンテナ: scripts/ を volume mount (docker-compose.yml `./scripts:/app/scripts:ro`)
//     で実行時に全体が見えるため COPY 不整合 class が構造的に起きない
//     (この「mount 設計であること」自体は下記 [backup class 構造保証] test が機械検証する、#3684 AC2)
//   - node_modules import: deps stage で丸ごと COPY 済み (パッケージ解決は npm ci が担保)
//   - $lib alias: tsconfig paths 経由。src/ が COPY されている Dockerfile では relative 同様に
//     src/lib/ へ写像して検証する
//
// 近似限界の明文化 (#3684 AC3、QM residual #3654):
//   - resolveSpecifier は tsx の実解決を「候補列」(拡張子付与 / .js→.ts 写像 / index.ts) で
//     近似する。package.json exports 解決 / tsconfig paths の全 alias ($lib 以外) /
//     node_modules 内部のファイル解決は scope 外 (external として意図的に skip)
//   - 旧実装は relative / $lib specifier が候補列で解決不能なとき silent に対象外
//     (false negative の余地) だった → unresolved として収集し 1 件でも fail する (#3684 AC1)。
//     候補列の近似が実 import パターンに追随できていない場合、この fail が可視化する
//
// 後半の describe は「COPY 元そのもの」と「image を build する CI の発火条件」を見る:
//   - COPY 元の実在: build context からの COPY / build stage 経由の COPY の元が repo に実在し、
//     .dockerignore で除外されていない (消した file を COPY したままだと docker build が
//     "not found" で落ちるが、docker-build job は重量レーンで develop 向け PR では走らない)
//   - 秘密を含む合成物を build context に入れない (.dockerignore の cdk.out)
//   - image の入力が変わったら image を build する CI が発火する (ci.yml の paths filter /
//     deploy-nuc.yml の paths) + 全 Dockerfile が main より前に 1 度 build される

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

// repo 走査 test の区分宣言 (scripts/lib/ci/repo-scan-test-registry.mjs)。読むのは repo 直下と
// glob COPY 元の親ディレクトリだけで有界だが、静的判定に合わせて明示 timeout を置く。
vi.setConfig({ testTimeout: 30_000 });

const REPO_ROOT = resolve(__dirname, '../../..');

/** repo-relative posix パスに正規化する。 */
function toRepoPath(abs: string): string {
	return relative(REPO_ROOT, abs).split('\\').join('/');
}

/**
 * Dockerfile の COPY 宣言から「image に入る repo パス」集合を抽出する。
 * 本リポジトリの COPY は src(=repo パス) と dest が同一形 (/app/<p> → ./<p>) のため src を採る。
 * `COPY --from=<stage> /app/<p> ./<p>` / `COPY <p> <dest>` の両形に対応。
 */
function parseDockerfileCopyRoots(dockerfileText: string): string[] {
	const roots: string[] = [];
	for (const raw of dockerfileText.split('\n')) {
		const line = raw.trim();
		if (!line.startsWith('COPY ')) continue;
		const tokens = line
			.slice('COPY '.length)
			.split(/\s+/)
			.filter((t) => !t.startsWith('--'));
		// 最後の token が dest、それ以外が src 群
		const srcs = tokens.slice(0, -1);
		for (const src of srcs) {
			// build stage 内パス (/app/<p>) は repo パスへ写像。それ以外 (build context 直参照) はそのまま。
			const repoPath = src.startsWith('/app/') ? src.slice('/app/'.length) : src;
			roots.push(repoPath.replace(/^\.\//, '').replace(/\/$/, ''));
		}
	}
	return roots;
}

/** repo パスが COPY roots のいずれか (file 一致 or dir prefix) でカバーされるか。 */
function isCovered(repoPath: string, copyRoots: string[]): boolean {
	return copyRoots.some((root) => repoPath === root || repoPath.startsWith(`${root}/`));
}

/** import/require/dynamic-import の specifier を抽出する (コメント行は除外)。 */
function extractSpecifiers(sourceText: string): string[] {
	const noComments = sourceText
		.split('\n')
		.filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
		.join('\n');
	const specifiers: string[] = [];
	const patterns = [
		/import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g, // static import
		/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import
		/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // cjs require
	];
	for (const re of patterns) {
		for (const m of noComments.matchAll(re)) {
			if (m[1]) specifiers.push(m[1]);
		}
	}
	return specifiers;
}

/**
 * specifier 解決の結果 (#3684 AC1)。
 * - resolved:   候補列でファイル実体に解決できた (graph 走査対象)
 * - external:   node_modules / builtin — 意図的対象外 (deps stage COPY / npm ci が担保)
 * - unresolved: relative / $lib なのに候補列で解決不能 — silent 対象外にせず fail させる
 */
type ResolveOutcome =
	| { kind: 'resolved'; abs: string }
	| { kind: 'external' }
	| { kind: 'unresolved' };

/** specifier をファイル実体へ解決する (tsx 同等の近似: .js 指定は .ts 実体も試す)。 */
function resolveSpecifier(fromFileAbs: string, specifier: string): ResolveOutcome {
	let baseAbs: string;
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		baseAbs = resolve(dirname(fromFileAbs), specifier);
	} else if (specifier.startsWith('$lib/')) {
		baseAbs = resolve(REPO_ROOT, 'src/lib', specifier.slice('$lib/'.length));
	} else {
		return { kind: 'external' }; // node_modules / builtin — 対象外 (ヘッダー「近似限界」参照)
	}
	const candidates = [
		baseAbs,
		`${baseAbs}.ts`,
		`${baseAbs}.mts`,
		`${baseAbs}.mjs`,
		`${baseAbs}.cjs`,
		`${baseAbs}.js`,
		baseAbs.replace(/\.js$/, '.ts'), // ESM 慣習の .js 指定 → .ts 実体
		join(baseAbs, 'index.ts'),
	];
	for (const c of candidates) {
		if (existsSync(c) && !c.endsWith(posix.sep)) {
			// directory そのものに match した場合は index 解決のみ許す
			if (c === baseAbs && existsSync(join(c, 'index.ts'))) continue;
			try {
				if (readFileSync(c, 'utf-8') !== undefined) return { kind: 'resolved', abs: c };
			} catch {
				// directory 等は読めない → 次候補
			}
		}
	}
	return { kind: 'unresolved' };
}

/**
 * entry から relative/$lib import graph を再帰解決する。
 * files:      解決できた repo パス集合 (COPY カバレッジ検証対象)
 * unresolved: 候補列で解決不能だった relative/$lib specifier (`<from> -> <specifier>` 形式)。
 *             silent 対象外 (false negative) を根絶するため呼出側で 0 件を assert する (#3684 AC1)
 */
function collectImportGraph(entryAbs: string): { files: string[]; unresolved: string[] } {
	const visited = new Set<string>();
	const unresolved = new Set<string>();
	const queue = [entryAbs];
	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || visited.has(file)) continue;
		visited.add(file);
		const source = readFileSync(file, 'utf-8');
		for (const spec of extractSpecifiers(source)) {
			const outcome = resolveSpecifier(file, spec);
			if (outcome.kind === 'resolved' && !visited.has(outcome.abs)) {
				queue.push(outcome.abs);
			} else if (outcome.kind === 'unresolved') {
				unresolved.add(`${toRepoPath(file)} -> ${spec}`);
			}
		}
	}
	return {
		files: [...visited].map(toRepoPath).sort(),
		unresolved: [...unresolved].sort(),
	};
}

/** 検証対象: Dockerfile → image 同梱 entry (CMD / cutover rehearsal が実行するもの)。 */
const TARGETS: { dockerfile: string; entries: string[] }[] = [
	{
		dockerfile: 'Dockerfile',
		entries: ['scripts/nuc-pglite-cutover.ts', 'scripts/seed-staging.ts', 'scripts/prepare.mjs'],
	},
	{ dockerfile: 'Dockerfile.scheduler', entries: ['scripts/scheduler.ts', 'scripts/prepare.mjs'] },
	// Dockerfile.lambda は AWS 本番 (Lambda) の image。deps / prod-deps の 2 stage が
	// `npm ci` の prepare lifecycle で scripts/prepare.mjs を実行する。
	{ dockerfile: 'Dockerfile.lambda', entries: ['scripts/prepare.mjs'] },
];

describe('Dockerfile COPY ↔ CLI import 一致 fitness (#3652、ADR-0061)', () => {
	for (const target of TARGETS) {
		it(`${target.dockerfile}: entry の import graph 全体が COPY 宣言でカバーされる`, () => {
			const copyRoots = parseDockerfileCopyRoots(
				readFileSync(join(REPO_ROOT, target.dockerfile), 'utf-8'),
			);
			for (const entry of target.entries) {
				expect(isCovered(entry, copyRoots), `entry ${entry} 自体が COPY されていない`).toBe(true);
				const graph = collectImportGraph(join(REPO_ROOT, entry));
				// #3684 AC1: 候補列で解決不能な relative/$lib specifier を silent 対象外にしない。
				// unresolved が出た場合は「候補列 (resolveSpecifier) の近似が実 import に追随できて
				// いない」or「import 先の実体が存在しない」のどちらかで、放置すると COPY 漏れ検証の
				// 空白地帯 (false negative) になる。
				expect(
					graph.unresolved,
					`${entry} の import graph に resolveSpecifier で解決不能な specifier があります ` +
						`(silent 対象外 = false negative 温床、#3684)。候補列の追補 or import の見直しが必要:\n` +
						graph.unresolved.join('\n'),
				).toEqual([]);
				const missing = graph.files.filter((p) => !isCovered(p, copyRoots));
				expect(
					missing,
					`${target.dockerfile} の COPY に含まれない import 解決先があります (実行時 ERR_MODULE_NOT_FOUND、` +
						`#3642/#3648 と同 class)。COPY 追加または import 先の見直しが必要:\n${missing.join('\n')}`,
				).toEqual([]);
			}
		});
	}

	it('[mutation 演繹] COPY 宣言から scripts/lib/runtime を欠くと検出される (fitness 自体の実効性)', () => {
		const dockerfileText = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf-8');
		const mutated = parseDockerfileCopyRoots(dockerfileText).filter(
			(root) => root !== 'scripts/lib/runtime',
		);
		const graph = collectImportGraph(join(REPO_ROOT, 'scripts/nuc-pglite-cutover.ts'));
		const missing = graph.files.filter((p) => !isCovered(p, mutated));
		// scripts/lib COPY (#3648、#3659 で runtime/ に分離) を欠く = cycle 2 の実障害状態を再現 → 必ず検出される
		expect(missing.some((p) => p.startsWith('scripts/lib/runtime/'))).toBe(true);
	});

	it('[unresolved 演繹] 解決不能な relative specifier は unresolved として検出される (#3684 AC1)', () => {
		const entry = join(REPO_ROOT, 'scripts/scheduler.ts');
		// 実体が存在しない relative specifier → unresolved (silent skip しない)
		expect(resolveSpecifier(entry, './does-not-exist-3684').kind).toBe('unresolved');
		expect(resolveSpecifier(entry, '$lib/does-not-exist-3684').kind).toBe('unresolved');
		// node_modules / builtin は意図的対象外 (external) のまま — 近似 scope の境界を固定する
		expect(resolveSpecifier(entry, 'node:fs').kind).toBe('external');
		expect(resolveSpecifier(entry, 'vitest').kind).toBe('external');
	});

	it('[backup class 構造保証] docker-compose.yml の backup service が ./scripts:/app/scripts mount を保持する (#3684 AC2)', () => {
		// backup コンテナを本 fitness の対象外とする根拠は「scripts/ を volume mount する設計」
		// にある (ヘッダー「対象外」)。compose から mount を外すと backup の実行時 import が
		// COPY にも mount にも守られない fitness 空白地帯になるため、mount の存在自体を assert する。
		const composeText = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf-8');
		const lines = composeText.split('\n');
		const start = lines.findIndex((l) => /^ {2}backup:\s*$/.test(l));
		expect(start, 'docker-compose.yml に backup service が存在する').toBeGreaterThan(-1);
		const rest = lines.slice(start + 1);
		// 次の top-level service (インデント 2 の非コメント行) までを backup block とみなす
		const endOffset = rest.findIndex((l) => /^ {2}\S/.test(l) && !/^ {2}#/.test(l));
		const block = rest.slice(0, endOffset === -1 ? undefined : endOffset).join('\n');
		expect(
			block,
			'backup service の volumes に `./scripts:/app/scripts` mount が必要 (撤去 = fitness 空白化)',
		).toMatch(/-\s*\.\/scripts:\/app\/scripts(?::ro)?\s*$/m);
	});

	it('[parser 健全性] COPY 形式 (--from / 直 COPY / dir / file) を正しく抽出する', () => {
		const roots = parseDockerfileCopyRoots(
			[
				'COPY --from=build /app/scripts/foo.ts ./scripts/foo.ts',
				'COPY --from=build /app/src ./src',
				'COPY scripts/prepare.mjs ./scripts/prepare.mjs',
				'COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh',
			].join('\n'),
		);
		expect(roots).toContain('scripts/foo.ts');
		expect(roots).toContain('src');
		expect(roots).toContain('scripts/prepare.mjs');
		expect(isCovered('src/lib/server/db/factory.ts', roots)).toBe(true);
		expect(isCovered('scripts/lib/other.ts', roots)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// COPY 元の実在 / 秘密を build context に入れない / image を build する CI の発火条件
// ---------------------------------------------------------------------------

/**
 * `.dockerignore` / paths-filter で使う単純 glob を正規表現にする。
 * `**` は階層をまたぎ、`*` / `?` は 1 階層内。文字クラス (`[...]`) は使っていないので未対応とし、
 * 書かれたら黙って誤判定せずに落とす (matcher を拡張する合図)。
 */
function globToRegExp(glob: string): RegExp {
	if (/[[\]]/.test(glob)) {
		throw new Error(`glob "${glob}" の文字クラスは本 test の matcher 未対応。matcher を拡張する`);
	}
	let out = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob.charAt(i);
		if (ch === '*' && glob.charAt(i + 1) === '*') {
			if (glob.charAt(i + 2) === '/') {
				out += '(?:.*/)?';
				i += 2;
			} else {
				out += '.*';
				i += 1;
			}
		} else if (ch === '*') out += '[^/]*';
		else if (ch === '?') out += '[^/]';
		else out += ch.replace(/[.+^${}()|\\]/g, '\\$&');
	}
	return new RegExp(`^${out}$`);
}

/** `.dockerignore` の除外パターン。Docker は build context の root に固定して照合する。 */
function readDockerignorePatterns(text: string): { pattern: string; re: RegExp }[] {
	return text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l !== '' && !l.startsWith('#'))
		.map((pattern) => {
			if (pattern.startsWith('!')) {
				throw new Error(
					`例外パターン "${pattern}" は本 test の matcher 未対応。matcher を拡張する`,
				);
			}
			return { pattern, re: globToRegExp(pattern.replace(/^\/+/, '').replace(/\/+$/, '')) };
		});
}

const DOCKERIGNORE = readDockerignorePatterns(
	readFileSync(join(REPO_ROOT, '.dockerignore'), 'utf-8'),
);

/** repo パスを除外するパターンを返す (ディレクトリが除外されれば中身も除外される)。無ければ null。 */
function dockerignoreMatch(
	repoPath: string,
	patterns: { pattern: string; re: RegExp }[] = DOCKERIGNORE,
): string | null {
	const parts = repoPath.split('/');
	for (let i = 1; i <= parts.length; i++) {
		const prefix = parts.slice(0, i).join('/');
		const hit = patterns.find((p) => p.re.test(prefix));
		if (hit) return hit.pattern;
	}
	return null;
}

interface CopyInstruction {
	/** `--from=` の値。build context からの COPY なら null */
	from: string | null;
	srcs: string[];
	line: string;
}

interface DockerStage {
	base: string;
	name: string | null;
	copies: CopyInstruction[];
}

/** Dockerfile を stage ごとに分け、各 stage の COPY を集める。 */
function parseDockerStages(dockerfileText: string): DockerStage[] {
	const stages: DockerStage[] = [];
	for (const raw of dockerfileText.split('\n')) {
		const line = raw.trim();
		const from = /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
		if (from) {
			stages.push({ base: from[1] ?? '', name: from[2] ?? null, copies: [] });
			continue;
		}
		if (/^ADD\s/i.test(line) || /^COPY\s+(--\S+\s+)*\[/i.test(line)) {
			throw new Error(
				`"${line}" (ADD / JSON 形式の COPY) は本 test の parser 未対応。parser を拡張する`,
			);
		}
		if (!line.startsWith('COPY ')) continue;
		const tokens = line.slice('COPY '.length).trim().split(/\s+/);
		const fromFlag = tokens.find((t) => t.startsWith('--from='));
		const rest = tokens.filter((t) => !t.startsWith('--'));
		stages.at(-1)?.copies.push({
			from: fromFlag ? fromFlag.slice('--from='.length) : null,
			srcs: rest.slice(0, -1),
			line,
		});
	}
	return stages;
}

/** COPY の src を repo パス形に正規化する (`./a/` → `a`、`.` → ``)。 */
function normalizeSrc(src: string): string {
	const p = src.replace(/^\.\//, '').replace(/\/+$/, '');
	return p === '.' ? '' : p;
}

/**
 * build context からの COPY 元を repo パスに展開する。glob は親ディレクトリの実在 file に照合する。
 * `.` (context 全体) は空配列 = 個別の実在確認の対象外。
 */
function expandContextSrc(src: string): string[] {
	const p = normalizeSrc(src);
	if (p === '') return [];
	if (!/[*?]/.test(p)) return [p];
	const dir = posix.dirname(p);
	const re = globToRegExp(posix.basename(p));
	const base = dir === '.' ? REPO_ROOT : join(REPO_ROOT, dir);
	if (!existsSync(base)) return [];
	return readdirSync(base)
		.filter((name) => re.test(name))
		.map((name) => (dir === '.' ? name : `${dir}/${name}`));
}

/** repo パスが実在し、.dockerignore で除外されていなければ null、問題があれば理由を返す。 */
function contextPathProblem(repoPath: string): string | null {
	if (!existsSync(join(REPO_ROOT, repoPath))) return 'repo に存在しない';
	const ignored = dockerignoreMatch(repoPath);
	if (ignored) return `.dockerignore の "${ignored}" で build context から除外されている`;
	return null;
}

/**
 * build stage の RUN が作るもの (repo には無いので実在確認の対象外)。
 * ここに足すのは「その stage の RUN が生成する」と言えるものだけ。
 */
const GENERATED_IN_BUILD: Record<string, string> = {
	build: 'npm run build (SvelteKit adapter の出力)',
	node_modules: 'npm ci の出力',
	'.svelte-kit': 'npm run build 中の svelte-kit sync が生成する',
};

/** stage とその祖先 stage が build context から COPY した src の一覧。 */
function contextSrcsOfChain(stages: DockerStage[], stage: DockerStage): string[] {
	const srcs: string[] = [];
	let cur: DockerStage | undefined = stage;
	const seen = new Set<DockerStage>();
	while (cur && !seen.has(cur)) {
		seen.add(cur);
		for (const c of cur.copies) if (c.from === null) srcs.push(...c.srcs.map(normalizeSrc));
		const baseName: string = cur.base;
		cur = stages.find((s) => s.name === baseName);
	}
	return srcs;
}

/** build context からの COPY 1 行の問題 (元が repo に無い / .dockerignore で外れている)。 */
function contextCopyProblems(copy: CopyInstruction): string[] {
	const problems: string[] = [];
	for (const src of copy.srcs) {
		const expanded = expandContextSrc(src);
		if (normalizeSrc(src) !== '' && expanded.length === 0) {
			problems.push(`${copy.line} — "${src}" に一致する file が repo に無い`);
		}
		for (const p of expanded) {
			const why = contextPathProblem(p);
			if (why) problems.push(`${copy.line} — ${p} が ${why}`);
		}
	}
	return problems;
}

/**
 * stage 内パス (`/app/<p>`) が、その stage に build context から入っている or RUN が作ったものか。
 * 問題があれば理由を返す。
 */
function stagePathProblem(stages: DockerStage[], source: DockerStage, src: string): string | null {
	if (!src.startsWith('/app/')) return `stage 内パス "${src}" が /app/ 配下でない`;
	const p = normalizeSrc(src.slice('/app/'.length));
	if (Object.keys(GENERATED_IN_BUILD).some((g) => p === g || p.startsWith(`${g}/`))) return null;
	const covered = contextSrcsOfChain(stages, source).some(
		(s) =>
			s === '' || p === s || p.startsWith(`${s}/`) || (/[*?]/.test(s) && globToRegExp(s).test(p)),
	);
	if (!covered) {
		return (
			`stage "${source.name}" は ${p} を build context から COPY していない` +
			' (RUN が生成するなら GENERATED_IN_BUILD に理由付きで足す)'
		);
	}
	const why = contextPathProblem(p);
	return why ? `${p} が ${why}` : null;
}

/** Dockerfile 1 本の COPY 元の問題を列挙する (空なら問題なし)。 */
function findCopySourceProblems(dockerfile: string, dockerfileText: string): string[] {
	const stages = parseDockerStages(dockerfileText);
	const problems: string[] = [];
	for (const copy of stages.flatMap((stage) => stage.copies)) {
		if (copy.from === null) {
			problems.push(...contextCopyProblems(copy).map((p) => `${dockerfile}: ${p}`));
			continue;
		}
		const source = stages.find((s) => s.name === copy.from);
		if (!source) continue; // 外部 image (`--from=public.ecr.aws/...`) は repo と無関係
		for (const src of copy.srcs) {
			const why = stagePathProblem(stages, source, src);
			if (why) problems.push(`${dockerfile}: ${copy.line} — ${why}`);
		}
	}
	return problems;
}

/** repo 直下の Dockerfile (`Dockerfile` / `Dockerfile.<name>`)。 */
const DOCKERFILES = readdirSync(REPO_ROOT)
	.filter((name) => /^Dockerfile(\..+)?$/.test(name) && statSync(join(REPO_ROOT, name)).isFile())
	.sort();

/** Dockerfile の build context からの COPY 元 (repo パス。ディレクトリは `<dir>/` 付き)。 */
function contextCopyInputs(dockerfile: string): string[] {
	const stages = parseDockerStages(readFileSync(join(REPO_ROOT, dockerfile), 'utf-8'));
	const inputs = new Set<string>();
	for (const stage of stages) {
		for (const copy of stage.copies) {
			if (copy.from !== null) continue;
			for (const src of copy.srcs) {
				for (const p of expandContextSrc(src)) {
					const abs = join(REPO_ROOT, p);
					inputs.add(existsSync(abs) && statSync(abs).isDirectory() ? `${p}/` : p);
				}
			}
		}
	}
	return [...inputs].sort();
}

/** paths-filter のパターン群のどれかに一致するか。ディレクトリは配下の file で照合する。 */
function isMatchedByPaths(input: string, patterns: string[]): boolean {
	const probe = input.endsWith('/') ? `${input}any-file` : input;
	return patterns.some((p) => globToRegExp(p).test(probe));
}

type WorkflowStep = { id?: string; run?: string; with?: Record<string, unknown> };
type Workflow = {
	on?: { push?: { paths?: string[] } };
	jobs?: Record<string, { steps?: WorkflowStep[] }>;
};

function readWorkflow(file: string): Workflow {
	return parseYaml(readFileSync(join(REPO_ROOT, '.github/workflows', file), 'utf-8')) as Workflow;
}

/** ci.yml の changes job (dorny/paths-filter) の filter 定義。 */
function ciPathFilters(): Record<string, string[]> {
	const step = readWorkflow('ci.yml').jobs?.changes?.steps?.find((s) => s.id === 'filter');
	const filters = step?.with?.filters;
	if (typeof filters !== 'string') throw new Error('ci.yml の changes / filter step が読めない');
	return parseYaml(filters) as Record<string, string[]>;
}

/** docker-compose.yml が build する Dockerfile (NUC の app / backup / scheduler)。 */
function composeDockerfiles(): string[] {
	const compose = parseYaml(readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf-8')) as {
		services?: Record<string, { build?: string | { dockerfile?: string } }>;
	};
	const files = new Set<string>();
	for (const service of Object.values(compose.services ?? {})) {
		if (service.build === undefined) continue;
		files.add(
			typeof service.build === 'string' ? 'Dockerfile' : (service.build.dockerfile ?? 'Dockerfile'),
		);
	}
	return [...files].sort();
}

describe('Dockerfile の COPY 元が build context に実在する', () => {
	it('fitness の対象 (TARGETS) が repo 直下の全 Dockerfile を覆う (Dockerfile 追加時の空白化防止)', () => {
		expect(DOCKERFILES.length, 'repo 直下に Dockerfile が見つからない').toBeGreaterThan(0);
		expect(TARGETS.map((t) => t.dockerfile).sort()).toEqual(DOCKERFILES);
	});

	for (const dockerfile of DOCKERFILES) {
		it(`${dockerfile}: COPY 元が repo に実在し、.dockerignore で除外されていない`, () => {
			const problems = findCopySourceProblems(
				dockerfile,
				readFileSync(join(REPO_ROOT, dockerfile), 'utf-8'),
			);
			expect(
				problems,
				`COPY 元が build context に無いため docker build が "not found" で落ちます。` +
					`file を戻すか COPY を直してください:\n${problems.join('\n')}`,
			).toEqual([]);
		});
	}

	it('[mutation 演繹] 存在しない file / .dockerignore で外した file の COPY を検出する', () => {
		const problems = findCopySourceProblems(
			'Dockerfile.probe',
			[
				'FROM node:22-alpine AS deps',
				'WORKDIR /app',
				'COPY package*.json ./',
				'COPY scripts/does-not-exist-probe.mjs ./scripts/does-not-exist-probe.mjs',
				'COPY docs/CLAUDE.md ./docs/CLAUDE.md',
				'FROM deps AS build',
				'COPY . .',
				'FROM node:22-alpine AS runtime',
				'COPY --from=build /app/build/ ./',
				'COPY --from=build /app/drizzle-does-not-exist-probe.config.ts ./',
				'COPY --from=deps /app/src ./src',
			].join('\n'),
		);
		expect(problems.some((p) => p.includes('scripts/does-not-exist-probe.mjs'))).toBe(true);
		expect(problems.some((p) => p.includes('docs/CLAUDE.md') && p.includes('"docs"'))).toBe(true);
		expect(problems.some((p) => p.includes('drizzle-does-not-exist-probe.config.ts'))).toBe(true);
		// deps stage は src を build context から COPY していない
		expect(problems.some((p) => p.includes('stage "deps" は src を'))).toBe(true);
		// build 出力 (RUN が生成) と実在する package*.json は問題にしない
		expect(problems.some((p) => p.includes('/app/build/'))).toBe(false);
		expect(problems.some((p) => p.includes('package'))).toBe(false);
	});
});

describe('.dockerignore が秘密を含む合成物を build context から外す', () => {
	// deploy.yml / deploy-aws-staging.yml は `cdk diff` / `cdk deploy` を `-c <secret>` 付きで
	// 実行した後に、同じ checkout で `docker build` (build stage は `COPY . .`) を行う。
	// cdk.out には Lambda の環境変数に入る秘密がそのまま書かれた template が残るため、
	// build context に入ると build stage の layer と `cache-to: type=gha,mode=max` の cache に載る。
	it.each([
		'infra/cdk.out/GanbariQuestCompute.template.json',
		'infra/cdk.out/manifest.json',
		'cdk.out/manifest.json',
	])('%s は build context に入らない', (repoPath) => {
		expect(dockerignoreMatch(repoPath), `${repoPath} が build context に入る`).not.toBeNull();
	});

	it('[matcher 健全性] Docker と同じく root に固定して照合する', () => {
		const patterns = readDockerignorePatterns(
			['node_modules', 'data/*.db*', '*.log', 'infra/cdk.out', '**/secret.txt'].join('\n'),
		);
		expect(dockerignoreMatch('node_modules/x/index.js', patterns)).toBe('node_modules');
		expect(dockerignoreMatch('data/app.db-wal', patterns)).toBe('data/*.db*');
		expect(dockerignoreMatch('app.log', patterns)).toBe('*.log');
		expect(dockerignoreMatch('infra/cdk.out/a.json', patterns)).toBe('infra/cdk.out');
		expect(dockerignoreMatch('a/b/secret.txt', patterns)).toBe('**/secret.txt');
		// root 固定: 入れ子の同名は除外されない (Docker の .dockerignore の仕様)
		expect(dockerignoreMatch('infra/node_modules/x.js', patterns)).toBeNull();
		expect(dockerignoreMatch('logs/app.log', patterns)).toBeNull();
		expect(() => readDockerignorePatterns('!keep.txt')).toThrow();
	});
});

describe('image の入力が変わったら image を build する CI が発火する', () => {
	it('ci.yml: docker-build job が repo 直下の全 Dockerfile を build する (main より前に 1 度は build する)', () => {
		const steps = readWorkflow('ci.yml').jobs?.['docker-build']?.steps ?? [];
		const built = new Set<string>();
		for (const step of steps) {
			for (const m of (step.run ?? '').matchAll(/docker build\b([^\n]*)/g)) {
				const file = /(?:^|\s)-f\s+(\S+)/.exec(m[1] ?? '')?.[1];
				built.add(file ?? 'Dockerfile');
			}
		}
		const notBuilt = DOCKERFILES.filter((f) => !built.has(f));
		expect(
			notBuilt,
			`ci.yml の docker-build job が build しない Dockerfile があります。` +
				`統合 PR で 1 度も build されないまま main に入ります:\n${notBuilt.join('\n')}`,
		).toEqual([]);
	});

	it('ci.yml: Dockerfile と build context からの COPY 元の変更で docker-build が発火する', () => {
		const filters = ciPathFilters();
		expect(filters.docker, 'ci.yml に docker filter が無い').toBeDefined();
		// docker-build job の発火条件は `docker == 'true' || deps == 'true'`
		const patterns = [...(filters.docker ?? []), ...(filters.deps ?? [])];
		const inputs = new Set<string>(['.dockerignore', ...DOCKERFILES]);
		for (const dockerfile of DOCKERFILES) {
			for (const p of contextCopyInputs(dockerfile)) inputs.add(p);
		}
		const unmatched = [...inputs].filter((p) => !isMatchedByPaths(p, patterns)).sort();
		expect(
			unmatched,
			`image の入力なのに ci.yml の docker / deps filter に一致しません。変更しても docker-build が走りません。` +
				`ci.yml の docker filter に足してください:\n${unmatched.join('\n')}`,
		).toEqual([]);
	});

	it('deploy-nuc.yml: NUC が build する Dockerfile と COPY 元の変更で deploy が発火する', () => {
		const paths = readWorkflow('deploy-nuc.yml').on?.push?.paths ?? [];
		expect(paths.length, 'deploy-nuc.yml の on.push.paths が読めない').toBeGreaterThan(0);
		const nucDockerfiles = composeDockerfiles();
		expect(nucDockerfiles).toContain('Dockerfile');
		const inputs = new Set<string>(['.dockerignore', 'docker-compose.yml', ...nucDockerfiles]);
		for (const dockerfile of nucDockerfiles) {
			for (const p of contextCopyInputs(dockerfile)) inputs.add(p);
		}
		const unmatched = [...inputs].filter((p) => !isMatchedByPaths(p, paths)).sort();
		expect(
			unmatched,
			`NUC の image の入力なのに deploy-nuc.yml の paths に一致しません。main に入っても NUC に配られません。` +
				`deploy-nuc.yml の paths に足してください:\n${unmatched.join('\n')}`,
		).toEqual([]);
	});
});
