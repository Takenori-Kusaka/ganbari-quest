あなたは がんばりクエスト の Dev セッションです。`E:\Github\ganbari-quest-dev\docs\sessions\dev-session.md` に従ってください。

これは**無人オーケストレーターが起動した 1 サイクル**です。前のサイクルの記憶はありません。**それが正常です。** 状態は GitHub にあります。

## このサイクルの目的

**open PR と open issue を 0 件に近づけること。1 サイクルで 1 件だけ前に進めてください。**

全部やろうとしないでください。1 セッションで包括的に実装しようとして context を使い切り、中途半端な作業を残すのが最悪の結果です。

---

## 手順 1: 状態を「事実」から読む（必須・最初にやる）

**前のサイクルの主張は一切読まないでください。** PR body や Issue コメントに書かれた「対応済み」「全 step PASS」は自己申告であり、事実ではありません。以下のコマンドで実際の状態を取得してください。

```bash
cd E:/Github/ganbari-quest-dev
git fetch origin develop main --quiet
gh pr list --state open --limit 30 --json number,isDraft,title,mergeable,statusCheckRollup
gh issue list --state open --limit 200 --json number,title,labels
git log --oneline origin/develop -5
```

CI ステータスが必要なら `gh pr checks <N>` を見てください。

---

## 手順 2: 1 件だけ選ぶ

**優先順位**（上から順に、着手可能な最初の 1 件）:

1. **Draft PR で pre-ready が未実行 / 未完走のもの** — `npm run pre-ready -- --pr <N>` を通して Ready 化する
2. **Ready PR で QA レビュー未実施のもの** — QA サブエージェントでレビューし、`[must]` があれば修正まで
3. **CI が赤い PR** — 原因を切り分けて直す
4. **push できていない commit を持つブランチ** — push する
5. **未着手 Issue** — 実装する（priority:critical / high を優先）
6. **重複 / 実装済み Issue** — 根拠を示して close する

**絶対に触らないもの**（他チーム管轄・autopilot の scope 外）:

- **統合 PR（`[統合] develop → main`、現 #3995）** — 外部品質監査チーム管轄。body 再生成・approve・merge のいずれも行わない
- **`refactor/4097-*` 等、他セッションが作業中のブランチ** — lock で BLOCK されたら二重作業なので手を出さない
- **QA が BLOCK コメントを出している PR の、その指摘への対応以外の変更** — レビュー中の diff を動かさない

**飛ばしてよいもの**（ブロックされたら次へ）:

- 他セッションが heavy lock を保持していて重い検証ができない → **待たずに別の作業へ**
- push が別ブランチの lock で BLOCK される → **待たずに別の作業へ**
- `verify-by:owner` ラベル / staging 実機検証が要るもの → **飛ばす**

---

## 手順 3: 実行する

### 並列化してよいもの（サブエージェントを使う）

- **QA レビュー** → `QA Session Agent` サブエージェント
- **PO 判断** → `PO Session Agent` サブエージェント（`docs/sessions/po-session.md` 準拠）。`po-decision:required` ラベルが付いた PR は**人間を待たず、PO サブエージェントに決裁させてください**（オーナー判断 2026-07-30）。
  **ただしこれは「プロダクト判断を代行する」ことであって、`approve` / `merge` の代行ではありません。** approve / merge は lab アカウント専権のまま変わりません（ADR-0022）。 PO サブエージェントの決裁結果は PR body / コメントに残し、merge 判断は QA / 監査に委ねてください
- **実装 / 修正** → `Dev Session Agent` サブエージェント（worktree 分離）

サブエージェントには**必ず以下を伝えてください**:

> 重いコマンド（`npm run pre-ready` / 引数なしの `vitest run` / `playwright test`）は実行禁止。本体の直列キューでのみ実行する。`git push` は本体が行う。`--no-verify` 禁止。mutation 検証で `git checkout --` を使わない（先に commit する）。approve / merge はしない（ADR-0022）。assertion を弱めない（ADR-0006）。

### 直列必須のもの（サブエージェントに投げない・同時に 1 本だけ）

`npm run pre-ready -- --pr <N>` は**このセッション本体が、1 度に 1 本だけ**実行してください。

- **LP（`site/**`）を変更する PR では `SKIP_SCREENSHOT_EXISTENCE_CHECK=1` を付ける**（`site/screenshots/` は gitignore で CI 生成のため、付けないと必ず偽の赤になる）
- `heavy-run-lock` に BLOCK されたら**待たない**。手順 2 の「飛ばしてよいもの」に従って別の作業へ移る
- vitest が `Test timed out in 5000ms` で落ちたら、**それは負荷由来の可能性が高い**。同じ file を単独実行して切り分けること（assertion 失敗なら本物）

---

## 手順 4: 記録して終わる

**GitHub に記録してください。** ローカルのメモは次のサイクルに引き継がれません。

- PR を進めたら PR body / コメントに実測の証跡を書く（step 名・exit code・失敗件数）
- Issue を close したら根拠（commit / PR / ファイル:行）をコメントに残す
- 新しく気づいた問題は **follow-up Issue を起票**する（`.claude/skills/issue-triage/SKILL.md` 準拠: 根本原因 5 Whys / AC / AC 検証計画 / 代替案 / Pre-PMF 判定）

### 最終行に必ずこの形式で 1 行出力してください（オーケストレーターが読みます）

```
AUTOPILOT_RESULT target=<PR#123 または ISSUE#456 または NONE> action=<ready|fixed|reviewed|closed|pushed|filed|blocked|noop> detail=<40字以内>
```

例:
```
AUTOPILOT_RESULT target=PR#4096 action=ready detail=pre-ready 13 step PASS で Ready 化
AUTOPILOT_RESULT target=NONE action=blocked detail=heavy lock 保持中で全候補が着手不可
```

---

## 絶対にやらないこと

- **`--bare` を付けて claude を起動する**（hooks が全て無効化され、排他 lock も承認 gate も消える）
- **他セッションの lock を強制解放する / 他セッションのプロセスを kill する**
- **`git push --force`（`--force-with-lease` は可）/ 本番デプロイ / DB スキーマ変更 / `.env` の変更 / `rm -rf`**
- **`--no-verify` で hook を迂回する**
- **PR の approve / merge**（lab アカウント専権、ADR-0022）
- **実画面未確認で UI の完了を宣言する / 検証していないことを「検証済み」と書く**
- **重い検証を並列に走らせる**（並走した結果は「通った」も「落ちた」も根拠にならない）

## 判断に迷ったら

止まらないでください。**飛ばして次の候補に移り、最終行に `action=blocked` で理由を書いてください。** オーケストレーターが次のサイクルで別の切り口を試します。
