#!/usr/bin/env node
/**
 * scripts/verify-pr-head.mjs
 *
 * GitHub API の eventual consistency による PR headRefOid の stale cache 問題 (#2557)
 * を検知・警告するためのヘルパースクリプト。
 *
 * `git ls-remote` (authoritative) と `gh pr view` (キャッシュの可能性あり) を比較し、
 * 乖離がある場合は警告を表示する。
 *
 * Usage: node scripts/verify-pr-head.mjs <pr-number> <branch-name>
 */

import { execSync } from 'node:child_process';

const prNumber = process.argv[2];
const branchName = process.argv[3];

if (!prNumber || !branchName) {
	console.error('Usage: node scripts/verify-pr-head.mjs <pr-number> <branch-name>');
	process.exit(1);
}

try {
	// 1. git ls-remote (Authoritative)
	const lsRemoteOutput = execSync(`git ls-remote origin refs/heads/${branchName}`, {
		encoding: 'utf-8',
	}).trim();
	const lsRemoteSha = lsRemoteOutput.split(/\s+/)[0];

	if (!lsRemoteSha) {
		console.error(`[Error] Could not find branch '${branchName}' via git ls-remote.`);
		process.exit(1);
	}

	// 2. gh pr view (Potentially stale)
	const ghPrOutput = execSync(`gh pr view ${prNumber} --json headRefOid --jq .headRefOid`, {
		encoding: 'utf-8',
	}).trim();

	console.log(`[verify-pr-head] PR #${prNumber} (${branchName})`);
	console.log(`  git ls-remote : ${lsRemoteSha} (Authoritative)`);
	console.log(`  gh pr view    : ${ghPrOutput} (Potentially stale)`);

	if (lsRemoteSha !== ghPrOutput) {
		console.warn(`\n[WARNING] PR Head SHA mismatch detected!`);
		console.warn(`The GitHub API cache is stale. Please trust 'git ls-remote' (${lsRemoteSha}).`);
		console.warn(`Run 'git fetch origin ${branchName}' to get the latest commit locally.`);
		process.exit(2);
	} else {
		console.log(`\n[OK] Both sources are in sync.`);
		process.exit(0);
	}
} catch (error) {
	console.error('[Error] Execution failed:', error.message);
	process.exit(1);
}
