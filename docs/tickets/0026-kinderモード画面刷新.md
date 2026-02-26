# kinderモード画面刷新

### ステータス

`Done`

### GitHub Copilot 対応: 部分的に可能

> コンポーネント構造の移行はCopilot対応可能。デザインガイドライン準拠のUI設計、アニメーション、Ark UIの活用はClaude Code主導。

---

### 概要

#0017 で実装した子供用画面を kinder モード（3-5歳向け）として刷新する。`docs/reference/幼児 子供向けデザインガイドライン.md` に準拠し、ヘッドレスUIコンポーネント（Ark UI）を最大限活用したUXを実現する。

### 背景・動機

現在の子供画面は基本機能を優先して実装したため、4歳児に最適化されたデザインとは言い難い。デザインガイドラインで定められた「大きなタップターゲット（80px以上）」「アイコン＋ひらがな」「アニメーション多め」「丸みのある角」「鮮やかな配色」等を適用し、子供が楽しく使えるUIに刷新する。

### 前提条件

- #0023 年齢帯別UI基盤・ルーティング移行（ルート構造が確定していること）
- #0024 実績システム実装（実績一覧・解除演出の表示）
- #0027 サウンドシステム実装（操作音の再生）

### ゴール

- [x] `src/routes/(child)/kinder/` 配下の画面刷新
  - [x] `kinder/home/+page.svelte` — サウンド統合・キャンセル・実績演出・特別報酬演出
  - [x] `kinder/achievements/+page.svelte` — 実績一覧（新規）
  - [ ] `kinder/history/+page.svelte` — 履歴画面刷新 → 後日
  - [ ] `kinder/status/+page.svelte` — つよさ画面刷新 → 後日
- [x] ナビゲーション「じっせき」タブ追加
- [x] サウンドシステム統合（レイアウトで初期化・プリロード）
- [x] 実績解除演出
  - [x] AchievementUnlockOverlay（レアリティ別スタイル + サウンド）
  - [x] 複数解除時の連続表示
- [x] 特別報酬受取演出
  - [x] SpecialRewardOverlay（サウンド + localStorage表示済み管理）
- [x] 誤入力キャンセル機能
  - [x] 記録結果ダイアログに「とりけし」ボタン + カウントダウン
  - [x] cancelRecord サーバーアクション（cancelActivityLog連携）
- [x] 既存テスト全パス維持（406件）

### 技術方針

- `$lib/features/kinder/` に kinder 固有のコンポーネントを配置
- 共通 Ark UI プリミティブ（Dialog, Tabs, Progress 等）はそのまま再利用
- CSS カスタムプロパティで年齢帯の差分を吸収
- アニメーションは CSS `@keyframes` + Svelte `transition:` / `animate:`
- BottomNav の項目に「じっせき」タブを追加

### 作業メモ

-

### 成果・結果

- レイアウト修正: BottomNav に「じっせき」タブ追加、サウンド初期化（configure + preload）
- ホーム画面刷新: record アクションで unlockedAchievements/logId/cancelableUntil 返却、cancelRecord アクション追加、特別報酬 load 追加
- 新規コンポーネント: AchievementUnlockOverlay（レアリティ別スタイル・複数連続表示）、SpecialRewardOverlay（localStorage 表示済み管理）
- 実績ページ新規: achievements/+page.server.ts + +page.svelte（グリッド表示・詳細ダイアログ・レアリティ色分け）
- 誤入力キャンセル: 結果ダイアログに「とりけし」ボタン + カウントダウン表示
- check / vitest / biome 全クリア（既存テスト406件パス維持）

### 残課題・次のアクション

- E2Eテスト
- lower/upper/teen モードの実装は別チケット
