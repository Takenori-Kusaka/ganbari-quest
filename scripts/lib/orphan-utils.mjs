/**
 * scripts/lib/orphan-utils.mjs (EPIC #2362 follow-up — 構造的予防)
 *
 * 10 種類の orphan detection script で共有するユーティリティ。
 *  - REPO_ROOT 解決
 *  - file walker (gitignore-aware ではない、対象 dir 限定)
 *  - regex helper (escape / exact match)
 *  - baseline JSON loader (allowlist 機構)
 *  - CLI args parser (--report / --update-baseline / --check)
 *  - 結果 print (sorted, deterministic)
 *
 * 各 script 共通の "exit 0 if clean, exit 1 if new orphan" 仕様を実装。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// REPO_ROOT 解決 — scripts/lib/ から 2 階層上
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * CLI 引数を parse する。
 * Returns: { report: bool, updateBaseline: bool, check: bool, raw: string[] }
 */
export function parseArgs(argv) {
	const args = argv.slice(2);
	return {
		report: args.includes('--report'),
		updateBaseline: args.includes('--update-baseline'),
		check:
			args.includes('--check') ||
			(!args.includes('--report') && !args.includes('--update-baseline')),
		raw: args,
	};
}

/**
 * baseline JSON を読み込む。存在しなければ空の allowlist を返す。
 * Schema: { allowed: string[], reasons?: Record<string, string>, version?: string }
 */
export function loadBaseline(category) {
	const baselinePath = path.join(REPO_ROOT, 'scripts', 'orphan-baselines', `${category}.json`);
	if (!fs.existsSync(baselinePath)) {
		return { allowed: [], reasons: {}, version: '1.0.0', path: baselinePath };
	}
	const text = fs.readFileSync(baselinePath, 'utf8');
	const parsed = JSON.parse(text);
	return {
		allowed: parsed.allowed || [],
		reasons: parsed.reasons || {},
		version: parsed.version || '1.0.0',
		path: baselinePath,
	};
}

/**
 * baseline JSON を書き出す (`--update-baseline` 時のみ呼ばれる)。
 */
export function saveBaseline(category, data) {
	const baselinePath = path.join(REPO_ROOT, 'scripts', 'orphan-baselines', `${category}.json`);
	const out = {
		allowed: [...new Set(data.allowed)].sort(),
		reasons: data.reasons || {},
		version: data.version || '1.0.0',
		generated: new Date().toISOString(),
	};
	fs.writeFileSync(baselinePath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
	return baselinePath;
}

/**
 * 指定 dir 配下のファイルを再帰列挙。
 * - extensions: ['.ts', '.svelte'] のように指定
 * - excludePatterns: RegExp[] (relative path に対して test)
 */
export function walkDir(dir, options = {}) {
	const { extensions = null, excludePatterns = [] } = options;
	const out = [];
	if (!fs.existsSync(dir)) return out;
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		let entries;
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
			if (excludePatterns.some((p) => p.test(rel))) continue;
			if (entry.isDirectory()) {
				// node_modules / .git 等は無条件 skip
				if (
					entry.name === 'node_modules' ||
					entry.name === '.git' ||
					entry.name === 'dist' ||
					entry.name === 'build' ||
					entry.name === '.svelte-kit'
				)
					continue;
				stack.push(full);
			} else if (entry.isFile()) {
				if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
					out.push(full);
				}
			}
		}
	}
	return out.sort();
}

/**
 * 文字列を regex 用に escape する。
 */
export function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 結果 print + exit。
 *  - clean (新規 orphan 0): exit 0
 *  - new orphan あり: exit 1 (CI 用)
 *  - --report mode: 全件詳細表示 (allowlist + 新規) して exit 0
 *  - --update-baseline mode: baseline 更新して exit 0
 *
 * options.findings: Array<{ name, reason, locations?, allowlisted: bool }>
 */
