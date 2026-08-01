// src/lib/server/services/pglite-backup-service.ts
// #3950 — PGlite バックアップの実行サービス (取得 → 検証 → 確定 → ローテーション → 状態記録)。
//
// 純粋な検証・命名ロジックは $lib/server/db/pglite/backup.ts、FS と PGlite client を伴う
// オーケストレーションは本ファイル、HTTP 面は /api/cron/pglite-backup に分ける。

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import {
	describeOffsiteVerdict,
	judgeOffsiteReplication,
	OFFSITE_MARKER_FILENAME,
	type OffsiteVerdict,
	shouldNotifyOffsite,
} from '$lib/domain/backup-offsite';
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
	/**
	 * 連続失敗回数 (#4129 AC4)。成功で 0 に戻る。
	 *
	 * 失敗のたびに alert を 1 通投げるだけだと、**毎晩同じ alert が流れて埋もれる**。
	 * 2026-07-31 の実害では `CRON_SECRET` 未配布で毎晩失敗していたが 18 日間誰も気づかなかった
	 * (そのときは webhook も未配布で alert 自体が 0 通だった、#4119)。回数を持てば
	 * 「今日も失敗した」ではなく「**N 晩続けて失敗している**」を出せる。
	 */
	consecutiveFailures: number;
	/**
	 * 前回の off-site 判定 (#3970 AC2)。同じ警告を毎晩投げないための dedup 用。
	 *
	 * 同じ警告が毎晩届くと数日で無視され、**同じ通知先を共有している本物の失敗 alert
	 * まで一緒に見られなくなる**。状態が変わったときだけ通知する。
	 */
	lastOffsiteLevel: OffsiteVerdict['level'] | null;
	/**
	 * ローテーション guard (#4129 AC2) が止めている世代数 (#4162)。止まっていなければ 0。
	 *
	 * **取得の成否とは独立した事実**。guard 発火時は新世代の確定に成功していて
	 * 削除だけが止まっているため、これを failure に潰すと判定が「job が動いていない」へ
	 * 倒れて診断が真逆になる。欠損時は 0 扱い (旧 status file との後方互換)。
	 */
	rotationPendingCount: number;
	/** ローテーションが止まり始めた時刻 (ISO 8601)。止まっていなければ null。 */
	rotationBlockedSince: string | null;
}

/**
 * 破壊的ローテーション (一度に複数世代を消す) を検出して止めたことを表すエラー (#4129 AC2)。
 *
 * 通常運用では 1 回の実行で溢れる世代は高々 1 件しかない。複数件溢れるのは
 * **`BACKUP_RETENTION` が引き下げられた直後の初回実行**か、世代名のファイルが外から
 * 増やされたときだけであり、いずれも「気づかないうちに手持ちが一括で消える」形になる。
 * 削除は不可逆なので、消す前に止めて人間に退避させる (fail-closed)。
 */
