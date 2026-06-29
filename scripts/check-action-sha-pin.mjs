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
	{
		name: 'docker/build-push-action',
		reason:
			'ECR/registry に image を build & push する。改竄で本番 image 差し替え経路になり得る (#3483)',
	},
	{
		name: 'softprops/action-gh-release',
		reason:
			'contents: write で GitHub Release を作成・asset upload する third-party action。改竄で配布物汚染 (#3483)',
	},
];

// ---------------------------------------------------------------------------
// 網羅性 gate (#3483 / ADR-0061 原則 5 class-lock): HIGH_PRIVILEGE_ACTIONS の手動列挙だけだと
// 「新規高権限 third-party action を未 pin 導入しても silent に通る」no-silent-gap が残る
// (#3318→#3457→#3483 の手動追加 treadmill の root)。本 gate は **以下の write 権限クラスのいずれかを
// 付与する高権限 workflow 内の third-party action (first-party owner 以外) は SHA pin 必須**
// (default-deny) とし、floating 許容は LOW_RISK_THIRD_PARTY_ALLOWLIST に理由付き明示する。これにより
// 新規 third-party action を高権限 workflow に未 pin で足したら CI が自動 fail する (class 全体を lock)。
//
// 高権限とみなす write 権限クラス (HIGH_PRIVILEGE_PERMISSION_RE):
//   - id-token: write    … OIDC で本番クラウド role を assume (#3318 aws / #3457 gcp)
//   - contents: write    … push / release / asset upload で配布物を改変し得る
//   - pull-requests: write … PR を編集・auto-merge し得る。特に dependabot auto-merge (#3489) のように
//                            自動 merge を起動する context では、改竄 action が出力を偽造して悪性 PR の
//                            merge に直結し得る (= contents/id-token と同等の攻撃面)。#3483 当初は本クラスを
//                            取りこぼしており no-silent-gap の主張と実装が乖離していた (#3489 で是正)。
//   - packages: write    … GitHub Packages (registry) に publish し得る。配布物汚染経路
//   - permissions: write-all … 全 scope を write 付与する最大権限宣言
//
// permissions ブロックを全く持たない workflow の扱い (過剰 BLOCK ↔ silent gap のトレードオフ、#3489):
//   permissions 明示なしの workflow は repo / org の「デフォルト GITHUB_TOKEN 権限」設定に従う。
//   本 gate は **明示的な write 権限宣言**のみを高権限 context のトリガとする (default-deny の対象を明示宣言に限定)。
//   理由: 「permissions 明示なし = 高権限」とすると、ci.yml 等の多数の workflow が抱える setup 系
//   third-party action を一斉に違反化し、Pre-PMF (ADR-0010) で過大な churn を生む。デフォルト token を
//   read-only に絞る (GitHub 推奨の repo 設定 "Read repository contents permission") を第一防御線とし、
//   write が必要な workflow は permissions ブロックで明示する運用前提に乗る。この前提が崩れた場合
//   (デフォルト token が write のまま放置) は本 gate の対象外となる残余リスクであり、repo 設定側で担保する。
//   → silent gap を完全には潰さない代わりに、明示 write 宣言クラスは漏れなく lock する保守的境界を採る。
// ---------------------------------------------------------------------------

/** GitHub 公式 (actions/* / github/*)。floating tag 許容 (供給元 = GitHub 本体)。 */
export const FIRST_PARTY_OWNERS = ['actions', 'github'];

/**
 * 高権限 workflow 内でも floating を許容する低リスク third-party action の allowlist。
 * 基準: artifact/image を produce せず write 権限も持たない「setup / metadata 読取」専用 action のみ。
 * 新規追加は「produce/write 能力なし」を確認し reason を残す (default-deny の例外明示)。
 *
 * 注 (#3489): dependabot/fetch-metadata は「metadata 読取のみ」だが、dependabot-auto-merge.yml の
 * auto-merge 起動 context では出力 (update-type) の偽造が悪性 bump の自動 merge に直結し得るため、
 * allowlist 例外ではなく SHA pin を採用した (allowlist から除外)。read-only でも「起動する後続処理の
 * 危険度」で pin 要否を判断する原則の前例。
 */
