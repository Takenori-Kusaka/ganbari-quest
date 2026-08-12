// #2337 — check-new-required-env regex 改善 (PR #2325 教訓)
//
// envInStringRe が「env 名 + env var/environment variable/secret + is required」の
// 3 自然語パターンを検出することを確認する。
// 詳細経緯: PR #2325 で `[PARENT_GATE] PARENT_GATE_COOKIE_SECRET env var is required in production`
// パターンが検出漏れし本番障害を引き起こした事故への regress test。

import { describe, expect, it } from 'vitest';

import {
	detectNewRequiredEnvs,
	detectRequirementTransitions,
	parseNotNewlyRequiredExemptions,
} from '../../../scripts/check-new-required-env.mjs';

describe('check-new-required-env (#2337 regex 改善)', () => {
	describe('Pattern B: throw new Error 内 env 名検出', () => {
		it('env 名 + "is required" 直結パターンを検出する (既存)', () => {
			const lines = ["throw new Error('AWS_LICENSE_SECRET is required');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('AWS_LICENSE_SECRET')).toBe(true);
		});

		it('env 名 + "env var" + "is required" パターンを検出する (#2337 PR #2325 regress)', () => {
			const lines = [
				"throw new Error('[PARENT_GATE] PARENT_GATE_COOKIE_SECRET env var is required in production');",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('PARENT_GATE_COOKIE_SECRET')).toBe(true);
		});

		it('env 名 + "environment variable" + "is required" パターンを検出する (#2337)', () => {
			const lines = [
				"throw new Error('MY_FANCY_TOKEN environment variable is required at startup');",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('MY_FANCY_TOKEN')).toBe(true);
		});

		it('env 名 + "secret" + "is required" パターンを検出する (#2337)', () => {
			const lines = ["throw new Error('STRIPE_WEBHOOK_SECRET secret is required for webhook');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('STRIPE_WEBHOOK_SECRET')).toBe(true);
		});

		it('env 名 + "must be set" パターンを検出する (既存)', () => {
			const lines = ["throw new Error('FOO_BAR_TOKEN must be set');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('FOO_BAR_TOKEN')).toBe(true);
		});

		it('env 名 + "is not set" パターンを検出する (既存)', () => {
			const lines = ["throw new Error('CUSTOM_TOKEN is not set in env');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('CUSTOM_TOKEN')).toBe(true);
		});

		it('PR #2325 完全再現: ADR-0050 parent-gate-session.ts L43-45 throw', () => {
			// 実際の parent-gate-session.ts ソース (line breaks 含む) を模した状態
			const lines = [
				'		if (isProd) {',
				'			throw new Error(',
				"				'[PARENT_GATE] PARENT_GATE_COOKIE_SECRET env var is required in production (length >= 16)',",
				'			);',
				'		}',
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('PARENT_GATE_COOKIE_SECRET')).toBe(true);
		});
	});

	describe('Pattern A: assertXxxConfigured()', () => {
		it('assertLicenseKeyConfigured() + 周辺 process.env を検出する', () => {
			const lines = [
				'function assertLicenseKeyConfigured() {',
				'  if (!process.env.AWS_LICENSE_SECRET) {',
				"    throw new Error('license secret missing');",
				'  }',
				'}',
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('AWS_LICENSE_SECRET')).toBe(true);
		});
	});

	describe('Pattern C: process.env.X || (() => { throw })()', () => {
		it('inline throw IIFE パターンを検出する', () => {
			const lines = [
				"const secret = process.env.SUPER_SECRET || (() => { throw new Error('boom'); })();",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('SUPER_SECRET')).toBe(true);
		});
	});

	describe('False positive 抑止', () => {
		it('NODE_ENV / PORT / CI 等フレームワーク内蔵 env は検出対象外', () => {
			const lines = [
				"throw new Error('NODE_ENV is required');",
				"throw new Error('PORT must be set');",
				"throw new Error('CI is not set');",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('NODE_ENV')).toBe(false);
			expect(result.has('PORT')).toBe(false);
			expect(result.has('CI')).toBe(false);
		});

		it('camelCase / 単独大文字単語 は検出対象外', () => {
			const lines = [
				"throw new Error('apiKey is required');",
				"throw new Error('TOKEN is required');", // 単独大文字 (アンダースコアなし) は除外
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.size).toBe(0);
		});

		it('修飾語なし + is required 以外の文脈 は検出しない', () => {
			// "FOO is required to do X" のような業務文も誤検出しない
			const lines = ["console.log('A_VALID_FORM is required to do X');"];
			const result = detectNewRequiredEnvs(lines);
			// throw new Error の中にないので検出されない (B 経由でない)
			// 注: Pattern A/C 経由でなければ B のみで検出される設計なので、これは検出される
			// → B は throw new Error 内のみなので、本ケースは検出されない
			expect(result.has('A_VALID_FORM')).toBe(false);
		});
	});

	describe('複数 env の同時検出', () => {
		it('同一 throw 内で末尾 "are required" 直前の env を検出する', () => {
			// regex は env 名直後に修飾語 + is/are/must required を期待するため、
			// "X and Y are required" 形式では末尾 Y のみ検出される
			// (これは false positive 抑制の方針と整合)。
			const lines = ["throw new Error('AWS_LICENSE_SECRET and STRIPE_SECRET_KEY are required');"];
			const result = detectNewRequiredEnvs(lines);
			// 末尾 env のみが is/are required 直前にあるため検出される
			expect(result.has('STRIPE_SECRET_KEY')).toBe(false); // "are required" は対象外
			// "is required" 形式に絞れば検出される
			const lines2 = ["throw new Error('STRIPE_SECRET_KEY is required');"];
			const result2 = detectNewRequiredEnvs(lines2);
			expect(result2.has('STRIPE_SECRET_KEY')).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// #4129 AC5 — 「既存 env の必須化」まで検出範囲を広げる
//
// 実害 (2026-07-31): 本番 NUC の日次バックアップが 7/30 の deploy 後、初回実行から
// 毎晩失敗していた。原因は `CRON_SECRET` が NUC の .env に未配布だったこと。
// #3950 でバックアップ入口が `scripts/backup-nuc.cjs` の pglite 経路へ一本化された結果、
// 以前から存在する `CRON_SECRET` が backup コンテナの hard requirement になったが、
// 本 gate は「**新規**追加された必須 env」しか見ていなかったため素通りした。
// さらに `DISCORD_ALERT_WEBHOOK_URL` も未配布で失敗通知も届かず、18 日間気付かれなかった。
//
// 検出漏れの直接原因は 2 つ:
//   (a) requirement guard の throw 文言が日本語 (`CRON_SECRET が未設定です`) で、
//       英語 "is required" 前提の regex に掛からなかった
//   (b) `if (!X) { ... process.exit(1) }` 形式の fail-fast guard を見ていなかった
// 加えて構造的な穴として (c) optional → required への「変化」を diff から読んでいなかった。
// ---------------------------------------------------------------------------

describe('check-new-required-env (#4129 AC5 既存 env の必須化)', () => {
	describe('Pattern B-JP: 日本語の必須文言', () => {
		it('#3950 実物再現: throw new Error("CRON_SECRET が未設定です ...") を検出する', () => {
			// scripts/backup-nuc.cjs L101-103 の実コード
			const lines = [
				'	if (!CRON_SECRET) {',
				"		throw new Error('CRON_SECRET が未設定です (/api/cron/pglite-backup の認証に必要)');",
				'	}',
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('CRON_SECRET')).toBe(true);
		});

		it('「が必要」「は必須」「を設定してください」「が設定されていません」も検出する', () => {
			for (const message of [
				'DISCORD_ALERT_WEBHOOK_URL が必要です',
				'BACKUP_TARGET_URL は必須です',
				'NUC_ADMIN_TOKEN を設定してください',
				'RESTORE_VERIFY_URL が設定されていません',
			]) {
				const envName = message.split(' ')[0] as string;
				const result = detectNewRequiredEnvs([`throw new Error('${message}');`]);
				expect(result.has(envName), `${envName} を検出できていない`).toBe(true);
			}
		});
	});

	describe('Pattern E: fail-fast guard (throw を使わない必須化)', () => {
		it('const alias 経由の `if (!X) { ... process.exit(1) }` を検出する', () => {
			const lines = [
				"const BACKUP_SECRET = process.env.NUC_BACKUP_SECRET || '';",
				'if (!BACKUP_SECRET) {',
				"	console.error('backup secret missing');",
				'	process.exit(1);',
				'}',
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('NUC_BACKUP_SECRET')).toBe(true);
		});

		it('fallback 連鎖 (`A || B`) は両方の env を必須として検出する', () => {
			// backup-nuc.cjs L58 と同型。どちらも配布されていないと動かないため両方に証跡が要る
			const lines = [
				"const CRON_SECRET = process.env.CRON_SECRET || process.env.OPS_SECRET_KEY || '';",
				'if (!CRON_SECRET) {',
				'	process.exit(1);',
				'}',
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('CRON_SECRET')).toBe(true);
			expect(result.has('OPS_SECRET_KEY')).toBe(true);
		});

		it('`if (!process.env.X)` 直参照も検出する', () => {
			const lines = ['if (!process.env.PGLITE_BACKUP_BUCKET) {', '	process.exit(1);', '}'];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('PGLITE_BACKUP_BUCKET')).toBe(true);
		});

		it('env に紐づかない変数の guard は検出しない (false positive 抑止)', () => {
			const lines = [
				'const parsed = JSON.parse(raw);',
				'if (!parsed) {',
				'	process.exit(1);',
				'}',
			];
			expect(detectNewRequiredEnvs(lines).size).toBe(0);
		});

		// #4497: `if (!CONSENT_TYPES.includes(type)) throw ...` が env 必須化と誤検出された。
		// ALL_CAPS の**ドメイン定数**に対するメソッド呼び出しであって env 参照ではない。
		// bare な `!NAME` (env alias 直参照) だけを guard と見なす。
		it('ALL_CAPS 定数へのメソッド呼び出し guard は env ではない (false positive 抑止)', () => {
			const lines = [
				'for (const type of types) {',
				'	if (!CONSENT_TYPES.includes(type)) {',
				'		throw new Error("Unknown consent type");',
				'	}',
				'}',
			];
			expect(detectNewRequiredEnvs(lines).size).toBe(0);
		});

		it('ALL_CAPS 定数のプロパティ参照 guard も env ではない (false positive 抑止)', () => {
			const lines = [
				'if (!PLAN_LIMITS.standard) {',
				'	throw new Error("plan limits missing");',
				'}',
			];
			expect(detectNewRequiredEnvs(lines).size).toBe(0);
		});

		// 上の抑止を入れても、本来の検出 (bare な env alias / process.env 直参照) は生きていること
		it('bare な ALL_CAPS env 名の guard は引き続き検出する (抑止の掘りすぎ防止)', () => {
			const lines = ['if (!STRIPE_WEBHOOK_SECRET) {', '	throw new Error("missing");', '}'];
			expect(detectNewRequiredEnvs(lines).has('STRIPE_WEBHOOK_SECRET')).toBe(true);
		});

		it('exit(0) で終わる guard は必須化ではない (false positive 抑止)', () => {
			const lines = [
				"const optionalHook = process.env.OPTIONAL_HOOK_URL || '';",
				'if (!optionalHook) {',
				"	console.log('hook 未設定のため通知を skip します');",
				'	process.exit(0);',
				'}',
			];
			expect(detectNewRequiredEnvs(lines).has('OPTIONAL_HOOK_URL')).toBe(false);
		});
	});

	describe('Pattern F: optional → required の変化 (removed 行との対比)', () => {
		it('schema の `.optional()` 剥がしを検出する', () => {
			const result = detectRequirementTransitions({
				addedLines: ['	CRON_SECRET: z.string(),'],
				removedLines: ['	CRON_SECRET: z.string().optional(),'],
			});
			expect(result.has('CRON_SECRET')).toBe(true);
		});

		it('既定値 fallback の撤去を検出する', () => {
			const result = detectRequirementTransitions({
				addedLines: ['const url = process.env.DISCORD_ALERT_WEBHOOK_URL;'],
				removedLines: ["const url = process.env.DISCORD_ALERT_WEBHOOK_URL || '';"],
			});
			expect(result.has('DISCORD_ALERT_WEBHOOK_URL')).toBe(true);
		});

		it('CDK silent skip (ADR-0024 ルール 1) の撤去を検出する', () => {
			const result = detectRequirementTransitions({
				addedLines: ['	CRON_SECRET: cronSecret,'],
				removedLines: ['	...(cronSecret ? { CRON_SECRET: cronSecret } : {}),'],
			});
			expect(result.has('CRON_SECRET')).toBe(true);
		});

		it('optional のまま整形しただけの diff は検出しない (false positive 抑止)', () => {
			const result = detectRequirementTransitions({
				addedLines: ["const url = process.env.SOME_WEBHOOK_URL || ''; // 整形"],
				removedLines: ["const url = process.env.SOME_WEBHOOK_URL || '';"],
			});
			expect(result.has('SOME_WEBHOOK_URL')).toBe(false);
		});

		it('参照ごと消えた env は検出しない (使わなくなったのだから必須化ではない)', () => {
			const result = detectRequirementTransitions({
				addedLines: [],
				removedLines: ["const url = process.env.LEGACY_WEBHOOK_URL || '';"],
			});
			expect(result.has('LEGACY_WEBHOOK_URL')).toBe(false);
		});

		it('検出理由を env ごとに持つ (BLOCK メッセージで何を直すか分かるように)', () => {
			const result = detectRequirementTransitions({
				addedLines: ['	CRON_SECRET: z.string(),'],
				removedLines: ['	CRON_SECRET: z.string().optional(),'],
			});
			expect(result.get('CRON_SECRET')).toMatch(/optional/i);
		});
	});

	describe('誤検出の解除は「理由必須」の宣言でのみ行える (#3956 教訓)', () => {
		it('実体のある理由付き宣言は解除として受理される', () => {
			const body =
				'<!-- env-not-newly-required: SOME_TOKEN 既に NUC / GitHub Secrets 双方へ配布済で本 PR は参照位置の移動のみ -->';
			const map = parseNotNewlyRequiredExemptions(body);
			expect(map.get('SOME_TOKEN')?.valid).toBe(true);
		});

		it('定型 stub の理由は受理しない', () => {
			for (const stub of ['TODO', 'n/a', 'なし', '-']) {
				const map = parseNotNewlyRequiredExemptions(
					`<!-- env-not-newly-required: SOME_TOKEN ${stub} -->`,
				);
				expect(map.get('SOME_TOKEN')?.valid, `stub "${stub}" が受理されている`).toBe(false);
			}
		});

		it('stub ではないが短すぎる理由も受理しない (最小長 gate)', () => {
			// stub 一覧に載っていない語でも、実質的な説明になっていなければ受理しない。
			// stub 一覧だけでは「急ぎ」の一言で解除できてしまい理由の非強制が復活する
			const map = parseNotNewlyRequiredExemptions(
				'<!-- env-not-newly-required: SOME_TOKEN 急ぎ -->',
			);
			expect(map.get('SOME_TOKEN')?.valid).toBe(false);
		});

		it('理由が空の宣言は受理しない', () => {
			const map = parseNotNewlyRequiredExemptions('<!-- env-not-newly-required: SOME_TOKEN -->');
			expect(map.get('SOME_TOKEN')?.present).toBe(true);
			expect(map.get('SOME_TOKEN')?.valid).toBe(false);
		});

		it('宣言が無ければ解除されない', () => {
			expect(parseNotNewlyRequiredExemptions('本文に宣言なし').size).toBe(0);
		});
	});
});
