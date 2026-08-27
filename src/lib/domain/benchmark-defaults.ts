// src/lib/domain/benchmark-defaults.ts
//
// #4697: 「同年齢の平均」ベンチマーク既定値の SSOT。
//
// ## なぜ SSOT にするか
//
// 同じ「同年齢の目安」を 2 箇所が別々に持っていた:
//   - DB に seed される既定値 (発達段階モデル推定、本ファイルの表)
//   - `/admin/status` の入力ガイド文が画面内で計算していた式 `(age - 2) * 80`
//
// 4 歳で前者は平均 18〜38 XP、後者のガイド文は「平均 128〜240 XP」。桁が違う 2 つの数が
// 同じ画面に並び、親は「どちらを基準に入れればいいのか」を判断できなかった (#4697)。
// 既定値を本ファイルに集約し、seed もガイド文も同じ表から引くことで、片方だけ動く事故を消す。
//
// **値の意味**: カテゴリ別の累計 XP の、その年齢における平均 (mean) と標準偏差 (stdDev)。
// 設計根拠 (カテゴリ間の大小関係):
//   - せいかつ(3): 日常習慣は幼児期から蓄積が早く、全年齢で最高値
//   - うんどう(1): 粗大運動 → 巧緻運動と着実に発達 (文科省体力テスト参考)
//   - べんきょう(2): 就学前は低め、6 歳 (小学校入学) 以降に加速 (学習指導要領準拠)
//   - こうりゅう(4): 幼児期は基礎的、学童期にピアグループ形成で加速
//   - そうぞう(5): 幼児期に豊かな想像力、学童期は型の習得期で緩やか
//   - stdDev は平均の 28-33% (年齢が上がるほど個人差拡大)
//
// 親は `/admin/status` から家庭ごとに上書きできる。本表はあくまで初期値。
//
// #3607 と同じ理由で、`src/lib/server/db/seed.ts` は tsx 直接実行のため相対 import で読む。

/** ベンチマーク既定値 1 行。 */
export interface BenchmarkDefault {
	readonly age: number;
	/** legacy 数値カテゴリ id (1..5、`categories.ts` の legacyNumericId)。 */
	readonly categoryId: number;
	/** その年齢の累計 XP 平均。 */
	readonly mean: number;
	/** その年齢の累計 XP 標準偏差。 */
	readonly stdDev: number;
}

/** DB の `market_benchmarks.source` に入る出典ラベル。 */
export const BENCHMARK_DEFAULT_SOURCE = '発達段階モデル推定';

/** 既定値を持つ年齢の下限 / 上限。 */
export const BENCHMARK_DEFAULT_MIN_AGE = 3;
export const BENCHMARK_DEFAULT_MAX_AGE = 12;

