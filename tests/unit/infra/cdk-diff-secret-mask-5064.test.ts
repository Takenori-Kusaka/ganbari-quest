// #5064: deploy / staging deploy の `cdk diff` が CONTEXT_TOKEN_SECRET (context cookie の署名鍵) を
// 公開ログに出さない。
//
// この値は SSM から CFN parameter 経由で解決されるため secrets.* ではなく GitHub の伏せ字対象外で、
// SSM と Lambda env が食い違うと cdk diff が `[-] 旧値` / `[+] 新値` を平文で出す。
// diff より前に両方の値を add-mask するステップを本物の bash で実行して検証する。

// cspell:ignore xtrace

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PROD_ENV_CONFIG, STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';

const REPO_ROOT = resolve(__dirname, '../../..');
const STEP = 'Mask context token secret (SSM + deployed Lambda env)';

const WORKFLOWS = [
	{
		label: 'deploy.yml (本番)',
		file: '.github/workflows/deploy.yml',
		ssmPrefix: PROD_ENV_CONFIG.ssmPrefix,
	},
	{
		label: 'deploy-aws-staging.yml (staging)',
		file: '.github/workflows/deploy-aws-staging.yml',
		ssmPrefix: STAGING_ENV_CONFIG.ssmPrefix,
	},
] as const;

const tempDirs: string[] = [];
afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function stepsOf(file: string): string[] {
	return readFileSync(join(REPO_ROOT, file), 'utf8').split(/\n\s+- name: /);
}

