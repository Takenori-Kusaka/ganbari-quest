#!/usr/bin/env node
/**
 * scripts/check-pr-file-overlap.mjs
 *
 * #1200: 並行 PR による同ファイル上書き防止。
 *
 * 同一ファイルを変更する複数の open PR が存在する場合、後続 PR (特に full rewrite 系)
 * が先行 PR の成果を無意識に消滅させる事故が頻発している (PR #1143/#1144/#1178 前例)。
 *
 * 本スクリプトは PR open/sync 時に現 PR の changed files と他の open PR の changed files を
 * 比較し、overlap があれば GH Actions 上で warning として記録 + PR コメントで通知する。
 * **block はしない**。人間の判断で「先行 PR を待つ / マージ順序調整 / rebase 方針確認」
 * のいずれを選ぶかを促すことが目的。
 *
 * 想定実行環境: GitHub Actions の pull_request トリガ
 *   env:
 *     PR_NUMBER:   現在の PR 番号 (${{ github.event.pull_request.number }})
 *     REPO:        owner/repo (${{ github.repository }})
 *     GH_TOKEN:    GITHUB_TOKEN (read permission)
 *   optional:
 *     OUTPUT_MODE: 'json' | 'text' (default: text)
 *     IGNORE_FILES: 改行区切りのファイルパターン (glob 不可、完全一致)
 *
 * ローカル実行例:
 *   PR_NUMBER=1200 REPO=Takenori-Kusaka/ganbari-quest \
 *     node scripts/check-pr-file-overlap.mjs
 *
 * exit:
 *   0 = overlap 無し or 警告出力のみ (block はしない)
 *   2 = API 呼び出し失敗等の internal error
 */

import { execFileSync } from 'node:child_process';

const PR_NUMBER = process.env.PR_NUMBER;
const REPO = process.env.REPO;
const OUTPUT_MODE = process.env.OUTPUT_MODE || 'text';
const IGNORE_FILES = (process.env.IGNORE_FILES || '')
	.split('\n')
	.map((s) => s.trim())
	.filter(Boolean);

if (!PR_NUMBER) {
	console.error('[pr-file-overlap] PR_NUMBER env var is required');
	process.exit(2);
}
if (!REPO) {
	console.error('[pr-file-overlap] REPO env var is required (owner/repo)');
	process.exit(2);
}

function gh(args) {
	try {
		return execFileSync('gh', args, {
			stdio: ['ignore', 'pipe', 'inherit'],
			encoding: 'utf-8',
			maxBuffer: 10 * 1024 * 1024,
		});
	} catch (err) {
		console.error(`[pr-file-overlap] gh command failed: ${args.join(' ')}`);
		console.error(err?.message || err);
		process.exit(2);
	}
}

function listPrFiles(prNumber) {
	const out = gh(['pr', 'view', String(prNumber), '--repo', REPO, '--json', 'files']);
	const data = JSON.parse(out);
	return (data.files || []).map((f) => f.path).filter((p) => !IGNORE_FILES.includes(p));
}

function listOpenPrs() {
	const out = gh([
		'pr',
		'list',
		'--repo',
		REPO,
		'--state',
		'open',
		'--limit',
		'100',
		'--json',
		'number,title,author,isDraft,headRefName',
	]);
	return JSON.parse(out);
}

const currentFiles = listPrFiles(PR_NUMBER);
if (currentFiles.length === 0) {
	console.log(`[pr-file-overlap] PR #${PR_NUMBER} has no changed files. Nothing to check.`);
	process.exit(0);
}

const openPrs = listOpenPrs().filter((pr) => String(pr.number) !== String(PR_NUMBER));

const overlaps = [];
for (const pr of openPrs) {
	const files = listPrFiles(pr.number);
	const shared = files.filter((f) => currentFiles.includes(f));
	if (shared.length > 0) {
		overlaps.push({
			number: pr.number,
			title: pr.title,
			author: pr.author?.login || 'unknown',
			isDraft: pr.isDraft,
			headRefName: pr.headRefName,
			sharedFiles: shared,
		});
	}
}

if (OUTPUT_MODE === 'json') {
	console.log(
		JSON.stringify(
			{
				prNumber: Number(PR_NUMBER),
				currentFileCount: currentFiles.length,
				overlaps,
			},
			null,
			2,
		),
	);
} else if (overlaps.length === 0) {
	console.log(
		`[pr-file-overlap] PR #${PR_NUMBER} changes ${currentFiles.length} files; no overlap with ${openPrs.length} other open PRs.`,
	);
} else {
	console.log(
		`[pr-file-overlap] ⚠ PR #${PR_NUMBER} shares files with ${overlaps.length} other open PR(s):`,
	);
	for (const o of overlaps) {
		console.log(`  - #${o.number} ${o.isDraft ? '(Draft) ' : ''}by @${o.author}: ${o.title}`);
		for (const f of o.sharedFiles) {
			console.log(`      * ${f}`);
		}
	}
	console.log(
		'[pr-file-overlap] 複数 PR で同ファイルを編集中です。マージ順序と rebase 方針を事前に調整してください。',
	);
}

process.exit(0);
