// tests/unit/infra/compose-backup-volume.test.ts
// #3970 (E3 / EPIC #4119) — バックアップの保存先を compose を書き換えずに差し替えられること。
//
// ## なぜこれをテストで固定するのか
//
// #3970 の決定は「アプリ側は **volume 指定領域に出すところまで**を担い、NAS / SAMBA /
// クラウドへの複製は運用者がファイルシステム層で行う」。この責任分界が成立する前提は
// **運用者が compose を書き換えずに保存先を差し替えられる**ことである。
//
// 加えて、**`app` と `backup` が同じ実体を指す**ことが不変条件になる。片方だけ差し替えると
// backup コンテナが別ディレクトリを見て「取れているのに実データではない」状態になり、
// #3950 (PGlite 移行後も旧 SQLite を複製し続けた) と同型の事故が再現する。
// この 2 サービスの整合は目で見て守る類のものではないので機械で固定する。
//
//   [CV1] app / backup とも HOST_BACKUP_DIR 経由で /app/backups を mount する
//   [CV2] **両者が同一の指定**である (片方だけ固定に戻っていない)
//   [CV3] 未設定時の既定は従来どおり ./data/backups (既存 NUC が無設定のまま壊れない)
//   [CV4] **稼働中の DB (/app/data) は差し替え可能にしない** — 埋め込み型 DB を
//         ネットワーク共有上で直接稼働させると書き込み中の切断で DB ファイルが破損する。
//         off-site 化のために推奨した設定が、本番 DB 破損という別の全損経路を開いてはならない
//         (QM 指摘 PR #4149、2026-07-31)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COMPOSE_PATH = join(process.cwd(), 'docker-compose.yml');

/** `docker-compose.yml` から指定サービスの volumes 行を抜き出す。 */
function volumeLinesOf(service: string): string[] {
	const raw = readFileSync(COMPOSE_PATH, 'utf-8');
	const lines = raw.split('\n');
	const serviceIdx = lines.findIndex((l) => l.trimEnd() === `  ${service}:`);
	if (serviceIdx < 0) throw new Error(`service '${service}' が docker-compose.yml にありません`);

	// 次のサービス定義 (インデント 2 の `xxx:`) までを対象にする。
	const nextIdx = lines.findIndex((l, i) => i > serviceIdx && /^ {2}[a-z][a-z0-9_-]*:\s*$/.test(l));
	const block = lines.slice(serviceIdx, nextIdx < 0 ? lines.length : nextIdx);

	const volIdx = block.findIndex((l) => l.trim() === 'volumes:');
	if (volIdx < 0) return [];
	const out: string[] = [];
	for (const line of block.slice(volIdx + 1)) {
		const t = line.trim();
		if (t.startsWith('#')) continue;
		if (!t.startsWith('- ')) break; // volumes ブロックの終わり
		out.push(t.slice(2).trim());
	}
	return out;
}

/** 指定サービスの environment ブロックの各行 (`KEY=value`) を返す。 */
function environmentLinesOf(service: string): string[] {
	const raw = readFileSync(COMPOSE_PATH, 'utf-8');
	const lines = raw.split('\n');
	const serviceIdx = lines.findIndex((l) => l.trimEnd() === `  ${service}:`);
	if (serviceIdx < 0) throw new Error(`service '${service}' が docker-compose.yml にありません`);

	const nextIdx = lines.findIndex((l, i) => i > serviceIdx && /^ {2}[a-z][a-z0-9_-]*:\s*$/.test(l));
	const block = lines.slice(serviceIdx, nextIdx < 0 ? lines.length : nextIdx);

	const envIdx = block.findIndex((l) => l.trim() === 'environment:');
	if (envIdx < 0) return [];
	const out: string[] = [];
	for (const line of block.slice(envIdx + 1)) {
		const t = line.trim();
		if (t.startsWith('#')) continue;
		if (!t.startsWith('- ')) break; // environment ブロックの終わり
		out.push(t.slice(2).trim());
	}
	return out;
}

/** 指定の container path を mount している行の、ホスト側の指定部分を返す。 */
function hostMountFor(service: string, containerPath: string): string {
	const suffix = `:${containerPath}`;
	const line = volumeLinesOf(service).find((v) => v.endsWith(suffix));
	if (!line) throw new Error(`service '${service}' に ${containerPath} の mount がありません`);
	return line.slice(0, -suffix.length);
}

