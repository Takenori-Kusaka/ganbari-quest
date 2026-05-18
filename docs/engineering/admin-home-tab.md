# 管理画面 ホームタブ コンテンツ設計書

| 項目 | 内容 |
|------|------|
| Issue | #1394 (Sub A of umbrella #1393) |
| 版数 | 1.0 |
| 作成日 | 2026-04-26 |
| 作成者 | Dev セッション |
| ステータス | Committed |

---

## §1 設計背景

### 1.1 現状の課題

現在の `/admin` ホーム画面（`AdminHome.svelte`）は、以下の項目を縦積みで表示している。

1. プレミアム歓迎カード（初回のみ）
2. オンボーディングチェックリスト（未完了時）/ 完了バナー（完了後）/ チュートリアルバナー（フォールバック）
3. 全チュートリアル導線カード（常時）
4. 通知許可バナー（常時）
5. PlanStatusCard（planStats 取得時）/ プランアップグレードクイックリンク
6. 季節コンテンツ情報（イベント存在時）
7. サマリーカード（こどもの数・合計ポイント）
8. 今月のがんばり（子供別 月次サマリ）
9. こども一覧（ChildListCard）
10. デモ CTA（デモモード時のみ）

この構造は成長とともにアドホックに追加されており、以下の問題を抱えている。

- **セットアップ未完了 ユーザーと運用中ユーザーが同じ画面**を見ている
- セットアップ完了後も「オンボーディングチェックリスト」のスペースが残り、UX が一貫しない
- ホームの「役割（今 "now" の状況把握）」が曖昧になっている

### 1.2 解決したい UX ゴール

- **新規ユーザー**: 次に何をすべきかが一目でわかる（セットアップ完了まで誘導）
- **運用中ユーザー**: 「今日/今週の子供たちの状況」が開いた瞬間に把握できる
- 両者が同じコンポーネントを共有しながら、状態に応じて最適コンテンツを表示する

### 1.3 記録・分析 tab との役割分担

| tab | 時間軸 | ユーザーの問い |
|-----|--------|--------------|
| **ホーム** | "今 / 今日" | 「今子供たちは何をしているか？今日がんばったか？」|
| **記録** | "過去 / 期間全体" | 「先月の実績は？どの活動が多い？成長を振り返りたい」|

ホームは「開いた瞬間に今の状態が分かる」ことを最優先とし、長期トレンドや詳細分析は記録 tab に委ねる。

---

## §2 設計原則

1. **状態ドリブン表示**: セットアップ完了状態（`onboarding.allCompleted`）を主軸にコンテンツを切り替える
2. **最短経路**: セットアップ未完了時は次のアクションへの誘導のみ。余分なコンテンツを出さない
3. **"now" フォーカス**: 完了後コンテンツはすべて「今日・今週」の情報に限定する
4. **既存 data source の再利用**: 新規クエリは最小限。既存テーブルで賄えるものを優先

---

## §3 仕様

### 3.1 状態判定ロジック

ホーム画面は `onboarding.allCompleted && !onboarding.dismissed` の値で 2 状態に分岐する。

| 条件 | 表示状態 |
|------|--------|
| `onboarding` が `null` または `allCompleted === false` かつ `dismissed === false` | セットアップ未完了状態 |
| `allCompleted === true` または `dismissed === true` | セットアップ完了状態 |

> **注**: `dismissed === true` はユーザーが「非表示」を押した場合。完了 / 非表示どちらでも完了後 UI に切り替わる。

### 3.2 セットアップ未完了時のコンテンツ構成 [Committed]

現行実装に対応する。`OnboardingChecklist` コンポーネントおよび周辺 UI はそのまま維持する。

```
[セットアップ未完了時]
├── OnboardingChecklist（大）          ← 既存 onboarding-checklist, 6ステップ
├── PlanStatusCard / プランバナー      ← トライアル残日数・プラン状態
└── くわしいガイドを開く（tutorial-full-guide-card）
```

