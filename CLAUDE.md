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
- `docs/tickets/` - 開発チケット（Markdownベース）
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

## 設計書更新ルール（必須）

`docs/design/` の設計書は常に実装と同期させること。以下の場合は該当する設計書を必ず更新する:

| 変更種別 | 更新すべき設計書 |
|---------|---------------|
| API エンドポイントの追加・変更 | `07-API設計書.md` |
| DB テーブル・カラムの追加・変更 | `08-データベース設計書.md` |
| UI コンポーネント・テーマの大幅変更 | `06-UI設計書.md` |
| AWS インフラ構成の変更 | `13-AWSサーバレスアーキテクチャ設計書.md` |
| 認証・セキュリティ関連の変更 | セキュリティ設計書（要作成: #0141） |
| デザイン・ビジュアル変更（favicon, アイコン, カラー, フォント） | `15-ブランドガイドライン.md` を必ず参照。カラーコード・フォントがガイドラインと整合していることを確認。Done前にユーザーへのビジュアル提示必須 |

チケット完了時に「この変更で影響を受ける設計書はあるか？」を自己チェックすること。

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
