#!/usr/bin/env node
/**
 * scripts/check-cdk-cfn-lint.mjs — Issue #3874 Layer 1 (synth 静的 lint gate)
 *
 * CDK が synth する CloudFormation template (`infra/cdk.out/*.template.json`) を cfn-lint で
 * 静的検査し、AWS::* リソースの property 制約違反 (charset / allowed-value / type) を
 * **deploy 前 (synth 時点)** に hard-fail させる shift-left gate。
 *
 * 背景 (#3870 / 第16回リリース):
 *   `AWS::IAM::Role.Description` に日本語 (非-ASCII) を入れたことで IAM の ASCII/Latin-1 制約
 *   (U+00FF 上限) に違反 → 本番 deploy で `InvalidRequest` → CREATE_FAILED → stack rollback。
 *   この class は synth 成功・unit test 通過・staging すり抜けで「本番 deploy で初露見」する。
 *   cfn-lint rule **E3031** が `AWS::IAM::Role.Description` の schema pattern
 *   (許容 = U+0009 / U+000A / U+000D / U+0020-U+007E / U+00A1-U+00FF) を synth 時点で検査し捕捉する。
 *
 * 役割分担 (#3874 Layer 1 / Layer 2):
 *   - cfn-lint (本 gate)      = AWS schema 由来の**網羅的** property 制約 (汎用・自動・全リソース)
 *   - assertion fitness       = project 固有の意図 (`tests/unit/infra/*.test.ts`、logical ID 固定 /
 *                               IAM description ASCII / cross-stack export ratchet 等)
 *   両者は補完関係。cfn-lint は「AWS が受け付けない template」を、assertion は「本 project が
 *   壊してはいけない不変条件」を守る。
 *
 * gate semantics:
 *   error (E ルール) のみ hard-fail。warning / informational は advisory
 *   (`--non-zero-exit-code error`)。CDK 生成テンプレのノイズ (W3005 等) は `infra/.cfnlintrc`
 *   の ignore_checks で抑制し false-positive ゼロにする。
 *
 * Usage:
 *   node scripts/check-cdk-cfn-lint.mjs              # synth → cfn-lint (CI / local 共通)
 *   node scripts/check-cdk-cfn-lint.mjs --skip-synth # 既存 cdk.out を再 synth せず lint のみ
 *   CFN_LINT_BIN=/path/to/cfn-lint node scripts/check-cdk-cfn-lint.mjs  # cfn-lint 実体を明示
 *
 * 依存: cfn-lint (Python、`pip install cfn-lint`)。CI は `cdk-cfn-lint` job が pin 版を install する。
 *       本番 bundle には一切含まれない (Python dev tool、外部送信なし、AWS 認証不要、offline)。
 *
 * exit:
 *   0 = OK (E ルール違反なし)
 *   1 = 準備エラー (cfn-lint 不在 / synth 失敗)
 *   2 = cfn-lint が property 制約違反 (E ルール) を検出
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const infraDir = join(repoRoot, 'infra');
const cdkOutDir = join(infraDir, 'cdk.out');
const cfnlintrc = join(infraDir, '.cfnlintrc');

/**
 * `cdk synth --all` に渡す context。addError guard (parentGateCookieSecret / opsSecretKey /
 * dsqlEndpoint / dsqlClusterArn 非空要求) を満たす**非秘密のダミー値**と、全 stack を synth 対象に
 * するための context gate (dsqlEnabled / dsqlStagingEnabled / stagingEnabled) で構成する。
 * これにより #3870 の DsqlBackupRole を含む全 stack (prod 6 + Dsql + DsqlStaging + staging 3 = 11)
 * を cfn-lint の検査対象にする (`tests/unit/infra/iam-role-description-ascii.test.ts` と同じ網羅性)。
 */
const SYNTH_CONTEXT = [
	['parentGateCookieSecret', 'cfnlint-dummy-parent-gate-secret-0000000000'],
	['opsSecretKey', 'cfnlint-dummy-ops-secret-key'],
	['dsqlEndpoint', 'cfnlintdummy1234.dsql.us-east-1.on.aws'],
	['dsqlClusterArn', 'arn:aws:dsql:us-east-1:000000000000:cluster/cfnlintdummy1234'],
	['dsqlEnabled', 'true'],
	['dsqlStagingEnabled', 'true'],
	['stagingEnabled', 'true'],
];

