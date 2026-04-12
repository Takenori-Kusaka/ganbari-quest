#!/usr/bin/env node
/**
 * ADR-0029: Safety Assertion Erosion Ban — 新規 env / secret 追加チェック
 *
 * PR diff から新規必須環境変数の追加（assert*Configured / throw new Error('...required...')
 * / process.env.X || ... throw）を検出し、PR 本文に「配布済み: 証跡」が無ければ exit 1。
 *
 * 設計方針:
 * - 既存の scripts/check-coverage-threshold.js のパターンを踏襲（ESM, ノード組み込みのみ）
 * - 検出対象は src/** のみ（tests/** / scripts/** / docs/** は除外して false positive を抑制）
 * - PR_BODY 環境変数から PR 本文を受け取る（CI: ${{ github.event.pull_request.body }}）
 *   ローカル実行時は PR_BODY 未設定でも警告のみ（exit 0）でレビュアー手動確認を促す
 *
 * Usage:
 *   PR_BODY="$(gh pr view 914 --json body -q .body)" node scripts/check-new-required-env.mjs
 *
 * Environment:
 *   PR_BODY     PR 本文。CI では GitHub Actions が自動で渡す
 *   BASE_REF    比較対象の ref（既定: origin/main）
 *
 * Exit codes:
 *   0 — 検出なし、または検出したすべての env に配布証跡あり
 *   1 — 配布証跡が無い env が検出された
 */

import { execFileSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'origin/main';

/**
 * git diff を取得（src/** のみ、テスト・スクリプト・ドキュメントは除外）
 * @returns {string} 統一 diff 形式
 */
function getDiff() {
	try {
		return execFileSync(
			'git',
			[
				'diff',
				`${BASE_REF}...HEAD`,
				'--',
				'src',
				':!src/**/*.test.ts',
				':!src/**/*.spec.ts',
				':!src/**/__tests__/**',
			],
			{ encoding: 'utf-8', maxBuffer: 50_000_000 },
		);
	} catch {
		return '';
	}
}

/**
 * 検出パターン定義。
 * 各エントリは { name, regex } で、added line（diff の `+` 行）に対してマッチを試みる。
 */
const DETECTION_PATTERNS = [
	{
		name: 'assert*Configured(',
		regex: /\bassert([A-Z]\w*)Configured\s*\(/,
	},
	{
		name: "throw new Error('...required...')",
		regex: /throw\s+new\s+Error\s*\(\s*[`'"][^`'"]*\brequired\b/i,
	},
	{
		name: 'process.env.X || ... throw',
		regex: /process\.env\.[A-Z][A-Z0-9_]+\s*\|\|\s*[^;]*\bthrow\b/,
	},
];

/**
 * added line から env 名候補を全て抽出する。
 *
 * 抽出ソース:
 *   1. `process.env.ENV_NAME` 直接参照
 *   2. 文字列リテラル内の SCREAMING_SNAKE_CASE トークン
 *      （env が wrapper 経由で参照される場合に env 名がエラーメッセージや log に残る）
 *
 * 単独の SCREAMING（ERROR/JSON/HTTP 等）は false positive の温床なので、
 * **アンダースコアを含むトークン**のみを env 名候補とみなす（NODE_ENV / AWS_LICENSE_SECRET / etc）。
 *
 * 過検出は許容方針: false positive が出ても PR 本文に「配布済み: <ENV_NAME>」を
 * 1 行追加すれば green になるため、レビュアーにとっては low cost。一方で
 * env を見落として本番で throw する事故 (#911) は high cost。
 */
function extractEnvNames(line) {
	const names = new Set();

	// (1) process.env.X 直接参照
	const directRe = /process\.env\.([A-Z][A-Z0-9_]+)/g;
	let m;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
	while ((m = directRe.exec(line)) !== null) {
		names.add(m[1]);
	}

	// (2) 文字列リテラル内の SCREAMING_SNAKE_CASE 抽出（アンダースコア必須）
	//     `'...'` / `"..."` / `` `...` `` を全て対象にする
	const stringLiteralRe = /(['"`])((?:\\.|(?!\1).)*)\1/g;
	let lit;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
	while ((lit = stringLiteralRe.exec(line)) !== null) {
		const inside = lit[2];
		const screamingRe = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g;
		let s;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
		while ((s = screamingRe.exec(inside)) !== null) {
			names.add(s[1]);
		}
	}

	return names;
}

/**
 * diff を解析して、検出パターンにマッチした added line を含むファイルの
 * 全 added line から env 名を抽出する。
 *
 * グルーピングを「ファイル単位」にすることで、assertion の宣言と env 名チェックが
 * 別 hunk に分かれていても確実に検出できる（false negative を抑制）。
 * 検出対象は src/** のみに git pathspec で限定済みのため、false positive は限定的。
 */
function detectNewRequiredEnvs(diff) {
	if (!diff.trim()) return new Set();

	const lines = diff.split('\n');
	const detectedEnvs = new Set();

	// ファイルごとに added line をグルーピング（diff --git a/... b/... が境界）
	const fileBlocks = [];
	let currentFileLines = [];
	for (const line of lines) {
		if (line.startsWith('diff --git ')) {
			if (currentFileLines.length > 0) {
				fileBlocks.push(currentFileLines);
			}
			currentFileLines = [];
			continue;
		}
		if (line.startsWith('+') && !line.startsWith('+++')) {
			currentFileLines.push(line.slice(1));
		}
	}
	if (currentFileLines.length > 0) {
		fileBlocks.push(currentFileLines);
	}

	for (const fileLines of fileBlocks) {
		// このファイル内の added line に検出パターンマッチがあるか
		const fileHasMatch = fileLines.some((l) =>
			DETECTION_PATTERNS.some(({ regex }) => regex.test(l)),
		);
		if (!fileHasMatch) continue;

		// マッチがあれば、ファイル内の全 added line から env 名を抽出
		for (const l of fileLines) {
			for (const name of extractEnvNames(l)) {
				detectedEnvs.add(name);
			}
		}
	}

	return detectedEnvs;
}

/**
 * PR 本文に env 名の配布証跡が含まれているか検証する。
 *
 * 受理する記法:
 *   - `配布済み: ENV_NAME -> GitHub Secrets` のように、配布済みと env 名と配布先キーワードが
 *     同一行（または同一段落）に共存する
 *   - 配布先キーワード: GitHub Secrets / SSM / Parameter Store / NUC .env / .env.production
 */
function hasDistributionEvidence(prBody, envName) {
	if (!prBody) return false;
	// 配布済み + envName が近接していること（最大 200 文字以内）
	const proximityRe = new RegExp(`配布済み[\\s\\S]{0,200}${envName}|${envName}[\\s\\S]{0,200}配布済み`);
	if (!proximityRe.test(prBody)) return false;
	// 配布先キーワードが PR 本文のどこかにあること
	const destRe = /GitHub Secrets|SSM|Parameter Store|NUC\s*\.env|\.env\.production/;
	return destRe.test(prBody);
}

// === main ===

const diff = getDiff();
const detectedEnvs = detectNewRequiredEnvs(diff);

if (detectedEnvs.size === 0) {
	console.log('No new required env / safety assertions detected — OK');
	process.exit(0);
}

console.log(`Detected new required env(s): ${[...detectedEnvs].join(', ')}`);

const prBody = process.env.PR_BODY || '';
if (!prBody) {
	console.warn(
		'\nPR_BODY not set — assuming local run. The following envs would require distribution evidence in CI:',
	);
	for (const env of detectedEnvs) {
		console.warn(`  - ${env}`);
	}
	console.warn('\nIn CI, set PR_BODY="${{ github.event.pull_request.body }}".');
	process.exit(0);
}

const missing = [];
for (const env of detectedEnvs) {
	if (!hasDistributionEvidence(prBody, env)) {
		missing.push(env);
	}
}

if (missing.length > 0) {
	console.error('\nBLOCKED (ADR-0029): the following new required env(s) lack distribution evidence in the PR body:');
	for (const env of missing) {
		console.error(`  - ${env}`);
	}
	console.error(
		'\nAdd a "配布済み: <ENV_NAME> -> <配布先>" line to the PR body, where <配布先> is one of:',
	);
	console.error('  GitHub Secrets / SSM / Parameter Store / NUC .env / .env.production');
	console.error('\nSee: docs/decisions/0029-safety-assertion-erosion-ban.md');
	process.exit(1);
}

console.log('All detected envs have distribution evidence in PR body — OK');
process.exit(0);
