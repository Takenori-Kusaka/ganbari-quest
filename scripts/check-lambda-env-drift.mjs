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
//     --strict             : テンプレートにあるのに live に無いキー (欠落) を **全て** fail にする
//                            (既定は REQUIRED_ALWAYS_PRESENT_KEYS 以外の欠落は warning に留める)
//   CI: deploy-aws-staging.yml / deploy.yml の env 解決 step の直後。
//
// ADR-0024 (ENV silent skip 禁止) の env 版。deploy が success を返しながら実態が IaC と乖離する経路を塞ぐ。
//
// #4365 follow-up: 「テンプレートにあるのに live に無い (missing)」は既定 warning のため、
// deploy 成功後に認証 / 課金の env が live から欠落しても CI は緑のまま気付けなかった。
// REQUIRED_ALWAYS_PRESENT_KEYS に列挙したキーは `--strict` の有無に関わらず missing で hard-fail する。

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

// ---------------------------------------------------------------------------
// 常時必須キー SSOT (#4365 follow-up)
//
// `infra/lib/compute-stack.ts` の prod / staging 両 environment ブロックで、
// secret 有無の条件付き spread (`...(x ? {…} : {})`) を経由せず**無条件に**
// object property として直接代入されているキーのみを対象にする
// (条件付きキーは「未設定な環境ではテンプレートにも現れない」ため、そもそも
// 常時必須の性質を持たない。仮に REQUIRED に加えても diffEnvKeys の
// `missing` はテンプレートに存在するキーしか対象にしないため誤検知はしないが、
// 「常時必須」という名前の意味を保つため無条件キーのみに限定する)。
//
// 選定 (認証 / 課金コアで、欠落すると顧客影響が即時発生するもの):
//   - AUTH_MODE / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID / COGNITO_DOMAIN /
//     COGNITO_CALLBACK_URL / COGNITO_LOGOUT_URL: Cognito 認証の根幹。欠落すると
//     ログイン不能 (cold start 500 または誤 redirect)。SSM StringParameter から
//     無条件取得 (compute-stack.ts L109-127) で、prod / staging 双方の
//     environment object に直接代入されている。
//   - CONTEXT_TOKEN_SECRET: parent-gate / context token 検証の根幹。SSM から
//     無条件取得、prod / staging 双方に直接代入。欠落は認可検証の恒久停止。
//
// 選定から除外したもの (条件付き spread のため。理由: 環境によって未設定が
// 正当なケースがあり "常時" の前提を満たさない。既存の missing warning
// (または `--strict`) で従来通りカバーされる):
//   - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / USE_LOOKUP_KEY: Stripe test/live
//     鍵が未登録の staging 初期構築時は意図的に無効 (#4104 isStripeEnabled()=false)
//   - CRON_SECRET / OPS_SECRET_KEY: cron-dispatcher 側は `CRON_SECRET ?? OPS_SECRET_KEY`
//     の fallback 関係で「どちらか 1 本」が要件 (#1586)。片方だけの欠落を
//     hard-fail にすると正常構成を誤検知する
//   - PARENT_GATE_COOKIE_SECRET / ORIGIN_VERIFY_SECRET / ORIGIN_VERIFY_SECRET_PREVIOUS:
//     条件付き spread。GitHub Secret 未登録の初期 staging 構築時は意図的に
//     未注入のまま deploy される運用がありうる
//   - GRACE_PERIOD_DELETION_DISABLED / SES_SENDER_EMAIL / SES_CONFIG_SET_NAME:
//     prod 専用 (staging environment に無い) で「常時必須」の対象外
//
// 新たに無条件 env を追加した場合、認証 / 課金コアであれば本リストへの
// 追記を検討すること (追記しなくても deploy は落ちない = 従来通り warning)。
// ---------------------------------------------------------------------------
export const REQUIRED_ALWAYS_PRESENT_KEYS = [
	'AUTH_MODE',
	'COGNITO_USER_POOL_ID',
	'COGNITO_CLIENT_ID',
	'COGNITO_DOMAIN',
	'COGNITO_CALLBACK_URL',
	'COGNITO_LOGOUT_URL',
	'CONTEXT_TOKEN_SECRET',
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

/**
 * missing キー集合を「常時必須 (REQUIRED_ALWAYS_PRESENT_KEYS)」と「それ以外」に分類する。
 * 常時必須は `--strict` の有無に関わらず hard-fail 対象、それ以外は従来通り `--strict` 時のみ fail。
 *
 * @returns {{ requiredMissing: string[], optionalMissing: string[] }}
 */
export function classifyMissingKeys(missing, requiredKeys = REQUIRED_ALWAYS_PRESENT_KEYS) {
	return {
		requiredMissing: missing.filter((k) => requiredKeys.includes(k)),
		optionalMissing: missing.filter((k) => !requiredKeys.includes(k)),
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

	let missingIsFatal = false;
	if (missing.length > 0) {
		// #4365 follow-up: REQUIRED_ALWAYS_PRESENT_KEYS の欠落は `--strict` の有無に関わらず
		// hard-fail する (認証 / 課金コアが live から落ちても deploy が成功してしまう事故を防ぐ)。
		// それ以外の missing は従来通り --strict 時のみ fail。
		const { requiredMissing, optionalMissing } = classifyMissingKeys(missing);

		if (requiredMissing.length > 0) {
			console.error(
				`[check-lambda-env-drift] ✗ FAIL — 認証/課金コアの必須 env が live から欠落しています: ${requiredMissing.join(', ')}\n` +
					'  (REQUIRED_ALWAYS_PRESENT_KEYS 対象。--strict の指定に関わらず常に hard-fail します)',
			);
			missingIsFatal = true;
		}
		if (optionalMissing.length > 0) {
			const msg = `IaC にあるのに配備されていない env: ${optionalMissing.join(', ')}`;
			if (strict) {
				console.error(`[check-lambda-env-drift] ✗ FAIL — ${msg}`);
				missingIsFatal = true;
			} else {
				console.warn(`[check-lambda-env-drift] ⚠ WARN — ${msg}`);
			}
		}
	}
	if (missingIsFatal && extra.length === 0) return 1;

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
