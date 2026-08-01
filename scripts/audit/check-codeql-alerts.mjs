/**
 * scripts/audit/check-codeql-alerts.mjs (Issue #4155)
 *
 * CodeQL の「PR 由来の new alert 0 件」を **機械条件** にする検査。
 *
 * ## なぜ必要か
 *
 * `CodeQL` は main ruleset の `required_status_checks` に含まれない
 * ([branch-strategy.md](../../docs/sessions/branch-strategy.md) §4)。そのため従来は
 * 「required でないから赤でも merge 可」を **統合監査のたびに人が判断**していた。
 * これは外形が admin bypass と区別できず (ADR-0022 が禁じている形と同型)、実際に
 * 統合 PR #4152 では監査自身が入れた `js/incomplete-url-substring-sanitization` を
 * 判断で流しかけた。
 *
 * そこで required 非該当は維持しつつ、その代わりに満たすべき条件を
 * 「**統合 PR の ref (`refs/pull/<N>/merge`) 由来の open alert が baseline を超えない**」
 * として機械化する。`tests/e2e/a11y-baseline.json` と同型 (既知違反を rule 単位で pin し、
 * 新規は 1 件で hard-fail、silent cap 禁止)。
 *
 * ## 判定規則
 *
 * - baseline (`scripts/audit/codeql-baseline.json`) の entry は `(rule, path)` 組 + `count`。
 *   observed count ≤ baseline count なら受容、超過分は new alert として fail。
 * - baseline に無い `(rule, path)` 組の alert は 1 件で fail。
 * - **`src/` 配下を baseline に載せることは禁止**。顧客経路の alert に「受容」の選択肢を
 *   作らないため、ledger 検証自体が fail する (PO 決裁 2026-08-01)。
 * - 全 entry に `resolutionTrigger` を必須とする (期限なし pin = silent cap の禁止、AC4)。
 * - **「検査できなかった」を pass にしない**: 対象 ref の CodeQL analysis が 0 件、または
 *   API 取得に失敗した場合は fail する (#4084 で `ss-blob-sha-uniqueness` が
 *   「ペア 0 件 = skip」で黙って消えた事故と同じ class を作らない)。
 *
 * pure function (`validateBaseline` / `groupAlerts` / `evaluateCodeqlAlerts` /
 * `formatCodeqlMarkdown`) は副作用なし。fetch と fs だけが CLI 側にある。
 * vitest: tests/unit/audit/check-codeql-alerts.test.ts
 *
 * ## Usage
 *
 *   # 統合 PR の merge ref を検査し結果 JSON を書き出す (exit は --report-only で抑止)
 *   node scripts/audit/check-codeql-alerts.mjs --pr 4152 --out integration-evidence/codeql-alerts.json --report-only
 *
 *   # 書き出し済み結果を読んで enforcement だけ行う (new alert 1 件で exit 1)
 *   node scripts/audit/check-codeql-alerts.mjs --input integration-evidence/codeql-alerts.json
 *
 *   # 任意 ref / オフライン fixture
 *   node scripts/audit/check-codeql-alerts.mjs --ref refs/heads/main
 *   node scripts/audit/check-codeql-alerts.mjs --alerts-file tmp/alerts.json --analysis-count 1
 *
 * exit: 0 = 条件充足 / 1 = new alert or ledger 不正 or 検査不能
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain as isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** baseline ledger の既定パス */
export const BASELINE_PATH = join(HERE, 'codeql-baseline.json');

/** 既定の対象リポジトリ */
export const DEFAULT_REPO = 'Takenori-Kusaka/ganbari-quest';

/**
 * baseline に載せることを禁止するパス接頭辞 (顧客経路 = production コード)。
 * PO 決裁 2026-08-01:「`src/` 配下の alert を baseline に載せることを禁止。
 * 顧客経路の alert に『受容』の選択肢を作らない」。
 */
export const FORBIDDEN_BASELINE_PATH_PREFIXES = ['src/'];

/**
 * `(rule, path)` を 1 本のキーに畳む。
 * @param {string} rule
 * @param {string} path
 * @returns {string}
 */
export function alertKey(rule, path) {
	return `${rule} ${path}`;
}

/** キーを人間可読に戻す
 * @param {string} key
 * @returns {{ rule: string, path: string }}
 */
function splitKey(key) {
	const [rule, path] = key.split(' ');
	return { rule, path: path ?? '' };
}

