// scripts/ops-kpi-summary.ts — `/ops` ダッシュボードと同じ導出で KPI サマリーを書き出す CLI (#4962)
//
// 集計の SSOT は src/lib/server/services/ops-service.ts の getKpiSummary()、レポート用の文面は
// ops-kpi-report.ts。本 CLI はそれらを呼んでファイルに書き出すだけの thin wrapper で、
// 週次運営レポート (weekly-report.yml) が使う。手元でも同じ値を確認できる恒久運用ツール (#1442)。
//
// 実行 (tsx。`$lib` alias は tsconfig の paths で解決するため、先に `npx svelte-kit sync` が要る):
//   DATA_SOURCE=dsql DSQL_ENDPOINT=<id>.dsql.<region>.on.aws \
//     npx tsx scripts/ops-kpi-summary.ts --out kpi.json --text-out kpi.txt
//   DATA_SOURCE=demo npx tsx scripts/ops-kpi-summary.ts            # 出力先省略時は JSON を stdout
//
// DSQL には DbConnectAdmin 相当の AWS credential で `admin` として接続する (dsql-migrate と同じ経路)。

import { writeFileSync } from 'node:fs';
import { formatOpsKpiReportText } from '../src/lib/server/services/ops-kpi-report';
import { getKpiSummary } from '../src/lib/server/services/ops-service';

function readPathArg(argv: readonly string[], flag: string): string | null {
	const i = argv.indexOf(flag);
	if (i === -1) return null;
	const path = argv[i + 1];
	if (!path || path.startsWith('--')) {
		throw new Error(`[ops-kpi-summary] ${flag} にはファイルパスが必要です`);
	}
	return path;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const outPath = readPathArg(argv, '--out');
	const textOutPath = readPathArg(argv, '--text-out');

	const summary = await getKpiSummary();
	const json = `${JSON.stringify(summary, null, 2)}\n`;
	if (outPath) writeFileSync(outPath, json);
	if (textOutPath) writeFileSync(textOutPath, `${formatOpsKpiReportText(summary)}\n`);
	if (!outPath && !textOutPath) process.stdout.write(json);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('[ops-kpi-summary] 失敗:', err);
		process.exit(1);
	});
