// scripts/seed-staging.ts — staging 用 PII-free 合成ダミーデータ seed CLI (#3412 / #2999 根本解決)
//
// staging (NUC #2872 / AWS #2873) を本番 DB snapshot (PII) から切り離すための generic seed ツール
// (研究 SSOT: docs/research/2026-06-28-dummy-dataset-requirements.md §5 選択肢 A+B)。2 subcommand:
//
//   generate: 合成 dataset (5 tenant、demo-data.ts 再利用) を JSON に書き出す。DB 不要・決定的。
//       npx tsx scripts/seed-staging.ts generate --out tmp/synthetic-seed.json
//       npx tsx scripts/seed-staging.ts generate --out tmp/synthetic-seed.json --anchor today
//     --anchor (YYYY-MM-DD | today、既定 = demo fixture 固定日 2026-03-27): 全日付を一律 shift し
//     「直近 14 日の履歴」として描画させる。同一 anchor なら出力 byte 同一 (AC3 決定性)。
//
//   apply: dataset JSON を **空の** PGLITE_DATA_DIR に seed する (fresh PGlite 構築 + migration 適用
//          + importFamilyData verbatim + 件数突合)。nuc-pglite-cutover.ts import と同型の非破壊設計:
//          既存 (非空) dataDir を拒否し、失敗時は dataDir を削除して exit 1。
//       npx tsx scripts/seed-staging.ts apply --in tmp/synthetic-seed.json --data-dir data/pglite
//
// factory singleton 制約 (nuc-pglite-cutover.ts と同じ) を避けるため generate は DB 非接続で
// 完結し、apply のみ DATA_SOURCE=pglite で接続する (別 subcommand = 別プロセスで安全)。
//
// 本番 snapshot 経路 (scripts/snapshot-prod-db.cjs) の置換は deploy-nuc-staging.yml の
// syntheticSeed input (opt-in) が担う。snapshot 経路は不変 (既存検証フローを壊さない)。

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
	console.error(`[seed-staging] ERROR: ${msg}`);
	process.exit(1);
}

async function runGenerate(opts: Record<string, string>): Promise<void> {
	const outPath = opts.out ?? fail('--out <出力 JSON path> が必要です');
	const anchorOpt = opts.anchor;
	const anchorDate = anchorOpt === 'today' ? new Date().toISOString().slice(0, 10) : anchorOpt;

	const { buildSyntheticStagingDataset, SYNTHETIC_SEED_ANCHOR } = await import(
		'../src/lib/server/demo/synthetic-staging-dataset'
	);
	const dataset = await buildSyntheticStagingDataset(anchorDate ?? SYNTHETIC_SEED_ANCHOR);

	mkdirSync(dirname(resolve(outPath)), { recursive: true });
	writeFileSync(outPath, JSON.stringify(dataset));
	console.log(`[seed-staging] generate 完了: ${outPath} (anchor=${dataset.anchorDate})`);
	for (const t of dataset.tenants) {
		console.log(
			`[seed-staging]   - ${t.key}: children=${t.data?.family.children.length ?? 0} trial=${t.trial ? `${t.trial.tier} (${t.trial.startOffsetDays}..${t.trial.endOffsetDays}d)` : 'none'}`,
		);
	}
}

async function runApply(opts: Record<string, string>): Promise<void> {
	const inPath = opts.in ?? fail('--in <dataset JSON path> が必要です');
	const dataDir = opts['data-dir'] ?? fail('--data-dir <PGlite dataDir> が必要です');
	if (!existsSync(inPath)) fail(`dataset JSON が見つかりません: ${inPath}`);
	// 非破壊保証 (nuc-pglite-cutover.ts import と同型): 既存 (非空) dataDir への seed を拒否
	if (existsSync(dataDir) && readdirSync(dataDir).length > 0) {
		fail(`--data-dir が空ではありません: ${dataDir} (fresh dir を指定してください)`);
	}

	const dataset = JSON.parse(readFileSync(inPath, 'utf-8'));
	// format 識別子は dataset module の SSOT 定数を参照する (リテラル二重化しない)。
	// この import は fixture / pure module のみで DB 接続を伴わない (generate と同一 graph)。
	const { SYNTHETIC_DATASET_FORMAT } = await import(
		'../src/lib/server/demo/synthetic-staging-dataset'
	);
	if (dataset?.format !== SYNTHETIC_DATASET_FORMAT) {
		fail(`dataset の format が不正です: ${String(dataset?.format)}`);
	}

	process.env.DATA_SOURCE = 'pglite';
	process.env.PGLITE_DATA_DIR = resolve(dataDir);

	const pglite = await import('../src/lib/server/db/pglite/connection');
	await pglite.initPgliteConnection();

	try {
		const { applySyntheticDataset } = await import('./lib/runtime/seed-staging-apply');
		const result = await applySyntheticDataset(dataset, pglite.getPgliteDbSync());
		// close して FS flush を確定 (swap 前の完全永続化、cutover と同型)
		await pglite.resetPgliteConnectionForTesting();
		console.log(`[seed-staging] apply 完了 (anchor=${result.anchorDate}):`);
		for (const t of result.tenants) {
			console.log(
				`[seed-staging]   - ${t.key} (${t.tenantUuid}): children=${t.children} trial=${t.trial ? `${t.trial.tier} ${t.trial.startDate}..${t.trial.endDate}` : 'none'} counts=${t.importedCounts ? JSON.stringify(t.importedCounts) : 'n/a'}`,
			);
		}
	} catch (err) {
		await pglite.resetPgliteConnectionForTesting().catch(() => {});
		rmSync(dataDir, { recursive: true, force: true });
		console.error('[seed-staging] 部分構築した dataDir を削除しました (再実行可能)');
		throw err;
	}
}

const { cmd, opts } = parseArgs();
const main = cmd === 'generate' ? runGenerate : cmd === 'apply' ? runApply : null;
if (!main) {
	console.error(
		'Usage: npx tsx scripts/seed-staging.ts <generate|apply> [--out|--anchor|--in|--data-dir ...]',
	);
	process.exit(1);
}
main(opts).catch((err) => {
	console.error('[seed-staging] 失敗:', err);
	process.exit(1);
});
