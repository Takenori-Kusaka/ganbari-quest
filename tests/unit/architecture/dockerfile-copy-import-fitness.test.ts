// tests/unit/architecture/dockerfile-copy-import-fitness.test.ts
// #3652 / ADR-0061 — Docker image 同梱物 (COPY) と実行時 import 解決の一致 fitness。
//
// 「移設・追加した module が Dockerfile COPY に追随せず、実行時 ERR_MODULE_NOT_FOUND で
// staging/本番 deploy を止める」class が 3 件連続で CI をすり抜けた (prepare.mjs #3642 /
// scripts/lib/runtime/nuc-cutover-verify #3648 / QM が #3642 approve 時に本 fitness を候補化):
//   再発防止が「移設時に Dockerfile も見る」という人の注意依存だったため、image 同梱 CLI の
//   relative import graph を静的解決し、全解決先が COPY 宣言でカバーされることを CI で検証する。
//
// 対象 (entry は Dockerfile の COPY / CMD が SSOT):
//   - Dockerfile (NUC app):     scripts/nuc-pglite-cutover.ts (cutover rehearsal で docker compose run)
//   - Dockerfile.scheduler:     scripts/scheduler.ts (CMD tsx 実行)
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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
		entries: ['scripts/nuc-pglite-cutover.ts', 'scripts/seed-staging.ts'],
	},
	{ dockerfile: 'Dockerfile.scheduler', entries: ['scripts/scheduler.ts'] },
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
