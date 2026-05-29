// tests/e2e/helpers/per-worker-db.ts
//
// #2648 Phase A Step A-3: per-worker SQLite file isolation helper。
//
// 設計根拠 (deep research `a70be0e3278d98fd2` §7.3 + 試行錯誤ログ §3 Step A-3):
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
// 3. **`cleanupWorkerDb` は global-teardown.ts でも呼べる** (Step A-4 で接続):
//    - .db / .db-wal / .db-shm の 3 ファイルセットを削除
//    - WAL/shm が残ると次回 globalSetup でロック競合の可能性
//
// 4. **既存 helpers (test-user-factory.ts 等) との互換**:
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
 * 既に存在しても作り直さない (idempotent)。
 *
 * Mainmatter blog pattern: `data/e2e-worker-${parallelIndex}.db` を採用。
 * `.gitignore` の `*.db` で自動 ignore 済 (確認: Step A-0 audit prerequisite #9)。
 *
 * @param parallelIndex Playwright `workerInfo.parallelIndex` (0-based)
 * @returns 絶対 path (e.g. `C:/Users/.../data/e2e-worker-0.db`)
 */
export async function ensureWorkerDb(parallelIndex: number): Promise<string> {
	const workerDbPath = path.resolve(`data/e2e-worker-${parallelIndex}.db`);

	// 既存 file は再利用 (前回 run の残骸を流用するのは整合性が壊れる可能性あるため、
	// 呼び出し側の global-setup で先に cleanupWorkerDb() を呼んで cleanup してから本関数を呼ぶ運用)。
	if (fs.existsSync(workerDbPath)) {
		return workerDbPath;
	}

	if (!fs.existsSync(TEMPLATE_DB_PATH)) {
		throw new Error(
			`[per-worker-db] template DB not found: ${TEMPLATE_DB_PATH}. ` +
				`global-setup.ts が先に template を seed していること。`,
		);
	}

	// SQLite online backup API 経由で WAL/shm 整合 snapshot を作成。
	// better-sqlite3 v7.0.0+ で対応、本 repo は v12.9.0 (prerequisite #7 で確認済)。
	const src = new Database(TEMPLATE_DB_PATH, { readonly: true });
	try {
		await src.backup(workerDbPath);
	} finally {
		src.close();
	}

	return workerDbPath;
}

/**
 * worker `parallelIndex` 用の SQLite file 一式 (.db / -wal / -shm) を削除する。
 * idempotent (file 不在でもエラーにしない)。
 *
 * 呼び出し側: global-setup.ts 末尾で本関数呼出 → ensureWorkerDb() で再生成、
 * または global-teardown.ts で session 終了後の cleanup。
 *
 * WAL/shm を残すと次回 globalSetup で `database is locked` を起こす可能性あり。
 */
export function cleanupWorkerDb(parallelIndex: number): void {
	const basePath = path.resolve(`data/e2e-worker-${parallelIndex}.db`);
	for (const suffix of ['', '-wal', '-shm']) {
		const filePath = `${basePath}${suffix}`;
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	}
}
