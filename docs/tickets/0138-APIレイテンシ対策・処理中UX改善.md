# 0138 APIレイテンシ対策・処理中UX改善

### ステータス

`Done`

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 2: 開発 |
| 難易度 | 中 |
| 優先度 | 高 |
| 関連チケット | #0044（ユーザビリティ改善）, #0043（APIエラーハンドリング） |

---

### 概要

AWS Lambda 環境への移行によりコールドスタート・ネットワーク往復が加わり、API レスポンスの遅延が体感できるようになった。遅延そのものは構造上やむを得ないが、**「処理中であること」を即座にユーザーに伝える** UI を整備し、操作の手応えと不安解消を両立させる。

### 背景・動機

#### 現状の課題

| 画面 | 操作 | 現状 | 問題 |
|------|------|------|------|
| 子供（kinder/baby） | 活動ボタンタップ | SvelteKit form action → 応答まで無反応 | 子供が連打・不安・「壊れた？」 |
| 子供（kinder/baby） | ページ初回ロード | SSR 完了まで空白 | Lambda コールドスタート時に白画面が数秒続く |
| 親管理画面 | 活動追加・編集フォーム送信 | ボタンが一応 `disabled` になるが表示が地味 | 管理者に「送信できた？」という迷いが生じる |
| 親管理画面 | AI活動提案（`/api/v1/activities/suggest`） | `aiLoading` フラグはあるが UI が小さい | Gemini API 呼び出しに数秒かかっても視覚的に分かりにくい |
| 認証画面 | ログイン・サインアップ | `loading` フラグはあるが演出が最小限 | Cognito 応答まで「動いてるのか？」が不明 |

#### 既存インフラ（流用可）

- `NavigationProgress.svelte` — ページ遷移時のトップバー（`$navigating` を監視）
- `Skeleton.svelte` / `.skeleton-block` — シマーアニメーション
- `ErrorAlert.svelte` — エラー表示
- レイアウト (`+layout.svelte`) の `{#if $navigating}` スケルトン

#### 対象外

- Lambda コールドスタートの解消（インフラ側の問題、別チケット #0103 で対応）
- ネットワーク速度の改善

### 設計方針

#### 1. 子供画面（最重要）: 即時フィードバック

子供にとって「押した → 何かが始まった」という **即時の視覚的・聴覚的反応** が最優先。
サーバーの応答を待つのではなく、ボタンを押した瞬間から演出を開始する。

```
タップ → ① ボタンがシュン（縮小→拡大）アニメーション & disabled
           ② スピナー or ローディングドット表示
           → サーバー応答
           ③ 成功: 既存の完了演出（✨ はなまる等）
              失敗: ErrorAlert + ボタン復帰
```

**kinder モード**: ボタン全体がぷるぷるアニメ + 「まってね！」テキスト  
**baby モード**: ビッグカード全体がフェードアニメ + 巨大スピナー

#### 2. 管理画面フォーム: 送信状態の明示

`enhance` の `submitting` 状態を統一パターンで扱う。
既存の `use:enhance` パターンを拡張し、共通スタイルで処理中を表示する。

```svelte
<!-- 送信ボタンの統一パターン -->
<button type="submit" disabled={submitting} class="btn-primary">
  {#if submitting}
    <span class="btn-spinner" aria-hidden="true"></span>
    処理中...
  {:else}
    {labelText}
  {/if}
</button>
```

#### 3. AI 提案・長時間処理: プログレスメッセージ

Gemini API など数秒かかる処理は、フェーズごとにメッセージを切り替えて "生きていること" を伝える。

```
0s:  「AIに聞いています...」
3s:  「もうちょっと待ってね...」
6s:  「あとすこし...」
10s: タイムアウトエラー表示 + リトライボタン
```

#### 4. 初回ロード（SSR遅延）: スケルトンの改善

Lambda コールドスタート時は SSR 自体が遅延する。
`+layout.svelte` の既存スケルトンをページ構成に合わせた精度の高いものに変える。

### ゴール

#### 子供画面（kinder / baby）

