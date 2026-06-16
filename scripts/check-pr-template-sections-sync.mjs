#!/usr/bin/env node
/**
 * scripts/check-pr-template-sections-sync.mjs — Issue #2060 / #2950
 *
 * PR template (`.md`) の `## ` 見出しと、対応する section SSOT JSON の `sections` 配列が
 * 完全一致するかを検証する CI gate。**複数の template / JSON ペアを 1 本の gate で検証する**。
 *
 * 検証ペア (PAIRS):
 *   1. feature PR (feature → develop):
 *        `.github/PULL_REQUEST_TEMPLATE.md` ↔ `.github/PR_TEMPLATE_SECTIONS.json` (#2060)
 *   2. integration PR (develop → main、1 日 1 回 / 複数 PR 集約 / Issue 非紐づけ):
 *        `.github/INTEGRATION_PR_TEMPLATE.md` ↔ `.github/INTEGRATION_PR_TEMPLATE_SECTIONS.json` (#2950)
 *
 * 設計背景:
 *   - PR #2039 / #2043 で「必須セクション 12 件全欠落」が連続再発。
 *     `dev-open-pr` skill の Ready 化前 gate と CI workflow `必須セクションの存在確認` が
 *     hardcoded list だったため、template と CI 検証の同期が author の手動運用に依存していた。
 *   - #2060 で `.github/PR_TEMPLATE_SECTIONS.json` を SSOT 化し、template 更新で JSON も
 *     同時更新を強制する drift 検出 gate を導入。
 *   - #2950 (Phase B/B-1) で develop→main 統合 PR 専用 template を別系統で新設したため、
 *     本 gate を「複数ペア」対応に拡張し、専用 workflow を新設せず相乗りで検証する (#1442)。
 *
 * 検出する drift (各ペア共通):
 *   1. template に存在するが JSON に無い見出し (新規追加忘れ)
 *   2. JSON に存在するが template に無い見出し (template から削除されたのに JSON が古い)
 *   3. 並び順違い (template 順序が SSOT)
 *
 * Usage:
 *   node scripts/check-pr-template-sections-sync.mjs                 # 全ペア検証
 *   node scripts/check-pr-template-sections-sync.mjs --fix           # 全ペアの JSON を template から再生成
 *   node scripts/check-pr-template-sections-sync.mjs --integration   # integration ペアのみ検証
 *   node scripts/check-pr-template-sections-sync.mjs --feature       # feature ペアのみ検証
 *
 * Exit:
 *   0 = OK (全ペア一致)
 *   1 = drift 検出 (1 ペア以上)
 *   2 = internal error
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * 検証する template ↔ SSOT JSON ペア定義。
 * 新しい PR 種別 template を追加するときは本配列に 1 件足すだけで gate に乗る。
 *
 * @typedef {object} TemplatePair
 * @property {'feature'|'integration'} id ペア識別子 (CLI フィルタ用)
 * @property {string} label 人間可読ラベル (ログ用)
 * @property {string} templatePath template (`.md`) の絶対パス
 * @property {string} jsonPath SSOT JSON の絶対パス
 * @property {string} description `--fix` で再生成する JSON の `description` フィールド
 * @property {string} source `--fix` で再生成する JSON の `source` フィールド (template 相対パス)
 */

/** @type {TemplatePair[]} */
const PAIRS = [
	{
		id: 'feature',
		label: 'feature PR (feature → develop)',
		templatePath: join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'),
		jsonPath: join(repoRoot, '.github', 'PR_TEMPLATE_SECTIONS.json'),
		description:
			'Issue #2060 SSOT: PR body 必須セクション (## 見出し) 一覧。.github/PULL_REQUEST_TEMPLATE.md からこの JSON を生成し、CI workflow / dev-open-pr skill / scripts/check-pr-body.mjs が共通参照する。template 更新時は本 JSON も同時更新が必要 (CI gate: scripts/check-pr-template-sections-sync.mjs)。',
		source: '.github/PULL_REQUEST_TEMPLATE.md',
	},
	{
		id: 'integration',
		label: 'integration PR (develop → main)',
		templatePath: join(repoRoot, '.github', 'INTEGRATION_PR_TEMPLATE.md'),
		jsonPath: join(repoRoot, '.github', 'INTEGRATION_PR_TEMPLATE_SECTIONS.json'),
		description:
			'Issue #2950 SSOT: 統合 PR (develop→main) 本文の必須セクション (## 見出し) 一覧。.github/INTEGRATION_PR_TEMPLATE.md からこの JSON を生成し、check-pr-template-sections-sync.yml が同期を検証する。feature 用 PR_TEMPLATE_SECTIONS.json とは別系統 (統合 PR は単一 Issue 非紐づけ・複数 PR 集約・1 日 1 回発行)。template 更新時は本 JSON も同時更新が必要 (CI gate: scripts/check-pr-template-sections-sync.mjs --integration)。',
		source: '.github/INTEGRATION_PR_TEMPLATE.md',
	},
];