function runScriptOf(file: string): string {
	const step = stepsOf(file).find((s) => s.startsWith(STEP));
	if (!step) throw new Error(`${file} に step "${STEP}" が無い`);
	const m = step.match(/\n\s+run: \|\n([\s\S]*?)(?=\n\s{6}(?:- name:|#)|\n\s{0,5}\S|$)/);
	if (!m?.[1]) throw new Error(`${file} の step "${STEP}" から run を取り出せない`);
	const lines = m[1].split('\n');
	const indent = (lines[0]?.match(/^\s*/) ?? [''])[0].length;
	return lines.map((l) => l.slice(indent)).join('\n');
}

function ssmParamOf(file: string): string {
	const step = stepsOf(file).find((s) => s.startsWith(STEP)) ?? '';
	const m = step.match(/CONTEXT_TOKEN_SSM_PARAM:\s*(\S+)/);
	if (!m?.[1]) throw new Error(`${file} に CONTEXT_TOKEN_SSM_PARAM が無い`);
	return m[1];
}

interface StepRun {
	status: number | null;
	output: string;
}

/** `aws ssm ...` と `aws lambda ...` を別々に stub し、既定 shell (bash -e -o pipefail) で実行する。 */
function runStep(
	file: string,
	stub: { ssm: string; lambda: string },
	env: Record<string, string> = {},
): StepRun {
	const dir = mkdtempSync(join(tmpdir(), 'ctx-mask-'));
	tempDirs.push(dir);
	const scriptPath = join(dir, 'step.sh');
	writeFileSync(scriptPath, `${runScriptOf(file)}\n`, 'utf8');
	const binDir = join(dir, 'bin');
	mkdirSync(binDir, { recursive: true });
	const aws = join(binDir, 'aws');
	writeFileSync(
		aws,
		`#!/usr/bin/env bash\ncase "$1" in\n ssm) ${stub.ssm} ;;\n lambda) ${stub.lambda} ;;\n *) exit 99 ;;\nesac\n`,
		{ encoding: 'utf8', mode: 0o755 },
	);
	chmodSync(aws, 0o755);
	const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', scriptPath], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
			RUNNER_TEMP: dir,
			AWS_REGION: 'us-east-1',
			LAMBDA_FUNCTION: 'ganbari-quest-app',
			CONTEXT_TOKEN_SSM_PARAM: '/ganbari-quest/context-token-secret',
			...env,
		},
	});
	expect(result.status, `bash が起動できていない可能性: ${result.stderr}`).not.toBeNull();
	return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const NEW_SECRET = 'a'.repeat(64);
const OLD_SECRET = 'b'.repeat(64);
const stubSsm = (v: string) => `printf '%s\\n' '${v}'`;
const stubLambda = (v: string) => `printf '%s\\n' '${v}'`;
const notFoundSsm = `echo 'An error occurred (ParameterNotFound) when calling the GetParameter operation' >&2; exit 254`;
const notFoundLambda = `echo 'An error occurred (ResourceNotFoundException)' >&2; exit 254`;
const denied = `echo 'An error occurred (AccessDeniedException)' >&2; exit 254`;

describe.each(WORKFLOWS)('#5064 $label: cdk diff の前に署名鍵を伏せ字にする', (wf) => {
	it('AWS 認証の後・最初の cdk diff より前に置かれている', () => {
		const steps = stepsOf(wf.file);
		const credentials = steps.findIndex((s) => s.startsWith('Configure AWS credentials'));
		const mask = steps.findIndex((s) => s.startsWith(STEP));
		const firstDiff = steps.findIndex((s) => s.includes('npx cdk diff'));
		expect(credentials).toBeGreaterThan(-1);
		expect(mask).toBeGreaterThan(credentials);
		expect(firstDiff).toBeGreaterThan(-1);
		expect(mask).toBeLessThan(firstDiff);
	});

	it('SSM のパスが CDK が解決する param (env-config の ssmPrefix) と一致する', () => {
		expect(ssmParamOf(wf.file)).toBe(`${wf.ssmPrefix}/context-token-secret`);
	});

	// 値はシェル変数にだけ持つ前提。xtrace を足すと add-mask の登録前に展開後のコマンドが平文で出る。
	it('xtrace を有効にしない', () => {
		expect(runScriptOf(wf.file)).not.toMatch(/set\s+-[a-z]*x|xtrace/);
	});

	it('SSM の新しい値と Lambda に deploy 済みの旧い値の両方を add-mask し、他の行には値を出さない', () => {
		const r = runStep(wf.file, { ssm: stubSsm(NEW_SECRET), lambda: stubLambda(OLD_SECRET) });
		expect(r.status, r.output).toBe(0);
		const lines = r.output.split(/\r?\n/);
		expect(lines).toContain(`::add-mask::${NEW_SECRET}`);
		expect(lines).toContain(`::add-mask::${OLD_SECRET}`);
		const shown = lines.filter((l) => !l.startsWith('::add-mask::')).join('\n');
		expect(shown).not.toContain(NEW_SECRET);
		expect(shown).not.toContain(OLD_SECRET);
	});

	it('SSM にも Lambda にもまだ無い (初回) なら何も登録せず通る', () => {
		const r = runStep(wf.file, { ssm: notFoundSsm, lambda: notFoundLambda });
		expect(r.status, r.output).toBe(0);
		expect(r.output).not.toContain('::add-mask::');
	});

	it('Lambda の env に鍵がまだ無い (None) なら SSM 側だけ登録して通る', () => {
		const r = runStep(wf.file, { ssm: stubSsm(NEW_SECRET), lambda: stubLambda('None') });
		expect(r.status, r.output).toBe(0);
		expect(r.output.split(/\r?\n/)).toContain(`::add-mask::${NEW_SECRET}`);
		expect(r.output).not.toContain('::add-mask::None');
	});

	// 読めないまま diff に進むと、鍵を差し替えた deploy では新旧の値が伏せ字にならずに出る。
	it('SSM を読めなければ diff に進ませない', () => {
		const r = runStep(wf.file, { ssm: denied, lambda: stubLambda(OLD_SECRET) });
		expect(r.status).toBe(1);
		expect(r.output).toMatch(/::error::/);
	});

	it('Lambda の設定を読めなければ diff に進ませない', () => {
		const r = runStep(wf.file, { ssm: stubSsm(NEW_SECRET), lambda: denied });
		expect(r.status).toBe(1);
		expect(r.output).toMatch(/::error::/);
	});
});
