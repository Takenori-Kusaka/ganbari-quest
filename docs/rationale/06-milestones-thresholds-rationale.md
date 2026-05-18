# MILESTONES thresholds 設計経緯

<!-- 命名規則: 06-milestones-thresholds-rationale.md -->

## 議論の発端

- **日時**: 2026-05-17
- **発端 Issue**: #2174 (refactor: MILESTONES thresholds 妥当性検証)
- **関連 Issue**: #1600 (ADR-0023 I9 初月価値プレビュー体験)
- **問題意識**: 初月価値プレビュー (`src/lib/server/services/value-preview-service.ts`) の `MILESTONES` 閾値 (`records_5 = 5回 / records_10 = 10回 / streak_7 = 7日 / streak_14 = 14日 / streak_30 = 30日`) を導入時 (#1600) に深い prior art 比較なしで決めていた。Phase Milestone-Notification-UX 一次確認の過程で **Pokémon Unite 3 段階トロフィー** や **Duolingo streak** の業界事例を発見、現状値が業界 prior art と整合しているか検証する必要が出てきた。Pre-PMF 段階で閾値変更は dogfood リスクが高いため、本 rationale は **検証 + 妥当性評価** に留め、実装変更は別 Issue 判断とする。

## 検討した代替案

ここでは「閾値構造そのもの」を選定対象として、業界 prior art と現状値を 4 案で比較する。

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A: 現状維持 (6 段階 = 1/5/10 + 7/14/30) | first_record / records_5 / records_10 + streak_7 / streak_14 / streak_30 | #1600 で実装した初期値 |
| 案 B: Pokémon Unite 模倣 (3 段階 Bronze/Silver/Gold) | records と streak それぞれ 3 段階に圧縮 (例: 1/5/15 + 7/30/90) | Pokémon Unite achievement system は子供にも到達可能な「Beginner/Expert/Master」3 段階で過剰段階化を避けている |
| 案 C: Duolingo 模倣 (7 日中心) | 7 日 = habit 形成境界に絞り、それ以下/以上は装飾扱い | Duolingo blog 公式データ: 7 日達成者は翌日継続率 2.4 倍。30/100/365 等の上位は祝福用 (本機構の Anti-engagement と直接矛盾しない範囲で) |
| 案 D: Khan Academy / 学習 SaaS 模倣 (粒度大、4 段階) | 1 / 10 / 50 / 100 等の指数的段階 | 子供向け学習 SaaS は段階間距離を大きく取り、各到達体験を希少化する |

## 棄却理由

### 案 B 棄却理由 (Pokémon Unite 3 段階模倣)

- **3 段階化のメリット**は理解できるが、現行案 A は **records 系 3 段階 (1/5/10) + streak 系 3 段階 (7/14/30) = "2 軸 3 段階"** という構造であり、Pokémon Unite の単一軸 3 段階より情報量が多い (`docs/design/26-ゲーミフィケーション設計書.md §4e.3` 参照)
- Pokémon Unite の Bronze/Silver/Gold は **対戦実績** の段階表現で、本機構の **記録継続性** とは性質が異なる
- 圧縮するなら閾値変更が必要 (例: streak_14 を streak_30 / streak_90 にシフト) だが、子供 (preschool 3-5 歳) には 90 日連続は心理的に遠すぎる
- ADR-0012 Anti-engagement 観点: 段階を減らすと到達感も減るため、Pre-PMF 段階での "小さな達成感の機会数" が確保できない

### 案 C 棄却理由 (Duolingo 7 日特化)

- Duolingo 公式データの 7 日 = 2.4 倍継続率は本機構にとっても極めて重要な示唆だが、本アプリは **記録 = 親→子代理入力が主** であり、Duolingo (本人入力) と継続インセンティブの主体が異なる
- 7 日のみに絞ると **5 件記録達成 (records_5)** という親側にとっての「初月 1 週分の dataset 到達」感が出ない
- 現行案 A は **Duolingo 7 日境界を `streak_7` として確実に含めている**ため、Duolingo prior art の核心は既に取り入れ済み
- 30 日 = 月境界 (`streak_30`) も「定期サブスクの 1 ヶ月」と整合性があり、解約判断タイミング指標として親レポートで意味を持つ

### 案 D 棄却理由 (粒度大、指数段階)

- 1 / 10 / 50 / 100 のような指数的段階は **MAU (Monthly Active User) が安定した PMF 後の段階** に適する設計
- Pre-PMF 段階で 50 件記録到達まで 1 ヶ月以上かかる設計だと、初月体験 (#1600 ADR-0023 I9) として価値訴求が成立しない
- 「初月の 30 日以内に複数回到達体験を得る」設計目的と矛盾する

## 採用案とその理由

**案 A (現状維持) を採用。`MILESTONES` 6 段階 (records_1 / records_5 / records_10 / streak_7 / streak_14 / streak_30) は Pre-PMF 段階で妥当**。

### 妥当性評価サマリ

| 段階 | 現状値 | 業界 prior art | 評価 |
|-----|------|------|----|
| records_1 (`first_record`) | 1 回 | Pokémon Unite Beginner achievement / Duolingo 1 日目祝福 | **整合**: 業界標準の「初回到達」体験 |
| records_5 | 5 回 | Khan Academy 「最初の 5 問」型マイルストーン / 一般的 onboarding KPI | **整合**: 親の dataset 認識点として 5 件は計画立てが立つ最小単位 |
| records_10 | 10 回 | Pokémon Unite Expert tier の「短期累積」スケール / 一般的 product onboarding 推奨 | **整合**: 「2 桁達成」の心理的節目 |
| streak_7 | 7 日 | Duolingo 公式: 7 日達成者は翌日継続率 2.4 倍 / 一般的 habit formation 文献 | **強整合**: prior art 最強の根拠を持つ閾値 |
| streak_14 | 14 日 | Duolingo / Sylvi 等 streak SaaS の中間段階 | **整合**: 7 → 30 の中間として「もう一息」体験を提供 |
| streak_30 | 30 日 | Duolingo 30 日 milestone / 月境界 / サブスク 1 ヶ月境界 | **強整合**: 月境界 + サブスク解約判断と整合 |

### Pre-PMF 採用判断のポイント

1. **Duolingo 7 日の核心を確実に含めている** — 業界で最強の継続率データを持つ閾値が現行案にすでに採用済み
2. **2 軸 (count / streak) × 3 段階構造** が情報量と認知負荷のバランスとして適切 — Pokémon Unite 単一軸より親レポートでの「子供がどの軸で伸びているか」可視化に有利
3. **30 日 = 月境界 = サブスク解約判断点** — Pre-PMF 段階で「30 日連続できた家庭は解約しない」という business hypothesis を計測する dataset として機能する
4. **Anti-engagement (ADR-0012) との整合** — 6 段階だが UI は「達成済みのもの 1 件のみ表示 + 閲覧済みは localStorage で永続抑制」(`docs/design/26-ゲーミフィケーション設計書.md §4e.4`) のため、段階数増加が滞在時間延伸に直結しない
5. **baby モード非対象** (ADR-0011 整合) — 0-2 歳「親の準備モード」では本機構は表示されないため、子供向け過剰演出リスクなし

### 業界 prior art と現行案の関係図

```
Duolingo blog (公式データ)         Pokémon Unite (achievement)
    │                                 │
    │ 7 日 = 継続率 2.4 倍              │ Bronze / Silver / Gold (3 段階)
    │ 30 日 = 月境界 milestone           │ Beginner / Expert / Master (3 階層)
    │                                 │
    ▼                                 ▼
    ├──────── 現行案 (案 A) ──────────┤
    │                                 │
    │  records 軸 3 段階: 1 / 5 / 10   │ ← Pokémon Unite 3 段階構造を模倣
    │  streak 軸 3 段階: 7 / 14 / 30   │ ← Duolingo 7 日核心 + 月境界
    │                                 │
```

### 業界 prior art ソース

- [The Duolingo Streak Uses Habit Research to Keep You Motivated](https://blog.duolingo.com/how-duolingo-streak-builds-habit/) (Duolingo 公式 blog)
- [Improving the streak: Forming habits one lesson at a time](https://blog.duolingo.com/improving-the-streak/) (Duolingo 公式 blog)
- [The Psychology Behind Duolingo's Streak Feature](https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature)
- [Pokemon Unite Ranking System and Ranked Guide](https://game8.co/games/Pokemon-UNITE/archives/336136) (game8.co)
- [Achievement (UNITE) - Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Achievement_(UNITE))
- [Pokemon Unite: All Symbols and Their Meaning - GameRant](https://gamerant.com/pokemon-unite-medals-symbols-meaning/)

## 残された懸念・フォローアップ

- [ ] **PMF 後の閾値再評価** — MAU が安定し dataset が貯まったら、実データ (records_X / streak_X 到達率分布) に基づき再評価。例えば `streak_30` 到達率が極端に低ければ `streak_21` 等の中間段階追加判断
- [ ] **段階追加候補** — Duolingo の `100 日 / 365 日` 等のロングテール streak は **本機構では現時点で不要**。理由: 初月価値プレビュー (#1600) の scope は「最初の 30 日」であり、長期 streak は別機構 (称号 / バッジ #1782 廃止済) で扱う
- [ ] **閾値変更が必要になった場合の影響範囲** — 変更時は以下も同期更新:
  - `src/lib/server/services/value-preview-service.ts` の `MILESTONES` 定数
  - `docs/design/26-ゲーミフィケーション設計書.md §4e.3` の表
  - `src/lib/domain/labels.ts` の `MILESTONE_LABELS`
  - `tests/unit/server/services/value-preview-service.test.ts` (集計テスト) — 該当 test の閾値依存箇所
- [ ] **実装側 follow-up なし** — 本 rationale は「現状値妥当」結論のため、別 Issue 起票不要 (Issue #2174 AC3)

## 関連

- **議論源 Issue**: #2174 (本 rationale 起点)
- **影響を受ける設計書**: `docs/design/26-ゲーミフィケーション設計書.md §4e.3 マイルストーン定義`
- **関連 ADR**: [ADR-0012 Anti-engagement 原則](../decisions/0012-anti-engagement-principle.md) / [ADR-0011 baby モードは親の準備モード](../decisions/0011-baby-mode-as-parent-preparation.md)
- **実装 SSOT**: `src/lib/server/services/value-preview-service.ts` の `MILESTONES` 定数
- **派生 Issue**: #1600 (ADR-0023 I9 初月価値プレビュー体験、本機構の親 Issue)
