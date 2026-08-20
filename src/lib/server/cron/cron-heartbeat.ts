// src/lib/server/cron/cron-heartbeat.ts
// #4721: cron が実際に走っているかを外から見えるようにする。
//
// ## なぜ要るか
//
// NUC の scheduler は `docker-compose.yml` の `profiles: [scheduler]` gate 配下にあり、
// `--profile scheduler` を付けない deploy では起動も更新もされない。つまり
// **「scheduler が一度も上がっていない」「registry を更新したのに古いコンテナのまま」**
// という状態が普通に起こりうる。そしてその状態は
//
//   - 画面には何も出ない (retention / age-recalc / export-build が走らないだけ)
//   - log にも出ない (走っていないものは log を書かない)
//
// ため、誰も気付けない。**「動いていない」ことは沈黙と区別がつかない**ので、
// 「最後に走った時刻」を残して `/api/health` から読めるようにする。
//
// ## 置き場所
//
// アプリ側 (cron endpoint を受ける側) に置く。scheduler コンテナ自身に書かせると
// アプリと volume を共有する必要があり、しかも「scheduler は生きているが app に届いていない」
// を検出できない。**受けた側が記録する**ことで、経路が最後まで通ったことの証跡になる。
//
// 保存先はファイル。DSQL / PGlite に書くと「DB が死んでいるときに cron の生死も見えない」
// になり、per-request の write も増える。NUC は単一コンテナで data volume を持つので
// ファイルで十分 (pglite-backup-service の status file と同じ考え方)。
//
// **AWS では使わない。** Lambda の FS は実行ごとに消えるためファイルは意味を持たず、
// AWS 側は EventBridge / cron-dispatcher の CloudWatch metric と
// `ganbari-quest-cron-dispatcher-errors` alarm が同じ役割を果たす。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '$lib/server/logger';

/** 記録先ディレクトリ (pglite backup の status file と同じ data/ 配下)。 */
const CRON_STATUS_DIR = join(process.cwd(), 'data');
const CRON_STATUS_FILENAME = 'cron-status.json';

/** job 名 → 最終実行時刻 (ISO)。 */
export interface CronHeartbeat {
	lastRunAt: Record<string, string>;
}

const EMPTY: CronHeartbeat = { lastRunAt: {} };

function statusPath(): string {
	return join(CRON_STATUS_DIR, CRON_STATUS_FILENAME);
}

/** 記録を読む。ファイルが無い / 壊れている場合は空を返す (起動を妨げない)。 */
export function readCronHeartbeat(): CronHeartbeat {
	try {
		const path = statusPath();
		if (!existsSync(path)) return EMPTY;
		const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CronHeartbeat>;
		const lastRunAt = parsed.lastRunAt;
		if (!lastRunAt || typeof lastRunAt !== 'object') return EMPTY;
		return { lastRunAt };
	} catch (err) {
		logger.warn('[cron-heartbeat] 状態ファイルを読めないため空として扱う', {
			error: err instanceof Error ? err.message : String(err),
		});
		return EMPTY;
	}
}

/**
 * cron ジョブが 1 回走ったことを記録する。
 *
 * **記録の失敗で cron 本体を落とさない。** これは観測のための副次的な書き込みであり、
 * ここで throw すると「観測装置が壊れたせいで本処理も止まる」という本末転倒になる。
 */
export function recordCronRun(jobName: string, at: Date = new Date()): void {
	try {
		if (!existsSync(CRON_STATUS_DIR)) mkdirSync(CRON_STATUS_DIR, { recursive: true });
		const current = readCronHeartbeat();
		const next: CronHeartbeat = {
			lastRunAt: { ...current.lastRunAt, [jobName]: at.toISOString() },
		};
		writeFileSync(statusPath(), `${JSON.stringify(next, null, 2)}\n`);
	} catch (err) {
		logger.warn('[cron-heartbeat] 状態ファイルを書けなかった (cron 本体は継続)', {
			error: err instanceof Error ? err.message : String(err),
			context: { jobName },
		});
	}
}

/** `/api/cron/<name>` から job 名を取り出す。cron 以外のパスは undefined。 */
export function cronJobNameFromPath(pathname: string): string | undefined {
	const match = /^\/api\/cron\/([a-z0-9-]+)\/?$/.exec(pathname);
	return match?.[1];
}
