// src/lib/server/db/pglite/backup.ts
// #3950 — NUC PGlite 本番データの日次バックアップ (取得 → 検証 → ローテーション)。
//
// ── なぜアプリプロセス内で採るのか ─────────────────────────────────────────
// PGlite は dataDir を **単一プロセスで占有**する (connection.ts が `new PGlite(PGLITE_DATA_DIR)` を
// singleton 保持)。そのため外部プロセスから採れるのは「稼働中ディレクトリの tar」= 取得中に書き換えが
// 走り得る crash-consistent 相当のコピーだけで、復元できる保証がない。整合したスナップショットを
// ダウンタイムなしで得る唯一の経路が、DB を掴んでいる当プロセスから叩く公式 API `dumpDataDir()`。
// よって backup は「app プロセス内で実行し、外からは cron エンドポイントで起動する」形を採る。
//
// ── 「取れている」と「復旧できる」は別物 (監査指摘 / #3946 の教訓) ──────────
// 取得しただけの tarball は復元可能性ゼロ検証。本モジュールは **取得物を実際に別 PGlite へ復元して
// 検証が通ったものだけをバックアップとして確定**する (verify-then-commit)。検証は 3 段:
//   V1. 復元した DB の public テーブル全件に `select count(*)` が通る (物理的に読めること)
//   V2. `drizzle.__drizzle_migrations` が存在し 1 行以上ある (schema 適用済みであること)
//   V3. journal (`drizzle/pglite/meta/_journal.json`) の全 entry が「適用済み最大 created_at」以下
//       = **復元後に永久 skip される migration が無い** こと (#3951 監査 residual [security/sev2])。
//       #3946 はまさに「journal と適用実績の関係」の破れで起きたため、restore 経路で毎日突合する。
//
// ── ローテーションは成功後にのみ行う ────────────────────────────────────────
// 取得や検証が落ちた回に古い世代を消すと、失敗が続くほど手持ちが減る。削除は確定後だけ。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/** バックアップファイル名の prefix。既存 SQLite backup (`ganbari-quest-*.db`) と同居しても区別できる。 */
export const PGLITE_BACKUP_PREFIX = 'pglite-';
/** バックアップファイルの拡張子 (dumpDataDir('gzip') の出力は gzip 圧縮 tar)。 */
export const PGLITE_BACKUP_EXT = '.tgz';
/**
 * 「日次バックアップの世代」として数えてよいファイル名の厳密形 (`pglite-<YYYYMMDD>T<HHMMSS>Z.tgz`)。
 *
 * ⚠️ prefix + 拡張子の緩い一致で世代を数えてはいけない。同じ BACKUP_DIR には運用中に採る
 * **手動の暫定スナップショット** (実例: #3950 一次証跡の `pglite-snapshot-20260726-0738-pre-pr3947.tgz`)
 * が同居し得る。これは prefix / 拡張子とも一致するうえ、辞書順で `'s'` > 数字のため
 * `.sort().reverse()` で常に「最新世代」の位置に固定され、恒久的に 1 スロットを占有して
 * 実保持を 3 → 2 世代に減らす (QA レビュー #3956 指摘)。世代判定は本パターンの完全一致で行う。
 */
export const PGLITE_BACKUP_FILENAME_PATTERN = /^pglite-\d{8}T\d{6}Z\.tgz$/;
/** オーナー決裁 (2026-07-26): 日次取得・3 世代保持。 */
export const DEFAULT_BACKUP_RETENTION = 3;

/** 復元検証の結果。どの段で落ちたかを呼び出し側 (アラート) が識別できるようにする。 */
export interface PgliteBackupVerification {
	/** V1: 復元 DB で count(*) が通った public テーブル数。 */
	tablesVerified: number;
	/** V2: `drizzle.__drizzle_migrations` の行数。 */
	migrationsApplied: number;
	/** V3: 復元 DB の適用済み最大 created_at。 */
	maxAppliedCreatedAt: number;
	/** V3: journal entry 数 (突合対象)。 */
	journalEntries: number;
}

/** 1 回のバックアップ実行結果。 */
export interface PgliteBackupResult {
	/** 確定したバックアップファイル名 (backupDir 相対)。 */
	filename: string;
	/** 取得物のバイト数 (圧縮後)。 */
	bytes: number;
	/** 復元検証の内訳。 */
	verification: PgliteBackupVerification;
	/** ローテーションで削除したファイル名。 */
	rotated: string[];
	/** 保持世代数 (削除後に残っている世代数)。 */
	generationsKept: number;
	/** 取得開始から確定までの所要時間 (ms)。RTO/RPO の実測値として記録する。 */
	durationMs: number;
}

/** 検証段で落ちたことを呼び出し側が識別するためのエラー。 */
export class PgliteBackupVerificationError extends Error {
	constructor(
		readonly stage: 'V1-table-read' | 'V2-migrations-table' | 'V3-journal-reconcile',
		message: string,
	) {
		super(`[${stage}] ${message}`);
		this.name = 'PgliteBackupVerificationError';
	}
}

interface JournalEntry {
	idx: number;
	when: number;
	tag: string;
}

