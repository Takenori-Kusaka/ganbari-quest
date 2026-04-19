# 0039. デモモードを「実行モード」として本番ルート上で駆動する

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-18 |
| 起票者 | Takenori Kusaka |
| 関連 Issue | #1180, #1181, #296, #1129, #1147 |
| 関連 ADR | ADR-0003（設計書 SSOT）、ADR-0035（設計ポリシー先行確認）、ADR-0037（labels.ts SSOT）|

## コンテキスト

`src/routes/demo/**` は本番ルートツリー (`src/routes/(child)/[uiMode=uiMode]/**` および `src/routes/(parent)/**`) のほぼ完全コピーで構成されている（現状 **4,722 行**）。このため以下のデザイン乖離が**同じ形で 4 度**発生している。

| Issue | 乖離の内容 |
|-------|----------|
| #296 | デモで CSS トークンが本番と一致せずボタン色がずれた |
| #1129 | LP スクリーンショットが旧バナー込みで撮影されデグレ |
| #1147 | 家族プラン招待フローの UI 文言が本番のみ更新され demo が旧版 |
| #1180 | 年齢モードの tapSize 調整が本番にのみ反映（今回） |

対症療法（並行実装チェックリスト／用語辞書強化／ビジュアル検証ルール）を積み重ねてきたが、**「書き漏らすと乖離する」構造そのもの**を解消しないと 5 度目の再発を止められない。加えて #1181 で導入された `?screenshot=1` / `hideDemoOverlays` は、本番と異なる撮影条件を作る band-aid で、デザイン証跡そのものを歪める副作用を持つ。

## 検討した選択肢

### 選択肢 A: 並行実装チェックリストを強化しつつ `src/routes/demo/**` を維持

- メリット: 移行コストゼロ
- デメリット: 4 回証明された通り、人力で漏れを塞げない。構造的解決になっていない

### 選択肢 B: サブドメイン `demo.ganbari-quest.com` に分離し、本番コードを同じデプロイで走らせる

- メリット: URL 共有が分かりやすい
- デメリット: OAuth whitelist、証明書運用、DNS、Cognito 別 User Pool が必要。Pre-PMF で過剰（ADR-0034 と整合しない）

### 選択肢 C: 本番ルートツリーをそのまま使い、`mode=demo` を「実行モード」として hooks で切替

- メリット: デモ専用コードが構造的に消える。乖離再発が不可能。`/demo/*` 4,722 行を削減
- デメリット: 移行 PR が大きい。cookie 有効期限や退出 UX の新規設計が必要

### 選択肢 D: 本番とは別の実装を完全に分ける（別リポジトリ化）

- メリット: 影響範囲を隔離
- デメリット: Pre-PMF で明らかに過剰。同期コストはむしろ増える

## 決定

**選択肢 C** を採用する。以下の 3 レイヤ構成で実装する。

### 1. 判定レイヤ（URL 入口と状態保持）

| 層 | 役割 |
|-----|------|
| **URL クエリ `?mode=demo`** | 入口専用（LP からの遷移、共有リンク、E2E からの起動） |
| **cookie `gq_demo=1`** | モード維持（POST でクエリが消える／ナビゲーション跨ぎ）。有効期限 4h（短命デフォルト） |
| **`event.locals.isDemo: boolean`** | サーバサイドの単一真実。`hooks.server.ts` の `handle` で一度だけ確定 |

`/demo/exit` エンドポイントで cookie を明示削除し本番に戻せる導線を置く（Stripe test-mode toggle 相当）。

### 2. 書き込みガードレイヤ（hooks 単一集約）

`hooks.server.ts` で `locals.isDemo === true` かつ HTTP メソッドが `POST/PUT/PATCH/DELETE` のとき、**200 `{ ok: true, demo: true }`** を返して no-op 化する。

- 403 ではなく 200 を返すのは、子供向け UX でエラーモーダルを表示したくないため（Stripe test mode の設計思想と一致）
- `+page.server.ts` の `actions` と `+server.ts` の handler コードは**完全に無改変**
- 例外は許可リスト（`/api/feedback`, `/api/demo/exit`, `/api/health`, `/api/demo-analytics`）のみ

### 3. データレイヤ（in-memory demo context）

