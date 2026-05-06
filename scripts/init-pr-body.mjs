#!/usr/bin/env node
/**
 * scripts/init-pr-body.mjs — Issue #1863
 *
 * `npm run dev:open-pr -- --issue <num> --kind <kind>` のラッパー。
 * 実体は .claude/skills/dev-open-pr/scripts/init-pr-body.mjs を呼び出す。
 *
 * Skill 配下を直接呼んでもよいが、Dev Agent が `npm run` から起動できるよう
 * `scripts/` 直下に薄いラッパーを置いて発見性を高める（issue-triage は Skill 起動のみで
 * scripts ラッパー不要だったが、PR 起票は頻度が高いため scripts ラッパーを併設）。
 *
 * SSOT: .claude/skills/dev-open-pr/SKILL.md
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const skillScript = resolve(
	repoRoot,
	'.claude',
	'skills',
	'dev-open-pr',
	'scripts',
	'init-pr-body.mjs',
);

const result = spawnSync(process.execPath, [skillScript, ...process.argv.slice(2)], {
	stdio: 'inherit',
	cwd: repoRoot,
});

if (result.error) {
	console.error('scripts/init-pr-body.mjs: 子プロセス起動失敗:', result.error);
	process.exit(2);
}
process.exit(result.status ?? 0);
