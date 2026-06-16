/**
 * scripts/audit/to-sarif.mjs (Issue #2876 — Phase B/B-4、親 #2949 / EPIC #2861)
 *
 * 監査 run の structured JSON finding 群を **valid SARIF 2.1.0 document** に変換する
 * pure function + CLI。`scripts/audit/evidence-schema.mjs` が既に finding に SARIF 互換
 * field (ruleId / level / partialFingerprints / locations) を持たせているため、本 module は
 * それらを SARIF 2.1.0 の `runs[].results[]` / `runs[].tool.driver.rules[]` 構造へ写像する
 * だけの薄い変換層である (新規 dedup ロジックは持たず evidence-schema/dedup を再利用)。
 *
 * 設計判断 (OSS 先調査 / ADR-0014 整合):
 *   `node-sarif-builder` は full report builder で本用途には過剰。出力構造は SARIF 2.1.0 OASIS
 *   spec (https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) の最小必須サブセット
 *   (version / runs / tool.driver.name / results[].ruleId / message.text / level / locations /
 *   partialFingerprints) を直接組み立てる。Code scanning / SLSA verifier 等 external tool は
 *   この最小サブセットで finding を読めるため、依存追加せず標準性を確保する (Pre-PMF、ADR-0010)。
 *
 * 本 module は副作用を持たない (I/O は runCli wrapper 側)。
 * vitest unit test: tests/unit/audit/to-sarif.test.ts
 *
 * Usage (CLI):
 *   node scripts/audit/to-sarif.mjs --in tmp/audit-evidence --out sarif.json
 *   node scripts/audit/to-sarif.mjs --in tmp/audit-evidence/security.json --out sarif.json
 *
 * 関連:
 *   - scripts/audit/evidence-schema.mjs (computeFingerprint / VALID_SARIF_LEVELS を再利用)
 *   - .claude/agents/audit-manager.md §B (evidence schema SSOT)
 *   - docs/sessions/audit-team.md §3.5 (マージ判定エビデンス基準)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFingerprint, VALID_SARIF_LEVELS } from './evidence-schema.mjs';

/** SARIF 2.1.0 JSON schema URI (OASIS 公式) */
export const SARIF_SCHEMA_URI =
	'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

/** SARIF document version (本 module が出力する固定値) */
export const SARIF_VERSION = '2.1.0';

/** severity (1-4) → SARIF level の写像 (level 欠落 finding の fallback) */
const SEVERITY_TO_LEVEL = Object.freeze({
	1: 'note',
	2: 'warning',
	3: 'error',
	4: 'error',
});

/** @param {unknown} v */
function isNonEmptyString(v) {
	return typeof v === 'string' && v.trim().length > 0;
}

/**
 * finding の SARIF level を決定する (pure)。
 * - finding.level が SARIF 許容値ならそれを採用
 * - 欠落 / 不正なら severity (1-4) から写像 (1=note / 2=warning / 3-4=error)
 * - severity も不正なら 'none' (最も安全側)
 *
 * @param {any} finding
 * @returns {'none' | 'note' | 'warning' | 'error'}
 */
export function resolveSarifLevel(finding) {
	if (VALID_SARIF_LEVELS.includes(finding?.level)) {
		return finding.level;
	}
	const sev = finding?.severity;
	if (Number.isInteger(sev) && SEVERITY_TO_LEVEL[sev]) {
		return SEVERITY_TO_LEVEL[sev];
	}
	return 'none';
}

/**
 * finding の locations を SARIF physicalLocation 配列に正規化する (pure)。
 * - finding.locations が SARIF 形式 (physicalLocation.artifactLocation.uri) ならそのまま採用
 * - 欠落時は finding.location 文字列 (例 "src/foo.ts:42") を physicalLocation に組み立てる
 *   (末尾 ":行[:列]" は region.startLine / startColumn に分離)
 *
 * @param {any} finding
 * @returns {Array<{ physicalLocation: { artifactLocation: { uri: string }, region?: { startLine: number, startColumn?: number } } }>}
 */
