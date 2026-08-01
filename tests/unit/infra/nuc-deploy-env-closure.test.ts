// #4167 — NUC deploy が **本番で必要な env を配り落とさない**ことを機械で固定する。
//
// ## 塞ぐ穴
//
// `deploy-nuc.yml` の「Generate .env from GitHub Secrets」step は、`.env` を
// **固定リストで毎回全上書き**する (`Set-Content`)。したがって:
//
//   - リストに載っていない env は **deploy のたびに消える**
//   - 手で `.env` に足しても次の deploy で消える
//   - それでも **deploy 自体は成功する** ので、誰も気づかない
//
// 2026-07-31 の実害 (#4119) がまさにこれだった。`CRON_SECRET` が配られず日次バックアップが
// 18 晩失敗し続け、`DISCORD_ALERT_WEBHOOK_URL` も無いため alert は 0 通で、
// **本番データが 18 日間無保護のまま誰も気づかなかった**。
//
// 「deploy は緑、バックアップだけ静かに死ぬ」は #3950 と同型の failure mode である。
// 人の注意ではなく機械で閉じる (ADR-0061 fitness function)。
//
// ## 何を固定するか
//
// **本番バックアップ経路が読む env** が、deploy が生成する `.env` に載っていること。
// env の出所 (`scripts/backup-nuc.cjs` と service 層) から要求を読み、workflow と突き合わせる。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'deploy-nuc.yml');

const workflow = readFileSync(WORKFLOW_PATH, 'utf-8');

/**
 * `.env` 生成 step が書き出す行と、その後の条件付き追記をまとめて取り出す。
 *
 * `Set-Content -Path .env` までを対象にすることで、「env: に宣言したが `.env` に
 * 書いていない」= 配られていない、を検出できる (宣言だけでは届かない)。
 */
function envGenerationBlock(): string {
	const start = workflow.indexOf('Generate .env from GitHub Secrets');
	expect(start).toBeGreaterThan(-1);
	const end = workflow.indexOf('Set-Content -Path .env', start);
	expect(end).toBeGreaterThan(start);
	return workflow.slice(start, end);
}

/**
 * 本番 NUC のバックアップ経路が読む env のうち、**欠けると静かに壊れるもの**。
 *
 * `required` = 無いと日次バックアップが毎晩失敗する (deploy は成功して見える)。
 * `optional` = 無くても取得は動くが、**失敗が誰にも届かない / off-site 検査が走らない**。
 */
const BACKUP_ENV_CONTRACT = [
	{
		name: 'CRON_SECRET',
		required: true,
		why: '/api/cron/pglite-backup の認証。無いと毎晩 500 で失敗する (#4119 の直接原因)',
	},
	{
		name: 'DATA_SOURCE',
		required: true,
		why: 'backup-nuc.cjs が /api/health の dataSource と照合する。不一致なら実行前に落ちる (#3967)',
	},
	{
		name: 'PGLITE_DATA_DIR',
		required: true,
		why: '稼働中 PGDATA の場所。取得対象そのもの',
	},
	{
		name: 'DISCORD_ALERT_WEBHOOK_URL',
		required: false,
		why: '失敗通知の宛先。無いと 18 晩失敗しても alert 0 通になる (#4119)',
	},
] as const;

describe('#4167 NUC deploy の env 配布 closure', () => {
	const block = envGenerationBlock();

	it.each(BACKUP_ENV_CONTRACT.filter((e) => e.required))(
		'[ND1] 必須 env $name が deploy の .env 生成に含まれる',
		({ name, why }) => {
			// 「.env に書かれる」= 実際に配られる。env: への宣言だけでは届かない。
			expect(block, `${name} が .env 生成に含まれていません — ${why}`).toContain(`${name}=`);
		},
	);

	it.each(BACKUP_ENV_CONTRACT.filter((e) => !e.required))(
		'[ND2] 任意 env $name も配布経路を持つ (無いこと自体は許容)',
		({ name, why }) => {
			// 任意でも **配る手段が存在しない** のは別問題。secret 未登録で空になるのは許容するが、
			// workflow に経路が無ければ「登録しても届かない」= 永久に 0 通になる。
			expect(block, `${name} の配布経路が workflow にありません — ${why}`).toContain(name);
		},
	);

	it('[ND3] CRON_SECRET 欠落時は deploy を止める (fail-closed)', () => {
		// warning で流すと「deploy は緑、バックアップだけ静かに死ぬ」に戻る。
		// 2026-07-31 はその状態が 18 晩続いた。
		expect(block).toMatch(/if \(-not \$env:CRON_SECRET\)/);
		expect(block.slice(block.indexOf('$env:CRON_SECRET'))).toContain('exit 1');
	});

	it('[ND4] 通知先が無いときは警告を出す (黙って進めない)', () => {
		// 通知先の欠落で deploy を止めるのは過剰 (取得自体は動く) だが、
		// **黙って進むと「失敗しても誰にも届かない」状態が可視化されない**。
		expect(block).toMatch(/if \(-not \$env:DISCORD_ALERT_WEBHOOK_URL\)/);
		expect(block).toContain('::warning::');
	});

	it('[ND5] backup-nuc.cjs が読む env が契約に列挙されている (取りこぼし検出)', () => {
		// script 側が新しい env を読み始めたのに workflow へ足し忘れる、を検出する。
		// **script が SSOT** で、本テストはそこから要求を読む。
		const script = readFileSync(join(ROOT, 'scripts', 'backup-nuc.cjs'), 'utf-8');
		const referenced = new Set(
			[...script.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
		);
		// script が読むが deploy が配らなくてよい env (compose が直接与える / 派生値)。
		const suppliedByCompose = new Set([
			'BACKUP_DIR',
			'BACKUP_RETENTION',
			'APP_URL',
			'OPS_SECRET_KEY',
			'DISCORD_WEBHOOK_INCIDENT',
		]);
		const contractNames = new Set(BACKUP_ENV_CONTRACT.map((e) => e.name));

		const unaccounted = [...referenced].filter(
			(n) => !contractNames.has(n) && !suppliedByCompose.has(n),
		);
		expect(
			unaccounted,
			`backup-nuc.cjs が読む env のうち、配布契約にも compose にも無いものがあります: ${unaccounted.join(', ')}。` +
				'BACKUP_ENV_CONTRACT に追加するか、compose 供給分として suppliedByCompose に明示してください。',
		).toEqual([]);
	});
});
