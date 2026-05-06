#!/usr/bin/env node
/**
 * Dev PR body 初期化スクリプト (Issue #1863)
 *
 * 使用法:
 *   node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 1863 --kind default
 *   node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 1848 --kind lp
 *   node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 999  --kind critical-fix
 *   node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue 1234 --kind refactor-ssot --force
 *
 * 動作:
 *   1. gh issue view <num> --json title,body,labels で Issue 情報取得
 *   2. .claude/skills/dev-open-pr/templates/pr-body-<kind>.md を読み込み
 *   3. プレースホルダー置換:
 *      - {{ISSUE_NUMBER}} ← --issue 値
 *      - {{ISSUE_TITLE}} ← Issue タイトル
 *      - {{TYPE_CHECKBOXES}} ← labels の type:* から checkbox 自動 [x]
 *      - {{AC_TABLE}} ← Issue body の Acceptance Criteria 「- [ ]」行を 4 列 markdown 表化
 *   4. tmp/pr-bodies/<num>-<slug>.md に出力（既存は上書きしない、--force で上書き可）
 *
 * SSOT: .claude/skills/dev-open-pr/SKILL.md
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(SKILL_ROOT, 'templates');
const REPO_ROOT = resolve(SKILL_ROOT, '..', '..', '..');
const TMP_DIR = join(REPO_ROOT, 'tmp', 'pr-bodies');

const VALID_KINDS = /** @type {const} */ (['default', 'lp', 'critical-fix', 'refactor-ssot']);

const TYPE_LABEL_TO_CHECKBOX = {
	'type:feat': 'feat: 新機能',
	'type:fix': 'fix: バグ修正',
	'type:refactor': 'refactor: リファクタリング',
	'type:design': 'design: デザイン・UI改善',
	'type:infra': 'infra: インフラ・CI/CD',
	'type:test': 'test: テスト改善',
	'type:docs': 'docs: ドキュメント',
	'type:marketing': 'marketing: マーケティング・LP',
};

const ALL_TYPE_CHECKBOX_LINES = [
	'feat: 新機能',
	'fix: バグ修正',
	'refactor: リファクタリング',
	'design: デザイン・UI改善',
	'infra: インフラ・CI/CD',
	'test: テスト改善',
	'docs: ドキュメント',
	'marketing: マーケティング・LP',
];

/**
 * @returns {{ issue: string; kind: string; force: boolean; help: boolean }}
 */
function parseArgs() {
	const args = process.argv.slice(2);
	let issue = null;
	let kind = 'default';
	let force = false;
	let help = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--issue' && i + 1 < args.length) {
			issue = args[++i];
		} else if (a?.startsWith('--issue=')) {
			issue = a.slice('--issue='.length);
		} else if (a === '--kind' && i + 1 < args.length) {
			kind = args[++i];
		} else if (a?.startsWith('--kind=')) {
			kind = a.slice('--kind='.length);
		} else if (a === '--force' || a === '-f') {
			force = true;
		} else if (a === '--help' || a === '-h') {
			help = true;
		}
	}
	return { issue, kind, force, help };
}

function printHelp() {
	console.log(`
init-pr-body.mjs — Dev PR body 雛形初期化 (Issue #1863)

Usage:
  node .claude/skills/dev-open-pr/scripts/init-pr-body.mjs --issue <num> [--kind <kind>] [--force]
  npm run dev:open-pr -- --issue <num> --kind <kind>

Options:
  --issue <num>   GitHub Issue 番号（必須）
  --kind <kind>   雛形種別。既定 default。選択肢: ${VALID_KINDS.join(' / ')}
  --force, -f     既存の tmp/pr-bodies/<num>-<slug>.md を上書き
  --help, -h      このヘルプを表示

Output:
  tmp/pr-bodies/<issue-num>-<slug>.md

Placeholder replacement:
  {{ISSUE_NUMBER}}       ← --issue 値
  {{ISSUE_TITLE}}        ← gh issue view から取得
  {{TYPE_CHECKBOXES}}    ← labels (type:*) を自動 [x] 化
  {{AC_TABLE}}           ← Issue body Acceptance Criteria を 4 列 markdown 表化

詳細: .claude/skills/dev-open-pr/SKILL.md
`);
}

