# Autopilot セッション — 無人で open PR / open issue を消化する

**SSOT**: 実行体 → `scripts/autopilot.ps1` / 1 サイクルの動作定義 → 本ファイル §3 / 並行排他 → [agent-concurrency.md](agent-concurrency.md)

---

## 1. 設計背景

### 解こうとしている問題

Dev セッションで open PR / open issue を継続消化していると、**セッションが長くなるにつれて自動で次のステップへ進まなくなる**。人間が「続けて」と入力すると再開する。権限プロンプトで待っているのではなく、ターンが終了して戻ってこない。

公式ドキュメントに、症状と整合する記述がある:

> If a single file or tool output is so large that context refills immediately after each summary, **Claude Code stops auto-compacting after a few attempts and shows an error instead of looping.**
> — [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)

Anthropic のエンジニアリングブログも、長時間エージェントの典型的失敗として同じ形を挙げている:

> agents tend to attempt comprehensive implementation in a single session, which **exhausts context and leaves half-finished work.**
> — [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

### なぜセッション内の継続機構では解けないのか

`/loop` / `ScheduleWakeup` / `CronCreate` は、いずれも **同じ会話・同じ context window の中で次のターンを起こす**機構である。

> **Tasks are session-scoped: they live in the current conversation** and stop when you start a new one.
> — [Run prompts on a schedule](https://code.claude.com/docs/en/scheduled-tasks)

したがって context 逼迫が原因なら、これらは同じ壁に当たり続ける。新しいセッションを立てるのは Routines（クラウド、最小 1 時間、ローカルファイル不可）か、**外部から `claude -p` を起動する決定的なプロセス**だけである。

### なぜ上位オーケストレーターを LLM にしないのか

**上位を LLM にすると、上位自身が同じ「長時間で止まる」問題を抱える。** 公式ドキュメントがこれを裏付けている。

- Agent teams の lead は通常の Claude Code セッションであり独自の context window を持つ。公式 Troubleshooting に **「lead が作業完了前にシャットダウンを決めてしまうことがある」** が既知問題として記載されている。Best practices にも「無人で長時間放置するとムダな作業のリスクが上がる」とある。加えて experimental / default 無効
- Dynamic Workflows は「プランをコードに移す」ことでこの問題を回避する設計だが、**セッションを跨げない**（Claude Code を終了すると次のセッションでは最初から）
- Anthropic 公式の長時間ハーネスは、最上位に LLM を置かない。**Initializer 1 回 + Coding Agent 繰り返し**という決定的な再起動構造を採る

**この判断を覆す前に上記 3 点を再確認すること。** 「lead を Claude にすれば柔軟になる」は一度検討して却下した案である。

---

## 2. 設計原則

### 責務分割

| | 決定的側（`scripts/autopilot.ps1`） | LLM 側（1 サイクル = 1 プロセスの `claude -p`） |
|---|---|---|
| 持つもの | セッションのライフサイクル / 上限管理（回数・コスト・時間）/ 停止判定 / 進捗ゼロ検出 / バックオフ / ログ | 次に何をやるかの選択 / 実装 / レビュー判断 / 結果の解釈 |
| context | **持たない**（だから止まらない） | サイクルごとにゼロにリセットされる |

判断能力を捨てずに、止まらない性質を得るための分割である。

### 状態の SSOT は GitHub

open PR / open issue / label / CI ステータス / レビューコメントが、そのまま state machine として機能する。**ローカルに作業状態を持たない。**

`scripts/autopilot.ps1` が持つローカル state（`state.json`）は、サイクル計数・累計コスト・直近の着手対象・停止フラグのみ。これは「上限判定と反復検出」のためであって、作業内容の引き継ぎではない。

### 自己申告を信じない

各サイクルは、前サイクルの主張ではなく **git の事実と実際にコマンドを走らせた結果**から再開する。Anthropic 公式ハーネスの規律をそのまま採る:

> Start the session by **reading the progress notes file and git commit logs, and run a basic test on the development server to catch any undocumented bugs.**

PR body の「全 step PASS」「対応済み」は自己申告であり、事実ではない。

### 排他は既存 hook に委ねる

重い検証（`pre-ready` / `vitest` / `playwright` / `svelte-check`）のマシン全体排他は `.claude/hooks/heavy-run-lock.mjs` が既に機械強制している。**autopilot は lock を再実装しない。** BLOCK（exit 2）をシグナルとして受け、待たずに別の作業へ切り替える。

`claude -p` で起動した worker も同じ hook を読むため、対話セッションや別クローン（QA チーム）との排他はそのまま維持される。

**`--bare` は絶対に使わない。** hooks / CLAUDE.md / skills をすべてスキップするため、`heavy-run-lock` も `gate-approve` も無効化され、重い検証の二重起動が起きる。

---

## 3. 1 サイクルの動作定義（worker に渡すプロンプト SSOT）

`scripts/autopilot.ps1` は本節の内容を `claude -p` に渡す。**プロンプトの実体は `scripts/autopilot-cycle-prompt.md`** で、本節はその設計意図を記す。

| 手順 | 内容 | なぜ |
|---|---|---|
| 1 | `gh pr list` / `gh issue list` / `git log` で**事実**を読む | 前サイクルの主張を信用しない |
| 2 | **1 件だけ**選ぶ | 全部やろうとして context を使い切り中途半端に終わるのを防ぐ |
| 3 | 並列可能なものはサブエージェントへ / 重い検証は本体が 1 本ずつ | 並走した検証結果は「通った」も「落ちた」も根拠にならない |
| 4 | GitHub に記録して終わる | ローカルのメモは次サイクルに引き継がれない |

### 着手優先順位

1. Draft PR で pre-ready 未完走 → 通して Ready 化
2. Ready PR で QA 未実施 → QA サブエージェントでレビュー、`[must]` があれば修正まで
3. CI が赤い PR → 切り分けて修正
4. push 待ちの commit → push
5. 未着手 Issue（critical / high 優先）
6. 重複 / 実装済み Issue → 根拠を示して close

### 飛ばしてよいもの（待たない）

- 他セッションが heavy lock を保持している
- push が別ブランチの lock で BLOCK される
- `verify-by:owner` / staging 実機検証が要るもの

### PO 決裁の扱い

`po-decision:required` ラベルが付いた PR で人間を待たない。**`PO Session Agent` サブエージェントを起動し、[po-session.md](po-session.md) に基づいて決裁させる**（オーナー判断 2026-07-30）。

### サイクルの終了報告

worker は最終行に以下を出力する。`scripts/autopilot.ps1` が正規表現で読み、反復検出に使う。

```
AUTOPILOT_RESULT target=<PR#123|ISSUE#456|NONE> action=<ready|fixed|reviewed|closed|pushed|filed|blocked|noop> detail=<40字以内>
```

---

## 4. 安全弁（5 つすべてが必須）

| # | 安全弁 | 既定値 | 目的 |
|---|---|---|---|
| 1 | 停止フラグファイル | `scripts/.autopilot/STOP` | 外部から即座に止める |
| 2 | サイクル数上限 | 40 | 無限ループ防止 |
| 3 | 累計コスト上限 | $100 | `claude -p` の `total_cost_usd` を加算して判定 |
| 4 | 総経過時間上限 | 720 分 | 放置事故の時間的な蓋 |
| 5 | 進捗ゼロ連続 | 5 回 | 同じ対象を繰り返す / 全候補が blocked のとき人間に返す |

コスト上限は実在の事故を踏まえた必須要件である。30 分間隔ループで prompt cache を外し、1 日で $6,000 を消費した公開事例がある。

### 止め方

```powershell
# 次のサイクル冒頭で終了する（推奨・安全）
New-Item -ItemType File scripts\.autopilot\STOP

# 即時停止
Ctrl+C   # SIGTERM で turn を中断し SessionEnd hook を実行して exit 143
```

background session が残った場合は `claude daemon stop --any`。

---

## 5. 使い方

```powershell
# 動作確認（claude を起動せず判定ロジックだけ流す）
pwsh -File scripts\autopilot.ps1 -DryRun -Once

# 1 サイクルだけ実行して結果を見る
pwsh -File scripts\autopilot.ps1 -Once

# 通常運用
pwsh -File scripts\autopilot.ps1

# 上限を明示する
pwsh -File scripts\autopilot.ps1 -MaxCycles 20 -MaxCostUsd 50 -MaxMinutes 480
```

ログは `scripts/.autopilot/logs/` に出る（`autopilot.log` = 進行ログ / `cycle-NNN.json` = 各サイクルの raw 出力）。

---

## 6. 既知の制約

| 制約 | 内容 |
|---|---|
| **`claude -p` の background subagent 待ち** | デフォルト 10 分で打ち切る。`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` で調整（`0` で無制限）。重い検証を subagent 経由で回す場合は要調整 |
| **サイクル起動コスト** | サイクルごとに CLAUDE.md / skills / MCP をロードし直す |
| **サイクル間の作業記憶がない** | 設計上の意図。引き継ぎたいことは必ず GitHub に書く |
| **1 サイクルの長さ設計** | `pre-ready` が 20〜30 分かかるため、`CycleTimeoutMinutes` は最低でもその倍を確保する |

---

## 7. 関連

- [dev-session.md](dev-session.md) — worker が従う Dev ロール定義
- [po-session.md](po-session.md) — PO 決裁サブエージェントのロール定義
- [qa-session.md](qa-session.md) — QA レビューサブエージェントのロール定義
- [agent-concurrency.md](agent-concurrency.md) — 並行排他の運用規約
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — 本設計の下敷き
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — 外部メモリによる状態引き継ぎ
