#!/usr/bin/env node
/**
 * lambda-env-ssot.mjs — Lambda の環境変数の SSOT を CDK synth 出力に固定する (#4352)。
 *
 * ## なぜ要るのか
 *
 * CloudFormation は out-of-band drift を戻さない。テンプレートのプロパティが前回と同一なら
 * CFN はそのリソースを一切触らないため、`aws lambda update-function-configuration` で手で足した
 * env は **deploy が success を返しても消えない**。さらに deploy workflow 側が live env を読んで
 * merge して書き戻していたため、手で足した env は毎回「正式な設定」として再コミットされていた。
 * 実害: 検証用に注入した `STRIPE_PRICE_*` が staging に恒久残存し、#4286 の修正が効いているかを
 * staging で判定できない状態が続いた (#4352)。
 *
 * ## 何をするのか
 *
 * - `derive`: synth 出力 (cdk.out の template) の Lambda `Environment.Variables` を **望ましい env の
 *   集合の定義**として読み、deploy 時にしか決まらない値 (ORIGIN 等) を `--set` で上書きした
 *   完全な集合を出力する。**live env は値の引き継ぎにしか使わず、キー集合には influence させない**
 *   ため、SSOT 外のキーは出力に現れない (= 全上書きすれば消える)。
 * - `verify`: live env のキー集合が derive の出力と一致するかを検査する。差があれば exit 1。
 *   **出すのはキー名だけ**で、値は一切出力しない (CI ログは repo 参照者が読める)。
 *
 * 期待キーを手で列挙する実装は採らない (列挙は必ず腐る、PO 決裁 2026-08-07)。verify の許可リストは
 * derive の出力そのものであり、2 本目の SSOT を作らない。
 *
 * ## 使い方
 *
 * ```bash
 * # 望ましい env を組み立てる (values を含むため出力先はワークスペース内の一時ファイル)
 * node scripts/lambda-env-ssot.mjs derive \
 *   --template infra/cdk.out/GanbariQuestComputeStaging.template.json \
 *   --function-name ganbari-quest-staging-app \
 *   --live-env /tmp/live-env.json \
 *   --set ORIGIN=https://example.cloudfront.net \
 *   --out /tmp/desired-env.json --keys-out /tmp/desired-keys.json
 *
 * # live env のキー集合が SSOT と一致するかを検査する (差があれば exit 1)
 * node scripts/lambda-env-ssot.mjs verify --expected /tmp/desired-keys.json --live /tmp/live-env.json
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * synth 出力から対象 Lambda の Environment.Variables を取り出す。
 *
 * @param {unknown} template CFN template (JSON.parse 済み)
 * @param {string} functionName 物理名 (`FunctionName` プロパティ)
 * @returns {Record<string, unknown>} 値は literal string か CFN intrinsic (object)
 */
export function readLambdaEnvFromTemplate(template, functionName) {
	const resources =
		template && typeof template === 'object'
			? /** @type {Record<string, any>} */ (template).Resources
			: undefined;
	if (!resources || typeof resources !== 'object') {
		throw new Error('[lambda-env-ssot] template に Resources がありません (synth 出力ではない?)');
	}
	const matches = Object.entries(resources).filter(
		([, res]) =>
			res &&
			typeof res === 'object' &&
			res.Type === 'AWS::Lambda::Function' &&
			res.Properties?.FunctionName === functionName,
	);
	if (matches.length === 0) {
		throw new Error(
			`[lambda-env-ssot] template に FunctionName=${functionName} の AWS::Lambda::Function がありません`,
		);
	}
	if (matches.length > 1) {
		throw new Error(
			`[lambda-env-ssot] FunctionName=${functionName} の Lambda が ${matches.length} 個あります (どれが SSOT か決まらない)`,
		);
	}
	const vars = matches[0][1].Properties?.Environment?.Variables;
	if (!vars || typeof vars !== 'object') {
		throw new Error(
			`[lambda-env-ssot] FunctionName=${functionName} に Environment.Variables がありません`,
		);
	}
	return /** @type {Record<string, unknown>} */ (vars);
}

