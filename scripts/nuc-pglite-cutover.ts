// scripts/nuc-pglite-cutover.ts — NUC 旧 sqlite → PGlite cutover CLI (EPIC #3620 AC-C4 後段)
//
// ADR-0064 §ロールバック保証 (非破壊 import-then-swap) の実行ツール。2 subcommand 構成:
//
//   export: 旧 sqlite DB を **tmp に copy してから** (原本 read-only 保証、WAL 副作用も copy 側)
//           exportFamilyData(tenantId='local') で JSON に書き出す。
//     DATABASE_URL 不要 (--db で受ける):
//       npx tsx scripts/nuc-pglite-cutover.ts export --db data/ganbari-quest.db --out tmp/cutover.json
//
//   import: **空の** PGLITE_DATA_DIR に fresh PGlite を構築 (migration 適用) → JSON を
//           LOCAL_TENANT_UUID で import → 件数突合 (nuc-cutover-verify) → 不一致/エラー時は
//           dataDir を削除して exit 1 (旧 DB は無傷のため再実行可能)。
//       npx tsx scripts/nuc-pglite-cutover.ts import --in tmp/cutover.json --data-dir data/pglite
//
// swap (切替) は本 CLI の対象外: .env を DATA_SOURCE=pglite + PGLITE_DATA_DIR に変えて再起動する
// (旧 DB ファイルは物理保持 = 問題があれば .env を戻すだけで復帰)。手順 SSOT は
// docs/runbooks/nuc-pglite-cutover.md。
//
// factory singleton 制約により export と import は**別プロセス必須** (subcommand 分離の理由)。

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

interface Args {
	cmd: string;
	opts: Record<string, string>;
}

function parseArgs(): Args {
	const [cmd = ''] = process.argv.slice(2);
	const opts: Record<string, string> = {};
	for (let i = 3; i < process.argv.length; i += 2) {
		const k = process.argv[i];
		const v = process.argv[i + 1];
		if (k?.startsWith('--') && v !== undefined) opts[k.slice(2)] = v;
	}
	return { cmd, opts };
}

function fail(msg: string): never {
	console.error(`[nuc-cutover] ERROR: ${msg}`);
	process.exit(1);
}

async function runExport(opts: Record<string, string>): Promise<void> {
	const dbPath = opts.db ?? fail('--db <旧 sqlite DB path> が必要です');
	const outPath = opts.out ?? fail('--out <出力 JSON path> が必要です');
	if (!existsSync(dbPath)) fail(`旧 DB が見つかりません: ${dbPath}`);

	// 原本 read-only 保証: copy に対して open する (better-sqlite3 の WAL 副作用も copy 側に限定)。
	const workCopy = join(tmpdir(), `nuc-cutover-src-${process.pid}.db`);
	copyFileSync(dbPath, workCopy);
	// WAL/SHM が併存する場合も copy (checkpoint 前の直近書込を含めるため)。
	for (const suffix of ['-wal', '-shm']) {
		if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, workCopy + suffix);
	}

	process.env.DATA_SOURCE = 'sqlite';
	process.env.DATABASE_URL = workCopy;

	try {
		const { exportFamilyData } = await import('../src/lib/server/services/export-service');
		const { summarizeExportCounts } = await import('./lib/nuc-cutover-verify');
		// 旧 NUC の tenant は local auth 固定値 'local' (src/lib/server/auth/local-tenant.ts)。
		const data = await exportFamilyData({ tenantId: 'local' });
		const counts = summarizeExportCounts(data);
		mkdirSync(dirname(resolve(outPath)), { recursive: true });
		writeFileSync(outPath, JSON.stringify(data));
		console.log(`[nuc-cutover] export 完了: ${outPath}`);
		console.log(`[nuc-cutover] counts: ${JSON.stringify(counts)}`);
	} finally {
		// best-effort cleanup: Windows では better-sqlite3 が open 中の copy を unlink できず
		// EBUSY になる (プロセス終了で OS が解放、tmpdir なので残置無害)。export 成否に影響させない。
		for (const suffix of ['', '-wal', '-shm']) {
			try {
				rmSync(workCopy + suffix, { force: true });
			} catch {
				/* EBUSY 等は無視 */
			}
		}
	}
}

