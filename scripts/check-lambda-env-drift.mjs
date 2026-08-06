#!/usr/bin/env node
// @ts-nocheck — CLI gate script。unit test が import するため TS graph に入るが untyped JS の CLI ツール。
//
// scripts/check-lambda-env-drift.mjs (#4352)
//
// deploy 済み Lambda の環境変数キーが CDK テンプレートと一致しているかを実測し、
// **IaC の外で足された env (out-of-band drift)** を hard-fail で可聴化する。
//
// 背景 (#4352 / #4117 E1):
//   監査が #4286 の検証のため staging Lambda に手で `STRIPE_PRICE_*_MONTHLY` を注入した。
//   「次の deploy で消える」という前提で残置したが、**full staging deploy (success) を跨いで残った**。
//   原因は 2 つ:
//     1. CloudFormation はテンプレート無変更ならリソースを触らない → drift は戻らない
//     2. deploy workflow の「Resolve ORIGIN from CloudFront」step が live env を read-modify-write
//        (`jq '. + {…}'`) しており、**手で足した env を毎回 re-commit する**
//   結果として「IaC に書いていない env が恒久的に効き続ける」状態が誰にも気づかれないまま続き、
//   staging で checkout が通るのを見て「#4286 が直った」と誤判定しうる状態になっていた。
//
// 本 gate は deploy の最後に「live の env キー集合 ⊆ (テンプレートのキー ∪ 実行時解決キー)」を assert する。
// **値は一切読まない / 出力しない** (secret を CI ログに出さないため、キー名だけで判定する)。
//
// 使用:
//   node scripts/check-lambda-env-drift.mjs --function <name> --template <cfn-template.json> \
//     [--logical-id-prefix SvelteKitFn] [--region us-east-1] [--strict]
//     --template           : cdk deploy が出力した `infra/cdk.out/<Stack>.template.json`
//     --logical-id-prefix  : 対象 Lambda の論理 ID 前方一致。**指定推奨** (1 stack に app / cron-dispatcher /
//                            demo の複数 Lambda があり、省略すると和集合になって検査が緩む)
//     --strict             : テンプレートにあるのに live に無いキー (欠落) も fail にする (既定は warning)
//   CI: deploy-aws-staging.yml / deploy.yml の env 解決 step の直後。
//
// ADR-0024 (ENV silent skip 禁止) の env 版。deploy が success を返しながら実態が IaC と乖離する経路を塞ぐ。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { isMain as isMainModule } from './lib/is-main.mjs';

// ---------------------------------------------------------------------------
// 実行時解決キー SSOT
//
// CDK synth 時点では確定せず、deploy の後段 step が実測値で足すキー。
// テンプレートに現れないが drift ではないため、本 gate では許容する。
// 新たに「deploy 後に足す env」を増やしたら **必ず本リストに追記する** (追記しないと deploy が落ちる)。
// ---------------------------------------------------------------------------
export const RUNTIME_RESOLVED_KEYS = [
	// deploy-aws-staging.yml / deploy.yml の「Resolve ORIGIN from CloudFront」step が
	// CloudFront の DistributionDomainName から解決して注入する 3 本。
	'ORIGIN',
	'COGNITO_CALLBACK_URL',
	'COGNITO_LOGOUT_URL',
];

/**
 * CFN テンプレート (JSON) から Lambda 関数の env キー集合を抽出する。
 *
 * @param logicalIdPrefix 論理 ID の前方一致で対象関数を絞る (例 'SvelteKitFn')。
 *   **指定を推奨**。1 stack に複数の Lambda (app / cron-dispatcher / demo) がある場合、
 *   省略すると和集合になり「別関数にしか無いキー」を許容してしまう (検査が緩む)。
 */
export function extractTemplateEnvKeys(template, logicalIdPrefix = '') {
	const keys = new Set();
	for (const [logicalId, res] of Object.entries(template?.Resources ?? {})) {
		if (res?.Type !== 'AWS::Lambda::Function') continue;
		if (logicalIdPrefix && !logicalId.startsWith(logicalIdPrefix)) continue;
		for (const k of Object.keys(res?.Properties?.Environment?.Variables ?? {})) keys.add(k);
	}
	return [...keys].sort();
}

/**
 * live env キーとテンプレート env キーの差分を取る。**値は扱わない。**
 *
 * @returns {{ extra: string[], missing: string[] }}
 *   extra   : live にあるが IaC にも実行時解決リストにも無い = out-of-band drift
 *   missing : IaC にあるが live に無い = deploy が最後まで適用されていない
 */
export function diffEnvKeys(liveKeys, templateKeys, runtimeKeys = RUNTIME_RESOLVED_KEYS) {
	const allowed = new Set([...templateKeys, ...runtimeKeys]);
	const live = new Set(liveKeys);
	return {
		extra: [...live].filter((k) => !allowed.has(k)).sort(),
		missing: [...templateKeys].filter((k) => !live.has(k)).sort(),
	};
}

