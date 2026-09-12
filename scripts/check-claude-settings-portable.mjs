#!/usr/bin/env node
// .claude/settings.json は git 管理され全 clone 環境で共有される (chore/add-claude-skills、
// graphify 連携導入時に発覚)。hook の "command" に実行環境固有の絶対パスが書かれると、
// 別ユーザー名 / 別 OS の clone で即座に壊れる (実害: `graphify claude install` の公式
// インストーラは自身の exe 絶対パス — 例 C:/Users/<user>/.local/bin/graphify.EXE — を
// 毎回書き込む。アップグレード等で再実行すると portable な記述に戻し忘れやすい)。
//
// 「PATH 解決できるコマンド名のみ」「リポジトリ相対パス (node scripts/... 等)」以外の
// 絶対パスを検出し、commit 前に機械的に弾く。

import { readFileSync } from 'node:fs';

const SETTINGS_PATH = '.claude/settings.json';

const ABSOLUTE_PATH_PATTERNS = [
	{ re: /"?[A-Za-z]:[\\/]/, label: 'Windows ドライブレター絶対パス (例: C:\\Users\\...)' },
	{ re: /\/(Users|home)\//, label: 'Unix ホームディレクトリ絶対パス (例: /Users/... /home/...)' },
];

function collectCommands(hooksSection) {
	const commands = [];
	for (const eventName of Object.keys(hooksSection ?? {})) {
		for (const matcherEntry of hooksSection[eventName] ?? []) {
			for (const hook of matcherEntry.hooks ?? []) {
				if (typeof hook.command === 'string') {
					commands.push({ eventName, matcher: matcherEntry.matcher, command: hook.command });
				}
			}
		}
	}
	return commands;
}

function main() {
	let raw;
	try {
		raw = readFileSync(SETTINGS_PATH, 'utf8');
	} catch {
		// ファイル自体が無ければ検査対象外 (このリポジトリでは通常存在する)
		return;
	}

	const json = JSON.parse(raw);
	const commands = collectCommands(json.hooks);

	const violations = [];
	for (const { eventName, matcher, command } of commands) {
		const matched = ABSOLUTE_PATH_PATTERNS.find(({ re }) => re.test(command));
		if (matched) {
			violations.push({ eventName, matcher, command, label: matched.label });
		}
	}

	if (violations.length > 0) {
		console.error(
			`[check-claude-settings-portable] ${SETTINGS_PATH} に環境固有の絶対パスが含まれています:\n`,
		);
		for (const v of violations) {
			console.error(`  - [${v.eventName} / ${v.matcher}] "${v.command}"`);
			console.error(`    検出理由: ${v.label}`);
		}
		console.error(
			'\n修正方法: PATH 解決できるコマンド名のみ (例: `graphify hook-guard search`) か、' +
				'リポジトリ相対パス (例: `node scripts/foo.mjs`) に書き換えてください。\n' +
				'`graphify claude install` 等の公式インストーラを再実行した直後は、この絶対パス書き込みが' +
				'再発しやすいので必ず本チェックを通してから commit してください。',
		);
		process.exit(1);
	}
}

main();
