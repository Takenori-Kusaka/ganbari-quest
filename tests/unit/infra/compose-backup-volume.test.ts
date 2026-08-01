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
});