function fetchLiveEnvKeys(functionName, region) {
	// `keys()` を **AWS 側で**適用し、secret の平文を runner のプロセスに一切載せない。
	// (`Environment.Variables` をそのまま取得して JS 側でキーだけ抜く実装は、
	//  set -x / プロセスダンプ / 将来の console.log 追加のいずれでも平文が漏れる。
	//  既存の deploy.yml "Incident webhook env verification" と同じ射影方式に揃える)
	const out = execFileSync(
		'aws',
		[
			'lambda',
			'get-function-configuration',
			'--function-name',
			functionName,
			'--region',
			region,
			'--query',
			'keys(Environment.Variables)',
			'--output',
			'text',
		],
		{ encoding: 'utf8' },
	);
	return out.trim().split(/\s+/).filter(Boolean).sort();
}

function parseArgs(argv) {
	const get = (flag) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	return {
		functionName: get('--function'),
		templatePath: get('--template'),
		logicalIdPrefix: get('--logical-id-prefix') ?? '',
		region: get('--region') ?? process.env.AWS_REGION ?? 'us-east-1',
		strict: argv.includes('--strict'),
	};
}

export function main(argv = process.argv.slice(2)) {
	const { functionName, templatePath, logicalIdPrefix, region, strict } = parseArgs(argv);
	if (!functionName || !templatePath) {
		console.error(
			'[check-lambda-env-drift] 使用: --function <name> --template <cfn-template.json> [--region <r>] [--strict]',
		);
		return 2;
	}
	if (!fs.existsSync(templatePath)) {
		console.error(`[check-lambda-env-drift] ✗ テンプレートが見つかりません: ${templatePath}`);
		return 2;
	}

	const templateKeys = extractTemplateEnvKeys(
		JSON.parse(fs.readFileSync(templatePath, 'utf8')),
		logicalIdPrefix,
	);
	if (templateKeys.length === 0) {
		// テンプレートに Lambda env が 1 つも無い = 参照先 (または --logical-id-prefix) を間違えている。
		// 「対象 0 件だから PASS」は検査していないのと同じなので素通しさせない。
		console.error(
			`[check-lambda-env-drift] ✗ テンプレートに Lambda の環境変数が 1 件もありません: ${templatePath}` +
				(logicalIdPrefix ? ` (--logical-id-prefix ${logicalIdPrefix})` : ''),
		);
		return 2;
	}

	const liveKeys = fetchLiveEnvKeys(functionName, region);
	const { extra, missing } = diffEnvKeys(liveKeys, templateKeys);

	if (missing.length > 0) {
		const msg = `IaC にあるのに配備されていない env: ${missing.join(', ')}`;
		if (strict) {
			console.error(`[check-lambda-env-drift] ✗ FAIL — ${msg}`);
		} else {
			console.warn(`[check-lambda-env-drift] ⚠ WARN — ${msg}`);
		}
		if (strict) return 1;
	}

	if (extra.length > 0) {
		console.error(
			`[check-lambda-env-drift] ✗ FAIL — IaC の外で足された env が ${extra.length} 件あります: ${extra.join(', ')}\n` +
				`  (関数: ${functionName} / テンプレート: ${templatePath})\n` +
				'  CloudFormation はテンプレート無変更ならリソースを触らず、deploy の ORIGIN 解決 step は\n' +
				'  live env を read-modify-write するため、**この env は次の deploy でも消えません**。\n' +
				'\n' +
				'  対処 (既定は (a)。まず「この env は今 live で何かを支えていないか」を確かめる):\n' +
				'   (a) その設定を残すなら CDK に足す — infra/lib/compute-stack.ts の environment に追加し\n' +
				'       deploy workflow の `-c` で値を渡す (infra/CLAUDE.md §新規 env 追加時 PR チェックリスト)。\n' +
				'       **インシデント中に手で足した env はこちら**。消すと本番が壊れる。\n' +
				'   (b) 検証用に一時注入したもので、消しても壊れないと確認できた場合のみ手で除去する:\n' +
				`       aws lambda get-function-configuration --function-name ${functionName} --region ${region} --query 'Environment.Variables'\n` +
				'       → 該当キーを除いた JSON で aws lambda update-function-configuration --environment file://…',
		);
		return 1;
	}

	console.log(
		`[check-lambda-env-drift] ✓ PASS — ${functionName} の env キー ${liveKeys.length} 件は IaC と一致 ` +
			`(テンプレート ${templateKeys.length} 件 + 実行時解決 ${RUNTIME_RESOLVED_KEYS.length} 件)`,
	);
	return 0;
}

if (isMainModule(import.meta.url)) {
	process.exit(main());
}
