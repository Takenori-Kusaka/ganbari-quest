#!/usr/bin/env node
/**
 * scripts/check-cdk-replacement.mjs
 *
 * CDK diff の stdout を解析して Replacement / Destroy が必要なリソースを検出し、
 * 承認マーカーがない場合は exit 1 でデプロイを止める。
 *
 * Usage (deploy.yml から呼び出す):
 *   cdk diff ... 2>&1 | COMMIT_MSG="$(git log -1 --pretty=%B)" node scripts/check-cdk-replacement.mjs
 *
 * Approval (PR 本文またはコミットメッセージに記載):
 *   replacement-approved: LogicalId1,LogicalId2
 *
 * Ref: docs/decisions/0019-cdk-replacement-detection-gate.md (#1400)
 */

import * as readline from 'node:readline';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI エスケープコード検出に ESC 文字が必要
const ANSI_ESCAPE = /\x1b\[[0-9;]*[mGKHF]/g;

/**
 * CDK diff 出力行から ANSI エスケープコードを除去する
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
	return str.replace(ANSI_ESCAPE, '');
}

/**
 * CDK diff 出力行からリソースの論理 ID を抽出する
 * 形式: [~|+|-] AWS::Type LogicalId [CFHash] [(action)]
 * @param {string} line stripped line
 * @returns {string}
 */
export function extractLogicalId(line) {
	// トークン: [0]=[~], [1]=AWS::Type, [2]=LogicalId, [3]=CFHash (optional), [4+]=(action) (optional)
	const tokens = line.trim().split(/\s+/);
	// tokens[2] が存在しない場合は line 全体を返す
	return tokens[2] ?? line.trim();
}

/**
 * CDK diff の stdout 行リストを解析して Replacement/Destroy リソースを抽出する
 *
 * 検出パターン:
 *   - [-] AWS::Type LogicalId ... — リソース削除 (destroy)
 *   - [~] AWS::Type LogicalId ... (replace) / (replacement) — リソース置き換え
 *   - プロパティ行の (may cause replacement) / (requires replacement) / (REPLACEMENT)
 *
 * @param {string[]} lines
 * @returns {Map<string, string>} logicalId → reason
 */
export function detectReplacements(lines) {
	const replacements = new Map();
	let currentResourceId = null;

	for (const rawLine of lines) {
		const line = stripAnsi(rawLine).trimEnd();
		const trimmed = line.trim();

		if (!trimmed) {
			currentResourceId = null;
			continue;
		}

		// リソース行: [+|-|~] AWS::... (インデントなし)
		const resourceMatch = /^\[([+\-~])\]\s+(AWS::\S+)\s+(\S+)/.exec(trimmed);
		if (resourceMatch) {
			const marker = resourceMatch[1];
			const logicalId = resourceMatch[3];

			if (marker === '-') {
				// [-] = リソース削除
				replacements.set(logicalId, 'destroy');
				currentResourceId = logicalId;
			} else if (marker === '~') {
				// [~] with (replace) / (replacement) suffix = 明示的な置き換え
				const hasReplaceSuffix = /\(replace(?:ment)?\)\s*$/i.test(trimmed);
				if (hasReplaceSuffix) {
					replacements.set(logicalId, 'replace');
				}
				currentResourceId = logicalId;
			} else {
				// [+] = 追加 (新規リソース。単独では Replacement 扱いしない)
				currentResourceId = logicalId;
			}
			continue;
		}

		// プロパティ行: (may cause replacement) / (requires replacement) / (REPLACEMENT)
		if (
			/(may cause replacement|requires? replacement|REPLACEMENT)/i.test(trimmed) &&
			currentResourceId !== null &&
			!replacements.has(currentResourceId)
		) {
			replacements.set(currentResourceId, 'may-cause-replacement');
		}
	}

	return replacements;
}

/**
 * PR 本文またはコミットメッセージから承認済み論理 ID 一覧を抽出する
 *
 * 形式: replacement-approved: LogicalId1,LogicalId2
 *
 * @param {string} prBody
 * @param {string} commitMsg
 * @returns {Set<string>}
 */
export function parseApprovedIds(prBody = '', commitMsg = '') {
	const approved = new Set();

	for (const source of [prBody, commitMsg]) {
		const pattern = /replacement-approved:\s*([^\n\r]+)/gi;
		let match = pattern.exec(source);
		while (match !== null) {
			const ids = match[1]
				.split(/[,\s]+/)
				.map((s) => s.trim())
				.filter(Boolean);
			for (const id of ids) {
				approved.add(id);
			}
			match = pattern.exec(source);
		}
	}

	return approved;
}

/**
 * stdin から CDK diff 出力を読み込んで Replacement を検証するメイン処理
 */
async function main() {
	const rl = readline.createInterface({ input: process.stdin, terminal: false });
	const lines = [];
	for await (const line of rl) {
		lines.push(line);
	}

	const replacements = detectReplacements(lines);

	if (replacements.size === 0) {
		console.log('check-cdk-replacement: no replacements or destroys detected. OK.');
		process.exit(0);
	}

	const prBody = process.env.PR_BODY ?? '';
	const commitMsg = process.env.COMMIT_MSG ?? '';
	const approved = parseApprovedIds(prBody, commitMsg);

	const unapproved = [];
	console.log(`\nCDK Replacement / Destroy detected (${replacements.size} resource(s)):`);
	for (const [logicalId, reason] of replacements) {
		const isApproved = approved.has(logicalId);
		console.log(`  [${reason}] ${logicalId} — ${isApproved ? 'APPROVED' : 'NOT APPROVED'}`);
		if (!isApproved) {
			unapproved.push({ logicalId, reason });
		}
	}

	if (unapproved.length === 0) {
		console.log('\nAll replacements are approved. Proceeding with deploy.');
		process.exit(0);
	}

	console.error(`\nDEPLOY BLOCKED: ${unapproved.length} unapproved replacement(s) detected.`);
	console.error('Add the following line to the PR body (squash merge commit message) to approve:');
	console.error(`  replacement-approved: ${unapproved.map((u) => u.logicalId).join(',')}`);
	console.error('\nRef: docs/decisions/0019-cdk-replacement-detection-gate.md');
	process.exit(1);
}

// ESM: import.meta.url で直接実行を判定
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error('check-cdk-replacement.mjs fatal error:', err.message);
		process.exit(1);
	});
}