- デモ時の `locals.context` は `buildDemoContext()` が in-memory 値で合成する（`src/lib/server/demo/demo-data.ts` のシードを再利用）
- DB には触らない → reload で fresh start（Linear demo workspace と同じ挙動）
- これにより **`src/lib/server/demo/demo-service.ts` のサービス層 DI 切替は撤廃**。本番サービスは `isDemo` を知らなくてよい

### 廃止・削除する資産

| 対象 | 理由 |
|-----|------|
| `src/routes/demo/**` (4,722 行) | 本番ルートに統合 |
| `src/routes/demo/(child)/**`, `src/routes/demo/(parent)/**` | 同上 |
| `?screenshot=1` / `hideDemoOverlays`（#1181 band-aid） | 本決定で不要。E2E は localStorage フラグでバナー抑止する専用ヘルパーに置換 |
| 並行実装チェックリスト「デモ版 → 本番版の同期」 | **項目ごと削除**。構造的に同期不要になる |

### 保持する資産

| 対象 | 扱い |
|-----|------|
| `src/lib/features/demo/DemoGuideBar.svelte` | 本番レイアウトから条件付き mount（`{#if locals.isDemo}`） |
| `src/lib/features/demo/demo-analytics.ts` | デモファネル分析は継続 |
| `src/lib/server/demo/demo-data.ts`（シードデータ） | `buildDemoContext()` が参照 |
| `/api/demo-analytics` | そのまま |

### オーバーレイ UX（DESIGN.md §9 準拠）

- 上部固定バナー（sticky、`z-index: 100`）
- Primitives の `Alert variant="trial"` を流用（既存トークンのみ使用、hex 直書き禁止）
- 文言は `labels.ts` の `TRIAL_LABELS` 系に新設する demo 語彙を SSOT 化（ADR-0037 準拠）
- baby / preschool モード向けにひらがな併記（DESIGN.md §8 年齢帯別 UI 準拠）
- 退出ボタン（`/demo/exit`）と「ほんとうに始める」CTA（`/auth/signup`）を常時提示

### 移行パス

**1 PR で一括実施**（PO 判断 2026-04-18、tmp/QA-1180-demo-integration.md）。5 分割案は各段階の検証コストが逆に重く、途中段階の UI が中途半端になるため採用しない。

### LP スクリーンショットの保存パス

`site/screenshots/` の既存 29 枚は**上書きせず新パスに置く**（`site/screenshots/v2/` 等）。理由は PO 判断（上書きは旧撮影条件との差異が埋没しリスク大）。`index.html` / `pamphlet.html` の `<img>` src を一括更新する。

### CI 禁則

`scripts/check-no-demo-route-duplication.mjs` を追加し、`src/routes/demo/` 配下にファイルが再作成されたら CI を fail させる。`.github/workflows/ci.yml` に組み込み。

## 結果

- デモと本番のデザイン乖離は**構造的に再発不可能**になる（同一コードパスで駆動するため）
- `src/routes/demo/**` 4,722 行と demo-service.ts の DI 分岐が削減され、保守コストが降下
- #1181 band-aid が撤去され、LP 撮影が本番と同一条件になる
- 並行実装チェックリストから 1 項目削除できる
- 退出 UX（`/demo/exit`）と cookie 短命化により、デモ体験を意図的にリセット可能

### リスク

- cookie 経由で demo 状態が意図せず持続する → 4h 失効 + 退出ボタンで緩和
- `locals.isDemo` 参照忘れ → hooks で一元化するため実装側で参照する必要がほぼ無くなる（UI 側は `$page.data.isDemo` のみ）
- demo context のシードデータが本番と意味的にずれる → `demo-data.ts` は既存の 5 年齢モード全てをカバー済みのため影響最小

### 参考

- [SvelteKit Hooks docs](https://svelte.dev/docs/kit/hooks)
- [Stripe Testing use cases](https://docs.stripe.com/testing-use-cases)
- [Linear Workspaces docs](https://linear.app/docs/workspaces)
- [PostHog posthog-demo-3000 (HogFlix)](https://github.com/PostHog/posthog-demo-3000)
- [Metabase Writable connection docs](https://www.metabase.com/docs/latest/databases/writable-connection)
- 調査レポート: `tmp/1180-demo-research.md`
- インベントリ: タスク `a7987a3d84ab7c4ae` の成果（`src/routes/demo/**` および demo 関連コード一覧）