describe('#3970 バックアップ保存先の差し替え可能性 (docker-compose)', () => {
	it('[CV1] app / backup とも HOST_BACKUP_DIR 経由で /app/backups を mount する', () => {
		// compose を書き換えずに NAS 等へ向けられること = 責任分界の前提。
		expect(hostMountFor('app', '/app/backups')).toContain('HOST_BACKUP_DIR');
		expect(hostMountFor('backup', '/app/backups')).toContain('HOST_BACKUP_DIR');
	});

	it('[CV2] app と backup が同一の指定である (片方だけ固定に戻っていない)', () => {
		// 食い違うと backup が別ディレクトリを見て「取れているのに実データではない」
		// #3950 同型の事故になる。目視で守れる不変条件ではないので機械で固定する。
		expect(hostMountFor('backup', '/app/backups')).toBe(hostMountFor('app', '/app/backups'));
	});

	it('[CV4] 稼働中の DB (/app/data) は差し替え可能にしない', () => {
		// 埋め込み型 DB (PGlite / SQLite) をネットワーク共有上で直接稼働させると、
		// 書き込み中の切断で DB ファイルが破損する。off-site 化のために推奨した設定が
		// 本番 DB 破損という別の全損経路を開いてはならない (QM 指摘 PR #4149)。
		for (const service of ['app', 'backup']) {
			expect(hostMountFor(service, '/app/data')).toBe('./data');
		}
	});

	it('[CV6] off-site 検査の起動条件が app に配線されている (#3970 AC2)', () => {
		// **この 1 行が消えると検査そのものが二度と発火しない**。しかも off-site を
		// 設定していない家庭では元々沈黙する仕様なので、消えても誰も気づかない
		// (#3950 と同型の「動いているように見えて無保護」)。
		//
		// HOST_BACKUP_DIR は host 側の compose 変数でコンテナからは見えないため、
		// `:+` 展開で「設定されていれば true」を導出して渡す。この導出形が SSOT。
		// 期待値は compose の変数展開構文そのもの (JS の template literal ではない)。
		const expected = `$` + '{HOST_BACKUP_DIR:+true}';
		expect(environmentLinesOf('app')).toContain(`BACKUP_OFFSITE_EXPECTED=${expected}`);
	});

	it('[CV3] 未設定時の既定は従来どおり ./data/backups', () => {
		// 既存の NUC は HOST_BACKUP_DIR を持たない。既定が変わると無設定のまま
		// 既存世代が見えなくなる (host 側のパスが変わる)。
		// 期待値は compose の変数展開構文そのもの (JS の template literal ではない)。
		// lint/suspicious/noTemplateCurlyInString の誤検出を避けるため文字連結で組み立てる。
		const expected = `$` + '{HOST_BACKUP_DIR:-./data/backups}';
		expect(hostMountFor('app', '/app/backups')).toBe(expected);
	});

	// [CV5] **`BACKUP_DIR` env の指す先が mount した container path と一致している** (#4152 統合監査)
	//
	// CV1-CV4 は volumes 行だけを見ており、environment を一切読んでいない
	// (`hostMountFor` / `volumeLinesOf` とも volumes ブロックしか解析しない)。
	// しかし **実際にどこへ書くかを決めるのは `BACKUP_DIR` env** であり
	// (app 側 = `pglite-backup-service.resolveBackupDir`、backup 側 = `backup-nuc.cjs`)、
	// mount 先 (`/app/backups`) と食い違っていても CV1-CV4 は全件 green のままになる。
	//
	// 食い違ったときの実害は「バックアップは取れているのに mount 外 (container 内の
	// 一時領域) に書かれ、container 再作成で全損する」= #3950 と同型の「取れているつもり」。
	// #4149 (保存先の差し替え可能化) と #4144 / #4148 (BACKUP_DIR を読む側) が別 PR で
	// 入ったため、両者の整合はどこにも固定されていなかった。
	it('[CV5] app / backup の BACKUP_DIR env が mount した container path を指す', () => {
		for (const service of ['app', 'backup']) {
			// mount 側 (CV1 と同じ container path) が 1 本だけ存在すること。
			const mounted = volumeLinesOf(service).filter((v) => v.endsWith(':/app/backups'));
			expect(mounted, `service '${service}' の /app/backups mount`).toHaveLength(1);

			// 書き込み先を決める env が、その mount 先と一致すること。
			// 相対指定 (`./backups` 等) は cwd 依存で mount 外へ逃げうるため許容しない。
			const backupDir = environmentLinesOf(service)
				.map((l) => l.split('='))
				.find(([k]) => k === 'BACKUP_DIR')?.[1];
			expect(backupDir, `service '${service}' に BACKUP_DIR が無い`).toBeDefined();
			expect(
				backupDir,
				`service '${service}' の BACKUP_DIR=${backupDir} が mount 先 /app/backups と一致しない`,
			).toBe('/app/backups');
		}
	});
});

