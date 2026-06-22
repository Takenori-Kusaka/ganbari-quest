# 自動生成週間チャレンジ アルゴリズム 設計経緯

<!-- 命名規則: NN-機能名-rationale.md -->
<!-- rationale = 機能別の設計経緯・なぜそう決めたか (Why)。仕様の結論は docs/design/44-チャレンジ設計書.md が SSOT -->

## 保存先テーブルの訂正（2026-06-22、child_challenges 一本化）

本 rationale 初版（#3194）は生成アルゴリズム `computeProposal` を **`auto_challenges`** テーブルに実装した。しかし #3195 着手時の影響調査で、子供向けのバナー / 達成演出 / ごほうび受取 / history は別テーブル **`child_challenges`** を読んでおり、`auto_challenges` はそれらに繋がっていない（2 系統並走）ことが判明した。

PO 判断で **`child_challenges` 一本化** に訂正:
- アルゴリズム（`computeProposal` / `summarizeChallengeAnalytics`）は**そのまま流用**するが、生成先を `child_challenges` に向ける（`getOrCreateWeeklyChildChallenge`、`sourceTemplateId='auto:weekly'`）。生成メタ（mode / 連続未達）は `targetConfig` JSON に内包し追加カラムを不要にする。
- `auto_challenges` テーブル + `auto-challenge-service` は廃止（#3213）。
- 全プランに開放（family 限定ではない）。

以下本文の「auto_challenges テーブル」「2 カラム migration」記述は、上記訂正後は **child_challenges + targetConfig JSON** に読み替える。アルゴリズム本体（§1〜§6 の生成・適応ロジック）は不変。

## 議論の発端

- **日時**: 2026-06-20
- **発端**: PO 本番レビュー（2026-06-19、設定画面キャプチャ）→「きょうだいチャレンジ設定の『チャレンジモード』は現状どう効いているのか」。調査で `sibling_mode`（協力/競争/両方）が **dead setting**（書き込むだけで挙動分岐の consumer が無い）と判明。競争タイプは EPIC #2294②/#2296 で撤去済みだが設定 UI に残骸が残っていた。
- **問題意識**: dead UI 撤去をきっかけに、チャレンジ機能をゼロベースで再考。目的（子供が日々の活動とは別軸で苦手を底上げ・得意を伸ばす中期目標）は不変だが、それを実現する「アプリが自動生成する週間チャレンジ」のアルゴリズムが洗練されていない。
- **現行実装の構造的欠陥**（`src/lib/server/services/auto-challenge-service.ts` 実読）:
  - **D1 翌週適応なし**: `getOrCreateWeeklyChallenge` が前週 challenge の `status`/`currentCount` を参照しない。未達でも翌週同じ難度。
  - **D2 target が素朴平均で下限3固定**: `max(3, ceil(minCount/2)+1)`。苦手カテゴリ（記録が少ない）にいきなり週3回を課し難度過大。
  - **D3 得意軸が存在しない**: 常に最少カテゴリ（苦手）を選択。マンネリ化。
  - **D4 完了/未達シグナルの死蔵**: `incrementChallengeProgress` が `completed` を返すが次週生成に渡らない。

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A: ユーザーカスタマイズ強化 | 親が手動で目標・期限・カテゴリを自由設定。marketplace でチャレンジ集を配信 | 自由度は高い |
| 案 B: アプリ自動生成に一本化 | カスタマイズを撤去し、アプリが行動科学ベースで生成。改善はユーザーフィードバック（analytics）で回す | 管理が容易、Pre-PMF に適合 |
| 採用案: 案 B ＋ ヒューリスティック適応 | 案 B を、習慣形成/interleaving/Flow 理論の確立知見に基づく「調整可能定数」で実装。ML/ルールエンジンは不採用 | 過剰実装を避けつつ目的を達成 |

## 棄却理由

