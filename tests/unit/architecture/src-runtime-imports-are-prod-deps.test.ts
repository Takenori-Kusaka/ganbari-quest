// tests/unit/architecture/src-runtime-imports-are-prod-deps.test.ts
// cspell:ignore libc linuxmusl — npm lock の platform 制約 field 名と sharp の musl 向け
// platform binary 名。実名でないと本 test が守る対象を指せない (綴りを直すと意味を失う)。
// #4954: `src/**` が実行時に import する **ネイティブ package** が `devDependencies` にあると、
// 本番 Lambda image (`Dockerfile.lambda` の prod-deps stage = `npm ci --omit=dev`) に入らず
// **本番でだけ** 落ちる。
//
// 実害 (2026-09-13、本番): `src/lib/server/security/file-sanitizer.ts` が動的 import する
// `sharp` が devDependencies にあり、`npm ci --omit=dev` が platform binary
// (`@img/sharp-linuxmusl-arm64`、lock で `dev: true`) を落としたため、
// アバター画像のアップロードが常に 500。
//   Could not load the "sharp" module using the linuxmusl-arm64 runtime
//
// **CI では出ない**: unit / e2e / storybook はいずれも dev 依存が入った環境で走る。
// NUC (`Dockerfile`) も `npm ci`（dev 込み）なので通る。落ちるのは Lambda だけ。
// よってこの class は「実行環境の依存集合の差」でしか検出できず、fitness function で塞ぐ。
//
// 【なぜ「ネイティブ package」に限るか】
// `svelte` / `@sveltejs/kit` のような framework は Vite が build 時に bundle するため
// devDependencies のままで正しい。一方 platform 固有バイナリを持つ package は bundle できず、
// 必ず実行環境の node_modules に実体が要る。**bundle 可否が dependencies 要否を決める**ので、
// 判定は「lock 上で cpu / os / libc 制約付きの成果物を持つか」で行う。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (tests/CLAUDE.md §「repo 走査 test」#4085)。src 全体を読むため明示 timeout。
vi.setConfig({ testTimeout: 60_000 });

const ROOT = join(__dirname, '../../..');

type LockPackage = {
	cpu?: string[];
	os?: string[];
	libc?: string[];
	optionalDependencies?: Record<string, string>;
};

function collectFiles(dir: string, exts: string[]): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectFiles(full, exts));
		} else if (exts.some((e) => entry.name.endsWith(e))) {
			out.push(full);
		}
	}
	return out;
}

/** lock 上で「platform 固有の成果物を持つ = bundle できない」package 名の集合を作る。 */
function collectNativePackages(lock: { packages: Record<string, LockPackage> }): Set<string> {
	const platformSpecific = new Set<string>();
	for (const [path, meta] of Object.entries(lock.packages)) {
		if (!path.startsWith('node_modules/')) continue;
		if (meta.cpu || meta.os || meta.libc) {
			platformSpecific.add(path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length));
		}
	}
	// platform 固有 package を optionalDependencies に持つ親 (sharp 等) が実際の import 先。
	const native = new Set<string>();
	for (const [path, meta] of Object.entries(lock.packages)) {
		if (!path.startsWith('node_modules/')) continue;
		const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
		if (platformSpecific.has(name)) {
			native.add(name);
			continue;
		}
		const optional = Object.keys(meta.optionalDependencies ?? {});
		if (optional.length > 0 && optional.some((dep) => platformSpecific.has(dep))) {
			native.add(name);
		}
	}
	return native;
}

/** `import ... from 'pkg'` / `await import('pkg')` / `require('pkg')` の bare specifier を拾う。 */
const IMPORT_PATTERNS = [
	/(?:^|[^\w.])import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
	/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** bare specifier から package 名を取る (`@scope/name/sub` → `@scope/name`)。相対 / alias / node: は除外。 */
function toPackageName(spec: string): string | null {
	if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('$')) return null;
	if (spec.startsWith('node:')) return null;
	const parts = spec.split('/');
	return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] ?? null);
}

/** `source` 内の import/require 呼び出しから、dev 専用 native package への参照だけを拾う。 */
function findDevOnlyNativeImports(
	source: string,
	native: Set<string>,
	dev: Set<string>,
	prod: Set<string>,
): string[] {
	const found = new Set<string>();
	for (const pattern of IMPORT_PATTERNS) {
		pattern.lastIndex = 0;
		let m = pattern.exec(source);
		while (m !== null) {
			const name = m[1] ? toPackageName(m[1]) : null;
			if (name && native.has(name) && dev.has(name) && !prod.has(name)) {
				found.add(name);
			}
			m = pattern.exec(source);
		}
	}
	return [...found];
}

describe('#4954 src/** が import するネイティブ package は dependencies にある', () => {
	it('devDependencies にしか無いネイティブ package を src/** が import していない', () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf-8')) as {
			packages: Record<string, LockPackage>;
		};

		const prod = new Set(Object.keys(pkg.dependencies ?? {}));
		const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
		const native = collectNativePackages(lock);

		// guard: 判定器が壊れて空集合になったら、この test は何も守らなくなる
		expect(
			native.size,
			'lock から native package を 1 件も抽出できていない (判定器の破損)',
		).toBeGreaterThan(0);

		const files = collectFiles(join(ROOT, 'src'), ['.ts', '.js', '.svelte']).filter(
			(f) => !f.includes('.stories.') && !f.includes('.test.') && !f.includes('.spec.'),
		);

		const violations = files.flatMap((file) => {
			const source = readFileSync(file, 'utf-8');
			const relPath = file.slice(ROOT.length + 1).replace(/\\/g, '/');
			return findDevOnlyNativeImports(source, native, dev, prod).map(
				(name) => `${relPath} → ${name}`,
			);
		});

		expect(
			[...new Set(violations)].sort(),
			'src/** が import するネイティブ package は dependencies に置くこと。' +
				'devDependencies のままだと Lambda image (npm ci --omit=dev) から platform binary が' +
				'欠落し、CI 全緑のまま本番でだけ実行時エラーになる (#4954 の sharp と同型)。',
		).toEqual([]);
	});
});