// ---------------------------------------------------------------------------
// #4207 — TZ が「設定されている」ことと「効いている」ことは別
// ---------------------------------------------------------------------------
//
// 本番 NUC の日次バックアップは `0 3 * * *` (深夜 3 時のつもり) で登録されているのに、
// 実際には **12:00 JST (= 03:00 UTC)** に走っていた。家庭向けアプリの本番 DB を
// 利用者が起きている真昼にコピーしている状態だった。
//
// 原因は tzdata の欠落。`node:22-alpine` は tzdata を同梱しないため、
// `TZ=Asia/Tokyo` を env で渡しても libc がゾーンを解決できず UTC のままになる。
// busybox crond はその UTC で `0 3 * * *` を解釈する。
//
//   $ docker exec ganbari-quest-backup-1 printenv TZ   → Asia/Tokyo   (設定はされている)
//   $ docker exec ganbari-quest-backup-1 date          → ... UTC ...  (効いていない)
//
// **`printenv TZ` は正しい値を返すので「確認したつもり」になれる**のがこの欠陥の質。
// しかもバックアップ自体は成功する (ファイルは毎日でき consecutiveFailures: 0) ため、
// health も alert も何も言わない。#3950 の「取れているつもり」と同型で、
// 本日 4 件踏んだ「経路はあるが届かない」(#4119 / #4174 / #4189 / #4205) と同じ形。
//
//   [TZ1] TZ を宣言する service の Dockerfile が tzdata を install している
//   [TZ2] cron 式のコメント / 起動ログが実挙動と一致している (「3:00 AM JST」が嘘でない)
describe('#4207 TZ を宣言したなら、その TZ が実際に効くこと', () => {
	/** compose の `build:` から、その service がどの Dockerfile で焼かれるかを解決する。 */
	function dockerfileOf(service: string): string {
		const raw = readFileSync(COMPOSE_PATH, 'utf-8');
		const lines = raw.split('\n');
		const serviceIdx = lines.findIndex((l) => l.trimEnd() === `  ${service}:`);
		if (serviceIdx < 0) throw new Error(`service '${service}' が docker-compose.yml にありません`);

		const nextIdx = lines.findIndex((l, i) => i > serviceIdx && /^ {2}[a-z][a-z0-9_-]*:\s*$/.test(l));
		const block = lines.slice(serviceIdx, nextIdx < 0 ? lines.length : nextIdx);

		// `dockerfile: X` の明示があればそれ。無ければ既定の Dockerfile。
		const explicit = block.find((l) => /^\s+dockerfile:\s*\S+/.test(l));
		return explicit ? explicit.split(':')[1].trim() : 'Dockerfile';
	}

	/** TZ env を宣言している service を compose から列挙する (母数を literal 固定しない)。 */
	function servicesDeclaringTz(): string[] {
		const raw = readFileSync(COMPOSE_PATH, 'utf-8');
		const lines = raw.split('\n');
		return lines
			.map((l, i) => (/^ {2}[a-z][a-z0-9_-]*:\s*$/.test(l) ? { name: l.trim().slice(0, -1), i } : null))
			.filter((s): s is { name: string; i: number } => s !== null)
			.filter(({ name }) => environmentLinesOf(name).some((e) => e.startsWith('TZ=')));
	}

	const tzServices = servicesDeclaringTz();

	it('[TZ0] 母数: TZ を宣言する service が 1 つ以上ある', () => {
		// 0 件なら「全部通った」ではなく「1 つも検査していない」。
		expect(tzServices.length).toBeGreaterThan(0);
	});

	it('[TZ1] TZ を宣言する service の Dockerfile が tzdata を install している', () => {
		const missing: string[] = [];

		for (const { name } of tzServices) {
			const dockerfile = dockerfileOf(name);
			const content = readFileSync(join(process.cwd(), dockerfile), 'utf-8');
			// alpine 以外 (debian 系) は tzdata 同梱なので、alpine を使う場合だけ要求する。
			const usesAlpine = /^FROM\s+\S*alpine/m.test(content);
			if (!usesAlpine) continue;
			if (!/apk\s+add[^\n]*\btzdata\b/.test(content)) {
				missing.push(`${name} (${dockerfile})`);
			}
		}

		expect(
			missing,
			`TZ を env で渡しているが tzdata が無いため TZ が解決されない service: ${missing.join(' / ')}。` +
				'alpine は tzdata を同梱しないので `RUN apk add --no-cache tzdata` が要る。' +
				'これが無いと printenv TZ は正しい値を返すのに date は UTC を返す (#4207)。',
		).toEqual([]);
	});

	it('[TZ2] backup の cron 式と、コメント / 起動ログの時刻表記が一致している', () => {
		const raw = readFileSync(COMPOSE_PATH, 'utf-8');

		// crontab に登録している時刻を実体から取る。
		const cronLine = raw.split('\n').find((l) => l.includes('crontab -'));
		expect(cronLine, 'backup の crontab 登録行が見つからない').toBeDefined();
		const hour = cronLine?.match(/echo\s+"(\d+)\s+(\d+)\s+\*\s+\*\s+\*/)?.[2];
		expect(hour, `cron 式から時が読めない: ${cronLine}`).toBeDefined();

		// その時刻を JST として説明している文言が、cron 式の時と一致すること。
		// 「3:00 AM JST」と書いてあるのに `0 12 * * *` を登録している、の逆パターンも捕まえる。
		const claims = raw.split('\n').filter((l) => /(\d+):00 AM JST|daily .*JST/.test(l));
		expect(claims.length, 'cron の時刻を JST で説明している行が無い').toBeGreaterThan(0);
		for (const claim of claims) {
			const claimed = claim.match(/(\d+):00 AM JST/)?.[1];
			if (!claimed) continue;
			expect(
				Number(claimed),
				`「${claim.trim()}」が cron 式 (${hour} 時) と一致しない。文言か cron 式のどちらかが嘘になっている`,
			).toBe(Number(hour));
		}
	});
});
