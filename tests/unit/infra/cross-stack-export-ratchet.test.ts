// tests/unit/infra/cross-stack-export-ratchet.test.ts
// #3858 (ADR-0061 shift-left / same-class→guard): CFN 自動 cross-stack export / ImportValue の
// allowlist ratchet fitness gate。
//
// ## なぜ必要か (root class)
// 自動 cross-stack export (producing 側 `CfnOutput` + Export + consuming 側 `Fn::ImportValue`) は
// **synth 時に初めて生成されソースに存在しない**。#3438 で MainTable の自動 export を撤去した際、CFN の
// 「in-use export は削除・値変更不可」制約に阻まれて本番 deploy が壊れた (第16回リリース blocker #3850)。
// この class は develop 軽量レーン (unit/E2E) をすり抜け、release 統合監査 (deploy-aws-staging) で初めて
// 露見した (deploy lane は個別 develop PR では走らない)。自動 export はソースに無いため CDK Aspects /
// cdk-nag / ESLint-AST / dependency-cruiser では捕捉できず、**synth 後の template 検査層だけが確実に
// 捕捉できる** (Issue #3858 deep research)。本 test は PR 時点 (unit-test 層) に前倒し検出する。
//
// ## 何をするか
// 1. 全 stack (prod 6 + staging 3) を bin/app.ts と同一に wire して synth する。
//    自動 export は「consumer stack が同一 App 内に存在して初めて」生成されるため、Storage/Auth/Compute
//    だけの部分 synth (staging-cdk.test.ts) では Compute→Network / Compute→Ops の export を取りこぼす。
//    したがって本 test は 6 prod stack を全て wire する (これが #3855 = 「Ref export を見落とす」class の
//    構造的再発防止 = 全 consumer が import する export の全集合を基準にする、の実装)。
// 2. 各 template の findOutputs('*') から Export 名を、toJSON() 再帰走査から Fn::ImportValue を全抽出。
// 3. allowlist と **集合として過不足なく一致** することを assert する (新規 export = allowlist 外 = fail /
//    allowlist の stale entry = 生成されない = fail)。加えて全 import が allowlist 内 export を指すことを
//    検証する (dangling import guard)。
//
// ## ratchet 運用 (AC3)
// allowlist は **一方通行で減らす**。cross-stack 境界を SSM 疎結合化 / 撤去したら該当 export を allowlist
// から削除する (= 疎結合が進んだ進捗計測器)。**増やす方向 (新規自動 export) は CI fail** させて意図しない
// 密結合の混入を止める。cross-stack 完全禁止は AWS 公式 (同一 App の層状参照は正規手段) に反し非現実的な
// ため、意図的残存を allowlist で管理する (既存 base-token-routes-ratchet / check-cdk-replacement の
// 承認マーカーと同一思想)。
//
// ## #3850 MainTable export と #3854 の紐付け (AC4)
// MainTable の Ref/Arn export (prod + staging = 計 4 本) は #3850 Deploy-1 で「consumer(Compute) は
// import を落としたが producer(Storage) は export を保持する」過渡状態として allowlist に載っていた。
// **Deploy-2 (#3854) で StorageStack から table + 両 export を撤去したため、本 allowlist からも MainTable
// 4 entry を削除した (計 17 → 13)**。以後 MainTable 由来 export が synth に現れないことを下記 assert が
// 断言し、export が復活したら (table 復元等) 即 fail する (撤去の完遂 guard)。
//
// ## stack 数 guard (#3882、no-silent-gap)
// 本 test の synth 対象 (SYNTH_STACK_IDS) は hardcode であり、bin/app.ts に新 stack が追加されても
// ratchet が自動追随しない (= その stack の export/import が検査から silent に漏れる growth-drift)。
// これを塞ぐため、bin/app.ts のソースを parse して instantiate される stack id 集合を抽出し、
// 「synth 対象 ∪ 明示除外 (RATCHET_EXCLUDED_STACK_IDS)」と**集合として過不足なく一致**することを
// assert する (#3872 の `templates.length === 11` guard / admin-resource-model-registry の
// NON_CANONICAL 明示除外 no-silent-gap guard と同型思想)。除外 entry は理由付き登録 + 除外根拠
// (cross-stack export 0 本) を実 synth で自己検証し、根拠が崩れたら fail して組み込みを強制する。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthStack } from '../../../infra/lib/auth-stack';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { DsqlStack } from '../../../infra/lib/dsql-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { OpsStack } from '../../../infra/lib/ops-stack';
import { SesStack } from '../../../infra/lib/ses-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore TESTPOOL ZTEST
const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
const APP_NAME = 'GanbariQuest';
const DOMAIN = 'ganbari-quest.com';
const CERT_ARN = 'arn:aws:acm:us-east-1:000000000000:certificate/test';

