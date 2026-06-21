#!/usr/bin/env node
// scripts/native-dep-smoke.mjs
//
// #3191: native module (better-sqlite3 / sharp / bcrypt 等) の bump が
// demo/SQLite 経路を SIGSEGV crash させる class (#3190) を PR 時点で捕捉する最小 smoke。
//
// 背景: #3158 で better-sqlite3 12.9.0→12.11.1 に bump され、SQLite を使う demo/NUC 経路が
// プロセスごと SIGSEGV crash した。crash は重量 e2e (demo-free / staging) でのみ発現し、
// develop 軽量レーン + per-PR gate をすり抜けて統合監査まで露見しなかった (shift-left 欠如)。
// 本 smoke は native binding を実際に load + 最小操作し、ABI/バージョン不整合による
// crash (非 0 exit / SIGSEGV) を軽量レーンで即検出する (#3152 fitness / shift-left の適用)。
//
// 各 native dep は別プロセス相当の try/catch で隔離し、binding load + 代表操作を実行する。
// SIGSEGV は catch できない (プロセス即死) ため、本 script 自体が非 0 exit すれば CI が fail する。
//
// 使用: node scripts/native-dep-smoke.mjs

import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;

function ok(name, msg) {
	console.log(`[native-dep-smoke] OK  ${name}: ${msg}`);
}
function fail(name, err) {
	console.error(`[native-dep-smoke] FAIL ${name}: ${err}`);
	failures++;
}

// temp file 名の一意化カウンタ (process.pid と組み合わせて衝突回避)
let dbCounter = 0;

// SQLite file + WAL sidecar (-wal / -shm) を best-effort で削除する。
// 存在しない file の unlink は無視 (ENOENT)。
function cleanupSqliteFiles(basePath) {
	for (const suffix of ['', '-wal', '-shm']) {
		try {
			unlinkSync(`${basePath}${suffix}`);
		} catch {
			/* 未生成 / 既削除は無害 */
		}
	}
}

// --- better-sqlite3: SIGSEGV #3190 の当該 native module。
//     実 crash 経路 (src/lib/server/db/client.ts getOrInitDb) を mirror して
//     **file-backed DB + WAL pragma** を実際に exercise する。
//
//     `:memory:` DB は mmap/共有メモリ (-wal / -shm sidecar) を使わない別 native codepath で、
//     WAL 固有の binding crash を素通りさせてしまう (#3190 の実 crash は file+WAL 経路)。
//     よって smoke は temp file DB を作り、client.ts と同一の pragma を適用したうえで
//     CRUD round-trip を行い、生成された WAL sidecar ごと後始末する。
//
//     temp file 名は Date.now()/Math.random() が制限される実行文脈でも衝突しないよう
//     process.pid + module-level counter で一意化する (pre-unlink で残骸も除去)。
{
	let tempPath;
	let db;
	try {
		const Database = (await import('better-sqlite3')).default;
		tempPath = join(tmpdir(), `native-dep-smoke-${process.pid}-${dbCounter++}.db`);
		// 前回 run の残骸があれば除去してから new Database (clean state)
		cleanupSqliteFiles(tempPath);

		db = new Database(tempPath);
		// client.ts getOrInitDb (src/lib/server/db/client.ts:93-101) と同一の pragma 列。
		// journal_mode = WAL が mmap/-wal/-shm 経路を起動する (#3190 crash codepath)。
		db.pragma('journal_mode = WAL');
		db.pragma('foreign_keys = ON');
		db.pragma('busy_timeout = 5000');
		db.pragma('wal_autocheckpoint = 100');
		db.pragma('synchronous = NORMAL');

		// WAL が実際に有効化されたことを確認 (pragma 適用 + native codepath 起動の証跡)
		const journalMode = db.pragma('journal_mode', { simple: true });
		if (String(journalMode).toLowerCase() !== 'wal') {
			throw new Error(`journal_mode が WAL になっていない: ${journalMode}`);
		}

		db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, name TEXT)');
		db.prepare('INSERT INTO smoke (name) VALUES (?)').run('がんばり');
		const row = db.prepare('SELECT name FROM smoke WHERE id = 1').get();
		// WAL checkpoint を強制し -wal の page を本体へ書き戻す (mmap write 経路も exercise)
		db.pragma('wal_checkpoint(TRUNCATE)');
		db.close();
		db = null;
		if (row?.name !== 'がんばり') throw new Error(`unexpected read: ${JSON.stringify(row)}`);

		const ver = (await import('better-sqlite3/package.json', { with: { type: 'json' } })).default
			.version;
		ok('better-sqlite3', `v${ver} file+WAL load + CRUD 正常 (SIGSEGV なし) [${tempPath}]`);
	} catch (e) {
		fail('better-sqlite3', e);
	} finally {
		// open db が残っていれば close、その後 .db / -wal / -shm sidecar を全て後始末
		if (db) {
			try {
				db.close();
			} catch {
				/* close 失敗は cleanup を阻害しない */
			}
		}
		if (tempPath) cleanupSqliteFiles(tempPath);
	}
}

// --- bcrypt: native hashing。load + hash/compare ---
try {
	const bcrypt = (await import('bcrypt')).default;
	const hash = await bcrypt.hash('smoke', 4);
	if (!(await bcrypt.compare('smoke', hash))) throw new Error('hash/compare mismatch');
	ok('bcrypt', 'hash + compare 正常');
} catch (e) {
	fail('bcrypt', e);
}

// --- sharp: 画像最適化 native。load + 1x1 PNG 生成 (任意、未導入なら skip) ---
try {
	const sharp = (await import('sharp')).default;
	const png = await sharp({
		create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
	})
		.png()
		.toBuffer();
	if (!png || png.length === 0) throw new Error('empty PNG buffer');
	ok('sharp', '1x1 PNG 生成正常');
} catch (e) {
	// sharp は LP 最適化用途で必須ではないため、load 失敗は warning に留める
	console.warn(`[native-dep-smoke] WARN sharp: ${e} (LP 最適化のみ影響、blocker ではない)`);
}

if (failures > 0) {
	console.error(
		`\n[native-dep-smoke] FAIL — ${failures} 件の native module が load/操作に失敗。` +
			`\nnative dep の ABI/バージョン不整合の疑い (#3190 SIGSEGV class)。bump を pin/revert してください。`,
	);
	process.exit(1);
}
console.log('\n[native-dep-smoke] ALL PASS — native binding 健全 (#3191)');