/** ベンチマーク既定値 (3〜12 歳 × 5 カテゴリ)。 */
export const BENCHMARK_DEFAULTS: readonly BenchmarkDefault[] = [
	// age 3
	{ age: 3, categoryId: 1, mean: 16.0, stdDev: 5.0 },
	{ age: 3, categoryId: 2, mean: 8.0, stdDev: 3.0 },
	{ age: 3, categoryId: 3, mean: 22.0, stdDev: 6.0 },
	{ age: 3, categoryId: 4, mean: 12.0, stdDev: 4.0 },
	{ age: 3, categoryId: 5, mean: 14.0, stdDev: 4.5 },
	// age 4
	{ age: 4, categoryId: 1, mean: 30.0, stdDev: 9.0 },
	{ age: 4, categoryId: 2, mean: 18.0, stdDev: 6.0 },
	{ age: 4, categoryId: 3, mean: 38.0, stdDev: 10.0 },
	{ age: 4, categoryId: 4, mean: 24.0, stdDev: 8.0 },
	{ age: 4, categoryId: 5, mean: 28.0, stdDev: 8.0 },
	// age 5
	{ age: 5, categoryId: 1, mean: 52.0, stdDev: 15.0 },
	{ age: 5, categoryId: 2, mean: 32.0, stdDev: 10.0 },
	{ age: 5, categoryId: 3, mean: 60.0, stdDev: 16.0 },
	{ age: 5, categoryId: 4, mean: 40.0, stdDev: 12.0 },
	{ age: 5, categoryId: 5, mean: 42.0, stdDev: 12.0 },
	// age 6
	{ age: 6, categoryId: 1, mean: 85.0, stdDev: 25.0 },
	{ age: 6, categoryId: 2, mean: 65.0, stdDev: 20.0 },
	{ age: 6, categoryId: 3, mean: 95.0, stdDev: 25.0 },
	{ age: 6, categoryId: 4, mean: 62.0, stdDev: 18.0 },
	{ age: 6, categoryId: 5, mean: 58.0, stdDev: 17.0 },
	// age 7
	{ age: 7, categoryId: 1, mean: 122.0, stdDev: 36.0 },
	{ age: 7, categoryId: 2, mean: 105.0, stdDev: 32.0 },
	{ age: 7, categoryId: 3, mean: 138.0, stdDev: 36.0 },
	{ age: 7, categoryId: 4, mean: 95.0, stdDev: 28.0 },
	{ age: 7, categoryId: 5, mean: 82.0, stdDev: 24.0 },
	// age 8
	{ age: 8, categoryId: 1, mean: 168.0, stdDev: 50.0 },
	{ age: 8, categoryId: 2, mean: 152.0, stdDev: 46.0 },
	{ age: 8, categoryId: 3, mean: 188.0, stdDev: 48.0 },
	{ age: 8, categoryId: 4, mean: 140.0, stdDev: 42.0 },
	{ age: 8, categoryId: 5, mean: 112.0, stdDev: 33.0 },
	// age 9
	{ age: 9, categoryId: 1, mean: 222.0, stdDev: 66.0 },
	{ age: 9, categoryId: 2, mean: 205.0, stdDev: 62.0 },
	{ age: 9, categoryId: 3, mean: 248.0, stdDev: 62.0 },
	{ age: 9, categoryId: 4, mean: 192.0, stdDev: 58.0 },
	{ age: 9, categoryId: 5, mean: 148.0, stdDev: 44.0 },
	// age 10
	{ age: 10, categoryId: 1, mean: 282.0, stdDev: 85.0 },
	{ age: 10, categoryId: 2, mean: 265.0, stdDev: 80.0 },
	{ age: 10, categoryId: 3, mean: 315.0, stdDev: 78.0 },
	{ age: 10, categoryId: 4, mean: 248.0, stdDev: 75.0 },
	{ age: 10, categoryId: 5, mean: 192.0, stdDev: 58.0 },
	// age 11
	{ age: 11, categoryId: 1, mean: 348.0, stdDev: 105.0 },
	{ age: 11, categoryId: 2, mean: 330.0, stdDev: 100.0 },
	{ age: 11, categoryId: 3, mean: 390.0, stdDev: 95.0 },
	{ age: 11, categoryId: 4, mean: 308.0, stdDev: 92.0 },
	{ age: 11, categoryId: 5, mean: 245.0, stdDev: 74.0 },
	// age 12
	{ age: 12, categoryId: 1, mean: 418.0, stdDev: 125.0 },
	{ age: 12, categoryId: 2, mean: 400.0, stdDev: 120.0 },
	{ age: 12, categoryId: 3, mean: 470.0, stdDev: 115.0 },
	{ age: 12, categoryId: 4, mean: 372.0, stdDev: 112.0 },
	{ age: 12, categoryId: 5, mean: 302.0, stdDev: 90.0 },
] as const;

/**
 * `/admin/status` のベンチマーク入力ガイドに出す「その年齢の目安」レンジ。
 *
 * 画面内で式を組まず、本 SSOT の実値から min / max を取る。既定値を変えればガイド文も
 * 自動で追随し、桁がずれることが構造的に起こらない (#4697)。
 *
 * @returns 既定値を持たない年齢では `null` (画面はガイド文を出さない)
 */
export function getBenchmarkGuideRange(
	age: number,
): { meanLow: number; meanHigh: number; sdLow: number; sdHigh: number } | null {
	const rows = BENCHMARK_DEFAULTS.filter((b) => b.age === age);
	if (rows.length === 0) return null;
	const means = rows.map((b) => b.mean);
	const sds = rows.map((b) => b.stdDev);
	return {
		meanLow: Math.round(Math.min(...means)),
		meanHigh: Math.round(Math.max(...means)),
		sdLow: Math.round(Math.min(...sds)),
		sdHigh: Math.round(Math.max(...sds)),
	};
}