/**
 * GitHub code-scanning alerts API の生レスポンスを正規化する (pure)。
 *
 * @param {Array<any>} rawAlerts
 * @returns {Array<{ number: number|null, rule: string, path: string, securitySeverity: string, state: string }>}
 */
export function normalizeAlerts(rawAlerts) {
	return (rawAlerts ?? []).map((a) => ({
		number: typeof a?.number === 'number' ? a.number : null,
		rule: a?.rule?.id ?? a?.rule_id ?? 'unknown-rule',
		path: a?.most_recent_instance?.location?.path ?? a?.path ?? 'unknown-path',
		securitySeverity: a?.rule?.security_severity_level ?? a?.rule?.severity ?? 'unknown',
		state: a?.state ?? 'open',
	}));
}

/**
 * 正規化済み alert を `(rule, path)` 単位で数える (pure)。
 *
 * @param {ReturnType<typeof normalizeAlerts>} alerts
 * @returns {Map<string, { rule: string, path: string, count: number, securitySeverity: string, numbers: number[] }>}
 */
export function groupAlerts(alerts) {
	/** @type {Map<string, { rule: string, path: string, count: number, securitySeverity: string, numbers: number[] }>} */
	const groups = new Map();
	for (const a of alerts ?? []) {
		const key = alertKey(a.rule, a.path);
		const cur = groups.get(key);
		if (cur) {
			cur.count += 1;
			if (a.number !== null) cur.numbers.push(a.number);
		} else {
			groups.set(key, {
				rule: a.rule,
				path: a.path,
				count: 1,
				securitySeverity: a.securitySeverity,
				numbers: a.number !== null ? [a.number] : [],
			});
		}
	}
	return groups;
}

/**
 * baseline ledger 自体の妥当性を検証する (pure)。
 *
 * - `entries` は配列であること
 * - 各 entry に `rule` / `path` / 正の整数 `count` / 非空 `resolutionTrigger` があること
 *   (resolutionTrigger 欠落 = 期限なし pin = silent cap のため不可、AC4)
 * - `src/` 配下の path を載せていないこと (顧客経路に受容を作らない)
 * - `(rule, path)` の重複が無いこと
 *
 * @param {any} baseline
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateBaseline(baseline) {
	/** @type {string[]} */
	const errors = [];
	const entries = baseline?.entries;
	if (!Array.isArray(entries)) {
		return { valid: false, errors: ['baseline.entries が配列ではありません'] };
	}
	const seen = new Set();
	entries.forEach((e, i) => {
		const label = `entries[${i}]`;
		if (typeof e?.rule !== 'string' || e.rule === '') errors.push(`${label}: rule が空です`);
		if (typeof e?.path !== 'string' || e.path === '') errors.push(`${label}: path が空です`);
		if (!Number.isInteger(e?.count) || e.count < 1) {
			errors.push(`${label}: count は 1 以上の整数である必要があります`);
		}
		if (typeof e?.resolutionTrigger !== 'string' || e.resolutionTrigger.trim().length < 4) {
			errors.push(
				`${label} (${e?.rule} @ ${e?.path}): resolutionTrigger が未記入です。期限なしの pin は作れません (#4155 AC4)`,
			);
		}
		if (
			typeof e?.path === 'string' &&
			FORBIDDEN_BASELINE_PATH_PREFIXES.some((p) => e.path.startsWith(p))
		) {
			errors.push(
				`${label} (${e.rule} @ ${e.path}): production コード (${FORBIDDEN_BASELINE_PATH_PREFIXES.join(' / ')}) の alert は baseline に載せられません。即時解消してください`,
			);
		}
		if (typeof e?.rule === 'string' && typeof e?.path === 'string') {
			const key = alertKey(e.rule, e.path);
			if (seen.has(key)) errors.push(`${label}: (${e.rule}, ${e.path}) が重複登録されています`);
			seen.add(key);
		}
	});
	return { valid: errors.length === 0, errors };
}

/**
 * observed alert 群を baseline と突き合わせて判定する (pure)。
 *
 * @param {{
 *   alerts?: Array<any>,
 *   baseline?: any,
 *   analysisCount?: number | null,
 *   fetchError?: string | null,
 *   ref?: string,
 * }} input
 * @returns {{
 *   pass: boolean,
 *   ref: string,
 *   observedCount: number,
 *   newAlerts: Array<{ rule: string, path: string, excess: number, securitySeverity: string, numbers: number[] }>,
 *   acceptedCount: number,
 *   staleEntries: Array<{ rule: string, path: string, count: number }>,
 *   baselineErrors: string[],
 *   analysisCount: number | null,
 *   fetchError: string | null,
 *   reasons: string[],
 * }}
 */
