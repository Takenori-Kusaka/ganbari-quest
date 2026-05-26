#!/usr/bin/env node
/**
 * scripts/check-skip-deadlines.mjs (EPIC #2362 follow-up / ADR-0006 強化)
 *
 * tests/ 配下の `.skip` / `.skipIf` / `it.skip` / `describe.skip` 等について、
 * 直前 (-3 行) or 直後 (+1 行) の comment に「Issue # / deadline / owner」の
 * いずれかが含まれているかを検証する。
 *
 * メタデータ欠落 skip = 永久放置リスクが高い test、ADR-0006 違反候補。
 *
 * 使用法:
 *   node scripts/check-skip-deadlines.mjs              # CI mode
 *   node scripts/check-skip-deadlines.mjs --report     # 詳細 report
 *   node scripts/check-skip-deadlines.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/skip-deadlines.json
 *
 * 検出ロジック:
 *   1. tests/ 配下 *.ts / *.spec.ts / *.mjs / *.test.mjs を walk
 *   2. `it.skip\b|describe.skip\b|test.skip\b|.skipIf\b|it.todo\b` を含む行を見つける
 *   3. 直前 3 行 + 直後 1 行内 comment (// or block) に `#\d+` / `\d{4}-\d{2}-\d{2}` /
 *      `@owner` / `TODO:.*@` の存在を確認
 *   4. メタデータゼロ = violation
 *
 * baseline 形式: file 単位の violation 件数許容 (line 番号は変動しやすい)
 *   { "allowed": { "tests/e2e/foo.spec.ts": 3 } } のように記載
 *   実際の検出数 <= 許容数 なら PASS、超過したら新規 violation として block
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

const TEST_DIRS = ['tests', 'src'];
const TEST_EXTENSIONS = ['.ts', '.mjs', '.spec.ts', '.test.ts', '.test.mjs'];
const SKIP_RE = /\b(?:it|test|describe)\.(?:skip|todo)\b|\.skipIf\b/;

// metadata patterns: Issue 参照 / ISO 日付 / @owner / TODO[: ]@
const META_PATTERNS = [
	/#\d+/, // GitHub issue
	/\d{4}-\d{2}-\d{2}/, // ISO date (deadline / 起票日)
	/@\w+/, // @owner
	/TODO\s*[:(]\s*\w+/i, // TODO(name) or TODO: name
	/FIXME\s*[:(]\s*\w+/i, // FIXME
	/deadline/i,
	/owner/i,
];

function hasMetadata(line) {
	return META_PATTERNS.some((p) => p.test(line));
}

function isCommentLine(line) {
	const trimmed = line.trim();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('/*') ||
		trimmed.startsWith('*') ||
		trimmed.startsWith('<!--') ||
		trimmed.startsWith('#')
	);
}

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('skip-deadlines');

	const files = [];
	for (const d of TEST_DIRS) {
		const full = path.join(REPO_ROOT, d);
		if (fs.existsSync(full)) {
			files.push(...walkDir(full, { extensions: TEST_EXTENSIONS }));
		}
	}

	const findings = [];
	for (const file of files) {
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		const text = fs.readFileSync(file, 'utf8');
		if (!SKIP_RE.test(text)) continue;
		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!SKIP_RE.test(line)) continue;

			// 直前 3 行 + 自分 + 直後 1 行 で metadata を探す
			const start = Math.max(0, i - 3);
			const end = Math.min(lines.length - 1, i + 1);
			let metaFound = false;
			for (let j = start; j <= end; j++) {
				const l = lines[j];
				// metadata はコメント行に書かれている前提 (skip 行自身は除外、ただし skip 行に
				// inline comment があれば許容)
				if (j === i) {
					// 同行 inline comment (`// #123 ...`) は許容
					const inline = l.match(/\/\/\s*(.+)$/);
					if (inline && hasMetadata(inline[1])) {
						metaFound = true;
						break;
					}
					continue;
				}
				if (isCommentLine(l) && hasMetadata(l)) {
					metaFound = true;
					break;
				}
			}

			if (!metaFound) {
				findings.push({
					file: rel,
					line: i + 1,
				});
			}
		}
	}

	// baseline は file 単位の許容件数で管理 (line 番号変動を吸収)
	// baseline.allowed: ["tests/e2e/foo.spec.ts:3"] = file foo.spec.ts は 3 件まで許容
	const allowedMap = new Map();
	for (const entry of baseline.allowed) {
		const m = entry.match(/^(.+):(\d+)$/);
		if (m) allowedMap.set(m[1], Number(m[2]));
	}

	const byFile = new Map();
	for (const f of findings) {
		const cur = byFile.get(f.file) || [];
		cur.push(f);
		byFile.set(f.file, cur);
	}

	const reportFindingsList = [];
	for (const [file, list] of byFile) {
		const allowed = allowedMap.get(file) || 0;
		const overage = list.length - allowed;
		if (overage > 0) {
			for (const f of list.slice(0, overage)) {
				reportFindingsList.push({
					name: `${file}:${f.line}`,
					reason: `${file} に metadata-less .skip/.todo が ${list.length} 件存在 (baseline 許容: ${allowed} 件)。差分 ${overage} 件で hard fail。直前 3 行 or 同行 inline comment に Issue # / deadline / @owner を追加必須 (ADR-0006)。`,
					locations: list.map((x) => `${file}:${x.line}`),
					allowlisted: false,
				});
			}
		} else {
			// 全件 allowlisted (件数余裕あり)
			for (const f of list) {
				reportFindingsList.push({
					name: `${file}:${f.line}`,
					reason: `${file} 内の metadata-less skip (baseline ${list.length}/${allowed} 件、新規違反 0)`,
					locations: [`${file}:${f.line}`],
					allowlisted: true,
				});
			}
		}
	}

	const exit = reportFindings('skip-deadlines', reportFindingsList, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-skip-deadlines.mjs');
if (isMain) {
	main();
}
