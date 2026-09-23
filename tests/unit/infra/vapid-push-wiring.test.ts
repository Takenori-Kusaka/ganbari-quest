/**
 * tests/unit/infra/vapid-push-wiring.test.ts (#4706)
 *
 * 本番の Web Push (リマインダー / ストリーク警告 / 達成通知) は VAPID 鍵が Lambda env に無いと 1 通も送れない。
 * `notification-service.ts` は鍵が無いと warn を出して `sent: 0` を返すだけなので、配線が欠けても
 * cron は 200 のまま「送信 0 件」を返し続け、誰も気づかない (実測: 本番ログ 2026-09-13〜23 の
 * 送信判定 1,710 回すべてが鍵なしで止まっていた)。
 *
 * 守る不変条件:
 *   1. 本番 app Lambda の env に VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が context から載る
 *   2. 本番で鍵が未指定 / 形式不正 / 組になっていない (片方だけの作り直し・取り違え) なら synth error
 *   3. demo Lambda と staging には鍵を配らない (秘密鍵を匿名公開の demo や push を配信しない環境に置かない)
 *   4. deploy.yml が鍵を必須 secret として検証し、本番 ComputeStack を選択する cdk 実行に渡す
 *   5. deploy.yml の Validate step が synth と同じ判定 (isVapidKeyPair) で鍵の組を先に検査する
 *      (synth の addError だけだと、止まるのは Storage deploy / ECR push / DSQL deploy / migrate の後)
 *   6. deploy.yml が cdk diff より前に、deploy 済みの秘密鍵を伏せ字登録する
 *      (鍵を差し替えた deploy で、diff の `[-]` に出る旧い秘密鍵は secret ではないので伏せ字にならない)
 */

// cspell:ignore IAMROLE
// ↑ deploy.yml の secret 名 AWS_OIDC_IAMROLE_ARN をそのまま env に渡す (Validate step がこの名前で検査するため綴りを変えられない)

import { spawnSync } from 'node:child_process';
import { createECDH } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { type GqEnvConfig, STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { StorageStack } from '../../../infra/lib/storage-stack';
import { isVapidKeyPair } from '../../../infra/lib/vapid-context';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

/** 秘密鍵 (base64url 43 文字) から組になる公開鍵 (87 文字) を導く。テスト用の非秘密ダミーを作るためだけに使う。 */
function publicKeyOf(privateKey: string): string {
	const ecdh = createECDH('prime256v1');
	ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
	return ecdh.getPublicKey('base64url');
}

const PRIVATE_KEY = 'a'.repeat(43);
const PUBLIC_KEY = publicKeyOf(PRIVATE_KEY);
/** 形式は正しいが PRIVATE_KEY とは組にならない公開鍵 */
const OTHER_PUBLIC_KEY = publicKeyOf('c'.repeat(43));
const VAPID_ERROR = Match.stringLikeRegexp('VAPID');

type LambdaFn = { Properties: { Environment?: { Variables?: Record<string, unknown> } } };

function lambdaEnv(stack: cdk.Stack, functionName: string): Record<string, unknown> {
	const fns = Template.fromStack(stack).findResources('AWS::Lambda::Function', {
		Properties: { FunctionName: functionName },
	});
	expect(Object.keys(fns), `${functionName} が synth されていない`).toHaveLength(1);
	return (Object.values(fns)[0] as LambdaFn).Properties.Environment?.Variables ?? {};
}

function buildCompute(
	extraContext: Record<string, unknown> = {},
	envConfig?: GqEnvConfig,
): cdk.Stack {
	const app = new cdk.App({
		context: {
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
			originVerifySecret: 'origin-verify-secret-for-unit-test-0000000',
			...extraContext,
		},
	});
	const storage = new StorageStack(app, 'VapidStorage', { env, envConfig });
	return new ComputeStack(app, 'VapidCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
		envConfig,
	}) as unknown as cdk.Stack;
}

