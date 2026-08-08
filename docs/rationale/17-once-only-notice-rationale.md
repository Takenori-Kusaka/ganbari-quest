# 「一度見せたら次から出さない」機構 設計経緯

## 議論の発端

- **日時**: 2026-08-07
- **発端 Issue / セッション**: #4432（PR #4421 / #4410 で 4 例目が増えたことを受けた実態調査）
- **問題意識**: `shown_at` 列 + 記録 action で「一度見せたら次から出さない」を実現する実装が 4 例に増えた。CLAUDE.md §補佐設計品質ガード 6 は「3 つ目の類似 service / component の前に Strategy / Factory / Registry 適用判断」を求めており、既に 1 例超えている。**共通化すべきか**を実測で判断する。

**結論: 共通化しない。** 抽象ではなく「新規実装時の選択基準 + 満たすべき条件」で揃える。根拠は以下。

---

## 実態調査の結果

### 発端の前提が誤っていた — 4 例ではない

`shown_at` という**列名で探すと 4 例**だが、「一度見せたら次から出さない」を実現している実装を機能で探すと **4 種類の媒体にまたがる約 20 例**ある。

| 媒体 | 例数 | 代表 |
|---|---|---|
| A. 行に「見せた時刻」を刻む（per-row timestamp 列） | **5** | `special_rewards.shown_at` / `parent_messages.shown_at` / `sibling_cheers.shown_at` / `child_challenges.celebration_shown_at` / `reward_redemption_requests.shown_to_child_at` |
| B. settings KVS に「見せた」を置く | **11** | `ui_mode_change_notice:<childId>` / `habit_certificate_notice:<childId>` / `trial_expiration_modal_shown` / `premium_welcome_shown` / `pin_gate_onboarding_seen` / `onboarding_dismissed` ほか |
| C. localStorage（端末ローカル） | 4 | `gq:milestone-seen:*`（2 コンポーネントに複製）/ `child_tutorial_hint_shown_*` / `ganbari-page-guide-completed` / `tutorial-progress-*` |
| D. cookie | 1 | `trial_was_active`（active→inactive 遷移を 1 回だけ検知して delete） |

つまり Issue が数えた「4」は **A の 5 例のうち 4 例**であり、`reward_redemption_requests.shown_to_child_at`（`integer` epoch、命名も `shown_to_child_at`）が漏れていた。列名 grep で数えたことが原因。

**B / C は既にそれぞれ内部で揃っている。** B は `habit-certificate-notice-service.ts` 冒頭が「#4313 (`ui-mode-change-notice-service`) と同じ root class で、**その流儀に揃える**（観測・保存の形を 2 つ持たない）」と明記し、既読を空文字 upsert で表す規約まで文書化済み。さらに `export-format.ts` の `EXPORTABLE_SETTING_KEYS` / `SECRET_SETTING_KEYS` / `NON_EXPORTABLE_SETTING_KEYS` が全キーの分類 SSOT で、`settings-backup-classification.test.ts` が未分類キーを CI で fail させる（no-silent-gap）。**共通化の議論が意味を持つのは A の 5 例だけ**なので、以下は A に絞る。

### 観点 1〜3: A の 5 例は同型ではない

