# OSS 脆弱性診断ガイド

> Issue #985, #986 / ADR-0032 T4（四半期 / 自動 + 手動実行）

## 概要

3 つの OSS ツールでプロジェクトの脆弱性を検査する。
四半期ごとに `npm audit` を GitHub Actions で自動実行し、検出された脆弱性を GitHub Issue として自動起票する。

| ツール | 対象 | インストール | 必須 |
|--------|------|-------------|------|
| **npm audit** | npm 依存パッケージ | npm 組み込み（追加不要） | YES |
| **osv-scanner** | lockfile → OSV.dev DB | brew / go install | NO（推奨） |
| **semgrep** | ソースコード脆弱パターン | pip / brew | NO（推奨） |

## トリガ方法

### 自動実行 (cron)

- **スケジュール**: 毎四半期初日 00:00 UTC (1/1, 4/1, 7/1, 10/1)
- **ワークフロー**: `.github/workflows/security-scan.yml`
- 手動介入不要

### 手動実行 (workflow_dispatch)

1. GitHub リポジトリの Actions タブを開く
2. 左メニューから "Quarterly Security Scan" を選択
3. "Run workflow" ボタンをクリック
4. ブランチを `main` のまま "Run workflow" を実行

```bash
# gh CLI から
gh workflow run security-scan.yml

# ローカル実行（全ツール）
npm run security:scan
```

結果は `reports/security/YYYY-MM-DD/` に出力される。

## ツール別インストール手順

### npm audit（インストール不要）

npm 組み込み。追加作業なし。

### osv-scanner

Google 製の OSS 脆弱性スキャナ。OSV.dev の広範な脆弱性データベースを使用。

```bash
# macOS
brew install osv-scanner

# Go (any OS)
go install github.com/google/osv-scanner/cmd/osv-scanner@latest

# Linux (binary)
curl -L https://github.com/google/osv-scanner/releases/latest/download/osv-scanner_linux_amd64 -o /usr/local/bin/osv-scanner
chmod +x /usr/local/bin/osv-scanner

# Windows (scoop)
scoop install osv-scanner
```

検証: `osv-scanner --version`

### semgrep

軽量な静的解析ツール。SQLi、XSS、path traversal 等のコードパターンを検出。

```bash
# Python (any OS)
pip install semgrep

# macOS
brew install semgrep

# Docker
docker run --rm -v "${PWD}:/src" returntocorp/semgrep semgrep scan --config auto /src
```

検証: `semgrep --version`

## 実行

### 定期実行（推奨: 四半期ごと）

```bash
npm run security:scan
```

### カスタム出力先

```bash
node scripts/security-scan.mjs --output-dir reports/security/custom-name
```

### 個別ツール実行

```bash
# npm audit のみ
npm audit
npm audit --json > reports/security/npm-audit.json

# osv-scanner のみ
osv-scanner --lockfile=package-lock.json

# semgrep のみ
semgrep scan --config auto src/
```

## 出力ファイル

```
reports/security/YYYY-MM-DD/
  npm-audit.json        # npm audit の JSON 出力
  npm-audit.txt         # npm audit の人間可読出力
  osv-scanner.json      # osv-scanner 結果（未インストール時は skipped フラグ）
  semgrep.json          # semgrep 結果（未インストール時は skipped フラグ）
  summary.txt           # 全ツールのサマリ
```

> `reports/security/` は `.gitignore` に含まれる（機密情報を含む可能性があるため）。

## Finding Issue への対応フロー

### severity: high / critical

- 個別 Issue が自動起票される
- ラベル: `priority:high`, `type:fix`, `security`
- **対応期限**: 起票から 30 日以内
- 対応手順:
  1. 影響範囲を確認
  2. `npm audit fix` または手動で依存更新
  3. テスト全通過を確認
  4. PR 作成 → マージ

### severity: moderate / low

- 1 つのサマリ Issue に集約される
- ラベル: `priority:low`, `type:fix`, `security`
- **対応期限**: 次回四半期スキャンまで
- 対応手順:
  1. サマリを確認し、対応可能なものから更新
  2. breaking change がある場合は個別に判断

### 重複防止

- スクリプトは起票前に `gh issue list --search` で既存 Open Issue を検索
- 同一 advisory ID / パッケージ名の Issue が Open の場合は skip
- 解決済み Issue (Closed) は重複とみなさない

### Issue 起票テンプレート（手動起票時）

```markdown
## 脆弱性報告

- **ツール**: npm audit / osv-scanner / semgrep
- **パッケージ**: package-name@version
- **CVE**: CVE-YYYY-XXXXX
- **Severity**: high
- **概要**: [脆弱性の概要]
- **影響**: [本プロジェクトでの影響範囲]
- **修正方法**: [パッケージ更新 / コード修正 / ワークアラウンド]
- **検出日**: YYYY-MM-DD
```

### 修正方法

#### npm 依存パッケージの脆弱性

```bash
# 自動修正（breaking change なし）
npm audit fix

# 強制修正（breaking change あり — テスト必須）
npm audit fix --force

# 特定パッケージの更新
npm update <package-name>
```

#### コードパターンの脆弱性（semgrep 検出）

semgrep の出力に修正提案が含まれる。手動でコードを修正し、テストで回帰を確認。

## 例外登録

### npm audit

`package.json` に `overrides` を追加して脆弱性を受容する場合:

```json
{
  "overrides": {
    "vulnerable-package": ">=fixed-version"
  }
}
```

### osv-scanner

`.osv-scanner.toml` で特定 CVE を無視:

```toml
[[IgnoredVulns]]
id = "CVE-YYYY-XXXXX"
reason = "Not exploitable in our usage (see #IssueNumber)"
```

### semgrep

`.semgrepignore` で特定パスを除外:

```
# セキュリティ上問題のないパターン
tests/
```

> **重要**: 例外登録は PR レビューで正当性を必ず確認すること。「面倒だから ignore」は禁止。

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `.github/workflows/security-scan.yml` | GitHub Actions ワークフロー定義 |
| `scripts/security-findings-to-issues.mjs` | audit 結果 → Issue 起票スクリプト |
| `.github/workflows/codeql.yml` | CodeQL（JS/TS コードパターン検出） |
| `.github/workflows/dependency-review.yml` | PR 時の依存差分レビュー |

## 参照

- Issue #985: ローカル実行セキュリティスキャン
- Issue #986: 四半期自動セキュリティスキャン
- ADR-0029: Safety Assertion Erosion Ban
- ADR-0032: 静的解析ティアポリシー (T4 四半期)
- ADR-0034: Pre-PMF セキュリティ最小化方針