// context stub (multi-lambda-cdk.test.ts / staging-cdk.test.ts 踏襲 + Network の HostedZone.fromLookup 用)
const CTX: Record<string, unknown> = {
	'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/user-pool-id:region=us-east-1':
		'us-east-1_TESTPOOL',
	'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/client-id:region=us-east-1':
		'test-client-id',
	'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/domain:region=us-east-1':
		'auth.ganbari-quest.com',
	'ssm:account=000000000000:parameterName=/ganbari-quest/context-token-secret:region=us-east-1':
		'test-context-token-secret',
	opsSecretKey: 'test-ops-secret-key',
	parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
	// #3438 Phase 2A: DSQL 無条件 backend の fail-close 回避 (endpoint / clusterArn 必須)
	dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
	dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
	'hosted-zone:account=000000000000:domainName=ganbari-quest.com:region=us-east-1': {
		Id: '/hostedzone/ZTEST',
		Name: 'ganbari-quest.com.',
	},
};

/**
 * allowlist entry。export 名は construct token 由来の hash を含み stack 名で prefix される
 * (staging-cdk.test.ts で本番 synth 実測一致を確認済)。attr ごとに別 entry (#3855 = Ref を Arn と
 * 別本と認識する構造的再発防止)。
 */
interface ExportEntry {
	name: string;
	producer: string;
	descriptor: string;
}