- **案 A 棄却理由**: チャレンジは「使い始めてしばらく経ちマンネリ化してから欲しくなる」性質で、その自由度を UI / marketplace で管理させるのは顧客にとって難度が高い。自由度を上げると条件分岐がプログラミング的に複雑化し（カテゴリ×期限×子供×達成条件…）、Pre-PMF には過剰（ADR-0010 / YAGNI）。marketplace challenge-set は preset 1 個のみで陳列価値が薄く #2896 で非陳列決定済み。
- **ML / ルールエンジン（採用案の"向こう側"）棄却理由**: multi-armed bandit / Thompson sampling によるカテゴリ探索、BirdBrain 型 ML 難度調整、DDA（[DL-DDA](https://arxiv.org/pdf/2106.03075)）、曜日×カテゴリ×年齢の多変量 rule table はいずれも **MAU と学習データが前提**。Pre-PMF では到達せず YAGNI。analytics で達成率が観測でき定数調整が頭打ちになった時点で初めて PO と再検討する。

## 採用案とその理由

「アプリが自動生成する週間チャレンジ」を、行動科学・教育心理学の確立知見に基づき **ヒューリスティック＋調整可能定数**で洗練する。cron / ML / 新テーブルは不要、`auto_challenges` への2カラム追加のみで成立する。

### PO 確定方針（2026-06-20）

- アプリ自動生成に一本化。ユーザーカスタマイズ（親手動作成 `/admin/challenges`、marketplace challenge-set）は撤去。改善はユーザーフィードバック（達成率等の analytics）で回す。
- 伸ばす軸 = **苦手中心＋時々得意**（マンネリ防止に得意深掘り週を混ぜる）。
- 過剰実装回避: ルールエンジン化しない。「3分岐＋2連続未達特例を超えたら設計を止めて PO に戻す」を境界線とする。
- 競争（子供間の勝ち負け比較）は不採用・協力のみ（兄弟競争＝depression/自傷リスクの学術根拠、ADR-0012 Anti-engagement、EPIC #2294②/#2296 で撤去済）。

### 設計指針と根拠

#### ① target は ability ベース（下限3→2）

Fogg Behavior Model（B=MAP、Behavior = Motivation × Ability × Prompt）は「motivation は不安定なので ability（難度の低さ）を設計変数にせよ」。Bandura の self-efficacy は「未達の連鎖が子供の『できる』感を直接削り、mastery experience（達成体験）が self-efficacy の最重要情報源」。

→ 苦手カテゴリにいきなり週3回を課す現行 D2 は行動科学的に逆。`baseTarget = clamp(recentWeeklyAvg + 1, MIN=2, MAX=7)` とし、Fogg "make it tiny" に従い下限を 2 に下げる。

- Source: [Fogg Behavior Model](https://www.behaviormodel.org/) / [Bandura self-efficacy & habit (PMC8137900)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8137900/)

#### ② 苦手中心＋時々得意（weighted interleaving）

教育心理学の interleaved practice は、複数トピックを混ぜると初期成績は落ちるが長期保持・転移が向上する（desirable difficulty）。現行 D3（常に苦手1カテゴリ＝blocked practice）はこの利得を捨てている。

→ 重み付き抽選（苦手バイアス）＋ N週に1度の「得意深掘り週」＋同カテゴリ連続回避。

- Source: [Interleaved practice benefits (PMC8476370)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8476370/) / [Chartered College: spacing & interleaving](https://my.chartered.college/impact_article/the-application-of-spacing-and-interleaving-approaches-in-the-classroom/)

#### ③ 翌週適応（Flow 理論の3分岐ヒューリスティック）

Csikszentmihalyi の Flow channel は「challenge と skill が釣り合うと flow、過大で anxiety、過小で boredom」。Duolingo はこれを実データで裏付け（高すぎる daily goal は engagement でなく failure を生む / daily goal と streak を分離して D14 retention 改善 / 休む許可で復帰率向上）。

→ D1 解消。前週結果で翌週 target を3分岐調整: 完了→+1〜2（boredom 回避）/ 半分以上達成→据置（折らない）/ 半分未満→-1（anxiety 脱出＝self-efficacy 保護）。さらに **2週連続未達→target を最小固定＋得意週に切替**し、必ず達成体験を差し込む（Bandura の mastery experience 確保）。

target を上げるのは completed 時のみ・最大+2・上限7（青天井で煽らない）。「未達でも下げて必ず達成させる」非対称設計は滞在時間延伸でなく達成体験の確保が目的で、ADR-0012 整合（射幸性・連続演出を増やさない）。

- Source: [Flow Theory (Yu-kai Chou)](https://yukaichou.com/gamification-analysis/flow-theory-complete-guide-csikszentmihalyi-optimal-experience/) / [Duolingo streak blog](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/)

### Prior art の横断教訓

Duolingo（daily goal と streak を分離＝未達でも子供を責めない）/ Khan Academy（競争でなく"自分のペース"で mastery、協力固定方針と整合）/ Fogg Tiny Habits（最小単位に縮小、達成直後の肯定が habit wiring）。いずれも「achievable・自分のペース・反復で習熟」に収束し、competition は採用しない方針と整合する。

- Source: [Khan Academy Mastery (Sal Khan)](https://support.khanacademy.org/hc/en-us/articles/360030753412-Why-Mastery-Learning-by-Sal-Khan)

### 統合擬似アルゴリズム

```
// 調整可能定数（1箇所集約 = "ルールエンジン化しない" 約束の物理的表現）
TARGET_DELTA=1 / MIN_TARGET=2 / MAX_TARGET=7
WEAK_BIAS_BASE=5 / EVERY_N_WEEKS_STRONG=4
BUMP_NORMAL=1 / BUMP_OVERSHOOT=2 / MISS_RESCUE_AFTER=2

generateWeeklyChallenge(childId):
  if existing(weekStart): return existing          // 冪等（既存維持）
  counts = aggregateActivityLogsByCategory(過去2週) // 既存流用
  prev   = findByChildAndWeek(childId, lastWeekStart)  // ★D1解消

  // カテゴリ選択（② weighted interleaving）
  if totalRecords < MIN_RECORDS_FOR_ANALYSIS:  cat,mode = random, 'explore'
  elif prev.consecutiveMissCount >= MISS_RESCUE_AFTER: cat,mode = strongest, 'rescue-strength'
  elif weekIndex % EVERY_N_WEEKS_STRONG == 0:  cat,mode = strongest, 'strength'
  else: cat,mode = weightedPick(WEAK_BIAS_BASE), 'weakness'; 連続なら再抽選

  // target 決定（① ability + ③ flow 適応）
  base = clamp(round(counts[cat]/2) + TARGET_DELTA, MIN_TARGET, MAX_TARGET)
  if mode=='rescue-strength': target = MIN_TARGET                       // 必ず達成
  elif prev==null || prev.cat!=cat: target = base
  elif prev.status=='completed':
       bump = (overshoot>=2)? BUMP_OVERSHOOT : BUMP_NORMAL
       target = clamp(max(base, prev.target+bump), MIN_TARGET, MAX_TARGET)
  else: // 同カテゴリ未達
       target = (currentCount/target >= 0.5)? max(MIN, prev.target) : max(MIN, prev.target-1)
  insert({childId, weekStart, categoryId:cat, targetCount:target, mode})
```

達成判定（`incrementChallengeProgress`）は既存のまま。変更は「生成時に prev を読む」「2カラム追加」「定数で適応」のみ。

### 最小 analytics（カスタマイズ撤去後の唯一の改善入力）

| 指標 | 取得元 | 既存で取れるか |
|---|---|---|
| カテゴリ別達成率 = completed週/生成週 | `auto_challenges.status` 集計 | ✅ 既存 |
| 達成時の超過度 = currentCount - targetCount | 既存カラム | ✅ |
| 未達時の到達率 = currentCount / targetCount | 既存カラム | ✅ |
| 2連続未達の発生率 | `consecutiveMissCount`（新1カラム） | ⚠ 追加 |
| 得意週 vs 苦手週の達成率差 | `mode`（新1カラム） | ⚠ 追加 |
| challenge skip/dismiss 率 | 新規 event（UI 導線が要る） | ❌ 別 Issue（Pre-PMF 後回し） |

上4指標は既存テーブルの SQL 集計で取得可能。`consecutiveMissCount` と `mode` の2カラム追加で②③の適応と全 analytics が成立する。

## 残された懸念・フォローアップ

- [ ] **DBスキーマ変更（要 PO 承認・Auto Mode 確認事項）**: `auto_challenges` に `mode` / `consecutiveMissCount` 2カラム追加。並行実装4ファイル同期必須（`tests/e2e/global-setup.ts` / `tests/unit/helpers/test-db.ts` / `src/lib/server/demo/demo-data.ts` / schema）。DESIGN.md DB 並行実装チェック整合。**PO 判断: 案A（2カラム追加を許容）で進行**。
- [ ] **親手動チャレンジ作成 `/admin/challenges` の撤去**: PO 判断「アプリ一本化」。child-challenge-service / 関連 UI / E2E の撤去スコープを別 Issue で。dead UI 撤去（競争モードラジオ＋`sibling_mode`、草案 `tmp/issue-bodies/challenge-mode-dead-ui-removal.md`）はこの一本化の第一歩として fold 可。
- [ ] **skip/dismiss analytics**: UI 導線追加を伴うため Pre-PMF 後回し。別 Issue。
- [ ] **trust-but-verify**: Duolingo の「intense goal＝ストリーク率最低」具体数値は二次出典（case study/Medium）依存で公式 blog 未確認。**数値は仮説扱い、設計の方向性（高すぎる目標は逆効果）のみ採用**。
- [ ] **設計書44 への正仕様反映**: 本 rationale 確定後、`docs/design/44-チャレンジ設計書.md` の auto-challenge 節を本アルゴリズムで更新（What の SSOT）。

## 関連

- **議論源**: PO レビュー 2026-06-19 / dead setting 調査 2026-06-20
- **改修対象**: `src/lib/server/services/auto-challenge-service.ts` / 集計流用 `activity-log-aggregation.ts` / repo `auto-challenge-repo.ts`
- **影響を受ける設計書**: `docs/design/44-チャレンジ設計書.md` / `docs/design/26-ゲーミフィケーション設計書.md`
- **関連 ADR**: [ADR-0012 Anti-engagement](../decisions/0012-anti-engagement-principle.md) / [ADR-0010 Pre-PMF scope](../decisions/0010-pre-pmf-scope-judgment.md)
- **関連 Issue**: EPIC #2294②/#2296（競争撤去）/ #2446（per-child化）/ #2896（marketplace 非陳列）/ #2458-C（legacy table drop）/ #2278（retention 押し漏れ）

### 主要 Sources

- Fogg Behavior Model: https://www.behaviormodel.org/
- Bandura self-efficacy & habit (PMC8137900): https://pmc.ncbi.nlm.nih.gov/articles/PMC8137900/
- Interleaved practice (PMC8476370): https://pmc.ncbi.nlm.nih.gov/articles/PMC8476370/
- Flow Theory (Yu-kai Chou): https://yukaichou.com/gamification-analysis/flow-theory-complete-guide-csikszentmihalyi-optimal-experience/
- Duolingo streak blog: https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/
- Duolingo gamification case study: https://trophy.so/blog/duolingo-gamification-case-study
- Khan Academy Mastery (Sal Khan): https://support.khanacademy.org/hc/en-us/articles/360030753412-Why-Mastery-Learning-by-Sal-Khan
- DDA 参照（不採用上限）: https://arxiv.org/pdf/2106.03075
