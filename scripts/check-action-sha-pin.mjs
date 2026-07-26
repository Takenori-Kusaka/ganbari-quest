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
// 使用: node scripts/check-action-sha-pin.mjs [--verify-default-token]
//   --verify-default-token: repo 設定 default_workflow_permissions=read を gh api で実測 assert
//   (#3494 AC2 ②、owner local audit / 月 1 棚卸用。GITHUB_TOKEN は administration:read を持てず CI 不可)
// CI: deps-supply-chain-check job (.github/ 変更時)。tag pin / top-level permissions 未宣言で exit 1。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain as isMainModule } from './lib/is-main.mjs';

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
// 高権限とみなす write 権限クラス (HIGH_PRIVILEGE_PERMISSION_RE、#3494 で generic class-lock 化):
//   **任意の permission scope への write 付与** (`<scope>: write` / `permissions: write-all`) を
//   高権限 context のトリガとする。#3483 当初の 3 クラス → #3489 で 5 クラス → #3494 で
//   issues/pages/security-events/checks/deployments/statuses/actions:write が未列挙と検出され、
//   個別列挙は #3318→#3457→#3483→#3489 と同じ「手動追加 treadmill」を write クラス次元で再生産する
//   ことが確定したため、列挙自体を廃止して generic 検出に置換した。attestations / discussions 等の
//   未列挙クラスも自動的に lock される (no-silent-gap の射程 = 明示 write 宣言の全クラス)。
//   偽陽性 (permissions ブロック外の `<key>: write` 一致、例: コメント内言及) は「高権限側に倒す」
//   fail-safe 方向のため許容する (over-classify しても要求されるのは third-party の SHA pin のみ)。
//
// permissions ブロックを全く持たない workflow の扱い (#3489 → #3494 で機械担保に昇格):
//   permissions 明示なしの workflow は repo / org の「デフォルト GITHUB_TOKEN 権限」設定に従うため、
//   本 gate は明示 write 宣言のみをトリガとし permissionless workflow を除外している (#3489)。
//   この除外は「デフォルト token = read-only」という repo 設定前提に依存し、設定 drift で silent に
//   崩れる gap があった (#3494)。以下 2 層で機械担保する:
//   ① 静的 gate (scanDefaultTokenPremise、CI 決定的): 全 workflow に top-level `permissions:` 宣言を
//      必須化し、default token に依存する workflow を構造的に排除する (job-level のみでは、将来
//      permissions 無しの job を足すと default token に落ちるため不足とする)。
//   ② repo 設定の実測 assert (verifyDefaultTokenReadOnly、`--verify-default-token` opt-in):
//      `gh api repos/{owner}/{repo}/actions/permissions/workflow` で default_workflow_permissions=read
//      を assert する。GITHUB_TOKEN は administration:read を持てず CI 常時実行は不能のため、
//      repo owner の local audit / 月 1 棚卸で実行する (opt-in flag のため silent skip は発生しない —
//      flag 指定時に照会不能なら hard fail、ADR-0024)。
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
 * 高権限とみなす write 権限宣言の検出パターン (SSOT、#3494 で generic class-lock 化)。
 * 個別クラス列挙 (5 クラス固定) は未列挙 write クラスの silent gap を残すため、
 * 「任意 scope の write 付与」を generic に検出する (詳細は上記コメント)。
 */
const HIGH_PRIVILEGE_PERMISSION_RE = [
	// `<scope>: write` — issues/pages/security-events/checks/deployments/statuses/actions を含む
	// 全 write クラス (id-token/contents/pull-requests/packages と attestations 等の未列挙も lock)
	/\b[a-z][a-z-]*:\s*write\b/,
	// `permissions: write-all` (最大権限宣言)。上の generic にも一致するが意図明示のため残す
	/\bpermissions:\s*write-all\b/,
];

/** workflow が高権限な write 権限クラス (任意 scope の write / write-all、#3494 generic) を付与する context か。 */
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
 * 網羅性 gate (#3483 / #3489 / #3494): 高権限 workflow (任意 scope の write 宣言 or write-all) 内で、
 * first-party でも LOW_RISK allowlist でもない third-party action が SHA pin されて
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
				'高権限 workflow (任意 scope の write 宣言 or write-all、#3494 generic class-lock) 内の未 pin third-party action (#3483/#3489/#3494 網羅性 gate)。' +
				'pin するか、produce/write 能力なし + 起動する後続処理が安全なことを確認のうえ LOW_RISK_THIRD_PARTY_ALLOWLIST に reason 付きで追加する',
		});
	}
	return violations;
}

/**
 * default GITHUB_TOKEN 前提の静的 gate (#3494 AC2 ①): workflow が top-level `permissions:` を
 * 宣言していなければ violation で返す。permissionless workflow は repo デフォルト token 設定に
 * 依存する (= 網羅性 gate の除外前提が設定 drift で silent に崩れる) ため、全 workflow に明示宣言を
 * 必須化して default token 依存を構造的に排除する。job-level のみの宣言は、将来 permissions 無しの
 * job を追加すると default token に落ちるため不足とする (top-level 必須)。
 *
 * @param {string} source workflow YAML 本文
 * @param {string} fileRel リポジトリ相対パス
 * @returns {{file:string, line:number, action:string, ref:string, reason:string}[]}
 */
