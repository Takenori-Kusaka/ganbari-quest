#!/usr/bin/env node
/**
 * scripts/check-dynamodb-stub.mjs (#1021, 起源 PR #1017 from #1012)
 *
 * src/lib/server/db/dynamodb/*.ts 配下の stub / no-op / TODO 実装を検出し、
 * 本番マージを自動ブロックする。
 *
 * 背景:
 *   PR #993 (#820 PR-B) と PR #1003 (#804) で DynamoDB 実装を意図的に no-op stub
 *   のまま merge し、本番で /ops 監査ログが一切記録されない障害 (#1009) が発生。
 *   PO 方針は「main マージ = 即本番デプロイ = 即顧客提供」。
 *
 * ADR-0034 との関係:
 *   Pre-PMF では「採用しない」機能（汎用監査ログ / ブルート検知 等）もある。
 *   本 CI ルールは「interface を追加した機能 = DynamoDB 実装も完成させる」原則の強制であり、
 *   ADR-0034 で不採用とされた機能は interface 自体を追加しない（＝ stub が残らない）前提。
 *
 * 検出パターン:
 *   1. 関数本体が `return []` / `return undefined` / `return null` のみ（空配列返し）
 *   2. コメントに `// TODO` / `// stub` / `// no-op` / `// 仮実装`
 *   3. `throw new Error('not implemented')` 類
 *
 * 使用法: node scripts/check-dynamodb-stub.mjs
 * CI: エラー検出時は exit 1
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(REPO_ROOT, 'src/lib/server/db/dynamodb');

/**
 * 許容される (誤検知となる) ファイル名 — 定数・型・クライアント定義のみのファイル
 */
const ALLOW_LIST = new Set([
	'client.ts',
	'keys.ts',
	'auth-keys.ts',
	'counter.ts',
	'bulk-delete.ts',
]);

/**
 * 既知の未実装 stub (grandfathered)
 * 本 CI 導入時点で既に本番稼働している stub。follow-up Issue で順次 eradicate する。
 * 新規追加は厳禁。このリストにファイルを増やす PR は自動で reject すること。
 *
 * Format: 'filename.ts' → follow-up Issue 番号
 */
const GRANDFATHERED_STUBS = new Map([
	['evaluation-repo.ts', 1014], // rest days 機能: follow-up Issue #1014
	['message-repo.ts', 1015], // parent messages 機能: follow-up Issue #1015
	['trial-history-repo.ts', 1016], // trial history 機能: follow-up Issue #1016
]);

/**
 * 検出パターン
 */
const STUB_COMMENT_PATTERNS = [
	/\/\/\s*TODO\b/i,
	/\/\/\s*stub\b/i,
	/\/\/\s*no[- ]?op\b/i,
	/\/\/\s*仮実装/,
	/\/\/\s*stub\s*[:：]/,
	/\/\/\s*後続\s*PR/,
	/\/\/\s*follow[- ]?up/i,
];

const NOT_IMPLEMENTED_PATTERN =
	/throw\s+new\s+Error\(\s*['"`](not\s+implemented|未実装|unimplemented)/i;

/**
 * export async function xxx(...): ... {
 *   return [];
 * }
 * のような空実装を検出する
 */
const EMPTY_RETURN_FN_PATTERN =
	/export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*:\s*[^{]+\{\s*return\s+(\[\]|undefined|null|\{\})\s*;?\s*\}/g;

function collectFiles(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectFiles(full, out);
		} else if (entry.isFile() && entry.name.endsWith('.ts')) {
			if (ALLOW_LIST.has(entry.name)) continue;
			if (GRANDFATHERED_STUBS.has(entry.name)) continue;
			out.push(full);
		}
	}
	return out;
}

function checkFile(filePath) {
	const text = fs.readFileSync(filePath, 'utf8');
	const rel = path.relative(REPO_ROOT, filePath);
	const findings = [];

	// 1. stub 系コメント検出
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const pat of STUB_COMMENT_PATTERNS) {
			if (pat.test(line)) {
				findings.push({
					file: rel,
					line: i + 1,
					kind: 'stub-comment',
					snippet: line.trim().slice(0, 140),
				});
				break;
			}
		}
		if (NOT_IMPLEMENTED_PATTERN.test(line)) {
			findings.push({
				file: rel,
				line: i + 1,
				kind: 'not-implemented-throw',
				snippet: line.trim().slice(0, 140),
			});
		}
	}

	// 2. 空実装関数検出
	for (const m of text.matchAll(EMPTY_RETURN_FN_PATTERN)) {
		const fnName = m[1];
		const upToMatch = text.slice(0, m.index);
		const lineNum = upToMatch.split(/\r?\n/).length;
		findings.push({
			file: rel,
			line: lineNum,
			kind: 'empty-return-fn',
			snippet: `export function ${fnName}(...) { return ${m[2]}; }`,
		});
	}

	return findings;
}

function main() {
	const files = collectFiles(TARGET_DIR);
	const allFindings = [];
	for (const f of files) {
		allFindings.push(...checkFile(f));
	}

	if (allFindings.length === 0) {
		console.log('[check-dynamodb-stub] OK — stub / TODO / 空実装なし');
		process.exit(0);
	}

	console.error(
		`[check-dynamodb-stub] NG — ${allFindings.length} 件の DynamoDB stub 実装を検出しました:\n`,
	);
	for (const f of allFindings) {
		console.error(`  [${f.kind}] ${f.file}:${f.line}`);
		console.error(`    ${f.snippet}\n`);
	}
	console.error(
		'\nPO 方針: main マージ = 即本番デプロイ = 即顧客提供。\n' +
			'interface を追加した PR で SQLite + DynamoDB 両実装を完成させてください。\n' +
			'Pre-PMF で不採用の機能は interface 自体を追加しないこと（ADR-0034）。\n' +
			'詳細: docs/sessions/dev-session.md 「段階的リリース禁止」セクション / docs/decisions/0034-pre-pmf-security-minimum.md',
	);
	process.exit(1);
}

main();
