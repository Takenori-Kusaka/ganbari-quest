// src/lib/domain/constants/habit-milestones.ts
//
// #4172 — 「習慣化できていること」を褒めるための閾値。
//
// 撤去した旧機構は `totalRecords % 5 === 0`（記録の累計回数の剰余）で発火していた。
// これは「連続」でも「習慣」でもなく、1 日に 5 回記録しても発火する。
// **褒めるべきは「続いた」ことであって「たくさん入力した」ことではない**
// (`docs/design/26-ゲーミフィケーション設計書.md` §2.4)。

/**
 * 月間の習慣化を認める「その月に記録した日数」の閾値。
 *
 * **1 日に何回記録しても 1 日と数える。** 量ではなく継続を見る指標であるため
 * (判定は `report-service` の `daysWithActivity` を使う。定義が本閾値と一致している)。
 *
 * ## なぜ 10 日なのか (PO 決裁 2026-08-02、AC16)
 *
 * 本番実データ (NUC 1 家庭 2 人 / 6 child-month) は **23・22 日の習慣月**と
 * **7・3・1・1 日の失速月**に二分され、その谷に置く 10 日だけが両者を分けた。
 * **n=1 なので「分布」ではなく単一事例の観察値**である。
 *
 * 決め手はデータではなく**褒めることの意味**だった:
 * **7 日 / 31 日は習慣ではない。そこで褒めると親の「1 ヶ月がんばったね」が空になる。**
 * アプリが親に嘘をつかせてはならない (§2.1-2「最終的な報酬は親からの言葉」)。
 *
 * オーナーの言い回し「今月、週 1 回はできていた」を厳密に取ると日数ではなく
 * **分布の条件**（各週に 1 回以上）になる。月 4 日が 1 週間に集中していれば
 * 「週 1 回できていた」ではない。**日数 10 はその近似**として採用した。
 */
export const MONTHLY_HABIT_DAYS_THRESHOLD = 10;

/**
 * 閾値を再評価する期日 (#4261 ② PO 決裁 2026-08-06)。
 *
 * **n=1 のまま据え置くのは構わないが、「いつ見直すか」が無いまま固定するのは認めない**
 * (#4256 と同じ形 — 気づく仕組みが無い状態が既定になり、そのまま恒久化する)。
 */
export const MONTHLY_HABIT_THRESHOLD_REVIEW_DEADLINE = '2026-11-05';

/** 期日より早く再評価に入る条件: 有料家庭がこの世帯数に達し 1 ヶ月分のデータが揃った時点。 */
export const MONTHLY_HABIT_THRESHOLD_REVIEW_MIN_PAID_FAMILIES = 3;

/**
 * 閾値の再評価トリガー (AC17 / #4261 ②)。
 *
 * **n=1 で決めた値なので、動かす条件を先に決めておく。**
 * これが無いと「動かさない理由」を毎回考え直すことになる。
 *
 * 見るのは `daysWithActivity` の分布 (達成率と、達成しなかった家庭の日数)。
 * 到達しない家庭が続くのは「その家庭ががんばっていない」ではなく
 * **閾値が実態に合っていない**可能性が高い、という前提で下げる方向に倒す。
 */
export const MONTHLY_HABIT_THRESHOLD_REVIEW_TRIGGER =
	`有料家庭が ${MONTHLY_HABIT_THRESHOLD_REVIEW_MIN_PAID_FAMILIES} 世帯以上で 1 ヶ月分のデータが揃った時点、` +
	`または ${MONTHLY_HABIT_THRESHOLD_REVIEW_DEADLINE} のいずれか早い方で再評価する。` +
	'3 ヶ月連続で誰も達成しなかったら 10 → 8 に下げる (n=1 で決めた値のため、下げる方向に倒す)';

/**
 * 月間習慣化達成に自動付与するポイント。
 *
 * 撤去した旧機構と同額。頻度が約 1/6 (5 回ごと → 月 1 回) になるため増額しない。
 * ごほうびのプリセットは 100〜1000pt 帯なので、**50pt は「ごほうび 1 個には足りないが近づく」量**。
 * アプリが単独でごほうびを買えるだけの通貨を配らない、という位置づけを保つ (PO 決裁 Q3)。
 */
