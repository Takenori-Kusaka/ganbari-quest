// src/lib/server/services/pglite-backup-service.ts
// #3950 — PGlite バックアップの実行サービス (取得 → 検証 → 確定 → ローテーション → 状態記録)。
//
// 純粋な検証・命名ロジックは $lib/server/db/pglite/backup.ts、FS と PGlite client を伴う
// オーケストレーションは本ファイル、HTTP 面は /api/cron/pglite-backup に分ける。

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { getEnv } from '$lib/runtime/env';
import {
	backupFilename,
	DEFAULT_BACKUP_RETENTION,
	loadJournalEntries,
	type PgliteBackupResult,
	sortBackupsNewestFirst,
	verifyPgliteDump,
} from '$lib/server/db/pglite/backup';
import { getPgliteClient } from '$lib/server/db/pglite/connection';
import { logger } from '$lib/server/logger';

/**
 * 最終成功/最終失敗を残すファイル名。fail が沈黙しないための可視化点 (#3950 AC)。
 *
 * 世代判定は `PGLITE_BACKUP_FILENAME_PATTERN` の完全一致で行うため本ファイルは世代に数えられないが、
 * 命名を `pglite-<YYYYMMDD>T<HHMMSS>Z.tgz` 形に寄せないこと (意図しない結合を作らない)。
 */
export const BACKUP_STATUS_FILENAME = 'backup-status-pglite.json';

export interface PgliteBackupStatus {
	lastSuccessAt: string | null;
	lastSuccessFilename: string | null;
	lastSuccessBytes: number | null;
	lastSuccessDurationMs: number | null;
	lastFailureAt: string | null;
	lastFailureMessage: string | null;
}

export interface RunPgliteBackupOptions {
	/** PGlite client。省略時は稼働中 singleton (本番経路)。テストは自前の client を渡す。 */
	client?: PGlite;
	/** 取得先ディレクトリ。省略時は BACKUP_DIR (既定 ./data/backups)。 */
	backupDir?: string;
	/** 保持世代数。省略時は BACKUP_RETENTION (既定 3 = オーナー決裁)。 */
	retention?: number;
	/** journal の解決先。省略時は PGLITE_MIGRATIONS_DIR (既定 ./drizzle/pglite)。 */
	migrationsDir?: string;
	/** ファイル名に使う時刻。テストで固定するための注入点。 */
	now?: Date;
}

function resolveBackupDir(explicit?: string): string {
	const env = getEnv();
	return resolve(explicit ?? env.BACKUP_DIR ?? join(process.cwd(), 'data', 'backups'));
}

function resolveMigrationsDir(explicit?: string): string {
	const env = getEnv();
	return resolve(explicit ?? env.PGLITE_MIGRATIONS_DIR ?? join(process.cwd(), 'drizzle', 'pglite'));
}

function resolveRetention(explicit?: number): number {
	const env = getEnv();
	return explicit ?? env.BACKUP_RETENTION ?? DEFAULT_BACKUP_RETENTION;
}

/** 現在の状態ファイルを読む (無ければ全 null)。 */
async function readStatus(backupDir: string): Promise<PgliteBackupStatus> {
	const empty: PgliteBackupStatus = {
		lastSuccessAt: null,
		lastSuccessFilename: null,
		lastSuccessBytes: null,
		lastSuccessDurationMs: null,
		lastFailureAt: null,
		lastFailureMessage: null,
	};
	try {
		const raw = await readFile(join(backupDir, BACKUP_STATUS_FILENAME), 'utf-8');
		return { ...empty, ...(JSON.parse(raw) as Partial<PgliteBackupStatus>) };
	} catch {
		// 初回実行では状態ファイルが無いのが正常。読めないこと自体は失敗にしない。
		return empty;
	}
}

async function writeStatus(backupDir: string, status: PgliteBackupStatus): Promise<void> {
	await writeFile(join(backupDir, BACKUP_STATUS_FILENAME), `${JSON.stringify(status, null, 2)}\n`);
}

/** 最終成功時刻などを外部 (運用調査 / 監視) から読むための口。 */
export async function getPgliteBackupStatus(backupDir?: string): Promise<PgliteBackupStatus> {
	return readStatus(resolveBackupDir(backupDir));
}

/**
 * バックアップを 1 回実行する。
 *
 * 取得 → **復元検証** → 確定 (atomic rename) → ローテーション、の順。検証に落ちた場合は
 * ファイルを確定させず、状態ファイルへ失敗を記録した上で例外を投げる (silent fail させない)。
 * ローテーションは確定後にのみ行う — 失敗し続ける状況で手持ちの世代を削らないため。
 */
export async function runPgliteBackup(
	options: RunPgliteBackupOptions = {},
): Promise<PgliteBackupResult> {
	const startedAt = Date.now();
	const backupDir = resolveBackupDir(options.backupDir);
	const migrationsDir = resolveMigrationsDir(options.migrationsDir);
	const retention = resolveRetention(options.retention);
	const now = options.now ?? new Date();

	await mkdir(backupDir, { recursive: true });

	try {
		const client = options.client ?? (await getPgliteClient());
		const journalEntries = await loadJournalEntries(migrationsDir);

		// 取得: プロセス内で一貫性を取った tarball を得る (ダウンタイム 0)。
		const dumped = await client.dumpDataDir('gzip');
		const bytes = Buffer.from(await dumped.arrayBuffer());

		// 検証: 取得物を別インスタンスへ実際に復元して読めることを確認する。
		// loadDataDir は渡した Blob を消費し得るため、保持している Buffer から新しい Blob を作る。
		const verification = await verifyPgliteDump(new Blob([bytes]), journalEntries);

		// 確定: tmp へ書いてから rename する (取得中に落ちた半端なファイルを世代として残さない)。
		const filename = backupFilename(now);
		const finalPath = join(backupDir, filename);
		const tmpPath = `${finalPath}.tmp`;
		await writeFile(tmpPath, bytes);
		await rename(tmpPath, finalPath);

		// ローテーション: 確定後にのみ削除する。
		const existing = sortBackupsNewestFirst(await readdir(backupDir));
		const rotated = existing.slice(retention);
		for (const stale of rotated) {
			await rm(join(backupDir, stale), { force: true });
		}

		const durationMs = Date.now() - startedAt;
		const previous = await readStatus(backupDir);
		await writeStatus(backupDir, {
			...previous,
			lastSuccessAt: new Date().toISOString(),
			lastSuccessFilename: filename,
			lastSuccessBytes: bytes.byteLength,
			lastSuccessDurationMs: durationMs,
		});

		const result: PgliteBackupResult = {
			filename,
			bytes: bytes.byteLength,
			verification,
			rotated,
			generationsKept: existing.length - rotated.length,
			durationMs,
		};
		logger.info('[pglite-backup] completed', {
			service: 'pglite-backup',
			context: { ...result, rotated: rotated.length },
		});
		return result;
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		const previous = await readStatus(backupDir);
		await writeStatus(backupDir, {
			...previous,
			lastFailureAt: new Date().toISOString(),
			lastFailureMessage: message,
		}).catch(() => {
			// 状態ファイルすら書けない場合でも、元の失敗を握り潰さずそのまま投げる。
		});
		logger.error('[pglite-backup] failed', { service: 'pglite-backup', error: message });
		throw e;
	}
}
