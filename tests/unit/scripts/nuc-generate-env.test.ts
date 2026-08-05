// tests/unit/scripts/nuc-generate-env.test.ts
// #4275 — NUC deploy の .env 生成を、self-hosted runner なしで検証する。
//
// ## なぜこのテストが要るか
//
// 2026-08-05 のリリースは AWS に届いて NUC に届かなかった。`deploy-nuc.yml` の
// `Generate .env from GitHub Secrets` step が **PowerShell の parse error** で落ちたためで、
// 壊したのは **エラーメッセージ自身** だった:
//
//   1. `--body <hex>` の `<` を PowerShell が予約演算子として解釈した
//   2. 日本語の警告文が Windows PowerShell 5.1 の ANSI 読みで mojibake し、`(` の対応が壊れた
//
// **この step は self-hosted NUC runner でしか実行されないため、PR の CI では 1 度も走らない。**
// #4168 は CI 緑のまま merge され、main に到達して初めて落ちた。
//
// そこで step 本体を `scripts/nuc/generate-env.ps1` に切り出し、本テストが
// (a) 壊れる書き方が二度と入らないこと（静的）と (b) 実際に動くこと（pwsh 実行）を検証する。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = 'scripts/nuc/generate-env.ps1';
const WORKFLOW_PATH = '.github/workflows/deploy-nuc.yml';

const script = readFileSync(SCRIPT_PATH, 'utf8');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

/** pwsh があるか。GitHub-hosted runner には常に入っている。 */
function findPwsh(): string | null {
	for (const bin of ['pwsh', 'powershell']) {
		try {
			execFileSync(bin, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
				stdio: 'pipe',
			});
			return bin;
		} catch {
			// 次の候補へ
		}
	}
	return null;
}

const pwsh = findPwsh();

