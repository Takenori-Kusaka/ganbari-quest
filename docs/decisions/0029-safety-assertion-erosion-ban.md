# 0029. Safety Assertion Erosion Ban — 既存 safety を弱める方向の変更を禁じる

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-12 |
| 起票者 | Claude Code |
| 関連 Issue | #911, #912, #914 |
| 関連 ADR | ADR-0017（テスト品質ラチェット）, ADR-0018（Issue 起票品質）, ADR-0020（強制プロセス）, ADR-0021（デプロイ検証ゲート）, ADR-0026（ライセンスキーアーキテクチャ） |

## コンテキスト

#911（CRITICAL: deploy.yml / deploy-nuc.yml の 25 連続失敗、本番デプロイ ~10 時間停止）の根本原因分析の結果、PR #863 が `assertLicenseKeyConfigured()` という production guard を追加した際、後続 PR で次のような「甘え」が混入する余地が構造的に残っていることが明らかになった。

- production check を warn に落とす（**Assertion Erosion** / OWASP Top 10 2025 A10 違反）
- `NODE_ENV === 'test'` で skip を**本体コード**に混入する（**Test Theater**）
- `ALLOW_LEGACY_LICENSE_KEYS=true` のような escape hatch を恒久化する（**Stale Feature Flag**）
- secret 配布を別 PR に後回しして「green に偽装」する（**Goodhart's Law**）

これは Diane Vaughan が Challenger 事故分析で命名した **Normalization of Deviance**（安全マージンの漸進的削減）に該当する。「1 回くらいなら」「期限が迫っているから」を理由に、本来 fail-closed であるべき箇所を fail-open に倒す変更が積み重なると、最終的にプロダクト全体が静かに崩壊する。

既存 ADR 群（0017/0018/0020/0021/0026）は「品質を上げる方向」の縛りはあるが、「**既に存在する safety を弱める方向**の変更を機械的に止める仕組み」が欠落していた。本 ADR がそのピースを埋める。

## 決定

### 禁止 5 項目

以下 5 つのパターンを含む変更は、PR 単独では merge できない。例外手続き（後述）を経ること。

1. **`throw` を含む production guard を `console.warn` / log のみに置き換える変更**
   例: `assertXxxConfigured()` の `throw new Error(...)` を `console.warn(...)` に書き換える
2. **`NODE_ENV === 'test'` 等で本体コードの assertion を skip する分岐の混入**
   ※ test ファイル側で `vi.mock` / DI で差し替えるのは許容。**本体コードを test 環境で曲げる**のが禁止
3. **`ALLOW_LEGACY_*` / `DISABLE_*` / `SKIP_*` の既定値を `true` にする変更**
   ※ 明示的に `=true` を指定したときのみ動くフラグは許容（既定 false / fail-closed）
4. **health check / retry / timeout を、根本原因未解明のまま増やす変更**
   ※ 「とりあえず timeout を 30s に伸ばす」「retry 回数を増やす」は対症療法。原因不明のまま緩めるのは禁止
5. **`.skip` / `.todo` / `// @ts-expect-error` / `// eslint-disable` の追加**
   ※ 「Issue 番号 + 30 日以内 deadline コメント」が併記されている場合のみ許容
   例: `// @ts-expect-error #999 — by 2026-05-12`

### fail-closed 原則の再確認

security / licensing / billing / auth / consent 系のモジュールでは、**fail-closed をデフォルトとする**。OWASP Top 10 2025 A10（Server-Side Request Forgery / Insecure Defaults）に従い、不確実な状態では拒否側に倒すこと。

例外: 子供向け UI のフォールバック（活動データ取得失敗時に空配列を返す等）は UX 上 fail-open が適切な場合がある。境界判別は次節に従う。

### 境界判別の 1 文

> **その緩和を取り消すときの owner と deadline が PR 本文に書かれているか。書かれていない緩和はすべて禁止。書かれている緩和は許容。**

これは Pragmatic Programmer の "Board it up" 原則の応用。一時的な緩和を permanent に変えないための唯一の現実的な楔。

