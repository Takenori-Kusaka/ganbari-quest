# Project Context

がんばりクエスト - 子供の活動をゲーミフィケーションで動機付けする家庭内専用Webアプリ。
SvelteKit 2 + Svelte 5 (Runes) + Ark UI Svelte + SQLite + Drizzle ORM。TypeScript strict。

## Key Directories

- `src/routes/` - SvelteKit ファイルベースルーティング
- `src/lib/ui/` - Ark UI ラッパ・共通UIコンポーネント
- `src/lib/features/` - 機能単位のコンポーネント・ロジック
- `src/lib/domain/` - ドメインモデル・バリデーション
- `src/lib/server/` - DB・外部API・サービス層（server only）
- `docs/design/` - 設計ドキュメント（企画書〜テスト設計書）
- `docs/tickets/` - **レガシー**（GitHub Issues に移行済み。新規追加禁止）
- `docs/reference/` - 参考資料

## Coding Guidelines

- 型は必須。新規コードはすべて TypeScript strict で型付き。
- データ取得は `+page.ts` / `+layout.ts` の `load` を使用。コンポーネント内の直接 fetch 禁止。
- 状態管理は `$state` / `$derived` / `$effect` を基本。stores は最小限。
- UI は `$lib/ui/primitives`（Ark UI ラッパ）と `$lib/ui/components` からのみ利用。Ark UI を routes から直接 import しない。
- `+server.ts` から直接 ORM クライアントを呼び出さない。必ず `$lib/server/services` 経由。
- API エラーは `@sveltejs/kit` の `error`, `json` で一貫したレスポンスを返す。

## Build & Test

- 開発: `npm run dev`
- ビルド: `npm run build`
- テスト: `npx vitest`
- E2E: `npx playwright test`
- Lint: `npx biome check .`
- DB マイグレーション: `npx drizzle-kit push`

### コミット前チェック（必須）

コミット前に以下を**すべて**実行し、エラーがないことを確認すること:

1. `npx biome check .` — lint エラーなし
2. `npx svelte-check` — 型エラーなし
3. `npx vitest run` — ユニットテスト全通過
4. `npx playwright test` — E2Eテスト全通過

特にE2Eテストはスキーマ変更・シードデータ変更・ルーティング変更時に壊れやすい。
DBスキーマを変更した場合は `tests/e2e/global-setup.ts` のテストデータ投入も更新すること。

## UI/デザイン変更の Done 基準（必須）

UI やデザインに関わるチケットは、コード変更に加えて以下を**全て**満たさなければ Done にできない:

1. **ビジュアル検証**: 対象画面をブラウザで実際に開き、変更前と比較して意図通りであることを確認
2. **スクリーンショット提示**: 変更後のスクリーンショットをユーザーに提示し承認を取得
3. **LP/アプリ両方確認**: `site/`（LP）と `src/`（アプリ）の両方に影響がある場合、両方を確認
4. **モバイル確認**: DevTools のレスポンシブモードで主要ブレークポイントを確認
5. **ゴールのチェック検証**: `[x]` を付ける前に、そのゴールが**文字通り**達成されているか自問する。「目視確認」なら実際に目で見る。「本番と同じUI」なら並べて比較する

### 絶対にやってはいけないこと
- 実際に画面を確認せずにゴールに `[x]` を付けること（検証偽装）
- チケットの「提案」と異なる方式で実装しながら、ゴールだけ達成したと報告すること
- デモと本番など、複数の対象があるチケットで、一方だけ修正して Done とすること

## Critical バグ修正の必須要件（CRITICAL）

`priority:critical` のバグ修正は、通常の Done 基準に加えて以下を**全て**満たすこと:

