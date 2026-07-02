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
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} OverlapEntry
 * @property {number|string} number
 * @property {string} title
 * @property {string} author
 * @property {boolean} [isDraft]
 * @property {string} [headRefName]
 * @property {string[]} sharedFiles
 */

/**
 * #3369: stdout に出す内容を組み立てる純粋関数 (gh I/O 非依存)。
 *
 * JSON モードは consumer (pr-info.yml が `require('/tmp/overlap.json').overlaps` を読む) と
 * **常に同じオブジェクト形** (`{ prNumber, currentFileCount, overlaps }`) を返す。
 * 0-changed-file PR (back-merge main→develop で develop⊇main の drift-0 ケース等) でも
 * human-readable 文字列を流さず空 overlaps の JSON を返すことで、後段 JSON.parse の
 * SyntaxError (back-merge のたびに赤 check 化) を防ぐ。
 *
 * @param {{ prNumber: string|number, currentFiles: string[], overlaps: OverlapEntry[], openPrsCount: number, outputMode: string }} input
 * @returns {string}
 */
export function renderOutput({ prNumber, currentFiles, overlaps, openPrsCount, outputMode }) {
	if (outputMode === 'json') {
		return JSON.stringify(
			{ prNumber: Number(prNumber), currentFileCount: currentFiles.length, overlaps },
			null,
			2,
		);
	}
	if (currentFiles.length === 0) {
		return `[pr-file-overlap] PR #${prNumber} has no changed files. Nothing to check.`;
	}
	if (overlaps.length === 0) {
		return `[pr-file-overlap] PR #${prNumber} changes ${currentFiles.length} files; no overlap with ${openPrsCount} other open PRs.`;
	}
	const lines = [
		`[pr-file-overlap] ⚠ PR #${prNumber} shares files with ${overlaps.length} other open PR(s):`,
	];
	for (const o of overlaps) {
		lines.push(`  - #${o.number} ${o.isDraft ? '(Draft) ' : ''}by @${o.author}: ${o.title}`);
		for (const f of o.sharedFiles) {
			lines.push(`      * ${f}`);
		}
	}
	lines.push(
		'[pr-file-overlap] 複数 PR で同ファイルを編集中です。マージ順序と rebase 方針を事前に調整してください。',
	);
	return lines.join('\n');
}

/**
 * #3369: 現 PR の changed files と他 open PR の files から overlap を算出する純粋関数。
 *
 * @param {string[]} currentFiles
 * @param {Array<{ number: number|string, title: string, author?: { login?: string }, isDraft?: boolean, headRefName?: string, files: string[] }>} otherPrs
 * @returns {OverlapEntry[]}
 */
export function computeOverlaps(currentFiles, otherPrs) {
	const overlaps = [];
	for (const pr of otherPrs) {
		const shared = (pr.files || []).filter((f) => currentFiles.includes(f));
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
	return overlaps;
}

function main() {
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
	// 上の guard 後も nested closure (listPrFiles / listOpenPrs) では narrowing が失われるため明示 cast。
	const repo = /** @type {string} */ (REPO);

	/** @param {string[]} args @returns {string} */
	function gh(args) {
		try {
			return execFileSync('gh', args, {
				stdio: ['ignore', 'pipe', 'inherit'],
				encoding: 'utf-8',
				maxBuffer: 10 * 1024 * 1024,
			});
		} catch (err) {
			console.error(`[pr-file-overlap] gh command failed: ${args.join(' ')}`);
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(2);
		}
	}

	/** @param {string|number} prNumber @returns {string[]} */
	function listPrFiles(prNumber) {
		const out = gh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'files']);
		const data = /** @type {{ files?: { path: string }[] }} */ (JSON.parse(out));
		return (data.files || []).map((f) => f.path).filter((p) => !IGNORE_FILES.includes(p));
	}

	/** @returns {Array<{ number: number|string, title: string, author?: { login?: string }, isDraft?: boolean, headRefName?: string }>} */
	function listOpenPrs() {
		const out = gh([
			'pr',
			'list',
			'--repo',
			repo,
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
	// #3369: 0-file でも下の共通 render を通す (early-return で human-readable を JSON に混ぜない)。
	const openPrs =
		currentFiles.length === 0
			? []
			: listOpenPrs().filter((pr) => String(pr.number) !== String(PR_NUMBER));
	const otherPrs = openPrs.map((pr) => ({ ...pr, files: listPrFiles(pr.number) }));
	const overlaps = computeOverlaps(currentFiles, otherPrs);

	console.log(
		renderOutput({
			prNumber: PR_NUMBER,
			currentFiles,
			overlaps,
			openPrsCount: openPrs.length,
			outputMode: OUTPUT_MODE,
		}),
	);
	process.exit(0);
}

// CLI として直接実行されたときのみ main() を呼ぶ。`import` 経由 (unit test 等) では実行されない。
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	main();
}