/**
 * 望ましい env の完全な集合を組み立てる。
 *
 * キー集合は **template だけ**で決まる。live env は CFN intrinsic (Ref / Fn::GetAtt /
 * Fn::ImportValue 等) の値をクライアント側で解決できないぶんの引き継ぎにしか使わない。
 *
 * @param {{ templateEnv: Record<string, unknown>, liveEnv?: Record<string, string>, overrides?: Record<string, string> }} args
 * @returns {{ desired: Record<string, string>, unresolvedKeys: string[], droppedKeys: string[] }}
 */
export function deriveDesiredEnv({ templateEnv, liveEnv = {}, overrides = {} }) {
	/** @type {Record<string, string>} */
	const desired = {};
	/** @type {string[]} */
	const unresolvedKeys = [];

	for (const key of Object.keys(overrides)) {
		if (!Object.hasOwn(templateEnv, key)) {
			throw new Error(
				`[lambda-env-ssot] override されたキー ${key} が CDK 側 (synth 出力) に存在しません。` +
					'IaC に無い env を workflow から生やすと SSOT が二重になります。compute-stack 側に定義してください',
			);
		}
	}

	for (const [key, value] of Object.entries(templateEnv)) {
		if (Object.hasOwn(overrides, key)) {
			desired[key] = overrides[key];
			continue;
		}
		if (typeof value === 'string') {
			desired[key] = value;
			continue;
		}
		// CFN intrinsic は deploy 時に CFN が解決する。クライアント側では解けないため、
		// CFN が既に書いた live の値を引き継ぐ。live にも無ければ **空文字で埋めずに落とす**
		// (env 欠落の Lambda を上げると cold start で全リクエストが壊れる、ADR-0006)。
		if (!Object.hasOwn(liveEnv, key)) {
			throw new Error(
				`[lambda-env-ssot] ${key} は CFN intrinsic のためローカルで解決できず、` +
					'live env にも存在しないため値を決められません (空で上書きせず停止します)',
			);
		}
		desired[key] = liveEnv[key];
		unresolvedKeys.push(key);
	}

	const droppedKeys = Object.keys(liveEnv)
		.filter((key) => !Object.hasOwn(desired, key))
		.sort();

	return { desired, unresolvedKeys: unresolvedKeys.sort(), droppedKeys };
}

/**
 * live env のキー集合が SSOT と一致するかを検査する。**キー名しか扱わない**
 * (値を受け取る口を持たせると、いつか必ず秘密がログに出る)。
 *
 * @param {{ expectedKeys: string[], actualKeys: string[] }} args
 * @returns {{ ok: boolean, unexpected: string[], missing: string[] }}
 */
export function verifyEnvKeys({ expectedKeys, actualKeys }) {
	const expected = new Set(expectedKeys);
	const actual = new Set(actualKeys);
	const unexpected = [...actual].filter((k) => !expected.has(k)).sort();
	const missing = [...expected].filter((k) => !actual.has(k)).sort();
	return { ok: unexpected.length === 0 && missing.length === 0, unexpected, missing };
}

// --- CLI ---------------------------------------------------------------

/** @param {string[]} argv */
function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const flags = {};
	/** @type {Record<string, string>} */
	const sets = {};
	let keysOnly = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--keys-only') {
			keysOnly = true;
			continue;
		}
		if (!arg.startsWith('--')) continue;
		const name = arg.slice(2);
		const value = argv[++i];
		if (value === undefined) throw new Error(`[lambda-env-ssot] --${name} の値がありません`);
		if (name === 'set') {
			const eq = value.indexOf('=');
			if (eq <= 0) throw new Error(`[lambda-env-ssot] --set は KEY=VALUE 形式です: ${value}`);
			sets[value.slice(0, eq)] = value.slice(eq + 1);
		} else {
			flags[name] = value;
		}
	}
	return { flags, sets, keysOnly };
}

/** @param {string} p */
function readJson(p) {
	return JSON.parse(readFileSync(p, 'utf8'));
}