1. **回帰テスト（E2E）を同一PR内で追加**すること。ガード条件の追加だけでは不十分 — テストがなければ次のリファクタリングで消える
2. **Issue の Acceptance Criteria を全項目完了**すること。部分実装で closes は禁止。未実装の対策がある場合は別 Issue に切り出してからクローズ
3. **Issue で提案された対策を全て実装**すること。提案の一部だけ実装して「直った」とするのは対症療法であり根本解決ではない
4. **全5年齢モード（baby/kinder/lower/upper/teen）で実機検証**し、スクリーンショットを PR に添付
5. **リネーム/リファクタリングとの依存関係を確認** — 直近30日に同じファイルを変更した PR がないかチェックし、修正が最新のファイルパスに適用されていることを確認

### 教訓（#543 → #611）
- #543 のダイアログフリーズ修正が、同日マージの #539（ルートリネーム）で消失し再発した
- 原因: 修正が旧ファイル名（preschool/elementary/junior/senior）に適用され、新ファイル名（kinder/lower/upper/teen）には一切反映されなかった
- Issue で提案された「ダイアログキュー」は未実装のまま closes された
- E2E テストなし、セルフレビュー + Copilot のみでマージ

## UI 実装ルール（IMPORTANT — デザインシステム強制）

本プロジェクトは 3 層トークンアーキテクチャ + プリミティブコンポーネントでUIを構築する。
eslint (`svelte/no-inline-styles`) と stylelint (`color-no-hex`) で自動検出される。

### 色の使い方
- **routes/features 配下で hex カラー（`#fff`, `#667eea` 等）を直書き禁止**。必ず CSS 変数を使う
- Semantic トークン（`var(--color-action-primary)`, `var(--color-surface-card)` 等）を優先
- Base トークン（`var(--color-brand-500)` 等）は Semantic 定義内でのみ使用
- `@theme` ブロック（`src/lib/ui/styles/app.css`）内でのみ hex 定義を許可

### コンポーネントの使い方
- **ボタンは必ず `$lib/ui/primitives/Button.svelte` を使用**。`<button class="px-3 py-1 ...">` の直書き禁止
- **フォーム要素は `$lib/ui/primitives/FormField.svelte`** を使用（追加後）
- **カードは `$lib/ui/primitives/Card.svelte`** を使用（追加後）
- 新しい UI パターンが必要な場合は、**先に primitives/components に追加してから** routes で使う

### スタイルの書き方
- `src/routes/` 配下の `<style>` ブロックは**原則50行以下**。超える場合はコンポーネント分割
- `style="..."` 属性は**動的な値**（`style:width={pct + '%'}` 等）のみ許容
- Tailwind ユーティリティクラスは使用可。ただし色は `bg-[var(--color-*)]` で CSS 変数参照
- Tailwind の arbitrary value で hex を書かない（`bg-[#667eea]` 禁止）

### lint コマンド
- `npm run lint` — Biome + ESLint(Svelte) + Stylelint をまとめて実行
- `npm run lint:svelte` — Svelte ファイルのインラインスタイルチェック
- `npm run lint:css` — CSS ファイルのハードコード色チェック

## 並行実装チェックリスト（IMPORTANT — 修正前必須）

本プロジェクトは **8 カテゴリ以上の並行実装ペア** を抱えている（同期漏れが頻発）。
修正前に必ず `docs/design/parallel-implementations.md` を参照し、以下のチェックを行うこと:

- [ ] **UI ラベル・用語** → `src/lib/domain/labels.ts` + `site/index.html` + `site/pamphlet.html` + `site/shared-labels.js` + `tutorial-chapters.ts`
- [ ] **年齢モード** → `src/routes/(child)/{baby,preschool,elementary,junior,senior}/` の 5 ディレクトリ全て
- [ ] **本番画面 → デモ画面** も同等変更 (`src/routes/demo/`)
- [ ] **アプリ機能 → LP** の文言 (`site/`) も同期
- [ ] **ナビゲーション** → デスクトップ (`AdminLayout`) + モバイル (`AdminMobileNav`) + ボトムナビ (`BottomNav`)
- [ ] **DB スキーマ** → `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts`
- [ ] **チュートリアル** → 本番 + デモガイド両方 (`tutorial-chapters.ts` + `demo-guide-state.svelte.ts`)