describe('#4275 静的 — 壊れる書き方を二度と入れない', () => {
	it('script は ASCII のみ（runner の encoding に依存させない）', () => {
		const nonAscii = [...script]
			.map((ch, i) => ({ ch, i }))
			.filter(({ ch }) => ch.charCodeAt(0) > 0x7f);
		expect(
			nonAscii.map(({ ch, i }) => `offset ${i}: ${JSON.stringify(ch)}`),
			'非 ASCII 文字は Windows PowerShell 5.1 の ANSI 読みで mojibake し、括弧の対応を壊して parse error になる (#4275 原因 2)',
		).toEqual([]);
	});

	it('実行行に < / > を書かない（PowerShell の予約演算子）', () => {
		// **文字列の中でも禁止する。** #4275 は「二重引用符の中だから安全」という前提が、
		// 直前行の mojibake で崩れて成立しなかった事例。
		// コメント行（`#` 始まり）は対象外 — PowerShell は行ごと読み飛ばすため parse に影響せず、
		// このルール自体を説明する文章が書けなくなる。
		const offending = script
			.split('\n')
			.map((line, idx) => ({ line, no: idx + 1 }))
			.filter(({ line }) => !line.trimStart().startsWith('#'))
			.filter(({ line }) => /[<>]/.test(line));
		expect(
			offending.map(({ line, no }) => `L${no}: ${line.trim()}`),
			'プレースホルダは [brackets] を使う (#4275 原因 1)',
		).toEqual([]);
	});

	it('必須 secret 2 件が fail-closed で検査されている', () => {
		for (const name of ['PARENT_GATE_COOKIE_SECRET', 'CRON_SECRET']) {
			expect(script, `${name} の未設定チェックが無い`).toMatch(
				new RegExp(`if \\(-not \\$env:${name}\\)`),
			);
		}
		// 「警告だけ出して続行」に退化していないこと
		expect(script.match(/exit 1/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
	});

	it('workflow の全 run ブロックが ASCII のみ（mojibake で parse error にしない）', () => {
		// #4275 の原因 2 は「日本語が ANSI 読みで mojibake し括弧の対応が壊れた」こと。
		// **切り出した script だけを守っても、workflow 側に日本語を書けば同じことが起きる**
		// （本 PR で追加した通知 step も含め、この workflow の run ブロック全体を対象にする）。
		// YAML コメント（`#` 行、step の外）は PowerShell に渡らないため対象外。
		const doc = load(workflow) as {
			jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
		};
		const offending: string[] = [];
		for (const step of doc.jobs['deploy-nuc'].steps) {
			if (typeof step.run !== 'string') continue;
			const nonAscii = [...step.run].filter((ch) => ch.charCodeAt(0) > 0x7f);
			if (nonAscii.length > 0) {
				offending.push(`${step.name ?? '(no name)'}: ${nonAscii.length} 文字`);
			}
		}
		expect(
			offending,
			'run ブロック内の非 ASCII は runner の encoding 次第で parse error になる',
		).toEqual([]);
	});

	it('env 生成 step が子プロセスの exit code を step の失敗に伝搬する', () => {
		// script が `exit 1` しても、GHA の powershell shell は `$LASTEXITCODE` を自動判定しない。
		// 伝搬させないと **secret 欠落で step が緑になり fail-closed が fail-open に退化する**
		// (#4119 の「deploy は成功、バックアップだけ静かに死ぬ」の再演)。
		const doc = load(workflow) as {
			jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
		};
		const step = doc.jobs['deploy-nuc'].steps.find((s) => s.name?.includes('Generate .env'));
		expect(step?.run, 'env 生成 step が見つからない').toBeTruthy();
		expect(
			step?.run,
			'$LASTEXITCODE の伝搬が無い = script が exit 1 しても step が緑になる',
		).toMatch(/\$LASTEXITCODE\s*-ne\s*0/);
	});

	it('workflow は inline PowerShell ではなく本 script を呼ぶ', () => {
		expect(workflow, 'workflow が script を呼んでいない = 切り出しが効いていない').toContain(
			'scripts/nuc/generate-env.ps1',
		);
		// 旧 inline 実装の痕跡（`$envLines = @(` を workflow 内に持つ形）が残っていないこと
		expect(workflow, 'inline の .env 生成が workflow に残っている').not.toContain('$envLines = @(');
	});
});

describe('#4275 動作 — pwsh で実際に走らせる', () => {
	/**
	 * pwsh が無い環境では静的検査だけになる。**CI では skip を許さない**
	 * (「検査できなかった」を「検査した」と区別できなくするのが #4084 / #4264 の失敗)。
	 */
	it('pwsh が使えること（CI では必須）', () => {
		if (!pwsh && process.env.CI) {
			throw new Error(
				'CI に pwsh が無い。本テストの動作検証が丸ごと消えるため fail させる (#4275 AC4)',
			);
		}
		expect(pwsh ?? 'skipped-locally').toBeTruthy();
	});

	it('parse できる（#4275 で落ちた箇所）', () => {
		if (!pwsh) return;
		const out = execFileSync(
			pwsh,
			[
				'-NoProfile',
				'-Command',
				`$e=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${SCRIPT_PATH}').Path,[ref]$null,[ref]$e); if($e.Count -gt 0){ $e | ForEach-Object { $_.Message }; exit 1 } else { 'PARSE_OK' }`,
			],
			{ encoding: 'utf8' },
		);
		expect(out).toContain('PARSE_OK');
	});

	it('必須 secret が無ければ exit 1（deploy を止める）', () => {
		if (!pwsh) return;
		for (const missing of ['PARENT_GATE_COOKIE_SECRET', 'CRON_SECRET']) {
			const env = {
				...process.env,
				PARENT_GATE_COOKIE_SECRET: 'dummy-parent-gate',
				CRON_SECRET: 'dummy-cron',
			};
			delete env[missing];
			let exitCode = 0;
			try {
				execFileSync(pwsh, ['-NoProfile', '-File', SCRIPT_PATH], { env, stdio: 'pipe' });
			} catch (e) {
				exitCode = (e as { status?: number }).status ?? -1;
			}
			expect(exitCode, `${missing} 未設定なのに deploy が続行した`).toBe(1);
		}
	});

	it('必須 secret が揃えば .env を書く（任意 env は設定時のみ）', () => {
		if (!pwsh) return;
		const dir = mkdtempSync(join(tmpdir(), 'nuc-env-'));
		const outFile = join(dir, '.env');
		try {
			execFileSync(pwsh, ['-NoProfile', '-File', SCRIPT_PATH, '-OutFile', outFile], {
				env: {
					...process.env,
					PARENT_GATE_COOKIE_SECRET: 'pg-secret-value',
					CRON_SECRET: 'cron-secret-value',
					HOST_BACKUP_DIR: 'D:/backups',
					DISCORD_ALERT_WEBHOOK_URL: '',
				},
				stdio: 'pipe',
			});
			expect(existsSync(outFile)).toBe(true);
			const written = readFileSync(outFile, 'utf8');

			expect(written).toContain('PARENT_GATE_COOKIE_SECRET=pg-secret-value');
			expect(written).toContain('CRON_SECRET=cron-secret-value');
			expect(written).toContain('DATA_SOURCE=pglite');
			expect(written).toContain('HOST_BACKUP_DIR=D:/backups');
			// 空の任意 env は書かない（「設定済みだが空」と区別できなくなる）
			expect(written).not.toContain('DISCORD_ALERT_WEBHOOK_URL=');
			// BOM を持たない（docker compose env_file が弾く）
			expect(written.charCodeAt(0)).not.toBe(0xfeff);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
