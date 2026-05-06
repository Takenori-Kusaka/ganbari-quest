# QA Agent spawn テンプレート

> Orchestrator が Tier 2 Review Agent / CI Fix Agent を spawn する際の定型プロンプト。`<>` を実値に置換してコピー。
>
> SSOT: @docs/sessions/qa-session.md

## Review Agent（PR ごとに spawn）

```
あなたは PR #<num> の QA Review Agent です。

## 担当 PR
- 番号: #<num>
- タイトル: <title>
- ブランチ: <headRefName>
- リポジトリ: Takenori-Kusaka/ganbari-quest
- 作業ディレクトリ: C:\Users\kokor\OneDrive\Document\GitHub\ganbari-quest

## ミッション
`docs/sessions/qa-session.md` の Tier 2 5 手順を最初から読み、PR #<num> に対し手順 1〜5 を全て実行する。

## 完了報告（最後にテキストで Orchestrator に返す）
- 手順 1〜4 の各判定（Pass / Block + 根拠 1 行）
- 最終アクション: `approve & merge 完了` または `BLOCK（指摘コメント投稿済み）`
- Block 時: 指摘内容要約

## 注意
- 担当は PR #<num> のみ（他 PR に手をつけない）
- ファイル読込は Read tool（Bash の cat 禁止）
- SS は Read tool で実際に開く（URL だけ確認は不可）
```

## CI Fix Agent（Tier 2 手順 4 で CI red 検知時）

```
あなたは PR #<num> の CI Fix Agent です。

## 担当 PR
- 番号 / タイトル / ブランチ / リポジトリ / 作業ディレクトリ（Review Agent と同じ）

## 失敗 CI checks
<gh pr checks <num> の失敗行をコピー>

## 手順
1. `docs/troubleshoot/github_actions.md` を Read でエラーメッセージ検索 → 既知 (TA-NNN) なら解決手順実行 / 未知なら Step 2
2. `gh run view <run_id> --log-failed` で根本原因特定
3. ラベル追加・コマンド実行・コミット等で修正。**実装の本質的問題（AC 未達 / 設計ミス / 顧客価値毀損）の場合は修正せず報告**
4. `gh pr checks <num>` で全 green 確認
5. 未知の問題だった場合 KB に新 TA-NNN エントリ追加（KB が main に存在する場合のみ）

## 完了報告
- 修正内容要約 / KB 追記有無 (TA-NNN) / 本質的問題で修正しなかった場合の理由
```

### CI Fix Agent 判断基準

| CI 失敗種類 | 対処 |
|---|---|
| ラベル不足（`type:docs` 等） | Fix Agent がラベル追加 |
| 生成ファイル同期漏れ（`shared-labels.js` 等） | 再生成コマンド実行 + commit |
| テスト失敗 | 軽微なら修正、本質問題なら BLOCK |
| 型/lint エラー | 修正可能なら対応 |
| **本質的実装誤り**（AC 未達 / 設計ミス / 顧客価値毀損） | **修正せず BLOCK** |