export function evaluateCodeqlAlerts({
	alerts = [],
	baseline = null,
	analysisCount = null,
	fetchError = null,
	ref = '',
} = {}) {
	const normalized = normalizeAlerts(alerts).filter((a) => a.state === 'open');
	const groups = groupAlerts(normalized);
	const { errors: baselineErrors } = validateBaseline(baseline);

	/** @type {Map<string, { count: number }>} */
	const baseMap = new Map();
	if (Array.isArray(baseline?.entries)) {
		for (const e of baseline.entries) {
			if (typeof e?.rule === 'string' && typeof e?.path === 'string') {
				baseMap.set(alertKey(e.rule, e.path), { count: Number.isInteger(e.count) ? e.count : 0 });
			}
		}
	}

	/** @type {Array<{ rule: string, path: string, excess: number, securitySeverity: string, numbers: number[] }>} */
	const newAlerts = [];
	let acceptedCount = 0;
	for (const [key, g] of groups) {
		const allowed = baseMap.get(key)?.count ?? 0;
		const excess = g.count - allowed;
		acceptedCount += Math.min(g.count, allowed);
		if (excess > 0) {
			newAlerts.push({
				rule: g.rule,
				path: g.path,
				excess,
				securitySeverity: g.securitySeverity,
				numbers: g.numbers,
			});
		}
	}
	newAlerts.sort((a, b) => a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path));

	/** @type {Array<{ rule: string, path: string, count: number }>} */
	const staleEntries = [];
	for (const [key, v] of baseMap) {
		if (!groups.has(key)) {
			const { rule, path } = splitKey(key);
			staleEntries.push({ rule, path, count: v.count });
		}
	}

	/** @type {string[]} */
	const reasons = [];
	if (fetchError) reasons.push(`alert 取得に失敗: ${fetchError} (検査不能 = pass にしない)`);
	if (analysisCount === 0) {
		reasons.push(
			`ref ${ref || '(未指定)'} に CodeQL analysis が 0 件 (未スキャン = pass にしない、#4084 同型)`,
		);
	}
	if (baselineErrors.length > 0)
		reasons.push(`baseline ledger が不正: ${baselineErrors.length} 件`);
	if (newAlerts.length > 0) {
		reasons.push(
			`baseline 超過の alert ${newAlerts.reduce((s, a) => s + a.excess, 0)} 件 (${newAlerts.map((a) => `${a.rule} @ ${a.path}`).join(', ')})`,
		);
	}

	const pass =
		!fetchError && analysisCount !== 0 && baselineErrors.length === 0 && newAlerts.length === 0;

	return {
		pass,
		ref,
		observedCount: normalized.length,
		newAlerts,
		acceptedCount,
		staleEntries,
		baselineErrors,
		analysisCount,
		fetchError,
		reasons: pass
			? [`baseline 内 ${acceptedCount} 件のみ / 新規 0 件 (ref ${ref || '(未指定)'})`]
			: reasons,
	};
}

/**
 * 判定結果を markdown に整形する (pure)。evidence.md §5 / job summary 用。
 *
 * @param {ReturnType<typeof evaluateCodeqlAlerts>} result
 * @returns {string}
 */
