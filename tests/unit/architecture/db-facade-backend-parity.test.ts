// tests/unit/architecture/db-facade-backend-parity.test.ts
// #4719 (EPIC #4680): 「facade が特定 backend を直 import している」class の regression guard。
//
// `src/lib/server/db/<name>-repo.ts` (facade) は **factory (`getRepos()`) 経由でのみ** backend 実装に
// 到達しなければならない。usage-log-repo.ts が sqlite 実装を直 import していたため、本番 pg-core
// (DSQL / PGlite) では表未作成 throw → WARN + 0 分に化けた (sqlite でしか再現しない)。
//
// 検査 (ADR-0061 same-class→guard、新規ツール導入ゼロ):
//   [F1] facade は `./sqlite/` / `./dsql/` / `./demo/` / `./client` を import しない
//        (static import / dynamic import() / require() / 改行 wrap も検出、route-db-boundary 踏襲)
//   [F2] facade は `getRepos()` を少なくとも 1 回呼ぶ (= factory 経由)
//   [F3] factory の Repositories が参照する interface ごとに、sqlite / dsql / demo の 3 実装 file が
//        揃っている (`src/lib/server/db/{sqlite,dsql,demo}/<name>-repo.ts`)。片側だけの実装 =
//        factory の型で落ちるが、interface 自体が factory に載っていない「sqlite 固定 facade」を
//        本 test の [F1]/[F2] で塞ぐ

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DB_DIR = resolve(REPO_ROOT, 'src/lib/server/db');

const STATIC_IMPORT_SPECIFIER = /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1/g;
const DYNAMIC_IMPORT_SPECIFIER = /\b(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g;
const FORBIDDEN =
	/^(?:\.\/(?:sqlite|dsql|demo)\/|\.\/client$|\$lib\/server\/db\/(?:sqlite|dsql|demo)\/|\$lib\/server\/db\/client$)/;

function importSpecifiers(source: string): string[] {
	const out: string[] = [];
	for (const m of source.matchAll(STATIC_IMPORT_SPECIFIER)) out.push(m[2] ?? '');
	for (const m of source.matchAll(DYNAMIC_IMPORT_SPECIFIER)) out.push(m[2] ?? '');
	return out;
}

const facades = readdirSync(DB_DIR).filter((f) => f.endsWith('-repo.ts'));

describe('db facade は factory 経由でのみ backend に到達する (#4719 / #4680 class)', () => {
	it('facade file が存在する (走査対象 0 件の空振り検出)', () => {
		expect(facades.length).toBeGreaterThan(10);
	});

	it.each(
		facades,
	)('[F1] %s は backend 実装 (sqlite / dsql / demo / client) を直 import しない', (f) => {
		const src = readFileSync(resolve(DB_DIR, f), 'utf8');
		const bad = importSpecifiers(src).filter((s) => FORBIDDEN.test(s));
		expect(
			bad,
			`${f} が backend 実装を直 import している: ${bad.join(', ')} — getRepos() 経由に直す (本番 pg では sqlite 固定 facade が壊れる、#4719)`,
		).toEqual([]);
	});

	it.each(facades)('[F2] %s は getRepos() 経由で委譲する', (f) => {
		const src = readFileSync(resolve(DB_DIR, f), 'utf8');
		expect(src.includes('getRepos()'), `${f} が factory (getRepos) を使っていない`).toBe(true);
	});

	it('[F3] factory の Repositories 各 key に sqlite / dsql / demo の実装 file が揃っている', () => {
		const factorySrc = readFileSync(resolve(DB_DIR, 'factory.ts'), 'utf8');
		// interface import 行から repo 名を抽出: `from './interfaces/<name>-repo.interface'`
		const names = [...factorySrc.matchAll(/\.\/interfaces\/([a-z-]+)-repo\.interface'/g)].map(
			(m) => m[1] ?? '',
		);
		expect(names.length).toBeGreaterThan(20);
		const missing: string[] = [];
		for (const name of names) {
			for (const backend of ['sqlite', 'dsql', 'demo'] as const) {
				// storage は backend 非依存 (s3 / sqlite / demo) のため対象外
				if (name === 'storage') continue;
				const p = resolve(DB_DIR, backend, `${name}-repo.ts`);
				if (!existsSync(p)) missing.push(`${backend}/${name}-repo.ts`);
			}
		}
		expect(
			missing,
			`backend 実装 file が欠けている (片側 backend だけ実装 = 本番でだけ壊れる class): ${missing.join(', ')}`,
		).toEqual([]);
	});
});
