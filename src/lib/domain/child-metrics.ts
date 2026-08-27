// src/lib/domain/child-metrics.ts
//
// #4697: 親向けレポートに出す「レベル」「XP」「ポイント」「対象月」の定義 SSOT。
//
// ## なぜ 1 箇所に集めるか
//
// 同じ言葉が画面ごとに別の数を指していた:
//   - 「レベル」は `/view/<token>` がカテゴリレベルの合計 (Lv.17)、月次レポート / 成長記録ブック /
//     証明書は最大値 (レベル 5)。同じ子の同じ状態を見て 2 つの数が出ていた
//   - 「ポイント」は月次レポートが `statuses.total_xp` の累計で、子供画面の所持ポイントとも
//     週次タブの当週獲得とも一致しなかった。累計なので先月比は常に ±0 になっていた
//   - 成長記録ブックは月次レポートの累計値を 12 ヶ月ぶん足していたため、活動 0 回の月にも
//     未来月にも同じ数が並び、年間合計は累計 × 12 になっていた
//
// 定義を関数にして全画面がこれを呼ぶ形にすれば、次に「レベル」を変えるときも 1 箇所で済む。

/** レベル導出の入力 (status repo の行の部分形)。 */
export interface ChildStatusLevelLike {
	level?: number | null;
}

/** XP 導出の入力 (status repo の行の部分形)。 */
export interface ChildStatusXpLike {
	totalXp?: number | null;
}

/** レベルの下限。活動 0 でもレベル 1 から始まる。 */
export const MIN_CHILD_LEVEL = 1;

/**
 * 子供の「レベル」= カテゴリ別レベルの **最大値** (合計ではない)。
 *
 * 月次レポート / 成長記録ブック / 証明書 / 閲覧リンクはすべてこの 1 定義を使う。
 * 合計にすると「5 カテゴリが Lv.1 の子」が Lv.5 と表示され、1 カテゴリだけ Lv.5 の子と
 * 区別が付かなくなる (親が「レベル」を強さの目安として読めない)。
 */
export function resolveChildLevel(statuses: readonly ChildStatusLevelLike[]): number {
	return statuses.reduce((max, s) => Math.max(max, s.level ?? MIN_CHILD_LEVEL), MIN_CHILD_LEVEL);
}

/**
 * 子供の「つよさ (XP)」= カテゴリ別 totalXp の合計 (累計)。
 *
 * **ポイントとは別の量**。ポイントは台帳 (`point_ledger`) の獲得・消費で増減する通貨で、
 * XP は消費されない成長の累計。旧実装はこの XP を「ポイント」として出していた。
 */
export function resolveChildTotalXp(statuses: readonly ChildStatusXpLike[]): number {
	return statuses.reduce((sum, s) => sum + (s.totalXp ?? 0), 0);
}

/**
 * `YYYY-MM` が「今日 (JST) の属する月より後」か。
 *
 * 成長記録ブックは 4 月〜翌 3 月の 12 ヶ月を必ず並べるため、未来月の枠が生まれる。
 * そこに数値を出すと「まだ来ていない月の記録」になってしまうので、呼出側は本関数で
 * 未来月を判定して数値ではなく「—」を出す。
 *
 * @param yearMonth `YYYY-MM`
 * @param todayJST `YYYY-MM-DD` (JST。`todayDateJST()` の戻り値をそのまま渡す)
 */
export function isFutureMonth(yearMonth: string, todayJST: string): boolean {
	return yearMonth > todayJST.slice(0, 7);
}