describe('#4706 isVapidKeyPair (synth の判定)', () => {
	it('web-push が生成する鍵ペアを受け付ける', async () => {
		const webpush = (await import('web-push')).default;
		for (let i = 0; i < 20; i++) {
			const { publicKey, privateKey } = webpush.generateVAPIDKeys();
			expect(isVapidKeyPair(publicKey, privateKey)).toBe(true);
		}
	});

	it.each([
		['未指定', '', ''],
		['秘密鍵だけ未指定', PUBLIC_KEY, ''],
		['公開鍵と秘密鍵の取り違え', PRIVATE_KEY, PUBLIC_KEY],
		['組にならない公開鍵 (片方だけ作り直した)', OTHER_PUBLIC_KEY, PRIVATE_KEY],
		// 片側だけ不正な入力。両側とも不正な入力だけでは `&&` → `||` の取り違えや ^$ アンカー削除を検知できない
		['秘密鍵が 44 文字 (公開鍵は正しい)', PUBLIC_KEY, `${PRIVATE_KEY}a`],
		['公開鍵が 88 文字 (秘密鍵は正しい)', `${PUBLIC_KEY}A`, PRIVATE_KEY],
		['base64url でない文字を含む', PUBLIC_KEY, `${'a'.repeat(42)}+`],
		['P-256 の秘密鍵として無効 (0)', PUBLIC_KEY, 'A'.repeat(43)],
	])('%s は拒否する', (_label, publicKey, privateKey) => {
		expect(isVapidKeyPair(publicKey, privateKey)).toBe(false);
	});
});

describe('#4706 本番 app Lambda に VAPID 鍵が配られる', () => {
	it('context の鍵が app Lambda の env に載り、demo Lambda には載らない', () => {
		const compute = buildCompute({ vapidPublicKey: PUBLIC_KEY, vapidPrivateKey: PRIVATE_KEY });
		const appEnv = lambdaEnv(compute, 'ganbari-quest-app');
		expect(appEnv.VAPID_PUBLIC_KEY).toBe(PUBLIC_KEY);
		expect(appEnv.VAPID_PRIVATE_KEY).toBe(PRIVATE_KEY);
		// demo は匿名公開のため秘密鍵を置かない
		const demoEnv = lambdaEnv(compute, 'ganbari-quest-app-demo');
		expect(demoEnv.VAPID_PUBLIC_KEY).toBeUndefined();
		expect(demoEnv.VAPID_PRIVATE_KEY).toBeUndefined();
		expect(Annotations.fromStack(compute).findError('*', VAPID_ERROR)).toHaveLength(0);
	}, 120_000);

	it('鍵が未指定なら synth error (送信 0 件のまま deploy が通る形を作らない)', () => {
		const compute = buildCompute();
		Annotations.fromStack(compute).hasError('*', VAPID_ERROR);
	}, 120_000);

	it('組にならない鍵 (片方だけ作り直した) なら synth error', () => {
		const compute = buildCompute({
			vapidPublicKey: OTHER_PUBLIC_KEY,
			vapidPrivateKey: PRIVATE_KEY,
		});
		Annotations.fromStack(compute).hasError('*', VAPID_ERROR);
	}, 120_000);

	it('staging は context に鍵があっても env に載せず、未指定でも synth error にしない', () => {
		const withKeys = buildCompute(
			{ vapidPublicKey: PUBLIC_KEY, vapidPrivateKey: PRIVATE_KEY },
			STAGING_ENV_CONFIG,
		);
		const stagingEnv = lambdaEnv(withKeys, 'ganbari-quest-staging-app');
		expect(stagingEnv.VAPID_PUBLIC_KEY).toBeUndefined();
		expect(stagingEnv.VAPID_PRIVATE_KEY).toBeUndefined();
		const withoutKeys = buildCompute({}, STAGING_ENV_CONFIG);
		expect(Annotations.fromStack(withoutKeys).findError('*', VAPID_ERROR)).toHaveLength(0);
	}, 120_000);
});

describe('#4706 deploy.yml が VAPID 鍵を配る', () => {
	const yml = readFileSync(join(__dirname, '../../..', '.github/workflows/deploy.yml'), 'utf8');
	const steps = yml.split(/\n\s+- name: /);
	// `${{ … }}` は GitHub Actions の式。JS の template literal として展開させないため連結で組む。
	const secretRef = (name: string) => `\${{ secrets.${name} }}`;

	it.each([
		'VAPID_PUBLIC_KEY',
		'VAPID_PRIVATE_KEY',
	])('%s を Validate required secrets で必須検証する', (name) => {
		const validate = steps.find((s) => s.startsWith('Validate required secrets'));
		expect(validate, 'Validate required secrets step が見つからない').toBeDefined();
		expect(validate).toMatch(new RegExp(`for s in [^\\n]*\\b${name}\\b`));
		expect(validate).toContain(`${name}: ${secretRef(name)}`);
	});

	// CDK CLI が addError で止めるのは *選択した* stack (と上流) だけ。本番 ComputeStack を選択するのは
	// `-c dsqlEndpoint=` を渡す step (diff --all / deploy --all。env-distribution-closure [AR1] と同じ判別)。
	// Storage / Dsql 単独の step は本番 Compute を合成はするが選択しないので、鍵が無くても止まらない。
	it('本番 ComputeStack を選択する全 cdk 実行が VAPID 鍵を渡す', () => {
		const computeSteps = steps.filter(
			(s) => s.includes('npx cdk') && s.includes('-c dsqlEndpoint='),
		);
		expect(computeSteps.length).toBeGreaterThanOrEqual(2);
		for (const step of computeSteps) {
			expect(step).toContain(`-c vapidPublicKey=${secretRef('VAPID_PUBLIC_KEY')}`);
			expect(step).toContain(`-c vapidPrivateKey=${secretRef('VAPID_PRIVATE_KEY')}`);
		}
	});
});