async function runImport(opts: Record<string, string>): Promise<void> {
	const inPath = opts.in ?? fail('--in <export JSON path> が必要です');
	const dataDir = opts['data-dir'] ?? fail('--data-dir <PGlite dataDir> が必要です');
	if (!existsSync(inPath)) fail(`export JSON が見つかりません: ${inPath}`);
	// 非破壊保証: 既存 (非空) dataDir への上書き import を拒否する (誤指定で稼働 DB を壊さない)。
	if (existsSync(dataDir) && readdirSync(dataDir).length > 0) {
		fail(`--data-dir が空ではありません: ${dataDir} (fresh dir を指定してください)`);
	}

	process.env.DATA_SOURCE = 'pglite';
	process.env.PGLITE_DATA_DIR = resolve(dataDir);

	const data = JSON.parse(readFileSync(inPath, 'utf-8'));

	// #3584 ③ birth_date backfill gate: 新 model は age 列を持たず compute-on-read (§11.1) のため、
	// birth_date NULL の child は age=0 → preschool UI に固定される (中高生が幼児 UI を見せられる
	// 誤 tier)。PO B2「cutover backfill 必須」を機械 gate 化し、NULL 行があれば dataDir 構築前に
	// fail-fast する (旧 DB 側で生年月日を登録 → 再 export → 再実行)。
	const nullBirthChildren = (
		(data.family?.children ?? []) as { nickname?: string; birthDate?: string | null }[]
	).filter((c) => !c.birthDate);
	if (nullBirthChildren.length > 0) {
		const names = nullBirthChildren.map((c) => c.nickname ?? '(無名)').join(', ');
		fail(
			`birth_date 未設定の child が ${nullBirthChildren.length} 人います (${names})。` +
				'新 model は birth_date が唯一の年齢ソース (compute-on-read §11.1) のため、未設定のまま ' +
				'cutover すると当該 child は age=0 (preschool UI) に固定されます。' +
				'旧環境で生年月日を登録してから export し直して再実行してください (#3584 ③)。',
		);
	}

	const { LOCAL_TENANT_UUID } = await import('../src/lib/server/auth/local-tenant');
	const pglite = await import('../src/lib/server/db/pglite/connection');

	const abortAndCleanup = async (reason: string): Promise<never> => {
		await pglite.resetPgliteConnectionForTesting().catch(() => {});
		rmSync(dataDir, { recursive: true, force: true });
		console.error('[nuc-cutover] 部分構築した dataDir を削除しました (旧 DB は無傷、再実行可能)');
		fail(reason);
	};

	await pglite.initPgliteConnection();
	const { importFamilyData } = await import('../src/lib/server/services/import-service');
	const verify = await import('./lib/nuc-cutover-verify');

	// #3653: cutover は fresh DB への完全移行のため verbatim (dedup bypass)。merge semantics だと
	// 実本番に存在する同 child 同 title 行等が skip され件数突合で abort する (cycle 3 実検出)。
	const result = await importFamilyData(data, LOCAL_TENANT_UUID, undefined, { mode: 'verbatim' });
	if (result.errors.length > 0) {
		console.error(`[nuc-cutover] import errors (${result.errors.length} 件):`);
		for (const e of result.errors) console.error(`  - ${e}`);
		await abortAndCleanup('import で hard error が発生したため中止しました (errors>0 abort)');
	}

	const expected = verify.summarizeExportCounts(data);
	const actual = await verify.collectImportedCounts(pglite.getPgliteDbSync(), LOCAL_TENANT_UUID);
	const mismatches = verify.diffCutoverCounts(expected, actual);
	if (mismatches.length > 0) {
		console.error(`[nuc-cutover] 件数突合 不一致 (${mismatches.length} 軸):`);
		for (const m of mismatches) console.error(`  - ${m}`);
		await abortAndCleanup('件数突合が一致しないため中止しました');
	}

	// close して FS flush を確定させる (swap 前の完全永続化)。
	await pglite.resetPgliteConnectionForTesting();
	console.log(`[nuc-cutover] import + 件数突合 完了: ${JSON.stringify(actual)}`);
	console.log(
		`[nuc-cutover] 次の手順 (swap): .env に DATA_SOURCE=pglite / PGLITE_DATA_DIR=${resolve(dataDir)} を設定して再起動。`,
	);
	console.log(
		'[nuc-cutover] 旧 sqlite DB は無変更のまま物理保持されています (復帰は .env を戻すだけ)。',
	);
}

const { cmd, opts } = parseArgs();
const main = cmd === 'export' ? runExport : cmd === 'import' ? runImport : null;
if (!main) {
	console.error(
		'Usage: npx tsx scripts/nuc-pglite-cutover.ts <export|import> [--db|--in|--out|--data-dir ...]',
	);
	process.exit(1);
}
main(opts).catch((err) => {
	console.error('[nuc-cutover] 失敗:', err);
	process.exit(1);
});