/** @param {unknown} parsed */
function toKeys(parsed) {
	if (Array.isArray(parsed)) return parsed.map(String);
	if (parsed && typeof parsed === 'object') return Object.keys(parsed);
	throw new Error(
		'[lambda-env-ssot] キー集合として読めない JSON です (object か array を渡してください)',
	);
}

function runDerive(/** @type {ReturnType<typeof parseArgs>} */ { flags, sets, keysOnly }) {
	const templatePath = flags.template;
	const functionName = flags['function-name'];
	if (!templatePath || !functionName) {
		throw new Error('[lambda-env-ssot] derive には --template と --function-name が必要です');
	}
	const templateEnv = readLambdaEnvFromTemplate(readJson(templatePath), functionName);

	if (keysOnly) {
		// (b) 単独運用: 値を一切扱わずキー集合だけを出す (intrinsic の解決も不要)。
		const keys = Object.keys(templateEnv).sort();
		if (flags['keys-out']) writeFileSync(flags['keys-out'], `${JSON.stringify(keys, null, 2)}\n`);
		console.log(`[lambda-env-ssot] CDK SSOT のキー (${keys.length}): ${keys.join(' ')}`);
		return;
	}

	const liveEnv = flags['live-env'] ? readJson(flags['live-env']) : {};
	const { desired, unresolvedKeys, droppedKeys } = deriveDesiredEnv({
		templateEnv,
		liveEnv,
		overrides: sets,
	});
	const keys = Object.keys(desired).sort();

	if (flags.out) writeFileSync(flags.out, `${JSON.stringify(desired, null, 2)}\n`);
	if (flags['keys-out']) writeFileSync(flags['keys-out'], `${JSON.stringify(keys, null, 2)}\n`);

	// **キー名だけを出す。** 値は出さない。
	console.log(`[lambda-env-ssot] desired env keys (${keys.length}): ${keys.join(' ')}`);
	if (unresolvedKeys.length > 0) {
		console.log(
			`[lambda-env-ssot] CFN intrinsic のため live から値を引き継いだキー (${unresolvedKeys.length}): ${unresolvedKeys.join(' ')}`,
		);
	}
	if (droppedKeys.length > 0) {
		// drift を消したことを可聴化する (静かに直すと、誰がいつ何を入れたかが分からなくなる)。
		console.log(
			`::warning::[lambda-env-ssot] IaC に無い env を ${droppedKeys.length} 件除去しました: ${droppedKeys.join(' ')} (#4352)`,
		);
	}
}

function runVerify(/** @type {ReturnType<typeof parseArgs>} */ { flags }) {
	const expectedPath = flags.expected;
	const livePath = flags.live;
	if (!expectedPath || !livePath) {
		throw new Error('[lambda-env-ssot] verify には --expected と --live が必要です');
	}
	const result = verifyEnvKeys({
		expectedKeys: toKeys(readJson(expectedPath)),
		actualKeys: toKeys(readJson(livePath)),
	});
	if (result.ok) {
		console.log('[lambda-env-ssot] env キー集合は CDK SSOT と一致しています');
		return;
	}
	if (result.unexpected.length > 0) {
		console.error(
			`::error::[lambda-env-ssot] IaC に無い env が Lambda に設定されています (${result.unexpected.length} 件): ${result.unexpected.join(' ')} (#4352。値は出力しません)`,
		);
	}
	if (result.missing.length > 0) {
		console.error(
			`::error::[lambda-env-ssot] IaC にあるはずの env が Lambda にありません (${result.missing.length} 件): ${result.missing.join(' ')}`,
		);
	}
	process.exitCode = 1;
}

function main() {
	const [command, ...rest] = process.argv.slice(2);
	const parsed = parseArgs(rest);
	if (command === 'derive') return runDerive(parsed);
	if (command === 'verify') return runVerify(parsed);
	console.error(
		'usage: lambda-env-ssot.mjs <derive|verify> [options]  (--help はソース冒頭を参照)',
	);
	process.exitCode = 2;
}

// direct 実行時のみ CLI を動かす (test からは pure function を import する)
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/lambda-env-ssot.mjs')) {
	try {
		main();
	} catch (err) {
		console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
	}
}