並行実装の全リストと背景は `docs/design/parallel-implementations.md` を参照。
解消計画: #564 (Tier 1) → #565 (Tier 2) → #566 (Tier 3)。

## 用語管理ルール（IMPORTANT — 用語散在の防止）

UIに表示されるラベル・用語は **`src/lib/domain/labels.ts`（用語辞書）** を Single Source of Truth とする。
同じ概念を複数箇所にハードコードすることは禁止。

### 用語辞書で管理すべきもの
- ナビゲーションカテゴリ名（みまもり、はげまし等）
- 年齢区分ラベル（baby/kinder/lower/upper/teen の日本語表示名）
- プラン名（無料プラン、スタンダードプラン、ファミリープラン）
- 機能名（レポート、おうえんメッセージ、とくべつなごほうび等）
- チュートリアルの説明文で参照される機能名・画面名

### ルール
- **ナビラベル、ページタイトル、チュートリアル本文で同じ機能を指す場合、必ず用語辞書の定数を使う**
- 用語を変更する場合は **`grep` で全出現箇所を確認**し、用語辞書の値を変更するだけで全画面に反映されることを確認する
- デモ版 (`/demo`) と本番で異なるラベルを使ってはならない

## Critical バグ修正の必須要件（#612 — IMPORTANT）

`priority:critical` のバグ修正は、通常の Done 基準に加えて以下を**全て**満たすこと:

- 回帰テスト（E2E）を**同一 PR 内で**追加すること
- Issue の Acceptance Criteria を**全項目**完了すること（部分実装で closes 禁止）
- Issue で提案された対策のうち未実装のものは、別 Issue に切り出してからクローズすること
- **5年齢モード全てで実機検証**し、スクリーンショットを PR に添付すること（年齢モードに関わる変更の場合）

### リネーム/リファクタリング時の引き継ぎチェック

ファイルリネームやルート構造のリファクタリングを行う際は、以下を必ず確認:

- `git log --since="30 days ago" -- <旧ファイルパス>` でリネーム対象への直近修正を確認
- 直近修正がリネーム先にも正しく反映されていることを検証
- 特に `priority:critical` の修正が消失していないことを確認

## チュートリアル修正ルール（IMPORTANT）

チュートリアル（`tutorial-chapters.ts` + `TutorialOverlay.svelte`）に関わる変更では、以下を必ず実施すること:

1. **全ステップ通し操作**: ステップ1〜最終ステップまで、実機で操作して以下を確認
   - フォーカスリングが正しい要素を囲んでいる（画面外・非表示の要素を指していない）
   - 説明文のテキストが画面の実態と一致している（ナビのカテゴリ数、ボタン名、機能名）
   - ナビゲーション（ヘッダー/ボトムナビ）がバブルに被っていない
   - ページ遷移後に DOM が安定してからフォーカスが表示される
2. **スクリーンショット添付**: 全ステップのスクリーンショットを PR に添付する
3. **デスクトップ + モバイル両方確認**: ナビ構造がデスクトップ（ドロップダウン）とモバイル（ボトムナビ）で異なるため、両方でテスト

## Things Not To Do