- [ ] 活動ボタンの `pending` 状態用 CSS アニメーションを追加（`animate-pending`）
- [ ] kinder 画面: ボタンタップ後に「まってね！」オーバーレイ or ボタン内スピナー表示
- [ ] baby 画面: カードタップ後にローディングインジケーター表示
- [ ] サーバーエラー時はボタンを復帰させ `ErrorAlert` を表示（既存コンポーネント再利用）

#### 共通コンポーネント

- [ ] `$lib/ui/components/LoadingButton.svelte` を作成
  - `loading: boolean`, `loadingText?: string`, `disabled?: boolean` props
  - スピナー内蔵ボタン（子供向け・管理向け両対応）
- [ ] `$lib/ui/components/ProgressMessage.svelte` を作成
  - `messages: string[]`, `intervalMs?: number` props
  - 時間経過でメッセージを自動切替
  - タイムアウト後にコールバックを発火

#### 管理画面

- [ ] 活動追加・編集フォームの送信ボタンを `LoadingButton` に差し替え
- [ ] AI活動提案ボタンを `ProgressMessage` + `LoadingButton` で置き換え
- [ ] こども管理ページのアバター生成ボタンを `LoadingButton` に差し替え

#### 認証画面

- [ ] ログイン・サインアップフォームの送信ボタンを `LoadingButton` に統一

#### グローバル

- [ ] `NavigationProgress` のバーを子供テーマ色（`--theme-accent`）で塗り、子供画面での視認性を向上

### 実装メモ

#### LoadingButton.svelte の設計

```svelte
<!-- $lib/ui/components/LoadingButton.svelte -->
<script lang="ts">
  interface Props {
    loading?: boolean;
    loadingText?: string;
    disabled?: boolean;
    variant?: 'primary' | 'child';  // child は大きなスピナー
    type?: 'submit' | 'button';
    onclick?: () => void;
    children: import('svelte').Snippet;
  }
  let { loading = false, loadingText, disabled, variant = 'primary', type = 'submit', onclick, children }: Props = $props();
</script>

<button {type} disabled={loading || disabled} class="loading-button loading-button--{variant}" {onclick}>
  {#if loading}
    <span class="spinner" aria-hidden="true"></span>
    {loadingText ?? '処理中...'}
  {:else}
    {@render children()}
  {/if}
</button>
```

#### 子供画面のボタン pending 状態

```svelte
<!-- kinder/home の活動ボタン（概念例） -->
<button
  class="activity-btn"
  class:activity-btn--pending={pendingId === activity.id}
  disabled={pendingId !== null}
  onclick={() => recordActivity(activity.id)}
>
  {#if pendingId === activity.id}
    <span class="pending-dot"></span>
    まってね！
  {:else}
    {activity.mainIcon} {activity.displayName}
  {/if}
</button>
```

```css
/* pending アニメーション */
.activity-btn--pending {
  animation: btn-pulse 0.8s ease-in-out infinite;
  opacity: 0.7;
}
@keyframes btn-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.97); }
}
```

#### ProgressMessage の実装方針

- `onMount` で `setInterval` を開始、`onDestroy` でクリア
- `messages` 配列を順番に表示
- 最後のメッセージに達したらタイムアウトコールバックを発火

### テスト観点

- [ ] ユニットテスト: `ProgressMessage` のメッセージ切替ロジック（タイマーモック）
- [ ] 操作テスト: 活動ボタンタップ後にボタンが `disabled` になることを E2E で確認
- [ ] 操作テスト: 送信中に二重送信ができないことを E2E で確認

### 作業メモ

- 

### 成果・結果

- LoadingButton / ProgressMessage 共通コンポーネント作成
- 子供画面（kinder/baby）に即時フィードバック（スピナー＋まってね！アニメ）追加
- 管理画面（AI提案・アバター生成）にスピナー＋ProgressMessage追加
- 認証画面（ログイン・サインアップ）にスピナーアニメーション追加

### 残課題・次のアクション

- Lambda コールドスタート自体の緩和（Provisioned Concurrency 等）は #0103 で検討
- Service Worker によるオフライン時フォールバックは #0044 の残課題として継続
