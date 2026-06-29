#!/usr/bin/env node
// @ts-nocheck — CLI gate script。unit test が import するため TS graph に入るが untyped JS の CLI ツール。
//
// scripts/check-action-sha-pin.mjs (#3298)
//
// 高権限 GitHub Actions が full-length commit SHA で pin されているかを静的検査し、
// floating tag pin (例 @v3) への regression を deterministic に hard-fail する (ADR-0061 shift-left)。
//
// 背景: 当 repo は全 Actions を floating major tag pin (例 actions/checkout@v7) で運用し dependabot が
// bump する。tag は mutable で、供給元が同一 tag を悪性コミットに再付け替えすると secrets/OIDC/write
// 権限を持つ CI で任意コード実行に至る (GitHub 公式 security hardening guide が SHA pin を推奨)。
// 特に「secret を消費する / provenance を発行する / cache を書く」高権限 action は被害が甚大。
//
// 本 gate は HIGH_PRIVILEGE_ACTIONS (SSOT below) が 40-hex commit SHA で pin されていることを保証する。
// dependabot は SHA pin + `# vX.Y.Z` コメント方式でも更新追従するため、SHA bump は本 gate を素通りする
// (= 安全な更新は妨げず、tag への巻き戻しのみ捕捉)。
//
// scope: 本 gate は高権限 action のみを対象とする。repo 全体の SHA pin 化は churn / 運用コストが大きく
// Pre-PMF (ADR-0010) で PO 判断待ちのため、本 gate では強制しない (#3298 §対応案 2)。
//
// 使用: node scripts/check-action-sha-pin.mjs
// CI: deps-supply-chain-check job (.github/ 変更時)。tag pin 検出で exit 1。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

// ---------------------------------------------------------------------------
// 高権限 Actions SSOT (#3298)
//
// SHA pin を必須とする action 名 (owner/repo、サブパス除く前方一致)。被害インパクトの根拠を reason に残す。
// 新たに secret 消費 / write 権限 / provenance / cache を扱う高権限 action を導入したら本 list に追記する。
// ---------------------------------------------------------------------------

export const HIGH_PRIVILEGE_ACTIONS = [
	{
		name: 'actions/create-github-app-token',
		reason:
			'INTEGRATION_BOT_APP_PRIVATE_KEY secret を消費し merge/write 可能な app token を発行する',
	},
	{
		name: 'actions/attest',
		reason: 'build provenance を発行する。改竄で偽 attestation が成立する',
	},
	{
		name: 'actions/cache',
		reason: 'cache を書き込む。cache poisoning で後続 job に汚染物が伝播し得る',
	},
	{
		name: 'aws-actions/configure-aws-credentials',
		reason:
			'id-token: write で本番 AWS role を assume する。悪性 re-tag で credential 窃取・本番リソース操作に直結 (#3318)',
	},
	{
		name: 'aws-actions/amazon-ecr-login',
		reason: 'ECR push 権限の docker login を行う。改竄で image 差し替え経路になり得る (#3318)',
	},
	{
		name: 'google-github-actions/auth',
		reason:
			'id-token: write 下で GCP OIDC credential を取得する third-party action。aws OIDC と構造的に等価な攻撃面 (#3457)',
	},
	{
		name: 'actions/github-script',
		reason:
			'GITHUB_TOKEN 付きで任意 JS を実行する。merge-write workflow で供給網汚染されると merge 権限奪取に直結 (#3457)',
	},
];

const SHA_RE = /^[0-9a-f]{40}$/;

/** `.github/workflows/` 配下の *.yml / *.yaml 絶対パスを返す。 */
export function listWorkflowFiles(dir = WORKFLOWS_DIR) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
		.map((f) => path.join(dir, f));
}

/**
 * workflow source 1 本を走査し、高権限 action が SHA pin でない `uses:` 行を violation で返す pure function。
 * `uses: <owner/repo>[/subpath]@<ref>` の ref が 40-hex SHA でなければ違反。owner/repo は前方一致で判定
 * (codeql-action のようなサブパス付きも owner/repo 部分で照合)。
 *
 * @param {string} source workflow YAML の本文
 * @param {string} fileRel リポジトリ相対パス (違反メッセージ用)
 * @param {{name:string, reason:string}[]} actions 高権限 action SSOT
 * @returns {{file:string, line:number, action:string, ref:string, reason:string}[]}
 */
export function findTagPinViolations(source, fileRel, actions = HIGH_PRIVILEGE_ACTIONS) {
	const violations = [];
	const lines = source.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		// `uses: owner/repo[/sub]@ref`。ref は空白前まで (末尾 `# comment` は ref に含まれない)。
		const m = line.match(/uses:\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)@(\S+)/);
		if (!m) continue;
		const usedPath = m[1];
		const ref = m[2];
		// owner/repo 前方一致 (サブパス付き action も owner/repo で照合)。
		const hit = actions.find((a) => usedPath === a.name || usedPath.startsWith(`${a.name}/`));
		if (!hit) continue;
		if (!SHA_RE.test(ref)) {
			violations.push({
				file: fileRel,
				line: i + 1,
				action: usedPath,
				ref,
				reason: hit.reason,
			});
		}
	}
	return violations;
}

/** 全 workflow を走査して violations を集約する。 */
export function scanAllWorkflows(files = listWorkflowFiles()) {
	const all = [];
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		all.push(...findTagPinViolations(source, rel));
	}
	return all;
}

function main() {
	console.log('[check-action-sha-pin] 高権限 GitHub Actions の SHA pin 検査 (#3298)');
	const violations = scanAllWorkflows();
	if (violations.length === 0) {
		console.log(
			`[check-action-sha-pin] ✓ PASS — ${HIGH_PRIVILEGE_ACTIONS.map((a) => a.name).join(', ')} は全て SHA pin`,
		);
		return 0;
	}

	console.log('\n[check-action-sha-pin] ✗ FAIL — SHA pin されていない高権限 action:\n');
	for (const v of violations) {
		console.log(`  ${v.file}:${v.line}  ${v.action}@${v.ref}`);
		console.log(`    理由: ${v.reason}`);
	}
	console.log(
		'\n修正方針 (#3298):\n' +
			'  - 該当 action を full-length commit SHA に pin し、`# vX.Y.Z` コメントで version を注記する。\n' +
			'    例: uses: actions/cache@2c8a9bd7457de244a408f35966fab2fb45fda9c8 # v6.0.0\n' +
			'  - SHA は `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha` で解決する。\n' +
			'  - dependabot は SHA pin + コメント方式でも更新追従するため運用負荷は増えない。\n' +
			'  - 新規高権限 action は scripts/check-action-sha-pin.mjs の HIGH_PRIVILEGE_ACTIONS に追記する。\n',
	);
	return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(main());
}