| # | 列 | 何を「見せた」と記録するか | 読み（表示対象の解決） | 書き手 | 冪等性 | 所有権の検証 | 稼働 |
|---|---|---|---|---|---|---|---|
| A1 | `special_rewards.shown_at` | 特別報酬付与の演出を 1 件 | repo SQL: `IS NULL` + `ORDER BY granted_at DESC LIMIT 1` | REST `POST /api/v1/special-rewards/[id]/shown`（fetch、失敗時 1 回再送 → warn） | **なし**（WHERE に `IS NULL` を含まず、再送で初回時刻を上書き） | WHERE に `(child_id, reward_id)` 複合 | **停止中**（load が `Promise.resolve(null)` 固定、#4172 決裁で子への演出を出さない） |
| A2 | `parent_messages.shown_at` | 親からのメッセージを 1 件 | repo SQL: `IS NULL` + `ORDER BY sent_at DESC LIMIT 1`、加えて未読数 `COUNT(*)` | REST `POST /api/v1/messages/[id]/shown`（同上） | **なし** | WHERE に `(child_id, message_id)` 複合 | 稼働 |
| A3 | `sibling_cheers.shown_at` | きょうだいのおうえんを**全件** | repo SQL: `IS NULL`（LIMIT なし、リストを返す） | form action `?/markCheersShown`（id 配列を CSV で受ける） | **なし** | **どのレイヤにも無い**（WHERE は `family_id` + `cheer_id IN (...)` のみ） | 稼働 |
| A4 | `child_challenges.celebration_shown_at` | チャレンジ達成の祝福を 1 件 | **専用クエリなし**。既に読み済みの一覧に対し TS の `resolveCelebrationChallenge` が `allCompleted && celebrationShownAt === null` で絞る | form action `?/markChallengeCelebrationShown` | **あり**（WHERE に `IS NULL`、初回時刻を保つ） | service 層で `findById` → `childId` 比較（false なら 400） | 稼働 |
| A5 | `reward_redemption_requests.shown_to_child_at` | 交換申請の承認/却下通知を 1 件 | repo SQL: `IS NULL` + `status IN ('approved','rejected')` + reward snapshot の `LEFT JOIN` + `ORDER BY resolved_at DESC LIMIT 1` | — | **なし** | WHERE に `(child_id, id)` 複合 | **死んでいる**（read `getUnshownRedemptionResult` / write `markRedemptionShown` とも production 呼び出し元ゼロ、参照は unit test のみ） |

同型なのは **`IS NULL` を「まだ見せていない」の意味に使っている 1 点だけ**。それ以外は全部違う:

- **読みの形が 4 通り**（最新 1 件 / 全件リスト / 専用クエリを持たず TS 側で追加述語つき filter / status 条件 + JOIN snapshot 付き 1 件）。A4 は「クエリ」ですらない
- **書き手が 3 通り**（REST エンドポイント / form action・単一 id / form action・id 配列）。しかも A1・A2 の REST は 1 回再送、A4 は `use:enhance`、B の habit notice は `keepalive: true` の自動発火と、失敗時の届け方も揃っていない
- **冪等性が 5 例中 1 例だけ**。A4 のみ `IS NULL` を WHERE に含む。他 4 例は再送で「最初に見せた時刻」が上書きされる
- **所有権の検証が 3 通り**（WHERE の複合キー 3 / service 層 1 / **無し 1**）
- **列の型すら違う**（A1〜A4 は `text` の ISO 文字列、A5 は `integer` epoch 秒）
- **5 例中 2 例が生きていない**（A1 は経路を保持したまま読みを停止、A5 は完全に到達不能）

**この非同型は既に実害を出している。** `child-challenge-repo.interface.ts` と `SiblingCelebration.svelte` のコメントは A4 を「`sibling_cheers.markShown` / `parent_messages` の `shown_at` と**同型**」と書いているが、実際には A4 だけが冪等で、A3 には所有権検証が無い。**名前の相似が実装の相似だと誤読された例が既に本体コード内にある。**

### 観点 4: 共通化して何が減るか — ほとんど減らない

A の read/write メソッドは `src/lib/server/db/` 配下 25 file に 67 箇所ある（sqlite / dsql / demo の 3 backend × interface）。仮に `ShownFlagRegistry<T>` 相当を作った場合に消せるのは:

- **消せる**: `IS NULL` の述語 1 個 × 5 例。`markX` の「now() を set する」1 行 × 5 例
- **残る**: 各 read の本体（`ORDER BY` / `LIMIT` / `LEFT JOIN` / `status IN` / A4 の TS filter）、3 backend 分の SQL 方言（sqlite は drizzle query builder、dsql は raw SQL、demo は fixture の in-memory filter）、interface 宣言、各エンドポイント / form action、テスト

