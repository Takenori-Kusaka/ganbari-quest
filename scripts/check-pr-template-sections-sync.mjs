#!/usr/bin/env node
/**
 * scripts/check-pr-template-sections-sync.mjs — Issue #2060
 *
 * `.github/PULL_REQUEST_TEMPLATE.md` の `## ` 見出しと
 * `.github/PR_TEMPLATE_SECTIONS.json` の `sections` 配列が完全一致するかを検証する CI gate。
 *
 * 設計背景:
 *   - PR #2039 / #2043 で「必須セクション 12 件全欠落」が連続再発。
 *     `dev-open-pr` skill の Ready 化前 gate と CI workflow `必須セクションの存在確認` が
 *     hardcoded list だったため、template と CI 検証の同期が author の手動運用に依存していた。
 *   - 本 Issue で `.github/PR_TEMPLATE_SECTIONS.json` を新規 SSOT 化し、
 *     template が更新されたら本 JSON も同時更新を強制する drift 検出 gate を導入する。
 *
 * 検出する drift:
 *   1. template に存在するが JSON に無い見出し (新規追加忘れ)
 *   2. JSON に存在するが template に無い見出し (template から削除されたのに JSON が古い)
 *   3. 並び順違い (template 順序が SSOT)
 *
 * Usage:
 *   node scripts/check-pr-template-sections-sync.mjs           # 検証のみ
 *   node scripts/check-pr-template-sections-sync.mjs --fix     # JSON を template から自動再生成
 *
 * Exit:
 *   0 = OK (一致)
 *   1 = drift 検出
 *   2 = internal error
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const TEMPLATE_PATH = join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md');
const SSOT_JSON_PATH = join(repoRoot, '.github', 'PR_TEMPLATE_SECTIONS.json');

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
 * (`.github/PR_TEMPLATE_SECTIONS.json` を biome check が pass する形)。
 *
 * @param {string[]} sections
 * @returns {string}
 */
function buildJsonContent(sections) {
	/** @type {{ $schema: string; description: string; source: string; sections: string[] }} */
	const data = {
		$schema: './PR_TEMPLATE_SECTIONS.schema.json',
		description:
			'Issue #2060 SSOT: PR body 必須セクション (## 見出し) 一覧。.github/PULL_REQUEST_TEMPLATE.md からこの JSON を生成し、CI workflow / dev-open-pr skill / scripts/check-pr-body.mjs が共通参照する。template 更新時は本 JSON も同時更新が必要 (CI gate: scripts/check-pr-template-sections-sync.mjs)。',
		source: '.github/PULL_REQUEST_TEMPLATE.md',
		sections,
	};
	return `${JSON.stringify(data, null, '\t')}\n`;
}

function parseArgs() {
	const argv = process.argv.slice(2);
	return {
		fix: argv.includes('--fix'),
		help: argv.includes('--help') || argv.includes('-h'),
	};
}

function printHelp() {
	console.log(`
check-pr-template-sections-sync.mjs — PR template / SSOT JSON 同期検証 (Issue #2060)

Usage:
  node scripts/check-pr-template-sections-sync.mjs           # 検証のみ
  node scripts/check-pr-template-sections-sync.mjs --fix     # JSON を template から自動再生成

Files:
  .github/PULL_REQUEST_TEMPLATE.md       (template SSOT)
  .github/PR_TEMPLATE_SECTIONS.json      (派生 SSOT、本 CLI が同期保証)

Exit codes:
  0 = OK (一致)
  1 = drift 検出 (fix オプションで再生成)
  2 = internal error
`);
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
	if (!existsSync(TEMPLATE_PATH)) {
		console.error(
			`[check-pr-template-sections-sync] ERROR: template が見つかりません: ${TEMPLATE_PATH}`,
		);
		return 2;
	}
	if (!existsSync(SSOT_JSON_PATH)) {
		console.error(
			`[check-pr-template-sections-sync] ERROR: SSOT JSON が見つかりません: ${SSOT_JSON_PATH}`,
		);
		return 2;
	}

	const template = readFileSync(TEMPLATE_PATH, 'utf-8');
	const ssotRaw = readFileSync(SSOT_JSON_PATH, 'utf-8');

	const fromTemplate = extractTemplateSections(template);
	let fromJson;
	try {
		fromJson = extractJsonSections(ssotRaw);
	} catch (err) {
		console.error(
			'[check-pr-template-sections-sync] ERROR: JSON parse 失敗:',
			err instanceof Error ? err.message : err,
		);
		return 2;
	}

	const diff = diffSections(fromTemplate, fromJson);
	const inSync =
		diff.missingInJson.length === 0 && diff.extraInJson.length === 0 && !diff.orderMismatch;

	if (inSync) {
		console.log(`[check-pr-template-sections-sync] OK — ${fromTemplate.length} 件 sync 状態`);
		return 0;
	}

	if (args.fix) {
		const updated = buildJsonContent(fromTemplate);
		writeFileSync(SSOT_JSON_PATH, updated, 'utf-8');
		console.log(
			`[check-pr-template-sections-sync] FIXED — JSON を template から再生成しました (${fromTemplate.length} 件)`,
		);
		return 0;
	}

	console.error('[check-pr-template-sections-sync] FAIL — template と JSON が乖離しています:');
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
	console.error(
		'\n対応: `node scripts/check-pr-template-sections-sync.mjs --fix` で JSON を再生成してください。',
	);
	return 1;
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