// #3858 実測 baseline。#3854 Deploy-2 で MainTable + 両 export を撤去したため、prod/staging とも
// MainTable Ref/Arn を allowlist から削除した (計 17 → 13)。
// prod 9 export (Storage 4 / Compute 4 / Network 1) + staging 4 export (StorageStaging 4) = 計 13。
const AUTO_EXPORT_ALLOWLIST: readonly ExportEntry[] = [
	// --- prod StorageStack (4) — Compute が assets/repo を import (MainTable Ref/Arn は #3854 で撤去) ---
	{
		name: 'GanbariQuestStorage:ExportsOutputRefAssetsBucket5CB761808BF2E271',
		producer: 'GanbariQuestStorage',
		descriptor: 'AssetsBucket Ref (bucket 名) → ComputeStack が import (ASSETS_BUCKET env)',
	},
	{
		name: 'GanbariQuestStorage:ExportsOutputFnGetAttAssetsBucket5CB76180ArnBF60D959',
		producer: 'GanbariQuestStorage',
		descriptor: 'AssetsBucket Arn → ComputeStack が grantReadWrite の IAM policy で import',
	},
	{
		name: 'GanbariQuestStorage:ExportsOutputRefAppRepoB478A890A63F2AF1',
		producer: 'GanbariQuestStorage',
		descriptor: 'ECR AppRepo Ref → ComputeStack が DockerImageFunction の image で import',
	},
	{
		name: 'GanbariQuestStorage:ExportsOutputFnGetAttAppRepoB478A890ArnD4F6FFCA',
		producer: 'GanbariQuestStorage',
		descriptor: 'ECR AppRepo Arn → ComputeStack が pull grant の IAM policy で import',
	},
	// --- prod ComputeStack (4) — Network / Ops が Fn URL / Fn Ref を import ---
	{
		name: 'GanbariQuestCompute:ExportsOutputFnGetAttSvelteKitFnFunctionUrlB4DF7458FunctionUrl81A12F7D',
		producer: 'GanbariQuestCompute',
		descriptor:
			'main Fn FunctionUrl → NetworkStack (CloudFront origin) + OpsStack (health check) が import',
	},
	{
		name: 'GanbariQuestCompute:ExportsOutputFnGetAttSvelteKitDemoFnFunctionUrl2CF07107FunctionUrlCBC401AD',
		producer: 'GanbariQuestCompute',
		descriptor: 'demo Fn FunctionUrl → NetworkStack (demo CloudFront origin) が import',
	},
	{
		name: 'GanbariQuestCompute:ExportsOutputRefSvelteKitFn878D73448615C011',
		producer: 'GanbariQuestCompute',
		descriptor: 'main Fn Ref → OpsStack が Errors alarm dimension で import',
	},
	{
		name: 'GanbariQuestCompute:ExportsOutputRefCronDispatcherFn485916360A15CE7E',
		producer: 'GanbariQuestCompute',
		descriptor: 'cron-dispatcher Fn Ref → OpsStack が Errors alarm dimension で import',
	},
	// --- prod NetworkStack (1) — Ops が CloudFront distribution を import ---
	{
		name: 'GanbariQuestNetwork:ExportsOutputRefCDN2330F4C017228780',
		producer: 'GanbariQuestNetwork',
		descriptor: 'CloudFront Distribution Ref → OpsStack が 5xx alarm dimension で import',
	},
	// --- staging StorageStack (4) — 同 hash / stack 名 prefix のみ prod と異なる (MainTable は #3854 で撤去) ---
	{
		name: 'GanbariQuestStorageStaging:ExportsOutputRefAssetsBucket5CB761808BF2E271',
		producer: 'GanbariQuestStorageStaging',
		descriptor: 'staging AssetsBucket Ref → ComputeStaging が import',
	},
	{
		name: 'GanbariQuestStorageStaging:ExportsOutputFnGetAttAssetsBucket5CB76180ArnBF60D959',
		producer: 'GanbariQuestStorageStaging',
		descriptor: 'staging AssetsBucket Arn → ComputeStaging が import',
	},
	{
		name: 'GanbariQuestStorageStaging:ExportsOutputRefAppRepoB478A890A63F2AF1',
		producer: 'GanbariQuestStorageStaging',
		descriptor: 'staging ECR AppRepo Ref → ComputeStaging が import',
	},
	{
		name: 'GanbariQuestStorageStaging:ExportsOutputFnGetAttAppRepoB478A890ArnD4F6FFCA',
		producer: 'GanbariQuestStorageStaging',
		descriptor: 'staging ECR AppRepo Arn → ComputeStaging が import',
	},
	// --- staging ComputeStack (1、#4204) — prod の main Fn FunctionUrl → Network と同型 ---
	{
		name: 'GanbariQuestComputeStaging:ExportsOutputFnGetAttSvelteKitFnFunctionUrlB4DF7458FunctionUrl81A12F7D',
		producer: 'GanbariQuestComputeStaging',
		descriptor: 'staging main Fn FunctionUrl → NetworkStaging (CloudFront origin) が import',
	},
];

const ALLOWLIST_NAMES: ReadonlySet<string> = new Set(AUTO_EXPORT_ALLOWLIST.map((e) => e.name));

// --- #3882: stack 数 guard (no-silent-gap) の SSOT ---

/**
 * 本 ratchet が synth する stack id (`${APP_NAME}` prefix 抜き)。synthAllStacks() の wire /
 * Template 化と下記 no-silent-gap guard の両方がこの配列を参照する。bin/app.ts に stack を
 * 追加したら、ここに追加して wire するか、RATCHET_EXCLUDED_STACK_IDS に理由付きで登録する。
 */
const SYNTH_STACK_IDS = [
	'Storage',
	'Auth',
	'Compute',
	'Network',
	'Ses',
	'Ops',
	'StorageStaging',
	'AuthStaging',
	'ComputeStaging',
	'NetworkStaging',
] as const;

/**
 * ratchet synth から意図的に除外する stack (id → 除外理由)。除外は「cross-stack export /
 * import を 1 本も持たない」ことが前提であり、DsqlStack についてはその前提を下記
 * describe '#3882' の自己検証 assert が実 synth で担保する (根拠が崩れたら fail →
 * SYNTH_STACK_IDS への組み込みを強制)。
 */
