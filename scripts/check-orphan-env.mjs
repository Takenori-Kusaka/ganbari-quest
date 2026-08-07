#!/usr/bin/env node
/**
 * scripts/check-orphan-env.mjs (EPIC #2362 follow-up)
 *
 * .env.example で定義 (またはコメントアウトで記載) されている env var について、
 * src/ / scripts/ / infra/ / tests/ から参照ゼロのものを検出する。
 *
 * 使用法:
 *   node scripts/check-orphan-env.mjs              # CI mode
 *   node scripts/check-orphan-env.mjs --report     # 詳細 report
 *   node scripts/check-orphan-env.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/env.json
 *
 * 検出ロジック:
 *   1. .env.example から `<NAME>=...` パターンを抽出 (コメント `#` 含む)
 *   2. 各 NAME について `process.env.<NAME>` / `env.<NAME>` / `$env/<dynamic|static>` 内の参照を集計
 *   3. 参照 0 件 = orphan candidate
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	loadBaseline,
	parseArgs,
	REPO_ROOT,
	reportFindings,
	walkDir,
} from './lib/ci/orphan-utils.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
const SEARCH_DIRS = ['src', 'scripts', 'infra', 'tests'];
export const SEARCH_EXTENSIONS = [
	'.ts',
	'.svelte',
	'.mjs',
	'.js',
	'.cjs',
	'.json',
	'.yml',
	'.yaml',
	// #4408: shell script からしか参照されない env (scripts/deploy.sh 等の
	// `${NAME:?...}`) を dead 判定しないため。baseline 登録での回避は
	// 「shell 単独参照の env が全部 baseline 行き」になり本物の dead env と
	// 区別できなくなるため不可。
	'.sh',
];

// orphan-baselines / orphan-audit ドキュメントは self-reference 除外
const EXCLUDE_PATTERNS = [
	/scripts[\\/]orphan-baselines[\\/]/,
	/docs[\\/]operations[\\/]orphan-audit-/,
];

/**
 * env 参照を探す対象ファイルを列挙する。
 * SEARCH_DIRS (src / scripts / infra / tests) + .github/workflows。
 */
export function collectSearchFiles(rootDir = REPO_ROOT) {
	const searchFiles = [];
	for (const d of SEARCH_DIRS) {
		const full = path.join(rootDir, d);
		if (fs.existsSync(full)) {
			searchFiles.push(
				...walkDir(full, { extensions: SEARCH_EXTENSIONS, excludePatterns: EXCLUDE_PATTERNS }),
			);
		}
	}
	// .github/workflows も対象 (GitHub Actions が env を渡すパスがある)
	const wfDir = path.join(rootDir, '.github', 'workflows');
	if (fs.existsSync(wfDir)) {
		searchFiles.push(...walkDir(wfDir, { extensions: ['.yml', '.yaml'] }));
	}
	return searchFiles;
}

/**
 * 各 env var の参照ファイル数を数える。
 * Returns: Map<name, count>
 *
 * 精度の性質 (#4408): 判定は word boundary の substring 一致であり、**コメント行や
 * 文字列リテラル (shell の echo 案内文、TS のコメント等) も 1 参照として数える**。
 * つまり「実行時に読まれていないが名前だけ書かれている env」は dead と報告されない。
 * これは .sh に限らず全拡張子に元からある性質で、shell parse / AST 解析を持ち込むより
 * 誤検出ゼロ側に倒す方が Pre-PMF では妥当という判断 (ADR-0010)。
 * 裏返しの罠として、**撤去済みの識別子をコメントに literal で書くと guard が自分で
 * 自分を無効化する** (同種の実例: src/lib/domain/terms.ts の注記)。
 */
export function countEnvReferences(envVars, files) {
	const refCount = new Map();
	for (const v of envVars) refCount.set(v, 0);

	for (const file of files) {
		let text;
		try {
			text = fs.readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		for (const v of envVars) {
			if (!text.includes(v)) continue;
			// boundary check: 前後が word 文字ではない
			const re = new RegExp(`\\b${v}\\b`);
			if (re.test(text)) refCount.set(v, (refCount.get(v) || 0) + 1);
		}
	}
	return refCount;
}

export function extractEnvVars(text) {
	// `<NAME>=...` (行頭 + コメント prefix `#` 付きも含む)
	const re = /^(?:#\s*)?([A-Z][A-Z0-9_]+)\s*=/gm;
	const out = new Set();
	for (const m of text.matchAll(re)) {
		out.add(m[1]);
	}
	return [...out].sort();
}

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('env');

	if (!fs.existsSync(ENV_EXAMPLE)) {
		process.stderr.write(`[check-orphan-env] .env.example not found at ${ENV_EXAMPLE}\n`);
		process.exit(1);
	}
	const envText = fs.readFileSync(ENV_EXAMPLE, 'utf8');
	const envVars = extractEnvVars(envText);

	if (envVars.length === 0) {
		process.stdout.write('[check-orphan-env] no env vars found in .env.example\n');
		process.exit(0);
	}

	const searchFiles = collectSearchFiles();
	// 各 env var について `process.env.<NAME>` / `env.<NAME>` / `$env/static/<NAME>` / `${<NAME>}` 参照を集計
	const refCount = countEnvReferences(envVars, searchFiles);

	const findings = envVars
		.map((v) => {
			if ((refCount.get(v) || 0) === 0) {
				return {
					name: v,
					reason: `env var "${v}" は .env.example に記載されていますが、source code / scripts / infra / tests / workflows から参照されていません。dead env の可能性。`,
					locations: [],
					allowlisted: baseline.allowed.includes(v),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('env', findings, { mode, baseline });
	process.exit(exit);
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
	main();
}
