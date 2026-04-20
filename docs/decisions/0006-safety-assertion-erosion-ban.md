# 0006. Safety Assertion Erosion Ban — 既存セーフティの段階的弱体化を禁ずる

- **Status**: Accepted
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265
- **統合元**: 旧 ADR-0029（本 PR で削除、詳細は git 履歴）

## コンテキスト

> 旧 ADR-0029 を renumber した新採番。ADR 10 枠再構成（#1262）の一環。

PR #863 が `assertLicenseKeyConfigured()` を追加した際、対応する `AWS_LICENSE_SECRET` の CI Secrets / SSM / NUC .env への配布が後回しになり、`deploy.yml` / `deploy-nuc.yml` が **25 連続失敗**し本番デプロイが約 10 時間停止した（#911）。

このとき発生しかけた誘惑は 4 種: production check を warn に落とす / `NODE_ENV === 'test'` で skip / `ALLOW_LEGACY_*=true` を恒久化 / secret 配布を別 PR に切って CI を green に偽装。

**Normalization of Deviance**（Diane Vaughan / Challenger 事故）、**Test Theater**（Yegor Bugayenko）、**Fail-Closed 原則**（OWASP A10）、**Chesterton's Fence**（G.K. Chesterton）— Pre-PMF / 1 人体制では PR レビュー時の社会的圧力と納期圧力が同時にかかり、機械的に止める仕組みが必要となる。

## 決定

### 禁止 5 項目

以下を含む PR は Copilot / PO レビューで `[must]` 所見として検出し、本 ADR への明示的な supersede 手続きなしには承認しない:

1. **throw を含む production guard を warn に落とす変更** — fail-closed → fail-open のサイレントなダウングレードは OWASP A10 違反
2. **`NODE_ENV === 'test'` 等で本体コードの assertion を skip する分岐の混入** — escape hatch は production リグレッションの温床
3. **`ALLOW_LEGACY_*` / `DISABLE_*` / `SKIP_*` の既定値を true にする変更** — 「一時的」フラグは恒久化する
4. **health check / retry / timeout を根本原因未解明のまま増やす変更** — 「たまに失敗する」は症状
5. **`.skip` / `.todo` / `@ts-expect-error` / `eslint-disable` の追加** — `// eslint-disable-next-line ... -- #1234, owner: @xxx, deadline: 2026-05-01` の 3 点セット必須

### Fail-Closed 原則

`security` / `licensing` / `billing` / `auth` 系の guard は OWASP Top 10 2025 A10 に従い fail-closed をデフォルトとする。

### 境界の判別法

> **その緩和を取り消すときの owner と deadline が PR 本文に書かれているか。書かれていない緩和はすべて禁止。書かれている緩和は許容。**（Pragmatic Programmer "Board it up" 原則）

### 例外手続き

禁止 5 項目を実行してよい唯一のルートは「**別 ADR を書き、当該 ADR を supersede する**」こと。supersede ADR には: 緩和される ADR 番号 / 脅威モデル変更 / 新しい fail-mode / 緩和を逆転する条件と deadline を必須記載。

### Chesterton's Fence 欄

safety check を削除する PR は: 削除される assertion が追加された過去 PR 番号 / 当時の脅威モデル / 現在その脅威モデルがどう変わったか を必須記載。

### 新規 env / secret 追加チェックの自動化

`scripts/check-new-required-env.mjs` が PR diff から `assert*Configured()` / `throw new Error('...required...')` パターンを検出し、PR 本文に「配布済み:」証跡が無ければ CI を red にする。

## 結果

- Pre-PMF 1 人体制でも Assertion Erosion を機械的に止められる
- 緩和が必要な場合は ADR 経由となり合議的・記録的な意思決定が強制される
- #911 のような「assertion 追加 → 配布忘れ → 25 連続失敗」が再発しない

## References

- Diane Vaughan, *The Challenger Launch Decision* (1996)
- OWASP Top 10 2025 A10: https://owasp.org/Top10/
- G.K. Chesterton's Fence: https://fs.blog/chestertons-fence/