つまり**列定義は 1 本も減らず、repo メソッドは実質減らず、テストも減らない**。減るのは `isNull(...)` という 1 語であり、それを共有するために型パラメータ付きの registry を通すのは割に合わない。Issue の判定基準「減らないなら共通化しない」に該当する。

### 観点 5: 共通化して何が固くなるか

1. **差分が options bag に化ける。** 冪等性 (2 値) × 所有権の掛け方 (3 通り) × 読みの形 (4 通り) × 書き手 (3 通り) を 1 つの抽象で吸収すると、コールサイトは `registry.markShown(id, { idempotent: true, ownership: 'composite', ... })` になる。**「この機構は所有権を見ているか」がコールサイトから読めなくなる** — A3 の欠落を見つけられたのは repo の WHERE 句を直接読めたからで、options 越しでは埋もれる
2. **DSQL の tenant 単一強制点が緩む。** dsql repo は raw SQL で `family_id = ${tenantId}` を必ず前置する（ADR-0063 の単一強制点、fitness function が静的検査する）。generic な shown-flag 層を挟むと述語の組み立てが動的になり、この検査が効かなくなる。**マルチテナント分離という一番落としてはいけない不変条件を、演出の重複排除のために弱める**取引になる
3. **媒体の選択が隠れる。** A / B / C / D の選択（DB 行に紐づくのか、子に 1 本なのか、端末ローカルでよいのか）は寿命と粒度の設計判断で、これが新規実装で最初に間違えやすい点。A の中だけを抽象化すると「まず A を使う」が既定になり、settings KV で足りるものまで不可逆なスキーマ変更に流れる（`habit-certificate-notice-service.ts` が明示的に避けた失敗）

---

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A | `ShownFlagRegistry` / `ImportStrategy` 型の Registry に 5 例を寄せる | ADR-0052（marketplace 5 type）の前例。CLAUDE.md §補佐設計品質ガード 6 が求める検討対象 |
| 案 B | repo に薄い共通 helper（`markShownIdempotent(table, idCol, where)` 等）だけ置く | 抽象を最小にして冪等性だけ揃える折衷案 |
| **採用案** | **共通化しない。** 新規実装時の「媒体の選択基準」と「A を選んだ場合に満たすべき 3 条件」を規約として残し、既存の逸脱は個別に直す | 5 例が同型でなく、共通化しても減らないため |

## 棄却理由

- **案 A 棄却理由**: 上記「観点 4 / 5」の通り。減るのは述語 1 語、失うのは所有権・冪等性のコールサイト可読性と DSQL tenant 述語の静的検査。ADR-0052 が成立したのは marketplace 5 type が **同一の入出力契約（schema 検証 → child binding → 取込）を持っていた**からで、A の 5 例にはその共通契約が無い（読みの形が 4 通りある時点で契約が定義できない）
- **案 B 棄却理由**: 冪等性を揃えたいだけなら、helper を作らず**各 repo の WHERE に `IS NULL` を足す**方が短く、diff も読める（A4 が既にその形）。helper は 3 backend の方言差（drizzle query builder / raw SQL / in-memory）を跨げず、結局 backend ごとに 3 実装になる。抽象の導入コストが節約分を上回る

## 採用案とその理由

**共通化せず、揃えるべきものを「抽象」ではなく「選択基準 + 条件」で揃える。**

`docs/design/parallel-implementations.md` に「一度だけ見せる」機構の並行実装エントリを追加し、以下を記載する（本 rationale が Why、あちらが What）。

### 媒体の選択基準（新規実装はここから）

| 何を記録するか | 媒体 | 例 |
|---|---|---|
| 特定の 1 行（メッセージ・報酬・チャレンジ）を見せたか | A: その行に timestamp 列 | `parent_messages.shown_at` |
| 子 / テナントに 1 本の一時的な未読告知 | **B: settings KV**（列追加は不可逆なので避ける） | `habit_certificate_notice:<childId>` |
| 端末ローカルで十分な UI ガイド（機種変で再表示されてよい） | C: localStorage | `ganbari-page-guide-completed` |