PR 本文に次のフォーマットで明記すること:

```markdown
## 一時的な safety 緩和（ADR-0029）
- 内容: <何を緩めたか>
- owner: @<github-username>
- deadline: YYYY-MM-DD（最大 30 日後）
- 取り消し条件: <この条件を満たしたら元に戻す>
- 取り消し用 issue: #<番号>
```

### 例外手続き

禁止 5 項目を実行してよい唯一のルートは **「別 ADR を書き、旧 ADR を supersede する」** ことである。PR 単独では不可。

例: 「ADR-0026 のライセンスキー fail-closed を一時的に warn に落としたい」→ ADR-0030 を新規作成し、`Status: accepted, Supersedes: ADR-0026` を明記。レビューで PO の承認を得てから対応 PR を出す。

### Chesterton's Fence 欄

既存の safety check / assertion を**削除または弱める** PR では、PR 本文に次を必須記載:

- 該当 assertion が**追加された過去 PR 番号**
- その当時の脅威モデル（なぜその assertion が必要だったか）
- 現在その脅威がどう変わったか（環境変化 / 別の手段で防御されている等）

これは G.K. Chesterton の "fence" 比喩に由来する: なぜそこにフェンスがあるか分からないうちは、撤去してはならない。

## 結果

### 強制力

1. **`scripts/check-new-required-env.mjs` を新設**
   PR diff から新規 `assert*Configured()` / `throw new Error('...required...')` / `process.env.X || ...throw` を検出し、PR 本文に「配布済み: 証跡」がなければ CI を red にする。

2. **CI workflow に `new-env-distribution-check` job を追加**
   `lint-and-test` と並列で `pull_request` イベントのみ実行。

3. **PR template に「新規 env / secret 追加チェック」セクションを追加**
   レビュー時に owner / deadline / 配布状況を機械的に確認できる。

4. **PO / Copilot レビューで `[must]` 所見として検出**
   ADR-0017 / 0020 と同じく、レビュアー側でも禁止 5 項目を機械的にブロック。

### 期待される効果

- secret 配布漏れによる本番デプロイ停止（#911 のような事案）が CI で事前検出される
- assertion を弱める PR が、owner / deadline 明記を強制されることで、暫定対応が暫定で終わる
- ADR-0029 が「assertion を弱めたい誘惑」が出るたびの判断基準として機能する

### トレードオフ

- 新規 env / secret 追加 PR の摩擦が増える（証跡記載が必須）
  → 摩擦が増えるのは意図された効果。secret 追加は本質的にデプロイパイプライン全体に影響するため、慎重さを強制する
- false positive（テストヘルパに `assertXxx` がある等）が出る可能性
  → 検出対象を `src/**` に限定し、`tests/**` / `scripts/**` / `docs/**` を除外することで抑制

## References

- Diane Vaughan, _The Challenger Launch Decision_ — Normalization of Deviance
- Yegor Bugayenko, _Test Theater_ — https://www.yegor256.com/2019/02/19/fakes-stubs-mocks.html
- OWASP Top 10 2025 — A10: Server-Side Request Forgery & Insecure Defaults
- Google SRE Workbook, Chapter 3 — Risk Tolerance & Error Budgets
- Pragmatic Programmer (Hunt & Thomas), 2nd ed. — Topic 3: "Software Entropy" / "Don't live with broken windows"
- G.K. Chesterton, _The Thing_ (1929) — "The Fence" parable
- Neal Ford, _Building Evolutionary Architectures_ — Fitness Functions

## 関連

- #911 — CRITICAL: deploy.yml / deploy-nuc.yml の 25 連続失敗（本 ADR の発端）
- #914 — process: ADR-0029 + 新規 env/secret 追加チェック自動化（本 ADR の起票 issue）
- ADR-0017 — テスト品質の劣化を許容しない（テスト側の縛り）
- ADR-0020 — テスト品質ラチェット強制プロセス
- ADR-0021 — デプロイ検証ゲート
- ADR-0026 — ライセンスキーアーキテクチャ（fail-closed の根拠）
