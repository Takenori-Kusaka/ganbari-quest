// tests/e2e/helpers/per-worker-db.ts
//
// #2648 Phase A Step A-3 + CI fix: per-worker SQLite file isolation helper。
//
// 設計根拠 (deep research `a70be0e3278d98fd2` §7.3 + 試行錯誤ログ §3 Step A-3 + CI 再 fix):
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
// 3. **CI fail 真因 (2026-05-29 PR #2657 → 本 fix)**:
//    - playwright runner は **plugin (webServer) setup を globalSetup より先に**実行する
//      (`node_modules/playwright/lib/runner/index.js:5828` `createGlobalSetupTasks` 配置順)
//    - つまり CI では vite preview が `npm run preview -- --port 5190` で起動 →
//      SvelteKit が `client.ts` で `new Database('./data/e2e-worker-0.db')` を **OPEN** →
//      schema が無いので auto-init (`SQL_CREATE_TABLES` 実行) で **空 schema + 0 行** 状態に
//    - その後 globalSetup が `cleanupWorkerDb` で `fs.unlinkSync` → Linux POSIX は
//      open FD を保持したまま directory entry のみ削除 → 同名 path に新規 inode 作成
//    - 後続 `ensureWorkerDb` の `db.backup()` は新 inode に seeded data を書き込むが、
//      vite preview server は **古い inode (空 schema)** を読み続けるため全 test fail
//      (`けんたくん の child-select ボタンが seed されていること` 等)
//    - Local Windows は `fs.unlinkSync` が open file で `EBUSY` を投げるため別現象として顕在化
//
// 4. **CI fix 方針 (本 file)**:
//    - **`fs.unlinkSync` を撤去** — 既存 file を残し `db.backup()` で **in-place 上書き** する
//    - SQLite Online Backup API は destination DB が存在する場合 page-level に overwrite し
//      WAL/shm を含む整合性を保つ。preview server の open connection も同じ inode を
//      参照し続けるため backup commit 後の新 data を読み出せる
//    - WAL/shm 残骸の lock 競合は `db.backup()` が SQLite EXCLUSIVE lock で吸収する
//    - cleanupWorkerDb は **`-wal` / `-shm` 残骸のみ** 削除する (`.db` 本体は触らない)
//
// 5. **既存 helpers (test-user-factory.ts 等) との互換**:
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
 * **CI fix 後の挙動 (in-place overwrite pattern)**:
 * 既存 file が存在しても **必ず template から再 backup する** (in-place overwrite)。
 * 理由は file header のコメント §3 / §4 参照 — vite preview server が既に worker DB を
 * 開いている状態でも SQLite Online Backup API が page-level に上書きするため、
 * preview server は同じ inode 経由で新 data を読める。
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
	// 上書きする。これにより preview server (CI で先行起動) が同じ inode 経由で
	// 新 seed data を読めるようになる (#2648 CI fix)。
	const src = new Database(TEMPLATE_DB_PATH, { readonly: true });
	try {
		await src.backup(workerDbPath);
	} finally {
		src.close();
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
