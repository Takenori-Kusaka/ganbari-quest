/**
 * scripts/audit/generate-integration-evidence.mjs (#2874 / EPIC #2861 D 系)
 *
 * 統合 PR (develop → main) のマージ判定エビデンス自動生成。
 * docs/sessions/audit-team.md §3.5「必須エビデンス 4 点 + NG 0 件条件」のうち
 * CI が機械生成できる #3 (テスト結果表) / #4 (自動テストカバレッジ) を artifact 化し、
 * #1 (含有 PR 一覧) / #2 (変更×テスト突合表) は B-1 (#2950 / audit-manager run) の
 * 記入領域として placeholder 行で境界を明示する (handoff spec 承認済設計判断)。
 *
 * 入力:
 *   - env NEEDS: GitHub Actions の `toJSON(needs)` (job → { result } のマップ)
 *   - coverage/coverage-summary.json (unit-test-merge job の artifact、欠落許容)
 *   - generate-coverage-gap-map.mjs / generate-api-coverage-map.mjs の pure 関数出力
 *
 * 出力: integration-evidence/evidence.md + evidence.json
 *       (CI 側で GITHUB_STEP_SUMMARY 反映 + artifact `integration-pr-evidence-<run_id>` upload)
 *
 * 本 job は ci-gate の needs に入れない (gate ではない)。`if: always()` で fail run でも
 * 表を残す = §3.6 全件発露の入力となる。
 *
 * pure function (buildEvidence) は副作用なし。
 * vitest: tests/unit/audit/generate-integration-evidence.test.ts
 *
 * Usage (CI):
 *   NEEDS='{"e2e-test":{"result":"success"},...}' node scripts/audit/generate-integration-evidence.mjs \
 *     --run-id 12345 --pr 9999 --out integration-evidence
 *
 * exit: 0 (evidence 生成自体は判定しない。判定は audit-manager / ci-gate の責務)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	extractApiEndpoints,
	formatApiCoverageMarkdown,
	matchEndpointCoverage,
} from './generate-api-coverage-map.mjs';
import { buildCoverageGapMap, formatCoverageGapMarkdown } from './generate-coverage-gap-map.mjs';

/** B-1 (#2950) 境界明示 placeholder (audit-manager run が記入する領域) */
export const B1_PLACEHOLDER = '（B-1 #2950 領域 — audit-manager run が記入。CI 自動生成の対象外）';

/**
 * NEEDS (toJSON(needs)) からテスト結果表 (audit-team.md §3.5 #3) を構築する (pure)。
 *
 * @param {Record<string, { result?: string }>} needs
 * @returns {Array<{ job: string, result: string }>}
 */
export function buildJobResultTable(needs) {
	return Object.entries(needs ?? {})
		.map(([job, value]) => ({ job, result: value?.result ?? 'unknown' }))
		.sort((a, b) => a.job.localeCompare(b.job));
}

/**
 * §3.5 エビデンス一式 (json + markdown) を構築する (pure)。
 *
 * @param {{
 *   needs: Record<string, { result?: string }>,
 *   coverageGapMap: ReturnType<typeof buildCoverageGapMap> | null,
 *   apiCoverageMap: ReturnType<typeof matchEndpointCoverage> | null,
 *   runId?: string,
 *   prNumber?: string,
 *   generatedAt?: string,
 * }} input
 * @returns {{
 *   json: {
 *     schema: string,
 *     generatedAt: string,
 *     runId: string,
 *     prNumber: string,
 *     includedChanges: null,
 *     changeTestMapping: null,
 *     jobResults: Array<{ job: string, result: string }>,
 *     coverage: ReturnType<typeof buildCoverageGapMap> | null,
 *     apiCoverage: ReturnType<typeof matchEndpointCoverage> | null,
 *     remainingNg: null,
 *     failedJobCount: number,
 *   },
 *   markdown: string,
 * }}
 */
