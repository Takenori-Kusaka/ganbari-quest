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

let failures = 0;

function ok(name, msg) {
	console.log(`[native-dep-smoke] OK  ${name}: ${msg}`);
}
function fail(name, err) {
	console.error(`[native-dep-smoke] FAIL ${name}: ${err}`);
	failures++;
}

// --- better-sqlite3: SIGSEGV #3190 の当該 native module。load + in-memory CRUD ---
try {
	const Database = (await import('better-sqlite3')).default;
	const db = new Database(':memory:');
	db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, name TEXT)');
	db.prepare('INSERT INTO smoke (name) VALUES (?)').run('がんばり');
	const row = db.prepare('SELECT name FROM smoke WHERE id = 1').get();
	db.close();
	if (row?.name !== 'がんばり') throw new Error(`unexpected read: ${JSON.stringify(row)}`);
	const ver = (await import('better-sqlite3/package.json', { with: { type: 'json' } })).default
		.version;
	ok('better-sqlite3', `v${ver} load + CRUD 正常 (SIGSEGV なし)`);
} catch (e) {
	fail('better-sqlite3', e);
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
