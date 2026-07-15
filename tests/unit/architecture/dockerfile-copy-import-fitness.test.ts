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
//   - node_modules import: deps stage で丸ごと COPY 済み (パッケージ解決は npm ci が担保)
//   - $lib alias: tsconfig paths 経由。src/ が COPY されている Dockerfile では relative 同様に
//     src/lib/ へ写像して検証する

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

/** specifier をファイル実体へ解決する (tsx 同等: .js 指定は .ts 実体も試す)。解決不能は null。 */
function resolveSpecifier(fromFileAbs: string, specifier: string): string | null {
	let baseAbs: string;
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		baseAbs = resolve(dirname(fromFileAbs), specifier);
	} else if (specifier.startsWith('$lib/')) {
		baseAbs = resolve(REPO_ROOT, 'src/lib', specifier.slice('$lib/'.length));
	} else {
		return null; // node_modules / builtin — 対象外
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
				if (readFileSync(c, 'utf-8') !== undefined) return c;
			} catch {
				// directory 等は読めない → 次候補
			}
		}
	}
	return null;
}

/** entry から relative/$lib import graph を再帰解決し、repo パス集合を返す。 */
function collectImportGraph(entryAbs: string): string[] {
	const visited = new Set<string>();
	const queue = [entryAbs];
	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || visited.has(file)) continue;
		visited.add(file);
		const source = readFileSync(file, 'utf-8');
		for (const spec of extractSpecifiers(source)) {
			const resolved = resolveSpecifier(file, spec);
			if (resolved && !visited.has(resolved)) queue.push(resolved);
		}
	}
	return [...visited].map(toRepoPath).sort();
}

/** 検証対象: Dockerfile → image 同梱 entry (CMD / cutover rehearsal が実行するもの)。 */
const TARGETS: { dockerfile: string; entries: string[] }[] = [
	{ dockerfile: 'Dockerfile', entries: ['scripts/nuc-pglite-cutover.ts'] },
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
				const missing = graph.filter((p) => !isCovered(p, copyRoots));
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
		const missing = graph.filter((p) => !isCovered(p, mutated));
		// scripts/lib COPY (#3648、#3659 で runtime/ に分離) を欠く = cycle 2 の実障害状態を再現 → 必ず検出される
		expect(missing.some((p) => p.startsWith('scripts/lib/runtime/'))).toBe(true);
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