- `src/routes` 配下のページコンポーネントにビジネスロジックを書かない。
- DB への直接アクセスは禁止。必ず `$lib/server/db` 経由。
- `.env` ファイルをコミットしない。
- `node_modules/` や `*.db` ファイルをコミットしない。
- 古い Svelte 4 / SvelteKit 1 の書き方（`$:` リアクティブ宣言等）を使わない。
- チケットのゴールを実態なく完了（`[x]`）にしない。成果物が存在しないものをDoneにしない。
- **routes 配下でインラインスタイル (`style="..."`) を新規追加しない。**
- **routes 配下で hex カラーを直書きしない。**
- **`$lib/ui/primitives/` に存在するコンポーネントを routes で再実装しない。**
- **`docs/tickets/` にチケットファイルを新規作成しない。** チケット管理は GitHub Issues で行う（下記「チケット管理」参照）。
- **URL をリネーム・廃止した際に、個別の `+page.server.ts` や `+page.ts` に `redirect()` を書かない。** `src/lib/server/routing/legacy-url-map.ts` の `LEGACY_URL_MAP` に必ずエントリを追加する（下記「旧 URL 廃止ルール」参照）。

## 旧 URL 廃止ルール（#578 — IMPORTANT）

URL をリネーム・廃止したら、**必ず** `src/lib/server/routing/legacy-url-map.ts` の
`LEGACY_URL_MAP` にエントリを追加する。個別ページで `redirect()` を書くのは禁止。

### 理由
- 散在した redirect は「廃止漏れ」と「無限ループ」の温床になる（#571 の 404 インシデント）
- 中央管理することで棚卸し・ログ・テストが一元化できる
- ブックマーク・PWA ショートカット・外部リンクを全て救済できる

### 追加手順
1. `LEGACY_URL_MAP` 配列に `LegacyUrlEntry` を追加（`from` / `to` / `deletedAt` / `issue` / `reason`）
2. `tests/unit/routing/legacy-url-map.test.ts` の `cases` テーブルにテストケースを追加
3. `tests/e2e/legacy-url-redirect.spec.ts` にスモーク E2E を追加

### やってはいけないこと
- 個別ルートで `throw redirect(302, '/new-url')` を書くこと（認可チェックやセッションリダイレクトを除く）
- `LEGACY_URL_MAP` のエントリを削除すること（ブックマークが生き続けるため、エントリは永久に残す）
- `from` と `to` が部分的に重なるエントリを追加すること（例: `/foo` と `/foo/bar`。長いプレフィックスが優先されるが、意図が不明瞭になる）

## チケット管理（IMPORTANT — GitHub Issues 必須）

チケットは **GitHub Issues** で管理する。`docs/tickets/` は**レガシー**（参照のみ・新規追加厳禁）。

### ルール
- **新規チケットは `gh issue create` で GitHub Issues に作成する**。`docs/tickets/` にファイルを作ってはならない。
- Issue テンプレート（`.github/ISSUE_TEMPLATE/dev_ticket.yml`）を使用すること。
- ラベル体系: `type:feat|fix|refactor|infra|design|docs|marketing|test`, `priority:critical|high|medium|low`, `status:blocked|in-progress|on-hold`, `area:auth|billing|child-ui|admin|lp|db`
- コミットメッセージやPR本文で `#<issue番号>` を参照し、完了時は `closes #<issue番号>` で自動クローズする。
- 既存の `docs/tickets/` ファイルは参照用に残すが、**編集・更新もしない**（GitHub Issue 側で管理）。

### Draft PR 運用
- PRは `gh pr create --draft` で **Draft PR** として作成する。
- 作業完了・CI全通過後に `gh pr ready <番号>` で **Ready for Review** に変更する。
- Draft PR はマージできない（GitHub ルールセットで保護）。
- Dependabot PR は自動的に non-draft で作成されるため、従来通りレビュー → auto-merge。

### コマンド例
```bash
# チケット作成
gh issue create --title "feat: 機能名" --label "type:feat,priority:medium"

# Draft PR 作成
gh pr create --draft --title "feat: #123 機能名" --body "closes #123"

# CI通過後に Ready for Review に変更
gh pr ready <PR番号>

# 一覧確認
gh issue list --label "priority:high"

# チケット詳細
gh issue view <番号>
```

## 画像アセットルール（IMPORTANT）