/**
 * @param {string} title
 * @returns {string} kebab-case slug (max 40 chars, ASCII only fallback)
 */
export function toSlug(title) {
	if (!title) return 'pr';
	// Issue title から ASCII 部分を優先抽出。日本語タイトルでも `:`・`#` 後の英数字を拾う
	let normalized = title
		.replace(/[#:]/g, ' ')
		.replace(/[^\x20-\x7E぀-ヿ一-龯]/g, ' ')
		.trim();
	// ASCII slug 化（日本語は drop して ASCII 部分だけ kebab-case 化）
	const ascii = normalized
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((s) => s.length > 0)
		.join('-');
	if (ascii.length > 0) {
		return ascii.slice(0, 40).replace(/-+$/g, '');
	}
	// ASCII が完全に取れない場合は固定 slug にフォールバック
	return 'pr';
}

/**
 * gh issue view で Issue 情報取得。
 * @param {string} num
 * @returns {{ title: string; body: string; labels: string[] }}
 */
function fetchIssue(num) {
	const raw = execSync(`gh issue view ${num} --json title,body,labels`, {
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 20_000,
	});
	const data = JSON.parse(raw);
	return {
		title: data.title || '',
		body: data.body || '',
		labels: Array.isArray(data.labels) ? data.labels.map((l) => l.name) : [],
	};
}

/**
 * Issue body から Acceptance Criteria セクションを抽出し、`- [ ]` 行を 4 列 markdown 表に変換する。
 *
 * 検出パターン:
 *   - `## Acceptance Criteria` または `## AC` (任意言語) または日本語 `## 受入条件` 等
 *   - `**AC1**:` のような bold 番号付き行も拾う
 *
 * @param {string} body
 * @returns {string} 4 列 markdown 表（ヘッダ込み）
 */
export function extractAcTable(body) {
	const headerRe = /^## (?:Acceptance Criteria|AC|受入条件|受け入れ条件)\b.*$/im;
	const startMatch = body.match(headerRe);
	let acSection;
	if (startMatch) {
		const startIdx = body.indexOf(startMatch[0]);
		const remaining = body.slice(startIdx + startMatch[0].length);
		const nextSectionIdx = remaining.search(/^## /m);
		acSection = nextSectionIdx === -1 ? remaining : remaining.slice(0, nextSectionIdx);
	} else {
		// AC 専用セクションが無い場合は body 全体から `- [ ]` 行を拾う（fallback）
		acSection = body;
	}

	const acLines = acSection
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => /^[-*]\s+\[[x ]\]/i.test(l));

	const headerRow = '| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |';
	const sepRow = '|---------|--------|---------|------------------|';

	if (acLines.length === 0) {
		// AC が抽出できない場合は 1 行ダミーを残す（穴埋め時に Agent が複製する想定）
		return [
			headerRow,
			sepRow,
			'| AC1 | <!-- Issue から AC を転記 --> | <!-- 機械検証コマンド / SS パス --> | <!-- PASS / 値 --> |',
		].join('\n');
	}

	const dataRows = acLines.map((line, idx) => {
		// `- [ ] **AC1**: 内容` / `- [x] AC1 内容` / `- [ ] 内容` の三型を吸収
		let content = line.replace(/^[-*]\s+\[[x ]\]\s*/i, '');
		// `**AC1**:` のような bold 番号付き形式を抽出
		const acIdMatch = content.match(/^\*{0,2}(AC\d+|AC-\d+|\d+\.?)\*{0,2}\s*[:：]?\s*/i);
		let acId;
		let acBody;
		if (acIdMatch) {
			acId = acIdMatch[1].replace(/^\d+\.?$/, (s) => `AC${s.replace(/\.$/, '')}`);
			acBody = content.slice(acIdMatch[0].length).trim();
		} else {
			acId = `AC${idx + 1}`;
			acBody = content.trim();
		}
		// `|` をセル内で escape
		const safeBody = acBody.replace(/\|/g, '\\|').slice(0, 200);
		return `| ${acId} | ${safeBody} | <!-- 機械検証コマンド / SS パス --> | <!-- PASS / 値 --> |`;
	});

	return [headerRow, sepRow, ...dataRows].join('\n');
}

/**
 * labels の type:* から PR template の変更タイプ checkbox を組み立てる。
 * Issue に該当 type label があれば `[x]`、無ければ `[ ]`。
 *
 * @param {string[]} labels
 * @returns {string}
 */
export function buildTypeCheckboxes(labels) {
	const matchedDescriptions = new Set();
	for (const label of labels) {
		const desc = TYPE_LABEL_TO_CHECKBOX[label];
		if (desc) matchedDescriptions.add(desc);
	}
	return ALL_TYPE_CHECKBOX_LINES.map((desc) =>
		matchedDescriptions.has(desc) ? `- [x] ${desc}` : `- [ ] ${desc}`,
	).join('\n');
}

/**
 * テンプレートのプレースホルダーを置換する。
 *
 * @param {string} template
 * @param {{ issueNumber: string; issueTitle: string; acTable: string; typeCheckboxes: string }} ctx
 * @returns {string}
 */
export function renderTemplate(template, ctx) {
	return template
		.replaceAll('{{ISSUE_NUMBER}}', ctx.issueNumber)
		.replaceAll('{{ISSUE_TITLE}}', ctx.issueTitle)
		.replaceAll('{{AC_TABLE}}', ctx.acTable)
		.replaceAll('{{TYPE_CHECKBOXES}}', ctx.typeCheckboxes);
}

async function main() {
	const args = parseArgs();
	if (args.help) {
		printHelp();
		return 0;
	}
	if (!args.issue) {
		console.error('エラー: --issue <num> は必須です');
		printHelp();
		return 1;
	}
	if (!/^\d+$/.test(args.issue)) {
		console.error(`エラー: --issue は数値のみ。受信: ${args.issue}`);
		return 1;
	}
	if (!VALID_KINDS.includes(args.kind)) {
		console.error(`エラー: --kind は ${VALID_KINDS.join(' / ')} のいずれか。受信: ${args.kind}`);
		return 1;
	}

	const templatePath = join(TEMPLATES_DIR, `pr-body-${args.kind}.md`);
	if (!existsSync(templatePath)) {
		console.error(`エラー: 雛形ファイルが見つかりません: ${templatePath}`);
		return 2;
	}

	let issueData;
	try {
		issueData = fetchIssue(args.issue);
	} catch (err) {
		console.error('エラー: gh issue view 失敗:', err instanceof Error ? err.message : err);
		console.error('gh が認証済みであることを確認してください: gh auth status');
		return 2;
	}

	const slug = toSlug(issueData.title);
	const outputPath = join(TMP_DIR, `${args.issue}-${slug}.md`);

	if (existsSync(outputPath) && !args.force) {
		console.error(`エラー: 既存ファイルを上書きしません: ${relative(REPO_ROOT, outputPath)}`);
		console.error('--force で上書き可能');
		return 1;
	}

	mkdirSync(TMP_DIR, { recursive: true });
	const template = readFileSync(templatePath, 'utf-8');
	const rendered = renderTemplate(template, {
		issueNumber: args.issue,
		issueTitle: issueData.title,
		acTable: extractAcTable(issueData.body),
		typeCheckboxes: buildTypeCheckboxes(issueData.labels),
	});

	writeFileSync(outputPath, rendered, 'utf-8');

	console.log(`✓ PR body 雛形を生成しました`);
	console.log(`  Issue: #${args.issue} ${issueData.title}`);
	console.log(`  Kind: ${args.kind}`);
	console.log(`  Labels: ${issueData.labels.join(', ') || '(none)'}`);
	console.log(`  出力先: ${relative(REPO_ROOT, outputPath)}`);
	console.log('');
	console.log('次の手順:');
	console.log(`  1. ${relative(REPO_ROOT, outputPath)} を編集して穴埋め`);
	console.log(
		`  2. node scripts/check-pr-body.mjs --body-file ${relative(REPO_ROOT, outputPath)} --skip-mergeable で検証`,
	);
	console.log(`  3. node scripts/check-gh-account-before-pr.mjs で gh アカウント確認`);
	console.log(
		`  4. gh pr create --draft --title "<type>: #${args.issue} <subject>" --body-file ${relative(REPO_ROOT, outputPath)}`,
	);
	console.log(`  5. 完了後: rm ${relative(REPO_ROOT, outputPath)}`);
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
			console.error('init-pr-body internal error:', err);
			process.exit(2);
		});
}
