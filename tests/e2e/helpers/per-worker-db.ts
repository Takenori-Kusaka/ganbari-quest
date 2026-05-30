// tests/e2e/helpers/per-worker-db.ts
//
// cspell:words Mainmatter
//
// #2648 Phase A Step A-3 + CI fix + Round 12 Option γ-extended: per-worker SQLite file isolation helper。
//
// 設計根拠 (deep research `a70be0e3278d98fd2` §7.3 + 試行錯誤ログ §3 Step A-3 + CI 再 fix
// + Round 11 deep research `tmp/research-round11-fix-path-product-fit-2026-05-30.md`):
//
// 1. **template DB → worker DB の複製は `db.backup()` 経由必須** (better-sqlite3 v12.9.0+):
//    - `fs.copyFile()` 経由は WAL / shm 整合性が壊れる既知問題
//      (https://scottspence.com/posts/sqlite-corruption-fs-copyfile-issue)
//    - `db.backup()` は SQLite online backup API を呼ぶため open writer trans 中でも
//      consistent snapshot を作成可能
//
// 2. **`globalSetup` で template (data/ganbari-quest.db) を作った後、worker 数分 backup する**:
//    - playwright `globalSetup` は test session 全体で 1 回実行 = worker index を取得不能
//    - そのため Step A-4 で global-setup.ts 末尾に `for (i of [0..WORKER_COUNT-1]) ensureWorkerDb(i)` を追加
//    - webServer 配列起動時 (Step A-4) で `env: { DATABASE_URL: './data/e2e-worker-${i}.db' }` を渡し
//      各 worker は自分の DB file のみ touch
//
// 3. **Round 12 Option γ-extended (本 fix の中心)**:
//    - 旧 Round 8 fix (`fs.unlinkSync` 撤去 + in-place overwrite) は preview server の
//      schema cache invalidation 問題 (H-1) を解決しなかった (Round 10 debug で実証)
//    - Round 12 で `src/lib/server/db/client.ts` を lazy DB init pattern に rewrite
//      (`new Database()` を module load → 1st HTTP request 時に遅延)
//    - これにより preview server module load 時 (T+0s) に空 DB を open する経路が消え、
//      globalSetup 完了後 (T+5s 以降) の 1st HTTP request で初めて DB open される
//    - 本 helper は引き続き template DB → worker DB の seed 複製を担当
//
// 4. **互換性**:
//    - `process.env.TEST_WORKER_INDEX` を読む既存 fallback pattern と整合
//    - 本 helper は SQLite file 操作のみ責務、Playwright worker fixture 連携は
//      `tests/e2e/fixtures.ts` (Step A-5) に分離

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * template DB のパス (env 未指定時は従来通り `data/ganbari-quest.db`)。
 * global-setup.ts と同じ resolve ロジック (Step A-2 で env 対応済) を使うため
 * `process.env.DATABASE_URL` を考慮しない (template は常に default path 想定)。
 *
 * 注意: 本 helper の呼び出し側 (global-setup 末尾) は `DATABASE_URL` env を
 * 未注入の状態 (`undefined` or default) で template seed 完了後に呼ぶこと。
 */
const TEMPLATE_DB_PATH = path.resolve('data/ganbari-quest.db');

/**
 * worker `parallelIndex` 用の SQLite file path を返す (絶対 path)。
 *
 * **挙動 (Round 12 Option γ-extended)**:
 * 既存 file が存在しても **必ず template から再 backup する** (in-place overwrite)。
 * Round 12 で preview server が lazy DB init になったため、preview server module load
 * 時点では DB を open していない = backup 操作と preview server の DB connection が衝突しない。
 * (旧 Round 8 では preview server が既に open している状態で backup する必要があったが
 *  Round 12 では globalSetup 完了 → 1st HTTP request 時に preview server が初めて
 *  open する順序が保証される)
 *
 * Mainmatter blog pattern: `data/e2e-worker-${parallelIndex}.db` を採用。
 * `.gitignore` の `*.db` で自動 ignore 済 (確認: Step A-0 audit prerequisite #9)。
 *
 * @param parallelIndex Playwright `workerInfo.parallelIndex` (0-based)
 * @returns 絶対 path (e.g. `C:/Users/.../data/e2e-worker-0.db`)
 */
export async function ensureWorkerDb(parallelIndex: number): Promise<string> {
	const workerDbPath = path.resolve(`data/e2e-worker-${parallelIndex}.db`);

	if (!fs.existsSync(TEMPLATE_DB_PATH)) {
		throw new Error(
			`[per-worker-db] template DB not found: ${TEMPLATE_DB_PATH}. ` +
				`global-setup.ts が先に template を seed していること。`,
		);
	}

	// SQLite Online Backup API 経由で WAL/shm 整合 snapshot を作成。
	// better-sqlite3 v7.0.0+ で対応、本 repo は v12.9.0 (prerequisite #7 で確認済)。
	//
	// **in-place overwrite**: workerDbPath が既存でも `db.backup()` が page 単位で
	// 上書きする。Round 12 では preview server がまだ open していないため安全。
	const src = new Database(TEMPLATE_DB_PATH, { readonly: true });
	try {
		await src.backup(workerDbPath);
	} finally {
		src.close();
	}

	// #2648 Round 12 (debug 一時、安定化後 revert 検討): backup 後の row 数を log で観察。
	// preview server log の `[client.ts/lazy] children count after init: N` と
	// 一致するか比較できる。期待: > 0 (template と同等)。
	try {
		const dst = new Database(workerDbPath, { readonly: true });
		try {
			const dstChildCount = dst.prepare('SELECT COUNT(*) AS c FROM children').get() as {
				c: number;
			};
			console.info(`[PerWorkerDB#${parallelIndex}] backup-DB children count=${dstChildCount.c}`);
		} finally {
			dst.close();
		}
	} catch (e) {
		console.info(
			`[PerWorkerDB#${parallelIndex}] verification ERROR: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	return workerDbPath;
}

/**
 * worker `parallelIndex` 用の SQLite WAL/shm 残骸を削除する。
 * `.db` 本体は **削除しない** (preview server が CI で先行 open している inode を
 * 失わせないため、#2648 CI fix を参照)。`-wal` / `-shm` のみ削除。
 * idempotent (file 不在でもエラーにしない)。
 *
 * 呼び出し側: global-setup.ts 末尾で本関数呼出 → ensureWorkerDb() で再 backup、
 * または global-teardown.ts で session 終了後の cleanup。
 *
 * Linux POSIX では open file の unlink は inode を孤立化させるが、Windows では
 * `EBUSY` を返す。両環境で安全に動作するため `.db` は触らず、close 後に残った
 * WAL/shm のみ削除する。
 */
export function cleanupWorkerDb(parallelIndex: number): void {
	const basePath = path.resolve(`data/e2e-worker-${parallelIndex}.db`);
	for (const suffix of ['-wal', '-shm']) {
		const filePath = `${basePath}${suffix}`;
		if (fs.existsSync(filePath)) {
			try {
				fs.unlinkSync(filePath);
			} catch {
				// preview server が WAL/shm を保持している可能性あり (Windows EBUSY)。
				// 次回 ensureWorkerDb の `db.backup()` が in-place overwrite するため
				// 残骸を残しても整合性は保たれる (#2648 CI fix)。
			}
		}
	}
}
