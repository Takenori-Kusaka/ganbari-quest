/**
 * scripts/audit/generate-release-predicate.mjs (Issue #2876 — Phase B/B-4、親 #2949 / EPIC #2861)
 *
 * 統合 PR (develop → main / release/* → main) の merge commit に紐付ける
 * **in-toto Release predicate v0.2 互換** statement を組み立てる pure function + CLI。
 * `.github/workflows/integration-attest.yml` が main push (= 統合 merge) を契機に本 CLI を呼び、
 * 生成した predicate を `actions/attest` で Sigstore 署名 → GH attestations API へ永続化する。
 * これにより merge 後も `gh attestation verify <merge-sha>` で「統合 PR は含有 PR 群 × テスト結果
 * × NG 0 件エビデンス」を改ざん検知可能な形で恒久追跡できる (tmp/ 揮発の解消、ADR-0056 self-report
 * 退化の構造封じ)。
 *
 * in-toto Release predicate v0.2 spec:
 *   https://github.com/in-toto/attestation/blob/main/spec/predicates/release.md
 *   - predicateType: "https://in-toto.io/attestation/release/v0.2"
 *   - subject: [{ name, digest: { sha1: <merge commit SHA> } }] (release が指す artifact)
 *   - predicate: { purl?, version?, releaseId?, ... } + 監査拡張 field
 *
 * 設計判断 (Issue #2876 alternatives):
 *   slsa-github-generator は build provenance 用で本用途 (監査判定の release attestation) に過剰。
 *   actions/attest + Release predicate の最小構成を採る。本 module は spec 必須 field を満たしつつ
 *   含有 PR / テスト結果 / coverage / NG-0 宣言を拡張 field (in-toto は predicate 内の追加 field を
 *   許容) として保持する。
 *
 * 含有 PR の算出は `scripts/integration-pr-body.mjs` (B-3 #2871) と同じ「前回統合 merge 以降に
 * develop へ merge された PR」ロジックを使う。本 module は重複算出せず、workflow が gh API で
 * 取得した containedPrs 配列を受け取る (integration-pr.yml と同型の collect step)。
 *
 * 本 module は副作用を持たない (I/O は runCli wrapper 側)。
 * vitest unit test: tests/unit/audit/generate-release-predicate.test.ts
 *
 * Usage (CLI):
 *   node scripts/audit/generate-release-predicate.mjs \
 *     --merge-sha <sha> --prs prs.json --job-results jobs.json \
 *     --coverage coverage.json --remaining-ng 0 --out predicate.json
 *
 * 関連:
 *   - scripts/integration-pr-body.mjs (classifyForContainedList — 含有判定の SSOT)
 *   - scripts/audit/generate-integration-evidence.mjs (jobResults / coverage の形)
 *   - docs/sessions/audit-team.md §3.5 (マージ判定エビデンス基準)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyForContainedList } from '../integration-pr-body.mjs';

/** in-toto attestation statement type (v1) */
export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';

/** in-toto Release predicate type (v0.2) */
export const RELEASE_PREDICATE_TYPE = 'https://in-toto.io/attestation/release/v0.2';

/** @param {unknown} v */
function isNonEmptyString(v) {
	return typeof v === 'string' && v.trim().length > 0;
}

/**
 * PR の labels（string[] or {name}[]）を string[] に正規化する (pure)。
 * @param {Array<string | { name?: string }> | undefined} labels
 * @returns {string[]}
 */
function normalizeLabels(labels) {
	return (labels ?? []).map((l) => (typeof l === 'string' ? l : (l?.name ?? '')));
}

/**
 * 含有 PR 配列を predicate 用の最小 record にマップする (pure)。
 * back-merge PR / 統合 PR 自身は classifyForContainedList で除外する
 * (integration-pr-body.mjs の含有判定 SSOT を再利用、重複実装しない)。
 *
 * @param {Array<{ number?: number, title?: string, headRefName?: string, labels?: Array<string|{name:string}>, mergedAt?: string }>} prs
 * @returns {Array<any>}
 */