export function reportFindings(category, findings, options) {
	const { mode, baseline } = options;
	const allowlisted = findings.filter((f) => f.allowlisted);
	const newOrphans = findings.filter((f) => !f.allowlisted);

	if (mode === 'update-baseline') {
		const newAllowed = newOrphans.map((f) => f.name);
		const allAllowed = [...baseline.allowed, ...newAllowed];
		const newReasons = { ...baseline.reasons };
		for (const f of newOrphans) {
			newReasons[f.name] = f.reason || 'auto-added by --update-baseline';
		}
		const savedPath = saveBaseline(category, {
			allowed: allAllowed,
			reasons: newReasons,
			version: baseline.version,
		});
		process.stdout.write(
			`[check-orphan-${category}] baseline updated: ${path.relative(REPO_ROOT, savedPath)}\n`,
		);
		process.stdout.write(`  added ${newOrphans.length} new entries\n`);
		for (const f of newOrphans) {
			process.stdout.write(`    - ${f.name}: ${f.reason || '(no reason)'}\n`);
		}
		return 0;
	}

	if (mode === 'report') {
		process.stdout.write(`# orphan-${category} report\n\n`);
		process.stdout.write(`Total findings: ${findings.length}\n`);
		process.stdout.write(`  allowlisted (baseline): ${allowlisted.length}\n`);
		process.stdout.write(`  new orphans (would block CI): ${newOrphans.length}\n\n`);
		if (newOrphans.length > 0) {
			process.stdout.write(`## NEW ORPHANS (not in baseline)\n\n`);
			for (const f of newOrphans) {
				process.stdout.write(`- ${f.name}\n`);
				if (f.reason) process.stdout.write(`  reason: ${f.reason}\n`);
				if (f.locations && f.locations.length > 0) {
					for (const loc of f.locations) process.stdout.write(`  at: ${loc}\n`);
				}
			}
			process.stdout.write('\n');
		}
		if (allowlisted.length > 0) {
			process.stdout.write(`## ALLOWLISTED (in baseline, won't block)\n\n`);
			for (const f of allowlisted) {
				const r = baseline.reasons[f.name] || '(no recorded reason)';
				process.stdout.write(`- ${f.name}: ${r}\n`);
			}
		}
		return 0;
	}

	// check mode (default)
	if (newOrphans.length === 0) {
		process.stdout.write(
			`[check-orphan-${category}] OK — ${findings.length} known orphan(s) all in baseline\n`,
		);
		return 0;
	}
	process.stderr.write(
		`[check-orphan-${category}] NG — ${newOrphans.length} NEW orphan(s) detected (not in baseline):\n\n`,
	);
	for (const f of newOrphans) {
		process.stderr.write(`  - ${f.name}\n`);
		if (f.reason) process.stderr.write(`    reason: ${f.reason}\n`);
		if (f.locations && f.locations.length > 0) {
			for (const loc of f.locations) process.stderr.write(`    at: ${loc}\n`);
		}
	}
	process.stderr.write('\n対応方針:\n');
	process.stderr.write('  1. 本当に未使用なら参照を復活させる / または削除する (cleanup PR)\n');
	process.stderr.write('  2. Pre-PMF Bucket B 等で意図的に残す場合は baseline に追加:\n');
	process.stderr.write(`     node scripts/check-orphan-${category}.mjs --update-baseline\n`);
	process.stderr.write('     その後 baseline JSON に "reasons" を編集し PR 経由で commit する。\n');
	return 1;
}

/**
 * 既知の "uses-detection" 用 helper:
 *   ファイル群を走査し、各 needle (識別子) ごとに「needle が現れる file:line」を集計する。
 *
 * Returns: Map<needle, Array<{ file: string, line: number, snippet: string }>>
 */
export function collectReferences(needles, files, options = {}) {
	const { boundary = true, ignoreSelf = null } = options;
	const out = new Map();
	for (const n of needles) out.set(n, []);

	const patterns = needles.map((n) => ({
		needle: n,
		regex: boundary ? new RegExp(`\\b${escapeRegex(n)}\\b`) : new RegExp(escapeRegex(n)),
	}));

	for (const file of files) {
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		if (ignoreSelf?.has(rel)) continue;
		let text;
		try {
			text = fs.readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		// 高速 path: ファイル全体に 1 needle も含まれていなければ早期 break
		const hasAny = patterns.some((p) => text.includes(p.needle));
		if (!hasAny) continue;
		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			for (const p of patterns) {
				if (p.regex.test(line)) {
					out.get(p.needle).push({
						file: rel,
						line: i + 1,
						snippet: line.trim().slice(0, 140),
					});
				}
			}
		}
	}
	return out;
}

/**
 * "file をどこから import されているか" を集計する helper。
 * - targetFiles: 各 file の relative path
 * - searchFiles: import 元として探す候補 (TS / Svelte / mjs etc.)
 *
 * Returns: Map<targetRel, Array<{ file: string, line: number, snippet: string }>>
 *
 * NOTE: 文字列マッチ + boundary check のシンプル実装。AST parse はしない (Pre-PMF コスト)。
 *       false positive (コメント内 import 等) は許容範囲、新規 orphan の hard fail のため
 *       allowlist + baseline 機構で回避する設計。
 */
export function collectFileImports(targetFiles, searchFiles, _options = {}) {
	// NOTE: `_options` は将来 `stripExt` 等の細粒度オプションを再導入する余地を残しているが
	// 現状の実装では basename matching が一律 stripExt=true 相当の挙動になっているため未使用。
	const needles = targetFiles.map((t) => {
		// e.g. 'src/lib/server/services/foo-service.ts'
		const base = path.basename(t, path.extname(t));
		// 検索 needle として使うのは file basename (foo-service)
		return { full: t, basename: base };
	});

	const out = new Map();
	for (const t of targetFiles) out.set(t, []);

	const basenameSet = new Set(needles.map((n) => n.basename));

	for (const file of searchFiles) {
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		// 自分自身からの参照は除外
		let text;
		try {
			text = fs.readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		// 高速 path: ファイル全体に basename が 1 つも含まれていなければ skip
		let anyHit = false;
		for (const bn of basenameSet) {
			if (text.includes(bn)) {
				anyHit = true;
				break;
			}
		}
		if (!anyHit) continue;

		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// import / from 行のみを対象 (誤検出抑制)
			if (!/\b(import|from|require)\b/.test(line)) continue;
			for (const n of needles) {
				if (n.full === rel) continue; // self skip
				if (line.includes(n.basename)) {
					// boundary check: basename の前後が word 構成文字でない
					const idx = line.indexOf(n.basename);
					const before = idx > 0 ? line.charAt(idx - 1) : '';
					const after = line.charAt(idx + n.basename.length) || '';
					const wordChar = /[A-Za-z0-9_]/;
					if (wordChar.test(before) || wordChar.test(after)) continue;
					out.get(n.full).push({
						file: rel,
						line: i + 1,
						snippet: line.trim().slice(0, 140),
					});
				}
			}
		}
	}
	return out;
}