本プロジェクトは**子供向けゲーミフィケーションアプリ**であり、視覚的な報酬体験がプロダクトの核心。
Claude Code は画像生成ができないが、**それを理由に絵文字・UTFアイコン・テキストで画像アセットを代替してはならない。**

### 絵文字では不十分な場面（画像アセットが必要）

- ゲーミフィケーションの報酬UI（シール、バッジ、トロフィー、実績アイコン）
- キャラクター・アバター・マスコット
- ブランドアイデンティティに関わるもの（ロゴ、アイコン）
- レベル/ランク表示、ステージ背景
- OS/ブラウザ間で見た目が変わると困る要素

### 絵文字で許容される場面

- ステータスラベル・通知テキスト内の装飾
- リスト項目の視覚的アクセント
- 開発中のプロトタイプ（ただし TODO コメント必須）

### 画像が必要と判断した場合の行動（優先順）

1. **Gemini API で生成**: `scripts/` 配下の画像生成スクリプトを作成・実行し、`static/assets/` に保存する。プロンプト設計は `docs/reference/gemini_image_generation_guide.md` を参照
2. **チケット化**: 画像生成の要件（サイズ、スタイル、用途）を明記したチケットを `docs/tickets/` に作成する
3. **プレースホルダー配置**: コード上にプレースホルダー画像を置き、`<!-- TODO: 画像アセット必要: [具体的な要件] -->` コメントを残す

**絶対にやってはいけないこと**: 本来画像アセットが必要な場面で、絵文字やテキストだけで「実装完了」とすること。見た目が簡素になる妥協は、このプロジェクトではバグと同等に扱う。

## 設計書更新ルール（CRITICAL — Done 基準に含む）

**設計書は実装の Single Source of Truth である。** 設計書に書かれていない仕様は「存在しない仕様」と同じ。
会話で決まった仕様を設計書に反映しなければ、会話コンパクション時に仕様が消失し、同じ説明を何度も繰り返す事態になる（実際にスタンプカード仕様で4回発生 — #607）。

### 設計書更新が Done 基準に含まれるケース

| 変更種別 | 更新すべき設計書 | 更新しないと Done にできない |
|---------|---------------|------------------------|
| API エンドポイントの追加・変更 | `07-API設計書.md` | はい |
| DB テーブル・カラムの追加・変更 | `08-データベース設計書.md` | はい |
| UI 機能・画面・オーバーレイの追加・変更 | `06-UI設計書.md` | はい |
| AWS インフラ構成の変更 | `13-AWSサーバレスアーキテクチャ設計書.md` | はい |
| 認証・セキュリティ関連の変更 | `14-セキュリティ設計書.md` | はい |
| デザイン・ビジュアル変更 | `15-ブランドガイドライン.md` | はい |
| 会話で確定した機能仕様 | 該当する設計書（なければ新設） | **はい — Issue 起票だけでは不十分** |

### 絶対にやってはいけないこと

- **会話で仕様が決まったのに設計書に反映しないまま実装を進めること**
- Issue 本文に仕様を書いて「設計書は後で」と先送りすること
- 設計書の更新を別 Issue に切り出して本体を Done にすること

### アーキテクチャ図のルール

- システムアーキテクチャ図・ソフトウェアアーキテクチャ図は **drawio 形式**（`.drawio`）で `docs/design/diagrams/` に保存する
- テキストベースの ASCII 図やマークダウン内の疑似図は禁止（メンテナンスされない）
- drawio ファイルは GitHub 上で差分表示可能であり、CI で PNG エクスポートも可能

## ADR (Architecture Decision Records)

重要な意思決定・教訓・仕様は `docs/decisions/` に ADR として記録する。

- **新規作成**: `docs/decisions/NNNN-kebab-case-title.md`（テンプレートは `docs/decisions/README.md` 参照）
- **記録すべきもの**: 技術選定の根拠、過去のインシデントの教訓、機能仕様の正仕様、品質プロセスの決定
- **Claude Code の memory はユーザーローカル**であり他の PO/開発者には見えない。チームで共有すべき知識は必ず ADR またはリポジトリ内のドキュメントに置く