export const MONTHLY_HABIT_POINTS = 50;

/**
 * ストリーク証明書の閾値 (日数)。
 *
 * #4172 AC12': 同じ値が `certificate-service` / `value-preview-service` /
 * `family-streak-service` の 3 箇所に別々のリテラルとして存在していた。
 * **数値だけをここに集約する。**
 *
 * **points の割り当ては統合しない。** `family-streak-service` は家族単位のストリークという
 * 別ドメインで、同じ日数に別の意味の points 表を持つ。**値が同じだから統合する、は誤り** —
 * 混ぜると片方を変えたときに他方が壊れる (PO 決裁 Q5)。
 *
 * 表示層 (`labels.ts` の文言) は本 SSOT の参照側として扱う。
 */
/**
 * 証明書 (がんばり証明書) を発行するレベルの節目 (#4674)。
 * certificate-service.ts の LEVEL_MILESTONES 実体であり、ページガイドの発行条件説明も本定数を引く
 * (数値をガイド文言に直書きしない、EPIC #4650 PO 判断)。
 */
export const CERTIFICATE_LEVEL_MILESTONES = [5, 10, 20, 30, 50] as const;

export const STREAK_MILESTONE_DAYS = [7, 14, 30, 60, 100] as const;

/**
 * `MILESTONES` (value-preview) が通知に使うストリーク閾値。
 *
 * 子供に見せる称賛は 30 日までを扱うため、`STREAK_MILESTONE_DAYS` からその範囲だけを取る
 * (60 / 100 日は証明書側のみ)。**別のリテラルを置かない。**
 * ここから導かれる ID 集合が `PRAISE_MILESTONE_IDS` と一致することは
 * `tests/unit/architecture/praise-axis-ssot.test.ts` [P3] が検査する。
 */
export const NOTIFIED_STREAK_MILESTONE_DAYS = STREAK_MILESTONE_DAYS.filter(
	(d) => d <= 30,
) as readonly number[];

/**
 * 子供に見せる称賛 (マイルストーン) の ID 集合 = **褒める軸の SSOT** (#4268)。
 *
 * ## 軸の契約
 *
 * **褒めるのは「続いた」ことだけ。「たくさん記録した」ことでは褒めない** (#4172)。
 * したがって本配列に入れてよいのは日数ベース (`streak_*`) の軸のみで、
 * 累計回数ベース (旧「5 回記録」「10 回記録」型) の軸は置かない。
 *
 * 唯一の例外が `first_record` で、これは**量ではなく「開始」を褒める**
 * (閾値 1 = 最初の 1 件。2 件目以降を数え上げない)。
 * 例外はこの 1 件だけであることを `PRAISE_START_MILESTONE_ID` で明示する。
 *
 * ## 両側適用の機械検査
 *
 * 褒める軸は「称賛表示側」(本配列 → `value-preview-service` の `MILESTONES` /
 * `labels.ts` の文言) と「報酬発行側」(`certificate-service` の月間習慣化 /
 * ストリーク証明書) の 2 系統に分かれている。片側だけ変えても壊れないため、
 * 両側が同じ軸に従っていることを `tests/unit/architecture/praise-axis-ssot.test.ts`
 * が fitness function として検査する。**軸を足す / 変えるときは本配列を起点にする。**
 */
export const PRAISE_MILESTONE_IDS = ['first_record', 'streak_7', 'streak_14', 'streak_30'] as const;

export type PraiseMilestoneId = (typeof PRAISE_MILESTONE_IDS)[number];

/**
 * 「開始」を褒める唯一の非日数軸 (#4268 AC2)。
 *
 * `first_record` を残したのは、閾値 1 が**量の達成ではなく開始の事実**だから。
 * #4172 が撤去したのは `totalRecords % 5` 型の累積量判定であり、初回の祝福ではない。
 * これを外すと、子供は最初のストリーク (7 日) まで称賛が 1 つも無い状態になる。
 */
export const PRAISE_START_MILESTONE_ID = 'first_record' satisfies PraiseMilestoneId;