/** cfn-lint 実体を解決する。CFN_LINT_BIN で明示可 (Windows で Scripts が PATH 外の場合等)。 */
function resolveCfnLintBin() {
	return process.env.CFN_LINT_BIN || 'cfn-lint';
}

function fail(message, code = 1) {
	console.error(`[check-cdk-cfn-lint] ✗ ${message}`);
	process.exit(code);
}

function main() {
	const skipSynth = process.argv.includes('--skip-synth');
	const cfnLint = resolveCfnLintBin();

	// --- 1. cfn-lint 実体の存在確認 (fail-closed。ADR-0006: silent skip 禁止) ---
	const versionProbe = spawnSync(cfnLint, ['--version'], { encoding: 'utf8' });
	if (versionProbe.error || versionProbe.status !== 0) {
		fail(
			`cfn-lint が見つかりません (${cfnLint})。\n` +
				'  導入: pip install "cfn-lint==1.53.0"\n' +
				'  Windows で Scripts が PATH 外の場合は CFN_LINT_BIN で実体を指定:\n' +
				'    CFN_LINT_BIN="$LOCALAPPDATA/Programs/Python/Python3xx/Scripts/cfn-lint.exe" node scripts/check-cdk-cfn-lint.mjs\n' +
				'  本 gate は fail-closed です (cfn-lint 不在で PASS しません)。',
			1,
		);
	}
	console.log(`[check-cdk-cfn-lint] cfn-lint: ${versionProbe.stdout.trim()}`);

	// --- 2. cdk synth --all (全 stack の template を cdk.out に生成) ---
	if (!skipSynth) {
		// npx は Windows で npx.cmd。Node の .cmd spawn 制約 (要 shell) を跨ぐため
		// shell:true + コマンド文字列で起動する (context 値は controlled constant、注入リスクなし)。
		const ctxFlags = SYNTH_CONTEXT.map(([k, v]) => `-c "${k}=${v}"`).join(' ');
		const synthCmd = `npx cdk synth --all --quiet ${ctxFlags}`;
		console.log('[check-cdk-cfn-lint] cdk synth --all (dummy context、全 11 stack)...');
		const synth = spawnSync(synthCmd, {
			cwd: infraDir,
			stdio: 'inherit',
			shell: true,
			// synth の addError guard を満たすダミー account (env-agnostic stack 合成)。
			env: {
				...process.env,
				CDK_DEFAULT_ACCOUNT: process.env.CDK_DEFAULT_ACCOUNT || '000000000000',
			},
		});
		if (synth.error) {
			fail(`cdk synth の起動に失敗しました: ${synth.error.message}`, 1);
		}
		if (synth.status !== 0) {
			fail(`cdk synth が失敗しました (exit ${synth.status})。infra/ の依存 (npm ci) を確認。`, 1);
		}
	}

	// --- 3. cdk.out の template ファイルを列挙 (glob をシェルに委ねず自前展開) ---
	if (!existsSync(cdkOutDir)) {
		fail(`${cdkOutDir} が存在しません。--skip-synth 指定時は事前に cdk synth が必要です。`, 1);
	}
	const templates = readdirSync(cdkOutDir)
		.filter((f) => f.endsWith('.template.json'))
		.map((f) => join(cdkOutDir, f))
		.sort();
	if (templates.length === 0) {
		fail(`${cdkOutDir} に *.template.json がありません (synth 空振り)。`, 1);
	}
	console.log(`[check-cdk-cfn-lint] 検査対象 ${templates.length} template:`);
	for (const t of templates) console.log(`  - ${t.replace(repoRoot, '.').replace(/\\/g, '/')}`);

	// --- 4. cfn-lint 実行 (error のみ hard-fail、CDK ノイズは .cfnlintrc で抑制) ---
	const lintArgs = ['--config-file', cfnlintrc, '--non-zero-exit-code', 'error', ...templates];
	const lint = spawnSync(cfnLint, lintArgs, { stdio: 'inherit' });
	if (lint.error) {
		fail(`cfn-lint の起動に失敗しました: ${lint.error.message}`, 1);
	}
	if (lint.status !== 0) {
		fail(
			'cfn-lint が property 制約違反 (E ルール) を検出しました。\n' +
				'  上記 E##### を修正してください (例: E3031 = IAM Role/ManagedPolicy Description の非-ASCII、#3870)。\n' +
				'  IAM description は英語 ASCII で書き、日本語の背景はコード直上のコメントに記載します。',
			2,
		);
	}

	console.log('[check-cdk-cfn-lint] ✓ PASS — property 制約違反 (E ルール) なし');
}

main();