export function buildSarifLocations(finding) {
	if (Array.isArray(finding?.locations) && finding.locations.length > 0) {
		// 既に SARIF 互換 locations を持つ場合はそのまま採用 (uri が空なら fallback)。
		const usable = finding.locations.filter((l) =>
			isNonEmptyString(l?.physicalLocation?.artifactLocation?.uri),
		);
		if (usable.length > 0) return usable;
	}

	const loc = isNonEmptyString(finding?.location) ? finding.location.trim() : '';
	if (!loc) {
		// SARIF result は location 配列を省略可能 (空配列) だが、本監査では出所を必ず残す。
		return [{ physicalLocation: { artifactLocation: { uri: 'unknown' } } }];
	}

	const m = loc.match(/^(.*?):(\d+)(?::(\d+))?\s*$/);
	if (m) {
		const uri = m[1].replace(/\\/g, '/');
		/** @type {{ startLine: number, startColumn?: number }} */
		const region = { startLine: Number(m[2]) };
		if (m[3] !== undefined) region.startColumn = Number(m[3]);
		return [{ physicalLocation: { artifactLocation: { uri }, region } }];
	}
	return [{ physicalLocation: { artifactLocation: { uri: loc.replace(/\\/g, '/') } } }];
}

/**
 * 1 件の finding を SARIF result object に変換する (pure)。
 *
 * @param {any} finding
 * @returns {{
 *   ruleId: string,
 *   level: string,
 *   message: { text: string },
 *   locations: Array<any>,
 *   partialFingerprints: Record<string, string>,
 * }}
 */
export function findingToResult(finding) {
	const ruleId = isNonEmptyString(finding?.ruleId) ? finding.ruleId.trim() : 'unknown-rule';
	const text = isNonEmptyString(finding?.title)
		? finding.title.trim()
		: isNonEmptyString(finding?.detail)
			? finding.detail.trim()
			: '(no message)';

	// partialFingerprints は finding 側を尊重しつつ、欠落時は computeFingerprint で補完。
	/** @type {Record<string, string>} */
	let partialFingerprints = {};
	if (
		finding?.partialFingerprints &&
		typeof finding.partialFingerprints === 'object' &&
		!Array.isArray(finding.partialFingerprints) &&
		isNonEmptyString(finding.partialFingerprints.primary)
	) {
		partialFingerprints = { ...finding.partialFingerprints };
	} else {
		partialFingerprints = { primary: computeFingerprint(finding) };
	}

	return {
		ruleId,
		level: resolveSarifLevel(finding),
		message: { text },
		locations: buildSarifLocations(finding),
		partialFingerprints,
	};
}

/**
 * finding 群から SARIF rules 配列 (tool.driver.rules) を構築する (pure)。
 * ruleId を重複排除し、各 rule に最初に出現した finding の title を shortDescription として付与する。
 *
 * @param {Array<any>} findings
 * @returns {Array<{ id: string, shortDescription: { text: string } }>}
 */
export function buildSarifRules(findings) {
	/** @type {Map<string, { id: string, shortDescription: { text: string } }>} */
	const byId = new Map();
	for (const f of findings ?? []) {
		const id = isNonEmptyString(f?.ruleId) ? f.ruleId.trim() : 'unknown-rule';
		if (byId.has(id)) continue;
		const text = isNonEmptyString(f?.title) ? f.title.trim() : id;
		byId.set(id, { id, shortDescription: { text } });
	}
	return [...byId.values()];
}

/**
 * finding 配列を valid SARIF 2.1.0 document に変換する (pure)。
 * 空入力では valid な空 SARIF (results: [] / rules: []) を返す。
 *
 * @param {Array<any>} findings finding オブジェクト配列 (evidence の findings を flatten 済)
 * @param {{ toolName?: string, toolVersion?: string, informationUri?: string }} [opts]
 * @returns {{
 *   $schema: string,
 *   version: string,
 *   runs: Array<{
 *     tool: { driver: { name: string, version?: string, informationUri?: string, rules: Array<any> } },
 *     results: Array<any>,
 *   }>,
 * }}
 */