export const LOW_RISK_THIRD_PARTY_ALLOWLIST = [
	{
		name: 'docker/setup-buildx-action',
		reason: 'buildx の setup のみ。artifact produce / write なし',
	},
	{ name: 'hashicorp/setup-terraform', reason: 'terraform CLI の setup のみ。produce/write なし' },
	{ name: 'dorny/paths-filter', reason: '変更パス判定の読取のみ。produce/write なし' },
];

/**
 * 高権限とみなす write 権限宣言の検出パターン (SSOT)。明示宣言クラスのみを対象とする
 * (permissions 明示なしの扱いは上記コメントのトレードオフ参照)。
 */
const HIGH_PRIVILEGE_PERMISSION_RE = [
	/\bid-token:\s*write\b/,
	/\bcontents:\s*write\b/,
	/\bpull-requests:\s*write\b/,
	/\bpackages:\s*write\b/,
	/\bpermissions:\s*write-all\b/,
];

/** workflow が高権限な write 権限クラス (id-token/contents/pull-requests/packages write or write-all) を付与する context か。 */
export function isHighPrivilegeWorkflow(source) {
	return HIGH_PRIVILEGE_PERMISSION_RE.some((re) => re.test(source));
}

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

/**
 * 網羅性 gate (#3483 / #3489): 高権限 workflow (id-token / contents / pull-requests / packages write
 * or write-all) 内で、first-party でも LOW_RISK allowlist でもない third-party action が SHA pin されて
 * いない `uses:` を violation で返す。新規 third-party action を未 pin で高権限 workflow に足したら自動検出 (no-silent-gap)。
 *
 * @param {string} source workflow YAML 本文
 * @param {string} fileRel リポジトリ相対パス
 * @returns {{file:string, line:number, action:string, ref:string, reason:string}[]}
 */
export function findHighPrivilegeContextViolations(source, fileRel) {
	if (!isHighPrivilegeWorkflow(source)) return [];
	const allowSet = new Set(LOW_RISK_THIRD_PARTY_ALLOWLIST.map((a) => a.name));
	const violations = [];
	const lines = source.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = (lines[i] ?? '').match(/uses:\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)@(\S+)/);
		if (!m) continue;
		const usedPath = m[1];
		const ref = m[2];
		const owner = usedPath.split('/')[0] ?? '';
		if (FIRST_PARTY_OWNERS.includes(owner)) continue; // GitHub 公式は floating 許容
		if (SHA_RE.test(ref)) continue; // 既に pin 済
		// owner/repo 前方一致で allowlist 判定
		const allowed = [...allowSet].some((n) => usedPath === n || usedPath.startsWith(`${n}/`));
		if (allowed) continue;
		violations.push({
			file: fileRel,
			line: i + 1,
			action: usedPath,
			ref,
			reason:
				'高権限 workflow (id-token/contents/pull-requests/packages write or write-all) 内の未 pin third-party action (#3483/#3489 網羅性 gate)。' +
				'pin するか、produce/write 能力なし + 起動する後続処理が安全なことを確認のうえ LOW_RISK_THIRD_PARTY_ALLOWLIST に reason 付きで追加する',
		});
	}
	return violations;
}

/** 全 workflow を走査して violations を集約する (named list + 網羅性 gate の両方)。 */
export function scanAllWorkflows(files = listWorkflowFiles()) {
	const all = [];
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		all.push(...findTagPinViolations(source, rel));
		all.push(...findHighPrivilegeContextViolations(source, rel));
	}
	// 同一 (file,line,action) の重複を除去 (named list と網羅 gate が同じ行を二重検出し得る)
	const seen = new Set();
	return all.filter((v) => {
		const k = `${v.file}:${v.line}:${v.action}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
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