export function buildEvidence({
	needs,
	coverageGapMap,
	apiCoverageMap,
	runId = '',
	prNumber = '',
	generatedAt = new Date().toISOString(),
}) {
	const jobResults = buildJobResultTable(needs);
	const failedJobs = jobResults.filter((j) => j.result === 'failure' || j.result === 'cancelled');

	const json = {
		schema: 'integration-pr-evidence/v1',
		generatedAt,
		runId,
		prNumber,
		// audit-team.md §3.5 必須エビデンス 5 点との対応
		includedChanges: null, // #1 含有 PR 一覧 — B-1 placeholder
		changeTestMapping: null, // #2 変更×テスト突合 — B-1 placeholder
		jobResults, // #3 テスト結果表
		coverage: coverageGapMap, // #4 自動テストカバレッジ (gap map 込み)
		apiCoverage: apiCoverageMap, // #4 補助: API 設計書 × test 突合
		remainingNg: null, // #5 NG 0 件エビデンス — B-1 / audit-manager 判定領域
		failedJobCount: failedJobs.length,
	};

	const md = [
		'# 統合 PR マージ判定エビデンス (audit-team.md §3.5、CI 自動生成 #2874)',
		'',
		`- 生成時刻: ${generatedAt}`,
		runId ? `- run: ${runId}` : null,
		prNumber ? `- PR: #${prNumber}` : null,
		'',
		'## 1. 新機能・修正一覧 (含有 PR 一覧)',
		'',
		`| 変更（出典 PR） | 対象領域 | 備考 |`,
		'|---|---|---|',
		`| ${B1_PLACEHOLDER} | — | — |`,
		'',
		'## 2. 変更 × テスト突合表',
		'',
		'| 変更（出典 PR） | 対応テストケース | 結果 |',
		'|---|---|---|',
		`| ${B1_PLACEHOLDER} | — | — |`,
		'',
		'## 3. テスト結果表 (最重厚レーン全 job 横断)',
		'',
		'| job | result |',
		'|---|---|',
		...jobResults.map((j) => `| ${j.job} | ${j.result} |`),
		'',
		`- failure / cancelled: ${failedJobs.length} 件${failedJobs.length > 0 ? ` (${failedJobs.map((j) => j.job).join(', ')})` : ''}`,
		'',
		'## 4. 自動テストカバレッジ',
		'',
		coverageGapMap
			? formatCoverageGapMarkdown(coverageGapMap)
			: '(coverage-summary.json 未取得 — unit-test-merge artifact を確認)',
		'',
		apiCoverageMap ? formatApiCoverageMarkdown(apiCoverageMap) : '(API 設計書突合 未実行)',
		'',
		'## 5. 残 NG / 実装一貫性最終チェック',
		'',
		`${B1_PLACEHOLDER}`,
		'',
	]
		.filter((line) => line !== null)
		.join('\n');

	return { json, markdown: md };
}

/** 簡易 argv パーサ
 * @param {string[]} argv
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function argOf(argv, name, fallback) {
	const idx = argv.indexOf(name);
	return (idx !== -1 ? argv[idx + 1] : undefined) ?? fallback;
}

/** CLI 本体 (副作用: fs read/write) */
export function runCli(argv = process.argv.slice(2)) {
	/** @type {Record<string, { result?: string }>} */
	let needs = {};
	try {
		needs = JSON.parse(process.env.NEEDS || '{}');
	} catch {
		console.error('[integration-evidence] NEEDS env の JSON parse に失敗 — 空表で続行');
	}

	const covPath = argOf(argv, '--coverage', 'coverage/coverage-summary.json');
	/** @type {ReturnType<typeof buildCoverageGapMap> | null} */
	let coverageGapMap = null;
	if (existsSync(covPath)) {
		const summary = JSON.parse(readFileSync(covPath, 'utf8'));
		coverageGapMap = buildCoverageGapMap(summary, []);
	}

	const designDocPath = argOf(argv, '--design-doc', 'docs/design/07-API設計書.md');
	/** @type {ReturnType<typeof matchEndpointCoverage> | null} */
	let apiCoverageMap = null;
	if (existsSync(designDocPath)) {
		// 突合対象ソースは generate-api-coverage-map.mjs CLI と同じだが、評価重複を避け
		// ここでは設計書抽出 + tests 連結読込を runCli 内で直接行わず、CLI 委譲も可。
		// 単純化のため同 module の pure 関数を直接使う (tests 連結は下の helper)。
		const { readTestsSourceText } = internalHelpers;
		apiCoverageMap = matchEndpointCoverage(
			extractApiEndpoints(readFileSync(designDocPath, 'utf8')),
			readTestsSourceText(),
		);
	}

	const { json, markdown } = buildEvidence({
		needs,
		coverageGapMap,
		apiCoverageMap,
		runId: argOf(argv, '--run-id', process.env.GITHUB_RUN_ID || ''),
		prNumber: argOf(argv, '--pr', ''),
	});

	const outDir = argOf(argv, '--out', 'integration-evidence');
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, 'evidence.json'), `${JSON.stringify(json, null, 2)}\n`);
	writeFileSync(join(outDir, 'evidence.md'), `${markdown}\n`);
	console.log(markdown);
	return { json, markdown, outDir };
}

/** tests/integration + tests/e2e の連結ソース読込 (CLI 用 helper) */
const internalHelpers = {
	readTestsSourceText() {
		/** @type {string[]} */
		const texts = [];
		/** @param {string} dir */
		const walk = (dir) => {
			/** @type {import('node:fs').Dirent[]} */
			let entries;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				const full = join(dir, e.name);
				if (e.isDirectory()) walk(full);
				else if (e.name.endsWith('.ts')) texts.push(readFileSync(full, 'utf8'));
			}
		};
		walk('tests/integration');
		walk('tests/e2e');
		return texts.join('\n');
	},
};

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	runCli();
	process.exit(0);
}