// ------------------------------------------------------------------
// deploy.yml の step を実際の shell で走らせて確かめる。
// 文言一致では「判定を呼んでいるつもりで呼べていない」「伏せ字にしているつもりで値が出ている」を
// 検出できないため、run ブロックを切り出して GitHub Actions と同じ `bash -e` で実行する
// (tests/unit/github/pr-lane-action-fail-open.test.ts と同じ手口)。
// ------------------------------------------------------------------

const REPO_ROOT = join(__dirname, '../../..');
const DEPLOY_YML = join(REPO_ROOT, '.github/workflows/deploy.yml');
const deploySteps = readFileSync(DEPLOY_YML, 'utf8').split(/\n\s+- name: /);
const tempDirs: string[] = [];

afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** `- name: <stepName>` の step の `run: |` ブロックを取り出して dedent する。 */
function extractRunScript(stepName: string): string {
	const lines = readFileSync(DEPLOY_YML, 'utf8').split(/\r?\n/);
	const stepStart = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
	expect(stepStart, `deploy.yml に step「${stepName}」が見つからない`).toBeGreaterThan(-1);
	const runStart = lines.findIndex((l, i) => i > stepStart && /^\s*run:\s*\|\s*$/.test(l));
	const nextStep = lines.findIndex((l, i) => i > stepStart && /^\s*- name: /.test(l));
	expect(runStart, `step「${stepName}」に run: | ブロックが無い`).toBeGreaterThan(stepStart);
	if (nextStep !== -1) expect(runStart).toBeLessThan(nextStep);

	const body: string[] = [];
	let indent: number | null = null;
	for (let i = runStart + 1; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.trim() === '') {
			body.push('');
			continue;
		}
		const lead = line.length - line.trimStart().length;
		if (indent === null) indent = lead;
		if (lead < indent) break;
		body.push(line.slice(indent));
	}
	return body.join('\n').trimEnd();
}

interface StepRun {
	status: number | null;
	output: string;
}