export function buildContainedPrRecords(prs) {
	return (prs ?? [])
		.filter((pr) => classifyForContainedList(pr) === 'contained')
		.map((pr) => ({
			number: Number(pr.number),
			title: typeof pr.title === 'string' && pr.title.trim().length > 0 ? pr.title.trim() : '',
			labels: normalizeLabels(pr.labels).filter(isNonEmptyString),
			mergedAt:
				typeof pr.mergedAt === 'string' && pr.mergedAt.trim().length > 0 ? pr.mergedAt : null,
		}))
		.sort((a, b) => a.number - b.number);
}

/**
 * job 結果配列から pass/fail サマリを構築する (pure)。
 * generate-integration-evidence.mjs の buildJobResultTable と同形の入力
 * ({ job, result }[]) を受ける。
 *
 * @param {Array<{ job?: string, result?: string }>} jobResults
 * @returns {{ total: number, passed: number, failed: number, failedJobs: string[], allGreen: boolean }}
 */
export function summarizeJobResults(jobResults) {
	const list = (jobResults ?? []).map((j) => ({
		job: typeof j?.job === 'string' && j.job.trim().length > 0 ? j.job : 'unknown',
		result: typeof j?.result === 'string' && j.result.trim().length > 0 ? j.result : 'unknown',
	}));
	const failedJobs = list
		.filter((j) => j.result === 'failure' || j.result === 'cancelled')
		.map((j) => j.job);
	const passed = list.filter((j) => j.result === 'success').length;
	return {
		total: list.length,
		passed,
		failed: failedJobs.length,
		failedJobs,
		// 全 job 緑 = 1 件以上 + failure/cancelled が 0 件。空入力は allGreen=false (証跡未取得を緑扱いしない)。
		allGreen: list.length > 0 && failedJobs.length === 0,
	};
}

/**
 * NG-0 宣言の真偽を判定する (pure)。
 * - remainingNg (severity 3-4 + policy_compliant=false の未解決 finding 件数) が 0
 * - coverageRatchetOk (カバレッジ ratchet 閾値割れなし) が true
 * の双方を満たして初めて ngZero=true。
 *
 * @param {{ remainingNg?: number, coverageRatchetOk?: boolean }} input
 * @returns {{ remainingNg: number, coverageRatchetOk: boolean, ngZero: boolean }}
 */
export function evaluateNgZero({ remainingNg, coverageRatchetOk } = {}) {
	// 未指定は -1 (不明 = ngZero false)。typeof guard で number に絞る (noUncheckedIndexedAccess 整合)。
	const ng =
		typeof remainingNg === 'number' && Number.isInteger(remainingNg) && remainingNg >= 0
			? remainingNg
			: -1;
	const covOk = coverageRatchetOk === true;
	return {
		remainingNg: ng,
		coverageRatchetOk: covOk,
		ngZero: ng === 0 && covOk,
	};
}

/**
 * in-toto Release predicate 互換 statement を組み立てる (pure)。
 *
 * @param {{
 *   mergeCommitSha?: string,
 *   containedPrs?: Array<any>,
 *   jobResults?: Array<{ job?: string, result?: string }>,
 *   coverage?: { lines?: number, statements?: number, functions?: number, branches?: number } | null,
 *   remainingNg?: number,
 *   coverageRatchetOk?: boolean,
 *   integrationPrNumber?: number | string,
 *   repository?: string,
 *   generatedAt?: string,
 * }} input
 * @returns {{
 *   _type: string,
 *   subject: Array<any>,
 *   predicateType: string,
 *   predicate: Record<string, any>,
 * }}
 */