**現行実装との対応**:

- `OnboardingChecklist` — `src/lib/features/admin/components/OnboardingChecklist.svelte`
- `PlanStatusCard` — `src/lib/features/admin/components/PlanStatusCard.svelte`
- `tutorial-full-guide-card` — `AdminHome.svelte` 内のインライン div

### 3.3 セットアップ完了後のコンテンツ構成

#### 3.3.1 Committed（現行実装済み）

以下は `AdminHome.svelte` に実装済みであり、完了後も継続して表示する。

```
[セットアップ完了時 — Committed]
├── サマリーカード（こどもの数・合計ポイント）       ← data-tutorial="summary-cards"
├── 今月のがんばり（子供別: 活動回数・レベル・実績）  ← data-tutorial="monthly-summary"
│   └── data source: getAllChildrenSimpleSummary()
│       テーブル: activities, achievements, child_status
├── こども一覧（ChildListCard）                       ← data-tutorial="children-overview"
└── PlanStatusCard / プランバナー                     ← トライアル・プラン状態
```

#### 3.3.2 Aspirational（未実装 — 将来計画）

以下は Issue #1394 で提案された案 X の「今日のサマリ」セクション。現時点では未実装であり、
Sub C (#1396) 実装時に改めて要件定義・設計を行う。設計が固まるまで既存の「今月のがんばり」
セクションがこの役割を代替する。

```
[セットアップ完了時 — Aspirational（未実装）]
├── 今日のサマリ（子供別）
│   ├── 達成したチャレンジ数
│   ├── もらったおうえん数
│   └── 今日の獲得ポイント
├── 最近のお知らせ（アプリ更新 / トライアル残日数）
└── クイックアクション（おうえん送る / ごほうび追加）
```

**想定データソース（Aspirational）**:

| 項目 | テーブル | クエリ概要 |
|------|---------|-----------|
| 今日の達成チャレンジ数 | `challenges` / `challenge_logs` | `WHERE date = today AND completed = true` |
| 今日のおうえん数 | `messages` | `WHERE created_at >= today AND type = 'encouragement'` |
| 今日の獲得ポイント | `point_transactions` | `WHERE created_at >= today AND child_id = X` |

> これらのテーブルの存在は設計書として確認済みだが、クエリの実装は #1396 のスコープ外。
> 実装時は `08-データベース設計書.md` と整合を取ること。

### 3.4 デモモード

デモモード（`mode === 'demo'`）では以下の差分がある。

- `OnboardingChecklist` は非表示（`!isDemo` ガード）
- `PlanStatusCard` は非表示
- `tutorial-full-guide-card` は非表示
- デモ CTA カード（「無料で始める」ボタン）を最下部に表示

### 3.5 既存 data source 対応表

| コンポーネント/セクション | data source | サービス |
|--------------------------|-------------|---------|
| OnboardingChecklist | `getOnboardingProgress()` | `onboarding-service.ts` |
| PlanStatusCard | `getPlanLimits()`, `parentData.planTier` | `plan-limit-service.ts` |
| サマリーカード | `getAllChildren()`, `getPointBalance()` | `child-service.ts`, `point-service.ts` |
| 今月のがんばり | `getAllChildrenSimpleSummary()` | `report-service.ts` |
| こども一覧 | `getAllChildren()` + `getChildStatus()` | `child-service.ts`, `status-service.ts` |
| 季節コンテンツ | `findActiveEvents()`, `getMemoryTicketStatus()` | `seasonal-content-service.ts` |

---

## 関連ドキュメント

- `docs/design/admin-ia.md` — #1395 IA 再設計（3 tab の配置決定）
- `docs/design/06-UI設計書.md` — 管理画面 UI コンポーネント仕様
- `src/lib/features/admin/components/AdminHome.svelte` — 実装
- `src/lib/features/admin/components/OnboardingChecklist.svelte` — オンボーディング UI
- `src/lib/server/services/onboarding-service.ts` — セットアップ完了状態ロジック
