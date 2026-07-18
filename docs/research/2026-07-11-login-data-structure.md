# ログインデータ構造の見直し — per-date 永続レコードの妥当性 deep-research (#3330)

**関連 Issue**: #3330 / **関連**: #3329 (backup 再設計) / ADR-0012 (anti-engagement) / ADR-0049 (保持期間)

本書は「ログインボーナスの per-date 永続レコード構造 (`SK=LOGIN#<date>`) が妥当か」を 6 観点で調査し、3 案（+ 機構再評価の派生論点）を比較する **調査比較資料**。採否の意思決定は ADR / 設計書で別途記録する（データ構造変更は PO 承認事項、ADR-0008）。

---

## 1. 現状構造（実装の事実）

### 1.1 データモデル

| backend | 格納形式 | キー |
|---|---|---|
| DSQL (`src/lib/server/db/dsql/login-bonus-repo.ts` / `dsql/schema.ts`) | `login_bonuses` 表、自然複合 PK `(family_id, child_id, login_date)` | 子供 × ログイン日 |
| SQLite (`src/lib/server/db/schema.ts` L315) | `login_bonuses` 表 + `uniqueIndex(child_id, login_date)` | 同上 |

1 レコードの内容: `loginDate` / `rank`（おみくじ）/ `basePoints` / `multiplier` / `totalPoints` / `consecutiveDays` / `createdAt`。

### 1.2 読み書き経路（`ILoginBonusRepo` 全 consumer）

| 経路 | 使い方 | 必要な情報 |
|---|---|---|
| `login-bonus-service.ts` `getLoginBonusStatus` | `findTodayBonus`（当日 claim 済判定）+ `findRecentBonuses(limit 60)` を遡って `consecutiveDays` 再計算 | **claimedToday + 連続日数のみ** |
| `login-bonus-service.ts` `claimLoginBonus` | 当日行の有無で冪等判定 → insert（`ON CONFLICT DO NOTHING`）。付与ポイントは **`point_ledger` に `type='login_bonus'` で別途記帳** | 当日行 1 件 + 連続日数 |
| child home (`(child)/[uiMode]/home/+page.server.ts`) | status 表示（連続日数 / claimedToday） | 同上 |
| export (`export-service.ts`) | `findRecentBonuses(childId, tenantId, 999999)` — **実質全件** を backup JSON に同梱 | 全件 |
| import (`import-service.ts`) | `findRecentBonuses(limit 365)` で重複検出しつつ復元 | 直近 365 件 |
| retention (`retention-cleanup-service.ts`, ADR-0049) | `deleteLoginBonusesBeforeDate` で cutoff 前を物理削除（free 90 日 / standard 365 日 / premium **無制限 = 削除なし**） | — |
| tenant 削除 / child データリセット | `deleteByTenantId` 等の全削除 | — |

**UI にログイン日カレンダーを表示する機能は存在しない**。per-date 履歴の consumer は「連続日数計算・当日冪等・backup」のみ。

### 1.3 増加量の概算

- 実本番 t-82c17558 CHILD#2: 2026-03-08 以降 66 件（約 4 ヶ月 ≒ 125 日で 66 = ログイン率 ~53%）。
- 上限: **1 子供 × 毎日ログイン = 365 件/年**。子供 3 人家族なら 580〜1,095 件/年。
- レコード単価は小さい（~200 bytes）が、**premium（`historyRetentionDays: null`）と NUC セルフホストでは retention 削除が走らず無限増加**。backup JSON（`MAX_EXPORT_ROWS = 999999` で実質全件）も利用年数に線形比例で肥大（#3329 と同根）。

---

## 2. 観点別調査結果（6 観点）

### 観点 1: gamification 設計の定石（OSS / 事例 4 件）