export function formatCodeqlMarkdown(result) {
	const lines = [
		'### CodeQL new-alert 検査 (#4155)',
		'',
		`- 判定: ${result.pass ? '✅ PASS' : '❌ FAIL'}`,
		`- 対象 ref: ${result.ref || '(未指定)'}`,
		`- open alert: ${result.observedCount} 件 (baseline 受容 ${result.acceptedCount} 件 / baseline 超過 ${result.newAlerts.length} 組)`,
		`- CodeQL analysis: ${result.analysisCount === null ? '未確認' : `${result.analysisCount} 件`}`,
		'',
		'> `CodeQL` は main ruleset の required_status_checks 非該当。その代わり本検査で',
		'> 「統合 PR 由来の new alert 0 件」を機械条件にする (branch-strategy.md §4 / audit-team.md §3.5)。',
	];
	if (result.newAlerts.length > 0) {
		lines.push(
			'',
			'| rule | path | 超過 | severity | alert # |',
			'|---|---|---|---|---|',
			...result.newAlerts.map(
				(a) =>
					`| \`${a.rule}\` | \`${a.path}\` | ${a.excess} | ${a.securitySeverity} | ${a.numbers.join(', ') || '—'} |`,
			),
		);
	}
	if (result.staleEntries.length > 0) {
		lines.push(
			'',
			`- 解消済み baseline entry ${result.staleEntries.length} 件 (ledger から削除してください): ${result.staleEntries
				.map((e) => `\`${e.rule}\` @ \`${e.path}\``)
				.join(', ')}`,
		);
	}
	if (!result.pass) {
		lines.push('', '理由:', ...result.reasons.map((r) => `- ${r}`));
	}
	return lines.join('\n');
}

/** 簡易 argv パーサ
 * @param {string[]} argv
 * @param {string} name
 * @param {string|undefined} [fallback]
 * @returns {string|undefined}
 */
function argOf(argv, name, fallback) {
	const idx = argv.indexOf(name);
	return (idx !== -1 ? argv[idx + 1] : undefined) ?? fallback;
}

/**
 * `gh api` を叩いて対象 ref の open alert + analysis 件数を取得する (副作用あり)。
 *
 * @param {{ repo: string, ref: string }} input
 * @returns {{ alerts: Array<any>, analysisCount: number | null, fetchError: string | null }}
 */
export function fetchCodeqlState({ repo, ref }) {
	/** @param {string} path */
	const ghJson = (path) =>
		JSON.parse(
			execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
		);
	const q = `ref=${encodeURIComponent(ref)}`;
	try {
		const alerts = ghJson(`repos/${repo}/code-scanning/alerts?state=open&per_page=100&${q}`);
		let analysisCount = null;
		try {
			const analyses = ghJson(`repos/${repo}/code-scanning/analyses?per_page=1&${q}`);
			analysisCount = Array.isArray(analyses) ? analyses.length : null;
		} catch (e) {
			// analyses だけ落ちた場合も「検査できていない」扱いにする (0 件と同義に倒さない)。
			return {
				alerts: Array.isArray(alerts) ? alerts : [],
				analysisCount: null,
				fetchError: `analyses 取得失敗: ${e instanceof Error ? e.message : String(e)}`,
			};
		}
		return { alerts: Array.isArray(alerts) ? alerts : [], analysisCount, fetchError: null };
	} catch (e) {
		return {
			alerts: [],
			analysisCount: null,
			fetchError: e instanceof Error ? e.message : String(e),
		};
	}
}

/** CLI 本体 (副作用: gh api / fs)
 * @param {string[]} [argv]
 * @returns {ReturnType<typeof evaluateCodeqlAlerts>}
 */
export function runCli(argv = process.argv.slice(2)) {
	const inputPath = argOf(argv, '--input');
	if (inputPath) {
		// 既に書き出した結果を読んで enforcement だけ行う (CI の 2 step 構成用)。
		const result = JSON.parse(readFileSync(inputPath, 'utf8'));
		console.log(formatCodeqlMarkdown(result));
		return result;
	}

	const repo = argOf(argv, '--repo', process.env.GITHUB_REPOSITORY || DEFAULT_REPO) ?? DEFAULT_REPO;
	const pr = argOf(argv, '--pr');
	const ref = argOf(argv, '--ref', pr ? `refs/pull/${pr}/merge` : 'refs/heads/main') ?? '';
	const baselinePath = argOf(argv, '--baseline', BASELINE_PATH) ?? BASELINE_PATH;
	const baseline = existsSync(baselinePath)
		? JSON.parse(readFileSync(baselinePath, 'utf8'))
		: { entries: null };

	const alertsFile = argOf(argv, '--alerts-file');
	const state = alertsFile
		? {
				alerts: JSON.parse(readFileSync(alertsFile, 'utf8')),
				analysisCount: Number(argOf(argv, '--analysis-count', '1')),
				fetchError: null,
			}
		: fetchCodeqlState({ repo, ref });

	const result = evaluateCodeqlAlerts({
		alerts: state.alerts,
		baseline,
		analysisCount: state.analysisCount,
		fetchError: state.fetchError,
		ref,
	});

	const outPath = argOf(argv, '--out');
	if (outPath) {
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
	}
	console.log(formatCodeqlMarkdown(result));
	return result;
}

if (isMainModule(import.meta.url)) {
	const reportOnly = process.argv.slice(2).includes('--report-only');
	const result = runCli();
	process.exit(reportOnly || result.pass ? 0 : 1);
}