export function buildReleasePredicate({
	mergeCommitSha,
	containedPrs = [],
	jobResults = [],
	coverage = null,
	remainingNg,
	coverageRatchetOk,
	integrationPrNumber,
	repository = 'Takenori-Kusaka/ganbari-quest',
	generatedAt = new Date().toISOString(),
} = {}) {
	if (typeof mergeCommitSha !== 'string' || mergeCommitSha.trim().length === 0) {
		throw new Error('buildReleasePredicate: mergeCommitSha (subject digest) が必須です');
	}
	const sha = mergeCommitSha.trim();

	const contained = buildContainedPrRecords(containedPrs);
	const jobSummary = summarizeJobResults(jobResults);
	const ng = evaluateNgZero({ remainingNg, coverageRatchetOk });

	const purl = `pkg:github/${repository}@${sha}`;

	return {
		_type: STATEMENT_TYPE,
		// subject = release が指す artifact = 統合 PR の merge commit。
		subject: [{ name: repository, digest: { sha1: sha } }],
		predicateType: RELEASE_PREDICATE_TYPE,
		predicate: {
			// --- in-toto Release predicate v0.2 標準 field ---
			purl,
			version: sha,
			// --- 監査拡張 field (audit-team.md §3.5 のエビデンスを authoritatively link) ---
			repository,
			integrationPr: integrationPrNumber != null ? String(integrationPrNumber) : null,
			generatedAt,
			// 含有 PR 一覧 (前回統合 merge 以降に develop へ merge された PR、back-merge/統合 PR 自身は除外)
			containedPrs: contained,
			containedPrCount: contained.length,
			// テスト結果サマリ (最重厚レーン全 job 横断)
			testResults: {
				total: jobSummary.total,
				passed: jobSummary.passed,
				failed: jobSummary.failed,
				failedJobs: jobSummary.failedJobs,
				allGreen: jobSummary.allGreen,
			},
			// カバレッジ (ratchet 閾値割れ判定込み)
			coverage: coverage ?? null,
			// NG-0 宣言 (rules-based: severity 3-4 + policy_compliant=false が 0 + coverage ratchet OK)
			ngZeroDeclaration: {
				remainingNg: ng.remainingNg,
				coverageRatchetOk: ng.coverageRatchetOk,
				ngZero: ng.ngZero,
			},
		},
	};
}

/** 簡易 argv パーサ
 * @param {string[]} argv
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string | undefined}
 */
function argOf(argv, name, fallback) {
	const idx = argv.indexOf(name);
	return (idx !== -1 ? argv[idx + 1] : undefined) ?? fallback;
}

/** JSON file を安全に読む (欠落 / parse 失敗で null)
 * @param {string | undefined} path
 * @returns {any}
 */
function readJsonOrNull(path) {
	if (typeof path !== 'string' || path.trim().length === 0 || !existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (e) {
		console.error(`[release-predicate] ${path} の JSON parse に失敗 — null 扱い: ${e}`);
		return null;
	}
}

/** CLI 本体 (副作用: fs read/write)
 * @param {string[]} [argv]
 * @returns {{ statement: ReturnType<typeof buildReleasePredicate>, outPath: string }}
 */
export function runCli(argv = process.argv.slice(2)) {
	const mergeSha = argOf(argv, '--merge-sha', process.env.GITHUB_SHA);
	const prs = readJsonOrNull(argOf(argv, '--prs')) ?? [];
	const jobResults = readJsonOrNull(argOf(argv, '--job-results')) ?? [];
	const coverage = readJsonOrNull(argOf(argv, '--coverage'));
	const remainingNgRaw = argOf(argv, '--remaining-ng');
	const remainingNg = remainingNgRaw !== undefined ? Number(remainingNgRaw) : undefined;
	const coverageRatchetOk = argOf(argv, '--coverage-ratchet-ok') === 'true';
	const integrationPrNumber = argOf(argv, '--pr');
	const outPath = argOf(argv, '--out', 'predicate.json');

	const statement = buildReleasePredicate({
		mergeCommitSha: /** @type {string} */ (mergeSha),
		containedPrs: prs,
		jobResults,
		coverage,
		remainingNg,
		coverageRatchetOk,
		integrationPrNumber,
		repository: process.env.GITHUB_REPOSITORY || 'Takenori-Kusaka/ganbari-quest',
	});

	const dir = dirname(/** @type {string} */ (outPath));
	if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
	writeFileSync(/** @type {string} */ (outPath), `${JSON.stringify(statement, null, 2)}\n`);
	console.log(
		`[release-predicate] subject=${statement.subject[0].digest.sha1} contained=${statement.predicate.containedPrCount} allGreen=${statement.predicate.testResults.allGreen} ngZero=${statement.predicate.ngZeroDeclaration.ngZero} → ${outPath}`,
	);
	return { statement, outPath: /** @type {string} */ (outPath) };
}

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