| 事例 | 保持方式 | 出典 |
|---|---|---|
| **Duolingo**（ログインストリークの代表例） | **少数フィールド縮約**: `current_streak_count` / `longest_streak_count` / `last_completed_date` / timezone。server が SSOT、mutation 時に `last_completed_date` と当日を比較して increment / reset。per-date ログは streak 判定に使わない | [Apptitude teardown](https://apptitude.io/blog/how-duolingos-streak-mechanic-actually-works/) / [実装ガイド](https://tigerabrodi.blog/implementing-a-daily-streak-system-a-practical-guide) |
| **Habitica**（OSS, [HabitRPG/habitica](https://github.com/HabitRPG/habitica)） | **counter 縮約**: task ごとの `streak` 整数 1 個。cron で未完了日にリセット。復元も counter の直接編集 | [Habitica Wiki: Streaks](https://habitica.fandom.com/wiki/Streaks) |
| **Loop Habit Tracker**（OSS, [iSoron/uhabits](https://github.com/iSoron/uhabits)） | **per-event ログ + 派生**: Repetitions（実施記録）を SSOT に持ち、streak / score は毎回導出（exponential smoothing）。ただし用途が「習慣履歴のカレンダー可視化」自体にあり、履歴 = プロダクト価値 | [FAQ discussion #689](https://github.com/iSoron/uhabits/discussions/689) |
| **Redis bitmap パターン**（確立パターン） | **bounded ビット列**: 1 日 = 1 bit（`SETBIT`）、365 日 ≒ 46 bytes/子。`BITCOUNT`/`BITPOS` で streak 導出 | [antirez: Bitmap Patterns](https://redis.antirez.com/community/bitmap-patterns.html) / [Redis docs](https://redis.io/docs/latest/develop/data-types/strings/bitmaps/) |

**結論**: 「ログインストリーク」用途の定石は **counter 縮約（Duolingo / Habitica 型）**。per-event ログを SSOT に置く uhabits 型は「履歴表示そのものが商品」の場合の選択であり、本アプリにはログインカレンダー UI が存在しないため該当しない。bounded window が必要な場合も bitmap 型で 46 bytes/年に収まる。

### 観点 2: 派生可能性（projection か本体か）

- 付与ポイントの事実は **`point_ledger`（`type='login_bonus'`、description におみくじ rank 込み）に既に二重記帳**されている。おみくじ結果の監査証跡は login_bonuses 行を消しても point_ledger 側に残る（point_ledger 自体も ADR-0049 retention 対象で同一ポリシー適用）。
- `consecutiveDays` は現在も **毎回 `findRecentBonuses(60)` から再計算する導出値**であり、行そのものは「導出のための材料」でしかない。
- streak 判定に本体として必要な最小状態は **`lastLoginDate` + `currentStreak` の 2 フィールド**（`claimedToday` は `lastLoginDate === today` で導出可）。60 行読む O(60) 計算が O(1) 参照になる。
- 当日冪等（1 日 1 回）は per-date 行の PK 衝突に依存しているが、**conditional write（DynamoDB `ConditionExpression` / SQL `UPDATE ... WHERE last_login_date <> :today`）で同等の原子性を担保可能**（Duolingo 型の標準実装）。

**結論**: per-date 行は projection の材料であり本体ではない。本体として保持すべき最小情報は `lastLoginDate` + `currentStreak`（任意で `longestStreak`。ただし現 UI に表示なし）。

### 観点 3: anti-engagement 整合（ADR-0012）

- ログインボーナス自体は「日次再訪」を促す engagement 機構であり、連続倍率テーブル（3 日 1.5x → 30 日 3.0x、`login-bonus.ts`）は連続ログイン継続への incentive。ADR-0012「滞在時間 = 価値毀損」と一定の緊張がある。
- 一方で現実装は (a) claim は home 表示に付随する 1 回のおみくじで連続ガチャ性なし、(b) 通知連打・喪失アバー（streak freeze 商品化等）を持たない、(c) ログイン = 活動記録の入口であり「記録する → 数秒で閉じる」動線と両立している。Duolingo 型の loss-aversion 演出（炎アイコン・freeze 課金）は不採用のまま。
- **機構自体の縮小 / 廃止（Issue 代替案 D）はプロダクト判断であり、本 research の scope（データ構造）と独立**。ただしどちらの判断でも counter 縮約（案 B）は有効: 機構継続なら最小状態で動き、廃止なら counter 2 フィールドの撤去で済む（per-date 全行の削除 migration より軽い）。

**結論**: データ構造の観点では「全ログイン日を恒久保存することが anti-engagement 上の必要性を持たない」ことが確認できた。機構の是非は PO 判断事項として切り出す。

### 観点 4: プライバシー / データ最小化

- per-date ログイン履歴は**子供の在席（presence）履歴**であり、家庭内専用でも「いつアプリを開いたか」の恒久記録は目的（streak 表示）に対して過剰。
- **COPPA 2025 改正**（2025-06-23 発効 / 2026-04-22 compliance 期限）: 子供の個人情報は「収集目的に合理的に必要な期間のみ」保持し、**無期限保持は原則許容されない**。書面の retention policy（目的・業務必要性・削除期限）が必須。[FTC press release](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data) / [Fenwick 解説](https://www.fenwick.com/insights/publications/what-the-amended-coppa-rule-means-for-data-retention-practices)
- **GDPR Art. 5(1)(c) data minimization / 5(1)(e) storage limitation**: 目的達成に必要な範囲・期間に限定。streak 表示の目的には counter 2 フィールドで足りる以上、全日履歴は minimization 違反方向。[Exabeam GDPR Article 5](https://www.exabeam.com/explainers/gdpr-compliance/gdpr-article-5-key-principles-and-6-compliance-best-practices/)
- 現状でも free/standard は retention 削除で 90/365 日に bounded だが、**premium と NUC は無期限**であり、プラン上位ほど保持リスクが増える逆転構造。

**結論**: data minimization 原則からは counter 縮約が明確に優位。per-date を残すなら少なくとも全プラン共通の bounded 化（retention 対象化）が必要。

### 観点 5: storage / backup 肥大

| 項目 | A: 現状 per-date | B: counter 縮約 | C: counter + bounded window |
|---|---|---|---|
| DB レコード数 / 子・年 | 最大 365 行（premium/NUC は無限累積） | **1 行（固定）** | 1 行 + 窓 N 日分（bitmap なら ~46 bytes） |
| backup JSON | 全件同梱（利用年数に線形比例、#3329 の肥大要因の 1 つ） | **2〜3 フィールド固定** | counter + 窓のみ |
| streak 計算 | 毎回 60 行 Query | O(1) 参照 | O(1) 参照 |
| import 重複検出 | `findRecentBonuses(365)` pre-fetch | 不要（counter 上書き/max 選択） | 窓のみ照合 |

**結論**: B は storage / backup / 読み取りコストの全てで優位。#3329（export 網羅 / backup 再設計）と同時に schema versioning すれば移行 1 回で済む。

### 観点 6: 保持期間ポリシー整合（ADR-0049）

- `login_bonuses` は既に ADR-0049 物理削除対象（#717 / #729、`deleteLoginBonusesBeforeDate`）。**free tier では 90 日超の履歴が既に消えており、システムは「全履歴がなくても成立する」ことを実運用が証明済**（longest streak の全期間再構成のような全履歴依存機能は存在しない）。
- 案 B 採用時は login_bonuses の retention 削除ロジック自体が不要になり、`retention-cleanup-service.ts` の対象テーブルが 1 つ減る（簡素化）。
- 案 A 維持時は「premium / NUC も含む全プラン共通の上限（例: 365 日）」を retention に追加しないと COPPA 2025 の無期限保持問題が残る。

**結論**: ADR-0049 とは B が最も整合的（削除すべき履歴が最初から生まれない = privacy by design）。A 維持なら ADR-0049 の premium 例外を login_bonuses に限り撤廃する改訂が必要。

---

## 3. 3 案比較

| | **A: 現状維持**（per-date 永続） | **B: counter 縮約**（推奨） | **C: ハイブリッド**（counter + 直近 N 日窓） |
|---|---|---|---|
| データ | `LOGIN#<date>` 行 × ログイン日数 | 子供ごとに `lastLoginDate` + `currentStreak`（+ 任意 `longestStreak`）の 1 状態 | B + 直近 N 日（例 60 日）の bounded ログ or bitmap |
| 当日冪等 | PK 衝突（実装済） | conditional write（`ConditionExpression` / `UPDATE ... WHERE last_login_date <> :today`） | 同左 |
| streak 計算 | O(60) Query 再計算 | O(1) | O(1) |
| 履歴カレンダー表示（将来） | 可能 | 不可（point_ledger から近似導出は可能） | 窓の範囲で可能 |
| COPPA/GDPR minimization | ✗（premium/NUC 無期限） | ◎ | ○（窓分は残る） |
| backup 肥大（#3329） | 線形増加 | 固定 | 準固定 |
| 移行コスト | 0 | **M**: repo interface 改訂 + 3 backend（dynamodb/dsql/sqlite）+ demo + export/import schema version + 既存行からの counter 導出 migration + retention 対象から除去 + E2E | M+（B の全てに加え窓の管理コード。OSS 定石上、窓の消費者がいないうちは YAGNI） |
| 定石整合 | uhabits 型（ただし履歴 UI がある製品向け） | **Duolingo / Habitica 型（ログインストリークの主流）** | Redis bitmap 型 |
| 残リスク | 無限増加・privacy・backup 継続 | 過去日の遡及修正（付け直し）は不可能になる — ただし現 UI にその機能なし。counter 破損時は 1 から再開（point_ledger で被害限定） | 複雑性が残る |

**Issue 代替案 D（機構自体の縮小 / 廃止）**: データ構造ではなくプロダクト判断（ADR-0012 の適用判断）。§2 観点 3 の通り本 research とは独立に PO が判断する。D を採る場合も B の縮約構造からの撤去が最も安価。

## 4. 推奨案

**案 B（`lastLoginDate` + `currentStreak` への縮約）を推奨する。**

根拠の要約:

1. ログインストリークの業界定石（Duolingo / Habitica）と一致し、OSS 先調査ルール（#1350）の要件を満たす確立パターン。
2. 全 consumer（claimedToday / consecutiveDays / 倍率 / 冪等）が 2 フィールド + conditional write で成立し、失う機能が現存しない（ログインカレンダー UI なし、付与事実は point_ledger が保持）。
3. COPPA 2025 / GDPR data minimization に構造で適合（privacy by design）。premium / NUC の無期限保持問題を根治。
4. backup 肥大（#3329）と retention 削除対象（ADR-0049）を同時に縮減。

移行時の注意（実装 Issue 側の要件）:

- 既存 per-date 行から `currentStreak` / `lastLoginDate` を導出する一括 migration（`findRecentBonuses` と同じ遡り論理）+ 旧行の削除。
- export/import の schema versioning（旧 backup の `loginBonuses[]` を読み込んで counter に fold する後方互換 import）— #3329 の backup 再設計と同一 PR 群での実施が効率的。
- 冪等の担保方式が PK 衝突 → conditional write に変わるため、race condition の回帰テスト（同時 claim 2 連発で 1 回のみ加点）を failing-test-first で先行（ADR-0061）。
- タイムゾーン境界（JST 固定 `todayDateJST`）は現行踏襲で影響なし。

## 5. 採否の次アクション

- 本書は AC① ②（6 観点 research + 推奨案・トレードオフ提示）に対応する。
- AC③（採否の ADR / 設計書反映）は **PO 判断後に実施**: 採用時は ADR 起票（データモデル決定 + ADR-0049 改訂）+ `08-データベース設計書.md` / `dsql-data-model.md` 同期 + 実装 Issue 切出し。機構自体の再評価（代替案 D）は別 Issue として PO に委ねる。