### A を選んだ場合に必ず満たす 3 条件

1. **冪等にする** — `UPDATE ... WHERE ... AND <col> IS NULL`。再送で「最初に見せた時刻」を上書きしない
2. **所有権を検証する** — WHERE に `(child_id, <id>)` の複合キーを含めるか、service 層で `findById` → `childId` 一致を確認する。`family_id` だけでは同一家族内の別の子の行を閉じられる
3. **表示可否の根拠を client の `$state` に置かない** — load 側で `IS NULL` を解決する（#4410 で確立）。`$state` はマウントのたびに初期値へ戻るため、根拠にすると再表示される

この 3 条件は 4 行のチェックリストであり、抽象を導入せずに次の実装者へ渡せる。**5 例目が来たときに参照すべきは registry ではなくこの表**。

---

## 残された懸念・フォローアップ

本調査で見つかった A の規約逸脱。**本 Issue では実装しない**（#4432 は判断が成果物）。下 3 件は **#4435** に切り出した。

- [ ] **A3 `sibling_cheers.markShown` に所有権検証が無い** — `?/markCheersShown` は cheer id の配列を受け、repo の WHERE は `family_id` + `cheer_id IN (...)` のみ。service も素通し。同一家族内の別の子の未読おうえんを既読化できる（IDOR、影響は「きょうだいの演出が出なくなる」で限定的だが、A1 / A2 / A5 が `#2845 課題①` で潰した穴が A3 だけ残っている）
- [ ] **A1 / A2 / A3 / A5 の mark が非冪等** — WHERE に `IS NULL` が無く、再送・二重送信で初回表示時刻が上書きされる。A4 のみ対処済み。上記「条件 1」への横展開。**なお guard を足すだけでは足りない mark がある**: 行を返す A1 / A2 は 0 行が「既に既読」と「他人の子の行」の両方を意味してしまい、`/shown` endpoint の 404 が担っていた所有権シグナル（#2845）が壊れる。guard + 0 行時に所有権を満たす行を読み直すところまでが是正の単位（#4440 で採用された形）
- [ ] **A5 が死んでいる** — `getUnshownRedemptionResult` / `markRedemptionShown` に production 呼び出し元が無く、参照は unit test のみ。列・repo・service・test が生きたまま残っているため、grep では「動いている機構」に見える。**#4435 / PR #4440 の判断は「繋がずに撤去」**: 子への承認 / 却下の伝達はごほうびショップのカードのバッジ（`latestRequestStatus`）と履歴画面が既に担っており、ホームに一度きりの全画面 overlay を足すのは ADR-0012 に反するため。列だけは backup 往復の忠実性のため残置し、撤去の終了条件を `schema.ts` の列コメントに置く（#3442 と同じ書き方）
- [ ] **C の `gq:milestone-seen:*` が 2 コンポーネントに複製されている** — `MilestoneBanner.svelte` と `MilestoneBellButton.svelte` が同じキー prefix の read/write を各自持つ。A の話とは別クラスターだが、同じ「一度だけ見せる」の重複として記録しておく

## 関連

- **後続 Issue**: #4435（A の規約逸脱 3 件の是正）
- **議論源 Issue / PR**: #4432（本調査）/ #4421・#4410（A4 の追加）/ #4261 ③・#4313（B の 2 例）/ #4172（A1 の読み停止）/ #2845 課題①（A1・A2・A5 の所有権検証）
- **影響を受ける設計書**: `docs/design/parallel-implementations.md`（「一度だけ見せる」機構のエントリ）
- **関連 ADR**: [ADR-0012](../decisions/0012-anti-engagement-principle.md)（再表示は滞在時間の押し付け）/ [ADR-0052](../decisions/0052-marketplace-type-registry.md)（Registry が成立する条件との対比）/ [ADR-0063](../decisions/0063-dsql-pool-multitenant-isolation.md)（tenant 述語の単一強制点）