const RATCHET_EXCLUDED_STACK_IDS: Readonly<Record<string, string>> = {
	Dsql:
		'`-c dsqlEnabled=true` context gate で既定非合成 + 他 stack から construct 参照ゼロ ' +
		'(接続情報は SSM / workflow output 経由) + CfnOutput 4 本すべて exportName 無し = ' +
		'cross-stack export 0 本 (除外根拠は本 test の自己検証 assert が synth 実測で保証)',
	DsqlStaging:
		'`-c dsqlStagingEnabled=true` context gate で既定非合成。除外根拠は Dsql と同一 ' +
		'(同一 DsqlStack class、deletionProtection のみ差分)',
};

const BIN_APP_TS_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../infra/bin/app.ts',
);

/**
 * bin/app.ts のソースから instantiate される stack id (`${appName}` prefix 抜き) を抽出する。
 * bin/app.ts は module scope で `app.synth()` まで実行する実行スクリプトのため import できず、
 * `new XxxStack(app, `${appName}<Id>`, ...)` の定型 instantiation をソース parse で拾う
 * (context gate (`if (dsqlEnabled)` 等) の内側も含めて「instantiate し得る全 stack」を返す)。
 */
function parseBinStackIds(source: string): string[] {
	return [...source.matchAll(/new \w+Stack\(\s*app,\s*`\$\{appName\}(\w+)`/g)].flatMap((m) =>
		m[1] === undefined ? [] : [m[1]],
	);
}

/**
 * bin/app.ts の stack 集合 vs 「ratchet synth 対象 ∪ 明示除外」の差分を返す (pure 関数。
 * negative test で「guard に歯がある」ことを直接実証できるよう判定ロジックを分離)。
 */
function computeStackCoverageGaps(
	binStackIds: readonly string[],
	coveredIds: readonly string[],
	excludedIds: readonly string[],
): { uncovered: string[]; stale: string[]; overlap: string[] } {
	const bin = new Set(binStackIds);
	const registered = new Set([...coveredIds, ...excludedIds]);
	return {
		// bin/app.ts にあるが未登録 = 新 stack の growth-drift (export 検査から silent に漏れる)
		uncovered: [...bin].filter((id) => !registered.has(id)).sort(),
		// 登録済だが bin/app.ts に無い = stack 撤去 / rename 後の stale entry
		stale: [...registered].filter((id) => !bin.has(id)).sort(),
		// synth 対象と除外の二重登録 (定義矛盾)
		overlap: coveredIds.filter((id) => excludedIds.includes(id)).sort(),
	};
}

/** template JSON を再帰走査し全 Fn::ImportValue (string 形) を収集する。 */
function collectImportValues(obj: unknown, acc: Set<string>): void {
	if (Array.isArray(obj)) {
		for (const v of obj) collectImportValues(v, acc);
	} else if (obj && typeof obj === 'object') {
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			if (k === 'Fn::ImportValue' && typeof v === 'string') acc.add(v);
			else collectImportValues(v, acc);
		}
	}
}

/** template の findOutputs から Export 名 (Export.Name が literal string のもの) を収集する。 */
function collectExportNames(template: Template, acc: Set<string>): void {
	for (const out of Object.values(template.findOutputs('*'))) {
		const name = (out as { Export?: { Name?: unknown } }).Export?.Name;
		if (typeof name === 'string') acc.add(name);
	}
}

/**
 * 全 stack を bin/app.ts と同一に wire して synth し、生成 Export 名 / Import 名を集合で返す。
 * synth (Template.fromStack) は tree を lock するため、全 stack を build し終えてから Template 化する。
 */
