// src/lib/domain/scheduler-health.ts
// #4721: 「NUC の scheduler が動いているか」の判定 (domain)。
//
// 生の最終実行時刻だけを出すと、読んだ人が毎回自分で深刻度を判断することになる
// (`backup-health.ts` が #4087 で同じ問題に当たっている)。判定は 1 箇所に置き、
// `/api/health` を読む人 / script が同じ結論を見るようにする。
//
// **「失敗 0 回」では判定できない。** scheduler コンテナが起動していなければ、
// ジョブは 1 度も走らず、したがって失敗も log も 0 件になる。異常が「何も起きない」
// という形で現れるので、**鮮度でしか捕まえられない**。

/** 判定に使う 1 ジョブ分の入力。 */
export interface SchedulerJobInput {
	name: string;
	/**
	 * 想定実行間隔 (分)。registry の cron 式から呼び出し側が導出する。
	 * **`null` は「日次より疎で鮮度判定に使えない」** = このジョブは評価対象外 (#4721)。
	 */
	expectedIntervalMinutes: number | null;
	/** 最終実行時刻 (ISO)。未実行は null。 */
	lastRunAt: string | null;
}

export type SchedulerHealthLevel = 'ok' | 'warning' | 'critical';

export interface SchedulerHealthVerdict {
	level: SchedulerHealthLevel;
	/** 人が読む 1 行。 */
	summary: string;
	/** 遅延している / 一度も走っていないジョブ名。 */
	staleJobs: string[];
	/** 一度も走っていないジョブ名 (staleJobs の部分集合)。 */
	neverRanJobs: string[];
}

/**
 * 猶予係数。cron は「間隔ちょうど」には来ない (実行時間・時計ずれ・単発失敗) ため、
 * 想定間隔の 3 倍を過ぎて初めて遅延とみなす。日次ジョブなら 3 日、15 分ジョブなら 45 分。
 */
const STALE_FACTOR = 3;

/**
 * 一度も走っていないジョブがあっても、**deploy 直後は正常**である
 * (日次ジョブは最初の 1 回が来るまで最大 1 日かかる)。
 * 想定間隔の 3 倍を過ぎても未実行なら critical に上げる。
 */
export function evaluateSchedulerHealth(
	jobs: readonly SchedulerJobInput[],
	now: Date,
	/** プロセス起動時刻。deploy 直後の未実行を誤検知しないための基準。 */
	processStartedAt: Date,
): SchedulerHealthVerdict {
	const staleJobs: string[] = [];
	const neverRanJobs: string[] = [];

	// 疎なジョブ (年 2 回等) は「最後の実行から日が経っている」が正常なので評価しない。
	// 混ぜると常時 warning になり、本物の停止がその warning に埋もれる。
	const evaluated = jobs.filter((job) => job.expectedIntervalMinutes !== null);

	for (const job of evaluated) {
		const toleranceMs = (job.expectedIntervalMinutes as number) * 60_000 * STALE_FACTOR;
		if (job.lastRunAt === null) {
			// 起動から猶予以内なら「まだ来ていないだけ」
			if (now.getTime() - processStartedAt.getTime() < toleranceMs) continue;
			neverRanJobs.push(job.name);
			staleJobs.push(job.name);
			continue;
		}
		const last = Date.parse(job.lastRunAt);
		if (Number.isNaN(last) || now.getTime() - last > toleranceMs) {
			staleJobs.push(job.name);
		}
	}

	if (staleJobs.length === 0) {
		return {
			level: 'ok',
			summary: '定期ジョブは想定間隔内に実行されています',
			staleJobs,
			neverRanJobs,
		};
	}

	// **全ジョブが未実行 = scheduler そのものが動いていない**。個別ジョブの失敗と切り分ける。
	if (neverRanJobs.length === evaluated.length && evaluated.length > 0) {
		return {
			level: 'critical',
			summary:
				'定期ジョブが 1 つも実行されていません。scheduler コンテナが起動していない可能性があります (docker compose --profile scheduler up -d)',
			staleJobs,
			neverRanJobs,
		};
	}

	return {
		level: staleJobs.length === evaluated.length ? 'critical' : 'warning',
		summary: `定期ジョブ ${staleJobs.length}/${evaluated.length} 件が想定間隔を過ぎても実行されていません: ${staleJobs.join(', ')}`,
		staleJobs,
		neverRanJobs,
	};
}

/**
 * cron 式 (`分 時 日 月 曜日`、Asia/Tokyo) から想定実行間隔 (分) を導出する。
 *
 * 判定に要るのは桁の精度ではなく「何分待てば次が来るはずか」なので、
 * 分 / 時フィールドの step (`*​/15`) と wildcard だけを見る粗い近似で足りる。
 * 月次・年 2 回のような疎なジョブは 1 日として扱い、日次と同じ猶予に丸める
 * (それ以上を厳密にしても「scheduler が動いていない」の検出精度は上がらない)。
 */
export function expectedIntervalMinutes(cronExpression: string): number | null {
	const fields = cronExpression.trim().split(/\s+/);
	const [minute = '*', hour = '*', dayOfMonth = '*', month = '*', dayOfWeek = '*'] = fields;

	// 日 / 月 / 曜日 のいずれかを限定している = 日次より疎。鮮度判定に使わない (#4721)。
	//
	// **疎なジョブを日次に丸めてはいけない**。年 2 回の pmf-survey (`0 9 1 6,12 *`) を
	// 1 日に丸めると、猶予 3 日を過ぎた時点で 1 年のうち約 359 日 staleJobs に居座り
	// warning が常時出続ける。運用者が「この warning は無視してよい」と学習した瞬間、
	// 本物の scheduler 停止も同じ warning に埋もれて見えなくなる (観測装置として逆効果)。
	// 疎なジョブは scheduler の生死を判定する材料にならないので最初から対象に入れない。
	if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null;

	const stepOf = (field: string): number | undefined => {
		const step = /^\*\/(\d+)$/.exec(field) ?? /^0\/(\d+)$/.exec(field);
		return step ? Number(step[1]) : undefined;
	};

	const minuteStep = stepOf(minute);
	if (minuteStep) return minuteStep;
	if (minute === '*') return 1;

	const hourStep = stepOf(hour);
	if (hourStep) return hourStep * 60;
	if (hour === '*') return 60;

	// 分・時とも固定 = 日次
	return 24 * 60;
}
