// scripts/__tests__/check-cdk-cfn-lint.test.mjs — Issue #3874 Layer 1 AC1 回帰実証
//
// #3870 (AWS::IAM::Role.Description に日本語 → deploy rollback) 相当の property 制約違反を、
// **本 PR が同梱する gate (cfn-lint + infra/.cfnlintrc)** が synth 時点で捕捉することを実証する。
// cdk synth を経由せず handcraft した最小 template を cfn-lint に掛けることで、gate の検出力を
// 決定的に (AWS 認証 / ネット不要で) 検証する。
//
// 実行: node --test scripts/__tests__/check-cdk-cfn-lint.test.mjs
//   cfn-lint (Python) を要するため CI の `cdk-cfn-lint` job (pin 版 install 済) で走らせる。
//   cfn-lint 不在環境 (通常の unit-test job / cfn-lint 未 install の local) では skip する
//   (本テストは gate の検出力の検証であって、gate 本体ではない。gate 本体は fail-closed)。
//
// 参照: scripts/check-cdk-cfn-lint.mjs / infra/.cfnlintrc / infra/CLAUDE.md §IAM description ASCII

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const cfnlintrc = join(repoRoot, 'infra', '.cfnlintrc');
const cfnLint = process.env.CFN_LINT_BIN || 'cfn-lint';

/** cfn-lint が実行可能か (不在なら本テスト群を skip)。 */
function cfnLintAvailable() {
	const probe = spawnSync(cfnLint, ['--version'], { encoding: 'utf8' });
	return !probe.error && probe.status === 0;
}

/** 与えた IAM Role Description を持つ最小 CloudFormation template を返す。 */
function iamRoleTemplate(description) {
	return JSON.stringify({
		Resources: {
			MyRole: {
				Type: 'AWS::IAM::Role',
				Properties: {
					Description: description,
					AssumeRolePolicyDocument: {
						Version: '2012-10-17',
						Statement: [
							{
								Effect: 'Allow',
								Principal: { Service: 'backup.amazonaws.com' },
								Action: 'sts:AssumeRole',
							},
						],
					},
				},
			},
		},
	});
}

/** shipped の gate と同一設定 (config-file + fail-on-error) で cfn-lint を回す。 */
function runCfnLint(templatePath) {
	return spawnSync(
		cfnLint,
		['--config-file', cfnlintrc, '--non-zero-exit-code', 'error', templatePath],
		{ encoding: 'utf8' },
	);
}

const available = cfnLintAvailable();

test('[AC1] 非-ASCII (日本語) IAM Role Description を E3031 で hard-fail (#3870 相当を再現)', (t) => {
	if (!available) {
		t.skip('cfn-lint が未 install (CI cdk-cfn-lint job で実行される)');
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), 'cfn-lint-regress-'));
	try {
		const bad = join(dir, 'bad.template.json');
		// #3870 の DsqlBackupRole が持っていた日本語 description に相当する非-ASCII 値。
		writeFileSync(bad, iamRoleTemplate('DSQL バックアップ用ロール'));
		const res = runCfnLint(bad);
		assert.notEqual(
			res.status,
			0,
			`非-ASCII description は hard-fail すべき (exit ${res.status})。gate が #3870 を見逃す`,
		);
		assert.match(
			`${res.stdout}${res.stderr}`,
			/E3031/,
			'IAM Description charset 違反は cfn-lint E3031 で検出されるべき',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('[AC2] ASCII の IAM Role Description は false-positive なく PASS する', (t) => {
	if (!available) {
		t.skip('cfn-lint が未 install (CI cdk-cfn-lint job で実行される)');
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), 'cfn-lint-regress-'));
	try {
		const good = join(dir, 'good.template.json');
		writeFileSync(good, iamRoleTemplate('Role for DSQL backup'));
		const res = runCfnLint(good);
		assert.equal(
			res.status,
			0,
			`ASCII description は PASS すべき (exit ${res.status})\n${res.stdout}${res.stderr}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
