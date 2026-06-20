#!/usr/bin/env node
// scripts/check-dependabot-target-branch.mjs
//
// #3191: dependabot の deps bump が main へ直行する運用穴を機械で塞ぐ regression guard。
// `.github/dependabot.yml` の全 `updates[]` が `target-branch: develop` を持つことを検証する。
//
// 背景: #3072 で `target-branch: develop` を全 ecosystem に設定したが、その実効性は
// 機械検証されていなかった。#3158 (better-sqlite3 12.11.1 含む) が main 直行し、
// develop 軽量レーン + 8 領域監査をすり抜けて統合監査で SIGSEGV crash (#3190) を起こした。
// 本 gate は dependabot.yml が将来 target-branch を失う / 新 ecosystem 追加時に付け忘れる
// 退行を CI で hard-fail させ、deps 供給線が監査 gate を迂回できないことを固定する。
//
// 使用: node scripts/check-dependabot-target-branch.mjs
// exit 0 = 全 updates が target-branch:develop / exit 1 = 違反あり

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPENDABOT_PATH = resolve(__dirname, '..', '.github', 'dependabot.yml');
const REQUIRED_TARGET = 'develop';

function main() {
	let doc;
	try {
		doc = parse(readFileSync(DEPENDABOT_PATH, 'utf-8'));
	} catch (e) {
		console.error(`[check-dependabot-target-branch] FAIL — dependabot.yml を読めません: ${e}`);
		process.exit(1);
	}

	const updates = Array.isArray(doc?.updates) ? doc.updates : null;
	if (!updates || updates.length === 0) {
		console.error('[check-dependabot-target-branch] FAIL — updates[] が空 / 不正です');
		process.exit(1);
	}

	const violations = [];
	for (const u of updates) {
		const eco = u['package-ecosystem'] ?? '(unknown)';
		const dir = u.directory ?? '(unknown)';
		const target = u['target-branch'];
		if (target !== REQUIRED_TARGET) {
			violations.push(
				`  - ${eco} (${dir}): target-branch=${target ?? '(未設定 = main 直行)'} ← '${REQUIRED_TARGET}' であるべき`,
			);
		}
	}

	if (violations.length > 0) {
		console.error(
			`[check-dependabot-target-branch] FAIL — ${violations.length} 件の ecosystem が target-branch=develop を持ちません (#3072 / #3191):`,
		);
		console.error(violations.join('\n'));
		console.error(
			'\n修正: .github/dependabot.yml の各 updates[] に `target-branch: "develop"` を設定してください。' +
				'\n理由: 未設定だと dependabot が main 直行し develop 軽量レーン + 統合監査をすり抜け、' +
				'\n      native dep crash 等が本番直前まで露見しません (#3190 SIGSEGV の運用穴)。',
		);
		process.exit(1);
	}

	console.log(
		`[check-dependabot-target-branch] OK — 全 ${updates.length} ecosystem が target-branch=develop (#3072 実効性維持)`,
	);
}

main();