/** GitHub Actions の既定 shell (`bash --noprofile --norc -e -o pipefail`) で step を実行する。 */
function runStep(
	script: string,
	stepEnv: Record<string, string>,
	stubs: Record<string, string> = {},
): StepRun {
	const dir = mkdtempSync(join(tmpdir(), 'deploy-step-'));
	tempDirs.push(dir);
	const scriptPath = join(dir, 'step.sh');
	writeFileSync(scriptPath, `${script}\n`, 'utf8');

	const binDir = join(dir, 'bin');
	mkdirSync(binDir, { recursive: true });
	for (const [name, body] of Object.entries(stubs)) {
		const stubPath = join(binDir, name);
		writeFileSync(stubPath, `#!/usr/bin/env bash\n${body}\n`, { encoding: 'utf8', mode: 0o755 });
		chmodSync(stubPath, 0o755);
	}

	const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', scriptPath], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
			RUNNER_TEMP: dir,
			...stepEnv,
		},
	});
	expect(result.status, `bash が起動できていない可能性: ${result.stderr}`).not.toBeNull();
	return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('#4706 deploy.yml の Validate step が鍵の組を先に検査する', () => {
	const script = () => extractRunScript('Validate required secrets');
	const secretsFor = (publicKey: string, privateKey: string) => ({
		OPS_SECRET_KEY: 'test-ops',
		AWS_OIDC_IAMROLE_ARN: 'arn:aws:iam::000000000000:role/test',
		STRIPE_SECRET_KEY: 'sk_live_test',
		PARENT_GATE_COOKIE_SECRET: 'test-parent-gate',
		ORIGIN_VERIFY_SECRET: 'test-origin-verify',
		VAPID_PUBLIC_KEY: publicKey,
		VAPID_PRIVATE_KEY: privateKey,
	});

	it('組になっている鍵なら通る', () => {
		const r = runStep(script(), secretsFor(PUBLIC_KEY, PRIVATE_KEY));
		expect(r.status, r.output).toBe(0);
	});

	// synth と同じ判定 (isVapidKeyPair) を呼んでいることを、synth が拒否する入力で確かめる。
	// 形式だけの検査 (長さ・文字種) なら「組にならない公開鍵」は通ってしまう。
	it.each([
		['組にならない公開鍵 (片方だけ作り直した)', OTHER_PUBLIC_KEY, PRIVATE_KEY],
		['公開鍵と秘密鍵の取り違え', PRIVATE_KEY, PUBLIC_KEY],
		['P-256 の秘密鍵として無効 (0)', PUBLIC_KEY, 'A'.repeat(43)],
	])('%s は deploy を始める前に止め、鍵の値を出力しない', (_label, publicKey, privateKey) => {
		expect(isVapidKeyPair(publicKey, privateKey), 'synth が拒否する入力であること').toBe(false);
		const r = runStep(script(), secretsFor(publicKey, privateKey));
		expect(r.status).toBe(1);
		expect(r.output).toMatch(/::error::.*VAPID/);
		expect(r.output).not.toContain(privateKey);
		expect(r.output).not.toContain(publicKey);
	});
});

describe('#4706 鍵を差し替えた deploy で旧い秘密鍵を公開ログに出さない', () => {
	const STEP = 'Mask deployed VAPID private key';
	const script = () => extractRunScript(STEP);
	const DEPLOYED_PRIVATE_KEY = 'b'.repeat(43);
	const stepEnv = { LAMBDA_FUNCTION: 'ganbari-quest-app', AWS_REGION: 'us-east-1' };

	it('cdk diff より前 (AWS 認証の後) に置かれている', () => {
		const index = (predicate: (s: string) => boolean) => deploySteps.findIndex(predicate);
		const credentials = index((s) => s.startsWith('Configure AWS credentials'));
		const mask = index((s) => s.startsWith(STEP));
		const firstDiff = index((s) => s.includes('npx cdk diff'));
		expect(credentials).toBeGreaterThan(-1);
		expect(mask).toBeGreaterThan(credentials);
		expect(mask).toBeLessThan(firstDiff);
	});

	it('deploy 済みの秘密鍵を add-mask で登録し、それ以外の行には値を出さない', () => {
		const r = runStep(script(), stepEnv, {
			aws: `printf '%s\\n' '${DEPLOYED_PRIVATE_KEY}'`,
		});
		expect(r.status, r.output).toBe(0);
		const lines = r.output.split(/\r?\n/);
		expect(lines).toContain(`::add-mask::${DEPLOYED_PRIVATE_KEY}`);
		// add-mask の行は runner が消費して表示しない。表示される行に値が残ってはいけない
		const shown = lines.filter((l) => !l.startsWith('::add-mask::'));
		expect(shown.join('\n')).not.toContain(DEPLOYED_PRIVATE_KEY);
	});

	it('Lambda に鍵がまだ無い (初回配布) なら何も登録せず通る', () => {
		const r = runStep(script(), stepEnv, { aws: `printf '%s\\n' 'None'` });
		expect(r.status, r.output).toBe(0);
		expect(r.output).not.toContain('::add-mask::');
	});

	it('本番 Lambda がまだ無いなら通る (伏せ字にする旧い値が無い)', () => {
		const r = runStep(script(), stepEnv, {
			aws: `echo 'An error occurred (ResourceNotFoundException) when calling the GetFunctionConfiguration operation' >&2; exit 254`,
		});
		expect(r.status, r.output).toBe(0);
		expect(r.output).not.toContain('::add-mask::');
	});

	// 読めないまま diff に進むと、鍵を差し替えた deploy では旧い秘密鍵が伏せ字にならずに出る。
	it('それ以外の理由で読めなければ diff に進ませない', () => {
		const r = runStep(script(), stepEnv, {
			aws: `echo 'An error occurred (AccessDeniedException)' >&2; exit 254`,
		});
		expect(r.status).toBe(1);
		expect(r.output).toMatch(/::error::/);
	});
});
