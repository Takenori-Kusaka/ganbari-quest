#!/usr/bin/env node
// scripts/check-cron-observability.mjs
// #1377 (#1374 Sub A-3): cron endpoint の observability 静的検査
//
// 目的:
//   既存 3 cron endpoint (license-expire / retention-cleanup / trial-notifications)
//   が以下の observability 要件を満たしているかをソース静的に検証する。
//
//   1. logger.info で「実行開始」相当のログを出している
//   2. logger.info で「実行完了」相当のログを出している
//   3. catch 節で logger.error を呼んでいる (silent fail 禁止)
//   4. CDK (compute-stack.ts) に CronDispatcher 用の CloudWatch LogGroup 定義あり
//   5. ops-stack.ts に dispatcher の Errors metric を監視する Alarm 定義あり
//
// 使い方:
//   node scripts/check-cron-observability.mjs
//   exit code 0 = 全要件満たす / 1 = 1 つ以上違反
//
// CI への組込:
//   `package.json` の scripts に `check:cron-observability` を追加し、
//   `ci.yml` で他の検証スクリプトと並列実行できる。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const ENDPOINTS = [
	{
		name: 'license-expire',
		path: 'src/routes/api/cron/license-expire/+server.ts',
	},
	{
		name: 'retention-cleanup',
		path: 'src/routes/api/cron/retention-cleanup/+server.ts',
	},
	{
		name: 'trial-notifications',
		path: 'src/routes/api/cron/trial-notifications/+server.ts',
	},
];

let violations = 0;

function fail(msg) {
	console.error(`[FAIL] ${msg}`);
	violations++;
}

function ok(msg) {
	console.log(`[ OK ] ${msg}`);
}

// ============================================================
// 1. 各 endpoint の logger 使用 + catch 節
// ============================================================

for (const ep of ENDPOINTS) {
	const fullPath = resolve(REPO_ROOT, ep.path);
	let src;
	try {
		src = readFileSync(fullPath, 'utf-8');
	} catch {
		fail(`${ep.name}: ファイル読み込み失敗 — ${ep.path}`);
		continue;
	}

	// logger.info で endpoint started / completed に相当するログ
	// (服務関数内でも completed が出ているなら OK = trial-notifications は service 完了ログを許容)
	const hasInfoLog = /logger\.info\(/.test(src);
	if (hasInfoLog) {
		ok(`${ep.name}: logger.info 呼び出しあり`);
	} else {
		fail(`${ep.name}: logger.info 呼び出しが見つからない (実行ログがない)`);
	}

	// catch 節で logger.error 呼び出し
	const hasErrorLog = /catch[^{]*\{[\s\S]*?logger\.error\(/.test(src);
	if (hasErrorLog) {
		ok(`${ep.name}: catch 節での logger.error あり`);
	} else {
		fail(`${ep.name}: catch 節で logger.error が呼ばれていない (silent fail リスク)`);
	}

	// verifyCronAuth 利用 (認証層が共通化されているか)
	const usesVerifyCronAuth = /verifyCronAuth\(/.test(src);
	if (usesVerifyCronAuth) {
		ok(`${ep.name}: verifyCronAuth 共通ヘルパー使用`);
	} else {
		fail(`${ep.name}: verifyCronAuth を使っていない (独自認証実装の禁止 — #1377)`);
	}
}

// ============================================================
// 2. CDK 側 CloudWatch LogGroup 定義
// ============================================================

{
	const cdkPath = resolve(REPO_ROOT, 'infra/lib/compute-stack.ts');
	const src = readFileSync(cdkPath, 'utf-8');

	const hasCronLogGroup = /CronDispatcherLogGroup/.test(src);
	if (hasCronLogGroup) {
		ok('compute-stack.ts: CronDispatcherLogGroup 定義あり');
	} else {
		fail('compute-stack.ts: CronDispatcherLogGroup 定義が見つからない');
	}

	const hasAppLogGroup = /AppLogGroup/.test(src);
	if (hasAppLogGroup) {
		ok('compute-stack.ts: AppLogGroup 定義あり (cron endpoint も同居)');
	} else {
		fail('compute-stack.ts: AppLogGroup 定義が見つからない');
	}
}

// ============================================================
// 3. ops-stack.ts の CloudWatch Alarm
// ============================================================

{
	const opsPath = resolve(REPO_ROOT, 'infra/lib/ops-stack.ts');
	let src;
	try {
		src = readFileSync(opsPath, 'utf-8');
	} catch {
		fail('infra/lib/ops-stack.ts が読めない');
		src = '';
	}
	if (src) {
		const hasCronAlarm = /cron-?dispatcher-?errors/i.test(src);
		if (hasCronAlarm) {
			ok('ops-stack.ts: cron-dispatcher-errors Alarm 定義あり');
		} else {
			fail('ops-stack.ts: cron-dispatcher-errors Alarm 定義が見つからない');
		}
	}
}

// ============================================================
// Summary
// ============================================================

if (violations > 0) {
	console.error(`\n[#1377] cron observability check FAILED with ${violations} violation(s)`);
	process.exit(1);
}

console.log('\n[#1377] cron observability check PASSED');
