# #0154 .github ディレクトリ拡充によるリポジトリ管理強化

## Status: Done
## 優先度: 中
## 種別: DevOps / リポジトリ整備

---

## 背景

現在の `.github/` 構成:

```
.github/
├── dependabot.yml        ✅ 依存関係の自動更新
├── FUNDING.yml           ✅ スポンサーリンク
├── release.yml           ✅ リリースノート自動生成カテゴリ定義
└── workflows/
    ├── ci.yml            ✅ lint / test / build
    ├── deploy.yml        ✅ AWS Lambda 本番デプロイ
    └── pages.yml         ✅ GitHub Pages (LP) デプロイ
```

OSS として公開されており（AGPL-3.0）外部貢献者も想定しているが、
Issue テンプレート・PR テンプレート・セキュリティポリシーなど、
GitHub が提供する**コミュニティヘルスファイル**と**補助ワークフロー**が整備されていない。

本チケットでは `.github/` に配置できる全機能を調査し、このプロジェクトに有用なものを実装する。

---

## GitHub `.github/` 機能カタログ

### A. コミュニティヘルスファイル（Community Health Files）

`.github/`・リポジトリルート・`docs/` のいずれかに置くと GitHub が自動認識する。

| ファイル | 機能 | GitHub での表示 |
|---------|------|----------------|
| `SECURITY.md` | セキュリティ脆弱性の報告方法を記述 |「Security policy」タブに表示。「Report a vulnerability」機能が有効化される |
| `CODE_OF_CONDUCT.md` | コミュニティ行動規範 | Insights > Community のチェック項目。外部貢献者に表示 |
| `SUPPORT.md` | サポートリソースへの誘導 | Issue 作成時のサイドバーに表示 |
| `CODEOWNERS` | ファイル別のレビュー担当者定義 | PR の「Reviewers」に自動追加。Merge に必須レビューを設定可能 |

### B. Issue テンプレート

`.github/ISSUE_TEMPLATE/` に配置。Issue 作成時にテンプレート選択肢が表示される。

| ファイル | 機能 |
|---------|------|
| `bug_report.yml` | バグ報告フォーム（YAML のフォーム形式）|
| `feature_request.yml` | 機能要望フォーム |
| `config.yml` | テンプレート選択UIの制御（空Issue禁止など）|

> `.yml` 形式はフォームとして描画される（ドロップダウン・チェックボックスなど）。`.md` 形式はプレーンテキストのテンプレート。

### C. PR テンプレート

`.github/PULL_REQUEST_TEMPLATE.md` に配置。PR 作成時に自動で本文に挿入される。

複数テンプレートは `.github/PULL_REQUEST_TEMPLATE/` ディレクトリに複数 `.md` を置き、
URL クエリパラメータ `?template=xxx.md` で選択する。

### D. セキュリティ・品質ワークフロー

`.github/workflows/` に追加するワークフローファイル。

| ファイル | 機能 | 備考 |
|---------|------|------|
| `codeql.yml` | CodeQL による静的セキュリティ解析 | 公開リポジトリは無料。push/PR/スケジュール実行 |
| `dependency-review.yml` | PR で追加された npm パッケージの既知脆弱性チェック | `actions/dependency-review-action` を使用 |
| `stale.yml` | 一定期間放置された Issue/PR を自動クローズ | `actions/stale` を使用 |

### E. 自動ラベリング

| ファイル | 機能 |
|---------|------|
| `.github/labeler.yml` | 変更ファイルのパターンに基づき PR に自動でラベルを付与 |

`actions/labeler` ワークフローと組み合わせて使う。

### F. GitHub Copilot カスタマイズ

| ファイル | 機能 |
|---------|------|
| `.github/copilot-instructions.md` | リポジトリ固有の GitHub Copilot へのカスタム指示 |

`CLAUDE.md` と同様の役割を GitHub Copilot ユーザー向けに提供。
GitHub.com の Copilot Chat でこのリポジトリを参照する外部コントリビュータに有効。

### G. GitHub Discussions テンプレート（将来対応）

`.github/DISCUSSION_TEMPLATE/` に YAML 形式のフォームを配置することで、
Discussions のカテゴリごとにテンプレートを設定できる。  
（本プロジェクトでは Discussions の利用状況が不明なため今回はスコープ外）

---

## このプロジェクトへの適用判断

### 優先度: 高（必須レベル）

#### 1. `SECURITY.md`
**理由**: 子供のデータを扱うアプリのため、セキュリティ脆弱性の報告窓口は必須。  
AGPL-3.0 OSS として外部から利用される場合、適切な開示ポリシーがないと信頼性を損なう。  
GitHub の「Private vulnerability reporting」機能を有効にするためにも必要。

**記載内容**:
- サポートするバージョン（最新 `main` のみ）
- 報告方法（GitHub の Private vulnerability reporting を使用）
- 報告後の対応フロー（48時間以内の初回応答など）
- 対象外のもの（DoS 攻撃、LAN 内前提のアクセス制御 等）

#### 2. `PULL_REQUEST_TEMPLATE.md`
**理由**: CLAUDE.md に「チケット番号でコミット・設計書更新」の規約があるが、
PR 作成時に忘れやすい。テンプレートで強制的にチェックさせることで品質維持。

**記載内容**:
- 対応チケット番号（`closes docs/tickets/XXXX-*`）
- 変更種別チェックボックス（feat / fix / refactor / docs / test）
- テスト実行結果確認チェックボックス（biome / svelte-check / vitest / playwright）
- 設計書更新チェックボックス（API設計書 / DB設計書 / UI設計書）
- スクリーンショット（UI変更の場合）

