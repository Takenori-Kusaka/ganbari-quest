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
} from './lib/orphan-utils.mjs';

const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
const SEARCH_DIRS = ['src', 'scripts', 'infra', 'tests'];
const SEARCH_EXTENSIONS = ['.ts', '.svelte', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml'];

function extractEnvVars(text) {
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

	// search 対象 (orphan-baselines / orphan-audit ドキュメントは self-reference 除外)
	const EXCLUDE_PATTERNS = [
		/scripts[\\/]orphan-baselines[\\/]/,
		/docs[\\/]operations[\\/]orphan-audit-/,
	];
	const searchFiles = [];
	for (const d of SEARCH_DIRS) {
		const full = path.join(REPO_ROOT, d);
		if (fs.existsSync(full)) {
			searchFiles.push(
				...walkDir(full, { extensions: SEARCH_EXTENSIONS, excludePatterns: EXCLUDE_PATTERNS }),
			);
		}
	}
	// .github/workflows も対象 (GitHub Actions が env を渡すパスがある)
	const wfDir = path.join(REPO_ROOT, '.github', 'workflows');
	if (fs.existsSync(wfDir)) {
		searchFiles.push(...walkDir(wfDir, { extensions: ['.yml', '.yaml'] }));
	}

	// 各 env var について `process.env.<NAME>` / `env.<NAME>` / `$env/static/<NAME>` / `${<NAME>}` 参照を集計
	const refCount = new Map();
	for (const v of envVars) refCount.set(v, 0);

	for (const file of searchFiles) {
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

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-env.mjs');
if (isMain) {
	main();
}