export function toSarif(findings, opts = {}) {
	const list = Array.isArray(findings) ? findings : [];
	const toolName = isNonEmptyString(opts.toolName) ? opts.toolName : 'ganbari-quest-audit';
	/** @type {{ name: string, version?: string, informationUri?: string, rules: Array<any> }} */
	const driver = { name: toolName, rules: buildSarifRules(list) };
	if (isNonEmptyString(opts.toolVersion)) driver.version = opts.toolVersion;
	if (isNonEmptyString(opts.informationUri)) driver.informationUri = opts.informationUri;

	return {
		$schema: SARIF_SCHEMA_URI,
		version: SARIF_VERSION,
		runs: [
			{
				tool: { driver },
				results: list.map(findingToResult),
			},
		],
	};
}

/**
 * evidence file / dir から findings を flatten する (pure、入力は parse 済 JSON 配列)。
 * 各 evidence は { findings: [...] } 形式。findings を持たない要素は無視する。
 *
 * @param {Array<any>} evidences parse 済 evidence オブジェクト配列
 * @returns {Array<any>} flatten 済 finding 配列
 */
export function flattenFindings(evidences) {
	/** @type {any[]} */
	const out = [];
	for (const ev of evidences ?? []) {
		if (Array.isArray(ev?.findings)) out.push(...ev.findings);
	}
	return out;
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

/**
 * --in が指す path (file or dir) から evidence JSON 群を読み込む (副作用: fs read)。
 * dir の場合は配下の *.json を全て読み込む。
 *
 * @param {string} inPath
 * @returns {Array<any>} parse 済 evidence オブジェクト配列
 */
function readEvidences(inPath) {
	/** @type {any[]} */
	const evidences = [];
	if (!existsSync(inPath)) {
		console.error(`[to-sarif] --in path が存在しません: ${inPath}`);
		return evidences;
	}
	const st = statSync(inPath);
	/** @type {string[]} */
	const files = st.isDirectory()
		? readdirSync(inPath)
				.filter((n) => n.endsWith('.json'))
				.map((n) => join(inPath, n))
		: [inPath];
	for (const file of files) {
		try {
			evidences.push(JSON.parse(readFileSync(file, 'utf8')));
		} catch (e) {
			console.error(`[to-sarif] ${file} の JSON parse に失敗 — skip: ${e}`);
		}
	}
	return evidences;
}

/** CLI 本体 (副作用: fs read/write)
 * @param {string[]} [argv]
 * @returns {{ sarif: ReturnType<typeof toSarif>, outPath: string }}
 */
export function runCli(argv = process.argv.slice(2)) {
	const inPath = argOf(argv, '--in', 'tmp/audit-evidence');
	const outPath = argOf(argv, '--out', 'sarif.json');
	const toolVersion = argOf(argv, '--tool-version', process.env.GITHUB_SHA || undefined);

	const evidences = readEvidences(/** @type {string} */ (inPath));
	const findings = flattenFindings(evidences);
	const sarif = toSarif(findings, {
		toolName: 'ganbari-quest-audit',
		toolVersion,
		informationUri: 'https://github.com/Takenori-Kusaka/ganbari-quest',
	});

	const dir = dirname(/** @type {string} */ (outPath));
	if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
	writeFileSync(/** @type {string} */ (outPath), `${JSON.stringify(sarif, null, 2)}\n`);
	console.log(
		`[to-sarif] ${findings.length} finding → ${sarif.runs[0].results.length} result / ${sarif.runs[0].tool.driver.rules.length} rule → ${outPath}`,
	);
	return { sarif, outPath: /** @type {string} */ (outPath) };
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
