# 0142 Dependabot 依存パッケージ一括更新

### ステータス

`Done`

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 3: 運用改善 |
| 難易度 | 中 |
| 優先度 | 中 |
| 依存チケット | #0101 |

---

### 概要

#0101 で導入した Dependabot が初回実行で14件の依存更新PRを自動生成した。安全なパッチ/マイナーアップデートをマージし、メジャーバージョンアップは影響を評価した上で対応方針を決定する。

### 背景・動機

依存パッケージの更新を放置するとセキュリティリスクが増大し、将来のアップグレードコストも増える。初回一括更新で現行バージョンを最新化し、以降は Dependabot の週次更新で追従する運用を確立する。

### ゴール

#### GitHub Actions（ワークフロー依存）— 全5件マージ済み
- [x] #8: actions/upload-pages-artifact 3→4
- [x] #9: aws-actions/configure-aws-credentials 4→6
- [x] #11: actions/checkout 4→6
- [x] #13: actions/upload-artifact 4→7
- [x] #7: docker/build-push-action 6→7

#### npm パッチ/マイナー（安全）— 5件マージ済み、1件rebase待ち
- [x] #20: @ark-ui/svelte 5.16.0→5.20.0
- [x] #19: @aws-sdk/client-dynamodb 3.1011.0→3.1018.0
- [x] #18: @aws-sdk/lib-dynamodb 3.1011.0→3.1018.0
- [x] #16: aws-cdk-lib 2.243.0→2.244.0 (infra)
- [ ] #14: constructs 10.5.1→10.6.0 (infra) — コンフリクト、Dependabot rebase依頼済み
- [x] #12: aws-cdk 2.1111.0→2.1114.1 (infra)

#### npm メジャー（要評価）
- [ ] #17: @vitest/coverage-v8 3→4 — CI失敗（vitest本体v4が必要）。保留
- [ ] #15: @sveltejs/vite-plugin-svelte 6→7 — CI失敗（SvelteKit互換性問題）。保留
- [x] #10: typescript 5→6 (infra) — CI通過、infraのみ影響のためマージ済み

### 対応方針

1. CI が通っている GitHub Actions PR を先にマージ（ワークフロー変更のみ、アプリに影響なし）
2. npm パッチ/マイナーを CI 確認後にマージ（コンフリクト発生時は rebase）
3. npm メジャーは CI 結果と breaking changes を評価し、対応可能なものをマージ、リスクが高いものは保留

### 結果サマリ

| カテゴリ | 合計 | マージ済み | 保留 |
|---------|------|-----------|------|
| GitHub Actions | 5 | 5 | 0 |
| npm パッチ/マイナー | 6 | 5 | 1 (rebase待ち) |
| npm メジャー | 3 | 1 | 2 (CI失敗) |
| **合計** | **14** | **11** | **3** |

### 残課題・次のアクション

- #14 (constructs) はDependabotのrebase後に自動マージ予定
- #15 (@sveltejs/vite-plugin-svelte 7) は SvelteKit 3 対応時に合わせて検討
- #17 (@vitest/coverage-v8 4) は vitest 本体の v4 アップグレードと合わせて対応
- 今後の Dependabot PR は週次で対応するフローを確立