#### 3. Issue テンプレート（`ISSUE_TEMPLATE/`）
**理由**: 「バグ報告」と「機能要望」でフォーム形式にすることで、
再現手順・環境情報の記入漏れを防ぐ。

**作成するテンプレート**:
- `bug_report.yml` — バグ報告（再現手順 / 期待動作 / 実際の動作 / OS・ブラウザ / Docker有無）
- `feature_request.yml` — 機能要望（ユースケース / 提案内容 / 代替案 / 子供の年齢層）
- `config.yml` — テンプレート未選択での Issue 作成を禁止

### 優先度: 中（推奨）

#### 4. `codeql.yml`（CodeQL セキュリティ解析）
**理由**: 子供データを扱う。OWASP Top10 の injection / XSS 系を自動検出できる。
公開リポジトリは無料で使用可能。

**設定**: `javascript-typescript` 言語、push/PR + 週1スケジュール実行。

#### 5. `dependency-review.yml`（依存関係レビュー）
**理由**: `dependabot.yml` は既存だが、PR 単位での脆弱性ブロックは別途必要。
新しい npm パッケージを追加する PR で CVE を自動チェックできる。

**設定**: PR トリガーのみ、`actions/dependency-review-action@v4` を使用。

#### 6. `CODEOWNERS`
**理由**: 自動的に特定のファイルへのレビュー担当者を指定。
特に `src/lib/server/` 以下（セキュリティ影響大）への変更は必須レビューにしたい。

**設定例**:
```
# デフォルト: 全ファイル
*                                    @Takenori-Kusaka

# サーバーサイド (セキュリティ重要)
src/lib/server/                      @Takenori-Kusaka

# インフラ (コスト影響大)
infra/                               @Takenori-Kusaka
.github/workflows/deploy.yml        @Takenori-Kusaka
```

#### 7. `labeler.yml` + ラベリングワークフロー
**理由**: PR へのラベル付けを自動化。外部コントリビュータの PR も自動分類できる。

**分類例**:

| ラベル | パターン |
|--------|---------|
| `area: frontend` | `src/routes/**`, `src/lib/ui/**` |
| `area: backend` | `src/lib/server/**`, `src/routes/api/**` |
| `area: database` | `src/lib/server/db/**`, `drizzle/**` |
| `area: infra` | `infra/**`, `.github/workflows/**` |
| `area: tests` | `tests/**` |
| `area: docs` | `docs/**`, `*.md` |
| `area: config` | `package.json`, `biome.json`, `tsconfig.json` |

### 優先度: 低（オプション）

#### 8. `stale.yml`（放置 Issue/PR の自動クローズ）
**理由**: 個人プロジェクト寄りなので優先度は低いが、
外部コントリビュータからの放置 PR を整理するのに役立つ。

**設定**: 60日放置でラベル付け、さらに14日で自動クローズ。

#### 9. `copilot-instructions.md`
**理由**: `CLAUDE.md` の内容を GitHub Copilot ユーザー向けに適応したもの。
外部のコントリビュータが GitHub Copilot を使う場合に有効。

---

## 実装計画

### Phase 1（このチケット: 高優先度）

| 作成ファイル | 内容 |
|------------|------|
| `.github/SECURITY.md` | セキュリティポリシー（報告窓口・対応フロー） |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR テンプレート（チケット番号・チェックリスト） |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | バグ報告フォーム |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 機能要望フォーム |
| `.github/ISSUE_TEMPLATE/config.yml` | 空 Issue の禁止設定 |

### Phase 2（推奨: 中優先度）

| 作成ファイル | 内容 |
|------------|------|
| `.github/workflows/codeql.yml` | CodeQL セキュリティ解析ワークフロー |
| `.github/workflows/dependency-review.yml` | PR 依存関係レビューワークフロー |
| `.github/CODEOWNERS` | ファイル別レビュー担当者定義 |
| `.github/labeler.yml` | PR 自動ラベリング設定 |
| `.github/workflows/labeler.yml` | ラベリングワークフロー |

### Phase 3（オプション: 低優先度）

| 作成ファイル | 内容 |
|------------|------|
| `.github/workflows/stale.yml` | 放置 Issue/PR の自動クローズ |
| `.github/copilot-instructions.md` | GitHub Copilot カスタム指示 |

---

## 受け入れ条件

### Phase 1
- [x] `SECURITY.md` が作成され、GitHub の「Security」タブに「View security policy」が表示される
- [x] PR 作成時に自動でテンプレートが挿入される
- [x] Issue 作成時にバグ報告 / 機能要望のどちらかを選択するダイアログが表示される
- [x] 空テキストでの Issue 作成がブロックされる（`config.yml` による）

### Phase 2
- [x] main への push/PR 時に CodeQL が実行され、結果が「Security」タブに表示される
- [x] npm パッケージを追加する PR に自動で依存関係レビューコメントが付く
- [x] `src/lib/server/` の変更を含む PR に `@Takenori-Kusaka` が自動追加される
- [x] PR に変更ファイルに応じたラベルが自動付与される

---

## 参考: GitHub 公式ドキュメント

- [Community health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
- [SECURITY.md](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository)
- [Issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)
- [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [CodeQL](https://docs.github.com/en/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning)
- [Dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review)
- [Copilot instructions](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot)