/**
 * `.github/PULL_REQUEST_TEMPLATE.md` から `^## ` 見出しを抽出する。
 * scripts/check-pr-body.mjs の extractRequiredSections と一致させる。
 *
 * @param {string} template
 * @returns {string[]}
 */
export function extractTemplateSections(template) {
	return template
		.split('\n')
		.filter((line) => /^## (?!#)/.test(line))
		.map((line) => line.trimEnd());
}

/**
 * JSON SSOT から sections を読む。
 * @param {string} jsonText
 * @returns {string[]}
 */
export function extractJsonSections(jsonText) {
	const data = JSON.parse(jsonText);
	if (!Array.isArray(data.sections)) {
		throw new Error('PR_TEMPLATE_SECTIONS.json: "sections" must be array');
	}
	return data.sections.map((/** @type {unknown} */ s) => String(s));
}

/**
 * @param {string[]} fromTemplate
 * @param {string[]} fromJson
 * @returns {{ missingInJson: string[]; extraInJson: string[]; orderMismatch: boolean }}
 */
export function diffSections(fromTemplate, fromJson) {
	const tplSet = new Set(fromTemplate);
	const jsonSet = new Set(fromJson);
	const missingInJson = fromTemplate.filter((s) => !jsonSet.has(s));
	const extraInJson = fromJson.filter((s) => !tplSet.has(s));
	const sameItems =
		fromTemplate.length === fromJson.length &&
		missingInJson.length === 0 &&
		extraInJson.length === 0;
	const orderMismatch = sameItems && fromTemplate.some((s, i) => fromJson[i] !== s);
	return { missingInJson, extraInJson, orderMismatch };
}

/**
 * `--fix` で再生成する JSON 本体。Biome が tab indent を要求するため `\t` で生成する
 * (section JSON を biome check が pass する形)。
 *
 * @param {TemplatePair} pair
 * @param {string[]} sections
 * @returns {string}
 */
function buildJsonContent(pair, sections) {
	/** @type {{ $schema: string; description: string; source: string; sections: string[] }} */
	const data = {
		$schema: './PR_TEMPLATE_SECTIONS.schema.json',
		description: pair.description,
		source: pair.source,
		sections,
	};
	return `${JSON.stringify(data, null, '\t')}\n`;
}

function parseArgs() {
	const argv = process.argv.slice(2);
	const onlyIds = [];
	if (argv.includes('--integration')) onlyIds.push('integration');
	if (argv.includes('--feature')) onlyIds.push('feature');
	return {
		fix: argv.includes('--fix'),
		help: argv.includes('--help') || argv.includes('-h'),
		onlyIds,
	};
}

function printHelp() {
	console.log(`
check-pr-template-sections-sync.mjs — PR template / SSOT JSON 同期検証 (Issue #2060 / #2950)

Usage:
  node scripts/check-pr-template-sections-sync.mjs                 # 全ペア検証
  node scripts/check-pr-template-sections-sync.mjs --fix           # 全ペアの JSON を template から再生成
  node scripts/check-pr-template-sections-sync.mjs --integration   # integration ペアのみ検証
  node scripts/check-pr-template-sections-sync.mjs --feature       # feature ペアのみ検証

Pairs:
  feature      .github/PULL_REQUEST_TEMPLATE.md           ↔ .github/PR_TEMPLATE_SECTIONS.json
  integration  .github/INTEGRATION_PR_TEMPLATE.md         ↔ .github/INTEGRATION_PR_TEMPLATE_SECTIONS.json

Exit codes:
  0 = OK (全ペア一致)
  1 = drift 検出 (fix オプションで再生成)
  2 = internal error
`);
}

/**
 * 1 ペアの template ↔ JSON 同期を検証する (必要なら `--fix` で再生成)。
 *
 * @param {TemplatePair} pair
 * @param {boolean} fix
 * @returns {{ status: 'ok'|'fixed'|'drift'|'error' }}
 */
function checkPair(pair, fix) {
	if (!existsSync(pair.templatePath)) {
		console.error(
			`[check-pr-template-sections-sync] (${pair.id}) ERROR: template が見つかりません: ${pair.templatePath}`,
		);
		return { status: 'error' };
	}
	if (!existsSync(pair.jsonPath)) {
		console.error(
			`[check-pr-template-sections-sync] (${pair.id}) ERROR: SSOT JSON が見つかりません: ${pair.jsonPath}`,
		);
		return { status: 'error' };
	}

	const template = readFileSync(pair.templatePath, 'utf-8');
	const ssotRaw = readFileSync(pair.jsonPath, 'utf-8');

	const fromTemplate = extractTemplateSections(template);
	let fromJson;
	try {
		fromJson = extractJsonSections(ssotRaw);
	} catch (err) {
		console.error(
			`[check-pr-template-sections-sync] (${pair.id}) ERROR: JSON parse 失敗:`,
			err instanceof Error ? err.message : err,
		);
		return { status: 'error' };
	}

	const diff = diffSections(fromTemplate, fromJson);
	const inSync =
		diff.missingInJson.length === 0 && diff.extraInJson.length === 0 && !diff.orderMismatch;

	if (inSync) {
		console.log(
			`[check-pr-template-sections-sync] OK — ${pair.label}: ${fromTemplate.length} 件 sync 状態`,
		);
		return { status: 'ok' };
	}

	if (fix) {
		writeFileSync(pair.jsonPath, buildJsonContent(pair, fromTemplate), 'utf-8');
		console.log(
			`[check-pr-template-sections-sync] FIXED — ${pair.label}: JSON を template から再生成しました (${fromTemplate.length} 件)`,
		);
		return { status: 'fixed' };
	}

	console.error(
		`[check-pr-template-sections-sync] FAIL — ${pair.label}: template と JSON が乖離しています:`,
	);
	if (diff.missingInJson.length > 0) {
		console.error(`\n  template には在るが JSON に無い (${diff.missingInJson.length} 件):`);
		for (const s of diff.missingInJson) console.error(`    + ${s}`);
	}
	if (diff.extraInJson.length > 0) {
		console.error(`\n  JSON には在るが template に無い (${diff.extraInJson.length} 件):`);
		for (const s of diff.extraInJson) console.error(`    - ${s}`);
	}
	if (diff.orderMismatch) {
		console.error('\n  並び順が異なります (template 順序が SSOT)');
		console.error('  expected:', fromTemplate);
		console.error('  actual:  ', fromJson);
	}
	const fixFlag = pair.id === 'feature' ? '--fix' : `--fix --${pair.id}`;
	console.error(
		`\n対応: \`node scripts/check-pr-template-sections-sync.mjs ${fixFlag}\` で JSON を再生成してください。`,
	);
	return { status: 'drift' };
}

/**
 * @returns {Promise<number>}
 */
export async function main() {
	const args = parseArgs();
	if (args.help) {
		printHelp();
		return 0;
	}

	const targets =
		args.onlyIds.length > 0 ? PAIRS.filter((p) => args.onlyIds.includes(p.id)) : PAIRS;

	let hasError = false;
	let hasDrift = false;
	for (const pair of targets) {
		const { status } = checkPair(pair, args.fix);
		if (status === 'error') hasError = true;
		if (status === 'drift') hasDrift = true;
	}

	if (hasError) return 2;
	if (hasDrift) return 1;
	return 0;
}

const isMain = (() => {
	try {
		const here = resolve(fileURLToPath(import.meta.url));
		const argv1 = resolve(process.argv[1] || '');
		return here === argv1;
	} catch {
		return false;
	}
})();

if (isMain) {
	main()
		.then((code) => process.exit(code))
		.catch((err) => {
			console.error('[check-pr-template-sections-sync] internal error:', err);
			process.exit(2);
		});
}