export function findMissingTopLevelPermissionsViolations(source, fileRel) {
	// column 0 の `permissions:` (top-level key)。indent 付き (job/step-level) は不一致。
	if (/^permissions:/m.test(source)) return [];
	return [
		{
			file: fileRel,
			line: 1,
			action: '(workflow 全体)',
			ref: '-',
			reason:
				'top-level `permissions:` 宣言なし = repo デフォルト GITHUB_TOKEN 権限に依存 (#3494 AC2)。' +
				'必要最小の permissions ブロック (読取のみなら `permissions:\\n  contents: read`) を top-level に明示する',
		},
	];
}

/** 全 workflow を走査して top-level permissions 未宣言 (default token 依存) を集約する (#3494 AC2 ①)。 */
export function scanDefaultTokenPremise(files = listWorkflowFiles()) {
	const all = [];
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		all.push(...findMissingTopLevelPermissionsViolations(source, rel));
	}
	return all;
}

/** verifyDefaultTokenReadOnly の既定 exec (gh CLI 経由、test では injectable)。 */
function defaultExec(cmd) {
	return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * repo 設定の実測 assert (#3494 AC2 ②): `default_workflow_permissions` が `read` であることを
 * GitHub API で検証する。permissionless 除外 (#3489 トレードオフ) が依存する「デフォルト token =
 * read-only」前提の設定 drift を検知する。GITHUB_TOKEN は administration:read を持てないため
 * CI 常時実行は不能 — `--verify-default-token` opt-in で repo owner の local audit / 月 1 棚卸から
 * 実行する。照会不能 (未認証 / 権限不足) も fail を返す (silent skip 禁止、ADR-0024)。
 *
 * @param {(cmd: string) => string} exec コマンド実行関数 (test では injectable)
 * @returns {{ok: boolean, detail: string}}
 */
export function verifyDefaultTokenReadOnly(exec = defaultExec) {
	try {
		const out = exec('gh api "repos/{owner}/{repo}/actions/permissions/workflow"');
		const parsed = JSON.parse(String(out));
		const perm = parsed.default_workflow_permissions;
		if (perm === 'read') {
			return { ok: true, detail: 'default_workflow_permissions=read (前提成立)' };
		}
		return {
			ok: false,
			detail:
				`default_workflow_permissions=${perm} — read 以外は permissionless 除外の前提崩れ。` +
				'repo Settings > Actions > General > Workflow permissions を "Read repository contents and packages permissions" に戻す',
		};
	} catch (e) {
		return {
			ok: false,
			detail:
				`repo 設定を照会できず前提を検証不能 (silent skip 禁止、ADR-0024): ${e?.message ?? e}。` +
				'gh auth login 済みで administration:read を持つ資格情報 (repo owner) で再実行する',
		};
	}
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
	console.log('[check-action-sha-pin] 高権限 GitHub Actions の SHA pin 検査 (#3298/#3483/#3494)');
	const violations = [...scanAllWorkflows(), ...scanDefaultTokenPremise()];
	if (violations.length > 0) {
		console.log('\n[check-action-sha-pin] ✗ FAIL — SHA pin / top-level permissions 宣言の違反:\n');
		for (const v of violations) {
			console.log(`  ${v.file}:${v.line}  ${v.action}@${v.ref}`);
			console.log(`    理由: ${v.reason}`);
		}
		console.log(
			'\n修正方針 (#3298/#3494):\n' +
				'  - 該当 action を full-length commit SHA に pin し、`# vX.Y.Z` コメントで version を注記する。\n' +
				'    例: uses: actions/cache@2c8a9bd7457de244a408f35966fab2fb45fda9c8 # v6.0.0\n' +
				'  - SHA は `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha` で解決する。\n' +
				'  - dependabot は SHA pin + コメント方式でも更新追従するため運用負荷は増えない。\n' +
				'  - 新規高権限 action は scripts/check-action-sha-pin.mjs の HIGH_PRIVILEGE_ACTIONS に追記する。\n' +
				'  - top-level permissions 未宣言の workflow は必要最小の permissions ブロックを明示する (#3494 AC2)。\n',
		);
		return 1;
	}

	// #3494 AC2 ②: opt-in で repo 設定 (default_workflow_permissions=read) を実測 assert。
	// GITHUB_TOKEN では照会不能 (administration:read なし) のため CI 常時実行はせず、
	// repo owner の local audit / 月 1 棚卸 (docs/CLAUDE.md §ADR 月 1 棚卸) から実行する。
	if (process.argv.includes('--verify-default-token')) {
		const r = verifyDefaultTokenReadOnly();
		if (!r.ok) {
			console.log(
				`\n[check-action-sha-pin] ✗ FAIL — default token 前提の実測 assert: ${r.detail}\n`,
			);
			return 1;
		}
		console.log(`[check-action-sha-pin] ✓ default token 実測 assert PASS — ${r.detail}`);
	}

	console.log(
		`[check-action-sha-pin] ✓ PASS — ${HIGH_PRIVILEGE_ACTIONS.map((a) => a.name).join(', ')} は全て SHA pin、` +
			'全 workflow が top-level permissions 宣言済',
	);
	return 0;
}

if (isMainModule(import.meta.url)) {
	process.exit(main());
}