/**
 * バックアップ tarball を **別インスタンスへ実際に復元**し、V1-V3 を検証する。
 *
 * 検証に落ちたら例外を投げる = そのバックアップは確定させない。`loadDataDir` は渡した Blob を
 * 消費し得るため、呼び出し側は保持している Buffer から毎回新しい Blob を作って渡すこと。
 */
export async function verifyPgliteDump(
	dump: Blob,
	journalEntries: JournalEntry[],
): Promise<PgliteBackupVerification> {
	// dataDir を指定しない = in-memory。復元検証が本番ディレクトリへ書き戻すことは無い。
	const restored = new PGlite({ loadDataDir: dump });
	try {
		await restored.waitReady;

		// V1: 物理的に読めること。テーブル名は復元 DB 自身の catalog から採るので、
		//     schema が増減しても検証範囲が自動で追従する (ハードコード一覧の陳腐化を作らない)。
		const tables = await restored.query<{ tablename: string }>(
			"select tablename from pg_tables where schemaname = 'public' order by tablename",
		);
		if (tables.rows.length === 0) {
			throw new PgliteBackupVerificationError(
				'V1-table-read',
				'復元した DB に public テーブルが 1 つも存在しません (空ダンプの疑い)',
			);
		}
		for (const { tablename } of tables.rows) {
			// tablename は復元 DB の catalog 由来だが、識別子は parameterize できないため形状を明示 assert する
			// (connection.ts の dbName 検証と同じ防御。unsafe pattern の横展開防止)。
			if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tablename)) {
				throw new PgliteBackupVerificationError(
					'V1-table-read',
					`不正なテーブル識別子: ${tablename}`,
				);
			}
			await restored.query(`select count(*) from "${tablename}"`);
		}

		// V2: schema が適用済みであること。
		const migrations = await restored.query<{ created_at: string }>(
			'select created_at from drizzle.__drizzle_migrations order by created_at desc',
		);
		const newestMigration = migrations.rows[0];
		if (!newestMigration) {
			throw new PgliteBackupVerificationError(
				'V2-migrations-table',
				'drizzle.__drizzle_migrations が空です (migration 未適用の DB を復元した疑い)',
			);
		}
		const maxAppliedCreatedAt = Number(newestMigration.created_at);

		// V3: journal ↔ 適用実績の突合。migrator は「適用済み最大 created_at」1 行だけを見て
		//     `created_at < entry.when` の entry を適用するため、**when がこの最大値以下の entry は
		//     永久に適用されない**。#3946 はこの関係が破れて発生した本番 500 そのもの。
		const notApplied = journalEntries.filter((e) => e.when > maxAppliedCreatedAt);
		if (notApplied.length > 0) {
			throw new PgliteBackupVerificationError(
				'V3-journal-reconcile',
				`復元 DB の適用済み最大 created_at (${maxAppliedCreatedAt}) より大きい when を持つ ` +
					`journal entry が ${notApplied.length} 件あります ` +
					`(${notApplied.map((e) => `${e.tag}:${e.when}`).join(', ')})。` +
					'→ これらは「未適用」として次回 boot 時に適用されます。意図した新規 migration なら ' +
					'アプリを再起動して適用を完了させてください。意図していないなら journal の when が ' +
					'書き換えられた疑いがあります (#3946 同型)。',
			);
		}

		return {
			tablesVerified: tables.rows.length,
			migrationsApplied: migrations.rows.length,
			maxAppliedCreatedAt,
			journalEntries: journalEntries.length,
		};
	} finally {
		await restored.close();
	}
}

/** `drizzle/pglite/meta/_journal.json` を読む。 */
export async function loadJournalEntries(migrationsDir: string): Promise<JournalEntry[]> {
	const raw = await readFile(join(migrationsDir, 'meta', '_journal.json'), 'utf-8');
	const parsed = JSON.parse(raw) as { entries?: JournalEntry[] };
	if (!parsed.entries || parsed.entries.length === 0) {
		throw new Error(`[pglite/backup] journal に entry がありません: ${migrationsDir}`);
	}
	return parsed.entries;
}

/** `pglite-20260726T034500.tgz` 形式のファイル名を作る (UTC、辞書順 = 時系列順)。 */
export function backupFilename(now: Date): string {
	const ts = now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z');
	const filename = `${PGLITE_BACKUP_PREFIX}${ts}${PGLITE_BACKUP_EXT}`;
	// 命名を変えたのに世代判定パターンを追従し忘れると、生成物がローテーション対象から外れ
	// 世代が無限に増える (or 新世代が「世代 0 件」に見える) 形で silent に壊れる。生成側で固定する。
	if (!PGLITE_BACKUP_FILENAME_PATTERN.test(filename)) {
		throw new Error(
			`[pglite/backup] 生成したファイル名が世代判定パターンに一致しません: ${filename}`,
		);
	}
	return filename;
}

/**
 * バックアップディレクトリ内の **日次バックアップ世代のみ**を新しい順に返す。
 *
 * `PGLITE_BACKUP_FILENAME_PATTERN` の完全一致で絞る = 命名規則に従わないファイル
 * (手動スナップショット / `.tmp` 残骸 / 状態ファイル) はローテーション対象にも世代数にも含めない。
 */
export function sortBackupsNewestFirst(filenames: string[]): string[] {
	return filenames
		.filter((f) => PGLITE_BACKUP_FILENAME_PATTERN.test(f))
		.sort()
		.reverse();
}
