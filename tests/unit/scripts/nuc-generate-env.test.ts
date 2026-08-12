// tests/unit/scripts/nuc-generate-env.test.ts
// cspell:ignore LASTEXITCODE — PowerShell の自動変数名 (綴りを変えると検査対象が別物になる)
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
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

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

type WorkflowStep = { name?: string; run?: string; env?: Record<string, string> };

/** deploy-nuc.yml の deploy-nuc job の step 一覧を型付きで取り出す。 */
function nucSteps(): WorkflowStep[] {
	const doc = parseYaml(workflow) as { jobs?: Record<string, { steps?: WorkflowStep[] }> };
	const steps = doc.jobs?.['deploy-nuc']?.steps;
	if (!steps) throw new Error('deploy-nuc job の steps が読めない (workflow の構造が変わった?)');
	return steps;
}

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
		const offending: string[] = [];
		for (const step of nucSteps()) {
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
		const step = nucSteps().find((s) => s.name?.includes('Generate .env'));
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

describe('#4330 静的 — provider を宣言したら、その鍵も同じ経路で配る', () => {
	/**
	 * `.env` に書く provider と、その provider が要求する API キー env の対応表。
	 * **provider を書くならキーも配る**が守るべき不変条件。
	 */
	const PROVIDER_KEY_ENV: Record<string, string> = { gemini: 'GEMINI_API_KEY' };

	it('script が書く AI_PROVIDER に対応する API キーも書く', () => {
		// #4330: `AI_PROVIDER=gemini` は書くのに GEMINI_API_KEY を配っていなかったため、
		// NUC の AI 提案は「provider は選ばれているのに鍵が無い」状態で常に無効だった。
		// **鍵が無いことが実行時まで分からない**のが本欠陥 (#4167 / #4174 と同じクラス)。
		const declared = [...script.matchAll(/^\s*"AI_PROVIDER=([a-z]+)"/gm)]
			.map((m) => m[1])
			.filter((name): name is string => name !== undefined);
		expect(declared, 'script が AI_PROVIDER を書いていない (前提が変わった?)').not.toEqual([]);

		for (const provider of declared) {
			const keyEnv = PROVIDER_KEY_ENV[provider];
			expect(keyEnv, `provider '${provider}' の API キー env が対応表に無い`).toBeTruthy();
			expect(
				script,
				`AI_PROVIDER=${provider} を書くのに ${keyEnv} を .env へ書いていない = 鍵の無い provider を宣言している (#4330)`,
			).toContain(`"${keyEnv}=$env:${keyEnv}"`);
		}
	});

	it('鍵が無いときは AI_PROVIDER を消さず warning に留める（bedrock への暗黙 fallback を作らない）', () => {
		// `AI_PROVIDER` を書かない案を採ると factory の既定 'bedrock' が選ばれる。
		// BedrockClaudeProvider.isAvailable() は BEDROCK_DISABLED 以外では**無条件 true** を返すため、
		// AWS 資格情報の無い NUC で「AI は使える」と名乗って呼び出し時に落ちる = 現状より悪化する。
		// gemini + 鍵なしなら isAvailable() が false になり、キーワード提案へ正しく縮退する。
		expect(script, 'AI_PROVIDER の無条件出力が消えている').toMatch(/^\s*"AI_PROVIDER=gemini"/m);
		expect(script, 'GEMINI_API_KEY 未設定時の warning が無い').toMatch(/::warning::GEMINI_API_KEY/);
		// deploy を止めない (#4275: 気づかせるために足した文言が deploy そのものを殺した)
		expect(
			script.match(/exit 1/g)?.length ?? 0,
			'AI キー欠落で exit 1 を増やしていない (AI は補助機能、deploy 全体を止めない)',
		).toBe(2);
	});

	it('workflow が渡す env の集合と、script が読む env の集合が一致する (#4330 AC4)', () => {
		// **片方に足りない env は deploy のたびに .env から消える。**
		// script 側にしか無い = 常に空 (これが #4330 / #4167 の欠陥そのもの)。
		// workflow 側にしか無い = 渡しているのに捨てている (secret 設定者を誤認させる)。
		const step = nucSteps().find((s) => s.name?.includes('Generate .env'));
		expect(step, 'env 生成 step が見つからない').toBeTruthy();
		const passed = new Set(Object.keys(step?.env ?? {}));
		const read = new Set(
			[...script.matchAll(/\$env:([A-Z][A-Z0-9_]*)/g)].map((m) => m[1] as string),
		);

		expect(
			[...read].filter((name) => !passed.has(name)).sort(),
			'script が読むのに workflow が渡していない env (deploy のたびに空になる)',
		).toEqual([]);
		expect(
			[...passed].filter((name) => !read.has(name)).sort(),
			'workflow が渡すのに script が .env へ書かない env (渡した気になるだけ)',
		).toEqual([]);
	});
});

/**
 * pwsh を起動する test の per-test timeout。
 *
 * 本 describe の各 test は **pwsh プロセスを 1〜2 回 spawn する**。pwsh の起動と
 * `System.Management.Automation` のアセンブリ読み込みは runner の負荷で大きくぶれ、
 * 既定 testTimeout (5s、vite.config.ts) を素通りする保証がない
 * (実測: 同一コードで develop の CI が 1.86s、PR #4376 の CI が 6.40s = 3.4 倍のぶれ。
 * 後者は **docs 1 file しか変えていない PR** を落としており、diff と無関係に赤が出る)。
 *
 * assertion は一切弱めず、spawn する test の性質に見合う時間だけを与える
 * (`check-readdir-rotation-guard.test.ts` / `cli-entry-guard.test.ts` の spawn 系と同じ扱い)。
 */
const PWSH_TIMEOUT_MS = 60_000;

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

	it(
		'parse できる（#4275 で落ちた箇所）',
		() => {
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
		},
		PWSH_TIMEOUT_MS,
	);

	it(
		'必須 secret が無ければ exit 1（deploy を止める）',
		() => {
			if (!pwsh) return;
			for (const missing of ['PARENT_GATE_COOKIE_SECRET', 'CRON_SECRET']) {
				const env: Record<string, string | undefined> = {
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
		},
		PWSH_TIMEOUT_MS,
	);

	it(
		'必須 secret が揃えば .env を書く（任意 env は設定時のみ）',
		() => {
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
		},
		PWSH_TIMEOUT_MS,
	);

	/** 必須 secret を埋め、GEMINI_API_KEY だけを指定値（または未設定）にした env を作る。 */
	function envWithGeminiKey(key?: string): Record<string, string | undefined> {
		const env: Record<string, string | undefined> = {
			...process.env,
			PARENT_GATE_COOKIE_SECRET: 'pg-secret-value',
			CRON_SECRET: 'cron-secret-value',
		};
		// **開発機に GEMINI_API_KEY が設定されていても結果が変わらないようにする**
		// (spread した process.env が漏れると「未設定なら warning」の検証が空振りする)
		delete env.GEMINI_API_KEY;
		if (key !== undefined) env.GEMINI_API_KEY = key;
		return env;
	}

	/** script を走らせて stdout と .env の中身を返す。 */
	function runScript(env: Record<string, string | undefined>): { stdout: string; written: string } {
		const dir = mkdtempSync(join(tmpdir(), 'nuc-env-'));
		const outFile = join(dir, '.env');
		try {
			const stdout = execFileSync(
				pwsh as string,
				['-NoProfile', '-File', SCRIPT_PATH, '-OutFile', outFile],
				{ env, encoding: 'utf8' },
			);
			return { stdout, written: readFileSync(outFile, 'utf8') };
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it(
		'#4330 GEMINI_API_KEY があれば AI_PROVIDER と一緒に .env へ書く',
		() => {
			if (!pwsh) return;
			const { written } = runScript(envWithGeminiKey('gemini-key-value'));
			expect(written, 'NUC は gemini ホスト').toContain('AI_PROVIDER=gemini');
			expect(
				written,
				'provider は書くのに鍵を配らない = AI 提案が常に無効になる (#4330)',
			).toContain('GEMINI_API_KEY=gemini-key-value');
		},
		PWSH_TIMEOUT_MS,
	);

	it(
		'#4330 GEMINI_API_KEY が無ければ warning を出し、deploy は続ける',
		() => {
			if (!pwsh) return;
			const { stdout, written } = runScript(envWithGeminiKey());
			expect(stdout, '鍵の欠落が誰にも届かない = #4330 の再演').toContain(
				'::warning::GEMINI_API_KEY',
			);
			// 空値を書くと「設定済みだが空」と区別できなくなる (既存の任意 env と同じ扱い)
			expect(written).not.toContain('GEMINI_API_KEY=');
			// AI 無効でも他の機能は動くので .env 生成自体は成功させる (#4275 の教訓)
			expect(written).toContain('CRON_SECRET=cron-secret-value');
		},
		PWSH_TIMEOUT_MS,
	);
});