export class PgliteBackupRotationGuardError extends Error {
	constructor(
		readonly wouldDelete: string[],
		readonly retention: number,
		message: string,
	) {
		super(message);
		this.name = 'PgliteBackupRotationGuardError';
	}
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

/**
 * #3970 AC2 — 退避先が実際に見えているかを実 FS から確認する。
 *
 * 判定そのものは `$lib/domain/backup-offsite.ts` (純粋関数) が持つ。ここは
 * **事実の採取だけ**を行う。読めないケースを `'unreadable'` として渡し、判定側で
 * 「問題なし」に丸めずに unknown として扱わせる。
 */
async function probeOffsiteReplication(backupDir: string): Promise<OffsiteVerdict> {
	const env = getEnv();
	// off-site を期待しているか。
	//
	// `HOST_BACKUP_DIR` は **host 側の compose 変数でコンテナからは見えない** (compose が
	// bind mount 先を決めるのに使うだけで、コンテナ内は常に BACKUP_DIR=/app/backups)。
	// そのため compose 側で `BACKUP_OFFSITE_EXPECTED=${HOST_BACKUP_DIR:+true}` と導出して
	// 渡す。運用者が新しく設定する項目は増えない (HOST_BACKUP_DIR を置いた時点で立つ)。
	//
	// 空文字 / 未設定はいずれも「期待していない」= 検査しない。`=== 'true'` の厳密比較なので
	// `${HOST_BACKUP_DIR:+true}` が空に展開されたケースも自動的にここへ落ちる。
	const expected = env.BACKUP_OFFSITE_EXPECTED === 'true';
	if (!expected) return judgeOffsiteReplication({ expected, marker: null });

	// 目印が読めるか。存在しない (ENOENT) と 読めない (権限 / I/O) を区別する —
	// 前者は「マウントされていない」、後者は「判定不能」で、運用者の取るべき行動が違う。
	let marker: string | null | 'unreadable';
	try {
		marker = await readFile(join(backupDir, OFFSITE_MARKER_FILENAME), 'utf-8');
	} catch (e) {
		marker = (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? null : 'unreadable';
	}

	return judgeOffsiteReplication({ expected, marker });
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
		consecutiveFailures: 0,
		lastOffsiteLevel: null,
		rotationPendingCount: 0,
		rotationBlockedSince: null,
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

		// #4129 AC2: **一度に 2 世代以上消す実行は止める (fail-closed)**。
		// 定常運用では、新しい 1 世代が入って古い 1 世代が溢れるだけなので rotated は高々 1 件。
		// 2 件以上溢れるのは retention 引き下げ直後の初回実行 (#3950 の 7 → 3) か、世代名の
		// ファイルが外から増えたときで、どちらも「気づかないうちに手持ちが一括で消える」形になる。
		// 取得した新世代はここまでで確定済みなので、**バックアップは失われず削除だけが止まる**。
		// 逃げ道 (bypass env) は用意しない — 退避してから手で古い世代を削れば、次回以降は
		// rotated が 1 件に戻って自然に解除される。env で黙って通せる穴を作らない。
		// #4162: guard は **throw する前に「取得は成功した」を状態ファイルへ確定させる**。
		// 新世代は上の rename で既に確定しており、コード自身がそれを知っている
		// (guard の文言も「今回取得した新しいバックアップは確定済み」と書いている)。
		// にもかかわらず throw だけすると catch が lastSuccessAt を進めないまま
		// consecutiveFailures を積み、判定が stale-critical (= 「job が動いていない」) に倒れる。
		// **実際は毎晩正常に取れており、必要な行動は「古い世代を退避して手で削除」**なので
		// 診断が真逆になる。取得の成功とローテーションの保留を別々の事実として残す。
		if (rotated.length > 1) {
			const previousForGuard = await readStatus(backupDir);
			await writeStatus(backupDir, {
				...previousForGuard,
				lastSuccessAt: new Date().toISOString(),
				lastSuccessFilename: filename,
				lastSuccessBytes: bytes.byteLength,
				lastSuccessDurationMs: Date.now() - startedAt,
				// 取得は成功しているので連続失敗は 0 に戻す。guard の発火は「失敗」ではない。
				consecutiveFailures: 0,
				rotationPendingCount: rotated.length,
				rotationBlockedSince: previousForGuard.rotationBlockedSince ?? new Date().toISOString(),
			}).catch(() => {
				// 状態を書けなくても guard 自体は止める (削除を通してしまう方が重い)。
			});
			throw new PgliteBackupRotationGuardError(
				rotated,
				retention,
				`[pglite-backup] 一度に ${rotated.length} 世代を削除しようとしたため中断しました ` +
					`(BACKUP_RETENTION=${retention})。削除は不可逆です。` +
					`対象: ${rotated.join(', ')}。` +
					'BACKUP_RETENTION を引き下げた直後の初回実行が原因である可能性が高いです。' +
					'消えて困る世代を退避したうえで、古い世代を手で削除してください ' +
					'(次回以降は溢れが 1 世代に戻り自動で解除されます)。' +
					`なお今回取得した新しいバックアップは確定済みで失われていません。`,
			);
		}

		for (const stale of rotated) {
			await rm(join(backupDir, stale), { force: true });
		}

		const durationMs = Date.now() - startedAt;
		const previous = await readStatus(backupDir);

		// #3970 AC2: **取得の成否とは別に**、控えが実際に退避先へ届いたかを確認する。
		// 取得が成功していても、マウントが外れていれば控えは筐体内にしか無い
		// (Docker が bind 先にローカルの空ディレクトリを作るため書き込みは成功する)。
		// ここで throw しないのは、取得は本当に成功しており、失敗として扱うと
		// 「取れている控えを無いものとして扱う」誤解を生むため。呼び出し側が alert する。
		const offsite = await probeOffsiteReplication(backupDir);
		const offsiteMessage = describeOffsiteVerdict(offsite);
		// 前回と同じ判定なら通知しない (毎晩同じ警告を投げて mute させない)。
		// 判定自体は毎回行い、通知するかどうかだけを絞る。
		const notifyOffsite = shouldNotifyOffsite(offsite, previous.lastOffsiteLevel ?? null);
		if (offsiteMessage) {
			logger.error('[pglite-backup] offsite check failed', {
				service: 'pglite-backup',
				context: { level: offsite.level, notify: notifyOffsite, message: offsiteMessage },
			});
		}

		await writeStatus(backupDir, {
			...previous,
			lastSuccessAt: new Date().toISOString(),
			lastSuccessFilename: filename,
			lastSuccessBytes: bytes.byteLength,
			lastSuccessDurationMs: durationMs,
			consecutiveFailures: 0,
			lastOffsiteLevel: offsite.level,
			// ここまで来た = ローテーションが通った。保留を解除する (#4162)。
			// 解除を書き忘れると「退避して削除したのに warn が消えない」状態が残り、
			// 表示が現実から乖離したまま固定される。
			rotationPendingCount: 0,
			rotationBlockedSince: null,
		});

		const result: PgliteBackupResult = {
			filename,
			bytes: bytes.byteLength,
			verification,
			rotated,
			generationsKept: existing.length - rotated.length,
			durationMs,
			offsite,
			// 通知しない (= 前回と同じ判定) ときは message を載せない。載せると
			// 呼び出し側が毎晩 alert してしまい dedup が効かない。
			offsiteMessage: notifyOffsite ? offsiteMessage : null,
		};
		logger.info('[pglite-backup] completed', {
			service: 'pglite-backup',
			context: { ...result, rotated: rotated.length },
		});
		return result;
	} catch (e) {
		// #4162: guard の発火は **失敗ではない**。取得は成功しており、削除だけを意図的に
		// 止めた状態で、その事実は throw の直前に状態ファイルへ書いてある。ここで
		// consecutiveFailures を積むと判定層が「落ち続けている」と読み、診断が真逆になる。
		// 状態はもう記録済みなので、そのまま呼び出し側へ投げるだけにする。
		if (e instanceof PgliteBackupRotationGuardError) {
			logger.warn('[pglite-backup] rotation blocked (取得は成功)', {
				service: 'pglite-backup',
				context: { wouldDelete: e.wouldDelete.length, retention: e.retention },
			});
			throw e;
		}

		const message = e instanceof Error ? e.message : String(e);
		const previous = await readStatus(backupDir);
		await writeStatus(backupDir, {
			...previous,
			lastFailureAt: new Date().toISOString(),
			lastFailureMessage: message,
			consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
		}).catch(() => {
			// 状態ファイルすら書けない場合でも、元の失敗を握り潰さずそのまま投げる。
		});
		logger.error('[pglite-backup] failed', { service: 'pglite-backup', error: message });
		throw e;
	}
}
