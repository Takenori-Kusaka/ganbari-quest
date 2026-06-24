#!/usr/bin/env node
// @ts-nocheck — CLI gate script。unit test が import するため TS graph に入るが untyped JS の CLI ツール。
//
// scripts/check-native-dep-pin.mjs (#3302)
//
// SIGSEGV-safe にピン留めした native 依存が、安全版から変わる PR を deterministic に hard-fail する。
//
// 背景: #3190 で better-sqlite3 12.11.1 が demo/SQLite (file-backed Database + WAL) を SIGSEGV crash
// させ、#3192 HOTFIX が 12.10.0 exact pin で根治した。だが #3197 の native-dep-smoke (runtime load)
// は CI runner 上で 12.11.1 を load できてしまい crash を再現せず、dependabot #3293 の 12.11.1 再提案が
// CI green ですり抜けた (gate の空洞化)。
//
// 本 gate は runtime load に依存せず、package.json + package-lock.json の version を静的照合し、
// SIGSEGV-safe pin (SSOT below) から逸脱したら即 fail する (ADR-0061 shift-left の機械強制)。
// dependabot.yml の ignore (12.11.x) と二重防御: ignore は再提案を抑止し、本 gate は手動 bump /
// transitive 巻き戻し / ignore すり抜けを最終捕捉する。
//
// 使用: node scripts/check-native-dep-pin.mjs
// CI: deps-supply-chain-check job (deps / dependabot 変更時)。逸脱で exit 1。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// SIGSEGV-safe pin SSOT
//
// native binding の ABI/実装が特定版で demo/NUC runtime を crash させるため exact pin する依存。
// version を変えるときは「該当 upstream 修正を確認 + native-dep-smoke + demo/NUC 実機検証」を経て
// ここを更新する (= 単独 SSOT)。dependabot.yml の ignore も同期更新すること。
// ---------------------------------------------------------------------------

export const SIGSEGV_SAFE_PINS = [
	{
		name: 'better-sqlite3',
		version: '12.10.0',
		reason: '#3190/#3192: 12.11.1 が demo/SQLite (file-backed + WAL) を SIGSEGV crash させる',
	},
];

/**
 * package.json + package-lock.json を pins と静的照合し、逸脱を violations で返す pure function。
 * @param {{dependencies?:Record<string,string>, devDependencies?:Record<string,string>}} pkgJson
 * @param {{packages?:Record<string,any>}} lockJson
 * @param {{name:string, version:string, reason:string}[]} pins
 * @returns {{name:string, where:string, expected:string, actual:string, reason:string}[]}
 */
export function findPinViolations(pkgJson, lockJson, pins) {
	const violations = [];
	const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
	const lockPkgs = lockJson.packages ?? {};

	for (const pin of pins) {
		// 1) package.json: exact 一致 (caret / tilde / range は不可 = exact pin 維持)
		const declared = deps[pin.name];
		if (declared === undefined) {
			violations.push({
				name: pin.name,
				where: 'package.json',
				expected: pin.version,
				actual: '(未宣言)',
				reason: pin.reason,
			});
		} else if (declared !== pin.version) {
			violations.push({
				name: pin.name,
				where: 'package.json',
				expected: pin.version,
				actual: declared,
				reason: pin.reason,
			});
		}

		// 2) package-lock.json: 解決済 version 一致
		const lockEntry = lockPkgs[`node_modules/${pin.name}`];
		const lockVersion = lockEntry?.version;
		if (lockVersion === undefined) {
			violations.push({
				name: pin.name,
				where: 'package-lock.json',
				expected: pin.version,
				actual: '(lock に node_modules entry なし)',
				reason: pin.reason,
			});
		} else if (lockVersion !== pin.version) {
			violations.push({
				name: pin.name,
				where: 'package-lock.json',
				expected: pin.version,
				actual: lockVersion,
				reason: pin.reason,
			});
		}
	}
	return violations;
}

function main() {
	console.log('[check-native-dep-pin] SIGSEGV-safe native dep pin 検査 (#3302)');
	let pkgJson;
	let lockJson;
	try {
		pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
		lockJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
	} catch (err) {
		console.error(`[check-native-dep-pin] read error: ${err.message}`);
		return 1;
	}

	const violations = findPinViolations(pkgJson, lockJson, SIGSEGV_SAFE_PINS);
	if (violations.length === 0) {
		console.log(
			`[check-native-dep-pin] ✓ PASS — ${SIGSEGV_SAFE_PINS.map((p) => `${p.name}@${p.version}`).join(', ')} 据え置き維持`,
		);
		return 0;
	}

	console.log('\n[check-native-dep-pin] ✗ FAIL — SIGSEGV-safe pin から逸脱した native 依存:\n');
	for (const v of violations) {
		console.log(`  ${v.name} [${v.where}]: expected ${v.expected} / actual ${v.actual}`);
		console.log(`    理由: ${v.reason}`);
	}
	console.log(
		'\n修正方針 (#3302):\n' +
			'  - 該当依存を SIGSEGV-safe pin に戻す (package.json exact + lock 同期)。\n' +
			'  - 安全版を更新する場合は upstream 修正確認 + native-dep-smoke + demo/NUC 実機検証後、\n' +
			'    scripts/check-native-dep-pin.mjs の SIGSEGV_SAFE_PINS と .github/dependabot.yml ignore を同時更新する。\n',
	);
	return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(main());
}
