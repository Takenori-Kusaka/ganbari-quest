/**
 * tests/unit/github/pr-lane-action-fail-open.test.ts (#4518)
 *
 * `actions/pr-lane` の commit author 取得 step が **本当に fail-open するか** を、
 * yml から run script を切り出して実際の shell で走らせて確認する。
 *
 * ## 背景
 *
 * 同 step は `gh api .../commits` が失敗したら warning を出して `authors=` (空) を返し、
 * actor だけで lane を判定し直す fail-open 設計だった。ところが GitHub の composite step は
 * 既定 shell が `bash --noprofile --norc -e -o pipefail` で、`-e` は run 冒頭の
 * `set -uo pipefail` では解除されない。裸の代入 `authors="$(gh api ...)"` にしていたため、
 * gh が非 0 で終了した瞬間に step ごと中断し、直後の `if [ $? -ne 0 ]` fail-open 分岐へ
 * 到達しなかった (= 設計上の fail-open が死んでいた)。
 *
 * 実害: dependabot PR #4492 で gh api が一過性に失敗し、`closing keyword の記入 (feat/fix)`
 * job が「lane 判定できず」ではなく **hard-fail** した。同じ composite action を
 * `必須セクションの存在確認` 等の **required context** も使うため、required check が
 * API の一過性失敗で落ちうる状態だった。
 *
 * コメントで「fail-open」と書いてあっても実際に fail-open するとは限らないので、
 * 静的な文言一致ではなく **実行して確かめる** (ADR-0061 same-class-N→guard)。
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const ACTION_YML = path.join(REPO_ROOT, 'actions', 'pr-lane', 'action.yml');

const tempDirs: string[] = [];

afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/**
 * action.yml から commit 取得 step (`id: commits`) の `run: |` ブロックを取り出して dedent する。
 * yml パーサ依存を増やさないため、既存の workflow 検査 test と同じくテキスト走査で切り出す。
 */
function extractCommitsRunScript(): string {
	const lines = readFileSync(ACTION_YML, 'utf8').split(/\r?\n/);
	const stepStart = lines.findIndex((l) => /^\s*id:\s*commits\s*$/.test(l));
	expect(stepStart, 'action.yml に `id: commits` の step が見つからない').toBeGreaterThan(-1);

	const runStart = lines.findIndex((l, i) => i > stepStart && /^\s*run:\s*\|\s*$/.test(l));
	expect(runStart, '`id: commits` step に `run: |` ブロックが無い').toBeGreaterThan(stepStart);

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
		if (lead < indent) break; // ブロック終端 (次の step へ)
		body.push(line.slice(indent));
	}
	const script = body.join('\n').trimEnd();
	expect(script, 'run ブロックが空').toContain('gh api');
	return script;
}

/** GitHub composite step の既定 shell と同じ条件で run script を実行する。 */
function runStepScript(options: { ghExitCode: number; ghStdout: string; prNumber: string }) {
	const dir = mkdtempSync(path.join(tmpdir(), 'pr-lane-failopen-'));
	tempDirs.push(dir);

	const scriptPath = path.join(dir, 'step.sh');
	writeFileSync(scriptPath, `${extractCommitsRunScript()}\n`, 'utf8');

	// gh の stub。実 gh を呼ばずに成功 / 失敗を注入する。
	const binDir = path.join(dir, 'bin');
	mkdirSync(binDir, { recursive: true });
	const ghStub = path.join(binDir, 'gh');
	writeFileSync(
		ghStub,
		`#!/usr/bin/env bash\nprintf '%s' ${JSON.stringify(options.ghStdout)}\nexit ${options.ghExitCode}\n`,
		{ encoding: 'utf8', mode: 0o755 },
	);
	chmodSync(ghStub, 0o755);

	const outputFile = path.join(dir, 'github_output');
	writeFileSync(outputFile, '', 'utf8');

	const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', scriptPath], {
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
			REPO: 'Takenori-Kusaka/ganbari-quest',
			PR_NUMBER: options.prNumber,
			GITHUB_OUTPUT: outputFile,
		},
	});

	return {
		status: result.status,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		githubOutput: readFileSync(outputFile, 'utf8'),
	};
}

describe('actions/pr-lane commit author 取得 step (#4518)', () => {
	it('gh api が失敗しても step は成功し、authors= (空) を出力する = fail-open が生きている', () => {
		const r = runStepScript({ ghExitCode: 1, ghStdout: '', prNumber: '4492' });

		// mkdtemp が存在する以上 bash 自体は起動できているはず。起動不能を成功と誤認しない。
		expect(r.status, `bash が起動できていない可能性: ${r.stderr}`).not.toBeNull();
		expect(r.status, `fail-open せず step が落ちた。stderr=${r.stderr}`).toBe(0);
		expect(r.githubOutput).toMatch(/^authors=\s*$/m);
		expect(r.stdout + r.stderr).toContain('::warning::');
	});

	it('gh api が成功したら取得した author 一覧をそのまま出力する', () => {
		const r = runStepScript({
			ghExitCode: 0,
			ghStdout: 'dependabot[bot],dependabot[bot]',
			prNumber: '4492',
		});

		expect(r.status).toBe(0);
		expect(r.githubOutput).toContain('authors=dependabot[bot],dependabot[bot]');
	});

	it('PR 番号が空なら gh を呼ばずに authors= で早期終了する', () => {
		const r = runStepScript({ ghExitCode: 1, ghStdout: '', prNumber: '' });

		expect(r.status).toBe(0);
		expect(r.githubOutput).toMatch(/^authors=\s*$/m);
	});
});