function synthAllStacks(): { exports: Set<string>; imports: Set<string> } {
	const app = new cdk.App({ context: CTX });

	// --- prod 6 stack (bin/app.ts と同一 wire) ---
	const storage = new StorageStack(app, `${APP_NAME}Storage`, { env });
	new AuthStack(app, `${APP_NAME}Auth`, { env, appDomain: DOMAIN, certificateArn: CERT_ARN });
	const compute = new ComputeStack(app, `${APP_NAME}Compute`, {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, `${APP_NAME}Network`, {
		env,
		functionUrl: compute.functionUrl,
		// #4280: front door shared secret (NetworkStackProps 必須)。テスト用ダミー値。
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: DOMAIN,
		certificateArn: CERT_ARN,
		demoFunctionUrl: compute.demoFunctionUrl,
		demoDomainName: `demo.${DOMAIN}`,
		demoCertificateArn: CERT_ARN,
	});
	new SesStack(app, `${APP_NAME}Ses`, { env, domainName: DOMAIN });
	new OpsStack(app, `${APP_NAME}Ops`, {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		staticAssetsBucket: network.staticAssetsBucket,
	});

	// --- staging 3 stack (bin/app.ts stagingEnabled=true と同一 wire) ---
	const sStorage = new StorageStack(app, `${APP_NAME}StorageStaging`, {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	new AuthStack(app, `${APP_NAME}AuthStaging`, { env, envConfig: STAGING_ENV_CONFIG });
	const sCompute = new ComputeStack(app, `${APP_NAME}ComputeStaging`, {
		env,
		assetsBucket: sStorage.assetsBucket,
		repository: sStorage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});
	// #4204: staging CloudFront。Compute の functionUrl を import する (prod Network と同型)。
	new NetworkStack(app, `${APP_NAME}NetworkStaging`, {
		env,
		functionUrl: sCompute.functionUrl,
		// #4280: front door shared secret (NetworkStackProps 必須)。テスト用ダミー値。
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		resourcePrefix: STAGING_ENV_CONFIG.resourcePrefix,
		geoRestrictionCountries: [],
	});

	// 全 stack build 完了後に Template 化 (synth は tree を lock するため順序が重要)。
	// synth 対象の SSOT は SYNTH_STACK_IDS (#3882 stack 数 guard と共有)。
	const exports = new Set<string>();
	const imports = new Set<string>();
	for (const id of SYNTH_STACK_IDS) {
		const name = `${APP_NAME}${id}`;
		const stack = app.node.tryFindChild(name) as cdk.Stack | undefined;
		if (!stack) {
			throw new Error(
				`SYNTH_STACK_IDS の '${id}' が synthAllStacks() で wire されていない。` +
					'bin/app.ts と同一の instantiation を本関数に追加する (#3882)。',
			);
		}
		const template = Template.fromStack(stack);
		collectExportNames(template, exports);
		collectImportValues(template.toJSON(), imports);
	}
	return { exports, imports };
}

let synthResult: { exports: Set<string>; imports: Set<string> };

beforeAll(() => {
	synthResult = synthAllStacks();
}, 120_000); // 9 stack synth は重い

describe('#3858 cross-stack 自動 export/ImportValue allowlist ratchet (ADR-0061 shift-left)', () => {
	it('生成される全 Export が allowlist 内である (新規自動 export = allowlist 外 = fail)', () => {
		const unexpected = [...synthResult.exports].filter((n) => !ALLOWLIST_NAMES.has(n)).sort();
		expect(
			unexpected,
			`allowlist 外の自動 cross-stack export を検出 (${unexpected.length} 件):\n` +
				`${unexpected.join('\n')}\n\n` +
				'これは新規 cross-stack 密結合の混入 (#3438 class = 撤去時に in-use 削除不可で本番 deploy 破壊) ' +
				'の可能性がある。SSM 疎結合で回避できないか検討し、意図的なら本 test の AUTO_EXPORT_ALLOWLIST に ' +
				'attr ごとに entry を追加する (hash は synth 実測値を貼る)。',
		).toEqual([]);
	});

	it('allowlist に stale entry が無い (生成されない export = SSM 化/撤去済み = allowlist 削除必須)', () => {
		// #3854 で MainTable export を撤去したら本 assert が fail し、allowlist からの削除を強制する (AC4)。
		const stale = AUTO_EXPORT_ALLOWLIST.map((e) => e.name)
			.filter((n) => !synthResult.exports.has(n))
			.sort();
		expect(
			stale,
			`allowlist にあるが synth で生成されない export (${stale.length} 件):\n${stale.join('\n')}\n\n` +
				'cross-stack 境界を SSM 疎結合化 / 撤去したら、対応 entry を AUTO_EXPORT_ALLOWLIST から削除する ' +
				'(ratchet は一方通行で減らす。特に MainTable export は #3854 撤去時に削除)。',
		).toEqual([]);
	});

	it('生成 Export と allowlist が集合として過不足なく一致する (計 14 = prod 9 + staging 5)', () => {
		// 上記 2 assert の統合表明 (数の drift を 1 行で可視化)。実測とズレたら人手承認 (本 test 更新) を要する。
		expect(synthResult.exports.size).toBe(AUTO_EXPORT_ALLOWLIST.length);
		expect(new Set(synthResult.exports)).toEqual(ALLOWLIST_NAMES);
	});

	it('全 Fn::ImportValue が allowlist 内 export を指す (dangling import guard)', () => {
		// consumer が producer に無い export を import すると deploy が落ちる。手書き importValue の混入も検出。
		const dangling = [...synthResult.imports].filter((n) => !ALLOWLIST_NAMES.has(n)).sort();
		expect(
			dangling,
			`import 先が allowlist に無い Fn::ImportValue を検出 (${dangling.length} 件):\n${dangling.join('\n')}`,
		).toEqual([]);
	});

	it('MainTable 由来の export が全 stack で 1 本も生成されない (#3854 Deploy-2 撤去完了)', () => {
		// #3854 Deploy-2: StorageStack から MainTable + 両 export を撤去した。prod / staging とも
		// MainTable 由来 export (Ref / Arn) が synth 結果に 1 本も現れないことを断言する
		// (旧 #3850 Deploy-1 の「dangling export として保持」の逆条件 = 撤去の完遂 guard)。
		const mainTableExports = [...synthResult.exports].filter((n) => /MainTable/.test(n)).sort();
		expect(
			mainTableExports,
			`MainTable export が残存 (${mainTableExports.length} 件):\n${mainTableExports.join('\n')}\n\n` +
				'#3854 Deploy-2 で MainTable + 両 export を撤去済のはず。残っていたら storage-stack.ts の ' +
				'table / exportValue が消えていないか確認する。',
		).toEqual([]);
	});
});

describe('#3858 ratchet が有効に機能する (negative test / failing-test-first、ADR-0061)', () => {
	it('allowlist 外の新規自動 cross-stack export が現れたら検出される (物理確認)', () => {
		// 故意に「新規 consumer が既存 producer の未参照属性を import する」= 新規自動 export を発生させ、
		// ratchet の判定ロジック (exports ⊄ allowlist) が violation を返すことを実 synth で実証する。
		const app = new cdk.App({ context: CTX });
		const storage = new StorageStack(app, `${APP_NAME}Storage`, { env });
		const compute = new ComputeStack(app, `${APP_NAME}Compute`, {
			env,
			assetsBucket: storage.assetsBucket,
			repository: storage.repository,
		});
		// 新規 consumer stack が compute.fn.functionArn を参照 → Compute に新しい自動 export
		// (ExportsOutputFnGetAttSvelteKitFn...Arn...) が生成される (= #3438 と同 class の新規 export)。
		const probe = new SesStack(app, `${APP_NAME}Probe`, { env });
		new cdk.CfnOutput(probe, 'ProbeRef', { value: compute.fn.functionArn });

		const exports = new Set<string>();
		for (const name of [`${APP_NAME}Storage`, `${APP_NAME}Compute`, `${APP_NAME}Probe`]) {
			collectExportNames(Template.fromStack(app.node.tryFindChild(name) as cdk.Stack), exports);
		}

		const unexpected = [...exports].filter((n) => !ALLOWLIST_NAMES.has(n));
		// probe が誘発した新規 export が少なくとも 1 本 allowlist 外として検出される = ratchet に歯がある。
		expect(unexpected.length).toBeGreaterThan(0);
		expect(unexpected.some((n) => n.includes('SvelteKitFn') && n.includes('Arn'))).toBe(true);
	}, 120_000);
});

describe('#3882 stack 数 guard (bin/app.ts vs ratchet synth 対象の no-silent-gap)', () => {
	const binStackIds = parseBinStackIds(readFileSync(BIN_APP_TS_PATH, 'utf8'));
	const excludedIds = Object.keys(RATCHET_EXCLUDED_STACK_IDS);

	it('bin/app.ts の stack instantiation を parser が抽出できる (parser 陳腐化 guard)', () => {
		// bin/app.ts の instantiation 定型 (`new XxxStack(app, `${appName}<Id>`, ...)`) が
		// リファクタで変わり regex が 0 件になった場合に guard 全体が silent 無効化しないための下限 assert。
		expect(
			binStackIds.length,
			`bin/app.ts から抽出できた stack が ${binStackIds.length} 件しかない。instantiation の書式が ` +
				'変わった場合は parseBinStackIds() の regex を追随させる (#3882)。',
		).toBeGreaterThanOrEqual(6);
		expect(binStackIds).toContain('Storage');
		expect(binStackIds).toContain('Compute');
		expect(new Set(binStackIds).size).toBe(binStackIds.length);
	});

	it('bin/app.ts の全 stack が「synth 対象 ∪ 意図除外」に過不足なく登録されている', () => {
		const gaps = computeStackCoverageGaps(binStackIds, SYNTH_STACK_IDS, excludedIds);
		expect(
			gaps.uncovered,
			`bin/app.ts に追加された stack が ratchet に未登録 (${gaps.uncovered.length} 件): ` +
				`${gaps.uncovered.join(', ')}\n\n` +
				'この stack の cross-stack export/import は本 ratchet の検査から漏れている (growth-drift)。' +
				'SYNTH_STACK_IDS に追加して synthAllStacks() で wire するか、cross-stack export 0 本を確認の ' +
				'うえ RATCHET_EXCLUDED_STACK_IDS に理由付きで登録する (#3882)。',
		).toEqual([]);
		expect(
			gaps.stale,
			`bin/app.ts に存在しない stack が ratchet に登録されたまま (${gaps.stale.length} 件): ` +
				`${gaps.stale.join(', ')}\n\nstack 撤去 / rename 後は登録も同期して削除する (#3882)。`,
		).toEqual([]);
		expect(gaps.overlap, 'synth 対象と意図除外の二重登録 (定義矛盾)').toEqual([]);
	});

	it('意図除外 DsqlStack / DsqlStaging は cross-stack export 0 本である (除外根拠の自己検証)', () => {
		// 除外の前提 =「exportName 付き output を 1 本も持たない」を実 synth で断言する。
		// 将来 DSQL cutover で Compute↔Dsql を cross-stack 化 (exportName 付与) したら本 assert が
		// fail し、SYNTH_STACK_IDS への組み込み + allowlist 管理への移行を強制する。
		// (自動 export は consumer 参照が無い限り生成されないため、明示 exportName の有無が判定対象。)
		const dsqlExports = new Set<string>();
		collectExportNames(
			Template.fromStack(
				new DsqlStack(new cdk.App(), `${APP_NAME}Dsql`, { env, opsEmail: 'ops@example.com' }),
			),
			dsqlExports,
		);
		collectExportNames(
			Template.fromStack(
				new DsqlStack(new cdk.App(), `${APP_NAME}DsqlStaging`, {
					env,
					deletionProtection: false,
				}),
			),
			dsqlExports,
		);
		expect(
			[...dsqlExports].sort(),
			'DsqlStack に exportName 付き output が追加され、意図除外の根拠 (cross-stack export 0 本) が ' +
				'崩れた。RATCHET_EXCLUDED_STACK_IDS から外し、SYNTH_STACK_IDS + AUTO_EXPORT_ALLOWLIST で ' +
				'管理する (#3882)。',
		).toEqual([]);
	});

	it('新 stack が bin/app.ts に追加されたのに未登録なら uncovered として検出される (negative)', () => {
		// AC2: 「新 stack を追加した場合に gate が fail する」ことの suite 内回帰実証。
		// bin/app.ts に `new ProbeStack(app, `${appName}Probe`, ...)` が増えた状況を模擬する。
		const gaps = computeStackCoverageGaps([...binStackIds, 'Probe'], SYNTH_STACK_IDS, excludedIds);
		expect(gaps.uncovered).toEqual(['Probe']);
	});

	it('登録済 stack が bin/app.ts から消えたら stale として検出される (negative)', () => {
		const gaps = computeStackCoverageGaps(
			binStackIds.filter((id) => id !== 'Ses'),
			SYNTH_STACK_IDS,
			excludedIds,
		);
		expect(gaps.stale).toEqual(['Ses']);
	});
});