### 現在の ADR 一覧
- [ADR-0001](docs/decisions/0001-rename-backward-compat.md) — リネーム時の後方互換必須（#572 の教訓）
- [ADR-0002](docs/decisions/0002-dialog-queue-required.md) — ダイアログキュー必須（#543/#611 の教訓）
- [ADR-0003](docs/decisions/0003-design-doc-as-source-of-truth.md) — 設計書は Single Source of Truth
- [ADR-0004](docs/decisions/0004-stamp-card-spec.md) — スタンプカード正仕様
- [ADR-0005](docs/decisions/0005-critical-fix-quality-gate.md) — Critical 修正の品質ゲート

## Further Context

- UI フレームワーク設計: @docs/reference/ui_framwork.md
- バックエンド設計: @docs/reference/backend_framework.md
- Gemini API 画像生成ガイド: @docs/reference/gemini_image_generation_guide.md
- 画像アセット仕様・カタログ: @docs/design/asset-catalog.md
- 家族情報（サブモジュール）: @personal/data/family.yml

## Compaction Rules

- コンパクション時は「変更ファイル一覧」「実行したテストコマンドと結果」「現在作業中のチケット番号」を必ず要約に残す。
- 作業中のチケットは `docs/tickets/` で管理。再開時はチケットのステータスを確認して継続する。

## Deploy

### AWS Lambda 本番（ganbari-quest.com）

- **自動デプロイ**: main ブランチへの push で GitHub Actions が自動実行
- ワークフロー: `.github/workflows/deploy.yml`
- フロー: test → Storage CDK → Docker build (ARM64) → ECR push → CDK deploy all → Lambda update
- 手動で Docker build/ECR push をしないこと（GitHub Actions が行う）
- CDK infra の手動デプロイ（SSMパラメータ作成等）は必要に応じて実行
- デプロイ状況確認: `gh run list` / `gh run watch`

### NUC ローカルサーバー（LAN内）

- 対象: NUCサーバー (Windows) `ssh kusaka-server@192.168.68.79`
- Docker: `C:\Docker\ganbari-quest`
- DB: `C:\Docker\ganbari-quest\data\ganbari-quest.db`（SQLite WALモード）
- 認証: 親の管理画面のみPINコード、子供画面は認証なし（LAN内限定）

SQLite WAL破損防止のため、**必ず stop → migrate → build → up の順序**で実施すること。
`docker compose up -d` だけで済ませると、コンテナ再作成時にWAL不整合でDB破損するリスクがある（#0099 障害）。

```bash
# 1. コンテナを安全に停止（graceful shutdown で WAL flush）
ssh kusaka-server@192.168.68.79 "cd C:\Docker\ganbari-quest && docker compose stop app"

# 2. DBマイグレーションがある場合はここで実行（コンテナ停止中＝競合なし）
ssh kusaka-server@192.168.68.79 "cd C:\Docker\ganbari-quest && node scripts/add-xxx.cjs data/ganbari-quest.db"

# 3. pull → ビルド → 起動
ssh kusaka-server@192.168.68.79 "cd C:\Docker\ganbari-quest && git pull && docker compose build && docker compose up -d"

# 4. 動作確認
ssh kusaka-server@192.168.68.79 "curl -s http://localhost:3000/api/health"
```

## Auto Mode ガイドライン

Auto mode (`claude --enable-auto-mode`) 使用時でも以下は必ず確認を求めること:

- `git push` / `git push --force` など本番リポジトリへの反映
- 本番サーバーへのデプロイ（ssh 経由の操作）
- DB のスキーマ変更（`drizzle-kit push`）やデータ削除
- `.env` や認証情報に関わるファイルの変更
- `rm -rf` 等の破壊的なファイル操作
