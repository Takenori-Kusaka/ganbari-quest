# GitHub API head_sha staleness 対処 (#2557)

## 問題の背景

PR の CI 修正 (Fix Agent) や再レビュー (QM Re-Review) の際、GitHub CLI の `gh pr view <num> --json headRefOid` で取得する PR HEAD コミット SHA は、GitHub API 側のキャッシュ遅延 (eventual consistency) により、実際に push された最新のコミットよりも古い値 (stale cache) を返すことがあります。

この遅延により、以下の誤診断 (false positive) が発生するインシデントがありました (#2545 等):

- **Fix Agent**: 修正を push した直後に `gh pr view` で確認し、「修正コミットが反映されていない (commit drop)」と誤判定。
- **QM Re-Review**: Re-Review 時に古い HEAD を参照してしまい、すでに修正済みの項目を「直っていない」として再度 BLOCK 判定。

## Authoritative な確認手法

PR ブランチの最新コミットを正確に把握するためには、`gh pr view` 単独に依存せず、**Git リポジトリ (リモート) の実態を直接参照 (authoritative source)** する必要があります。

### 対処手順

1. **`git ls-remote` による最新 SHA 取得**
   ```bash
   git ls-remote origin refs/heads/<branch>
   ```
   このコマンドは GitHub の Git サーバーから直接最新の refs を取得するため、API キャッシュの影響を受けません。

2. **`gh pr view` との Cross-check**
   ```bash
   gh pr view <num> --json headRefOid
   ```
   上記 1 と 2 の SHA を比較します。乖離がある場合は、**`git ls-remote` の結果を信頼** してください。

3. **最新リビジョンの fetch**
   乖離が発生している (API が遅延している) 状態でも、リモートの Git サーバーにはコミットが存在しています。
   ```bash
   git fetch origin <branch>
   ```
   を実行することで、確実に最新のコミットを手元に取得し、検証を進めることができます。

## 適用箇所

- Tier 2 QM Re-Review Agent による PR HEAD 検証
- CI Fix Agent による Push 後のコミット反映確認
- その他、自動化スクリプト等で PR の最新コミットを厳密に照合する必要があるすべてのケース