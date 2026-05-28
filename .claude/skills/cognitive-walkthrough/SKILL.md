---
name: Cognitive Walkthrough
description: Use when reviewing customer-facing UI flow (e.g. before customer review or Ready 化). Plays a first-time user persona and applies NN/G's 4 questions (Q1-Q4) to each step of a critical user journey to capture "動くが分かりにくい" UX failures that functional E2E (#2544) cannot detect.
---

# Cognitive Walkthrough (#2554、CX-DoR 条件 2)

機能 E2E (#2544 goal 完遂) が緑でも、**「動くが分かりにくい」UX 破綻**は捕捉できない (#2558 で実証: bug-2 分離ボタン / bug-3 謎用語 / bug-4 独自 UI / bug-1 dead-end が機能 E2E 緑のまま 1 分で顧客発見)。本 skill は評価者 (人間 or AI) が **初見ユーザー persona** で critical flow をステップごとに歩き、NN/G の **4 質問**を問うことで明白な 85% 級 UX 問題を実ユーザー 0 人 / コーディング前から捕捉する (NN/G「relatively cheap」、CX research §B-1 / §3-3)。

接続: `tests/CLAUDE.md` §「顧客レビュー前 CX 版 DoR (8 条件 SSOT、#2553)」 の **条件 2** を担当する。発展元: [`customer-voice` skill](../customer-voice/SKILL.md) (3 persona × 5 評価軸の汎用フィードバック) を walkthrough 4 質問へ specialize した skill。

---

## いつ使うか (trigger)

- customer-facing PR (`src/routes/**` UI 変更 / `src/lib/marketplace/**` / `src/lib/features/**`) の Ready 化前
- 顧客レビュー前の EPIC-merge gate
- 新規 critical flow 設計時 (コーディング前から適用可、NN/G 推奨)
- 既存 critical flow に bug 報告があった場合の再評価

**使わない場面**:

- 純粋な docs / infra / refactor 内部 PR (UI 変更なし)
- 非 critical flow (admin の settings 詳細など、最初の 5 人が触らない領域、ADR-0010 過剰防止)

---

## NN/G の 4 質問 (本 skill の中核)

評価者が各ステップで以下を **Yes/No + 理由**で答える ([NN/G 逐語](https://www.nngroup.com/articles/cognitive-walkthroughs/) / [Wikipedia](https://en.wikipedia.org/wiki/Cognitive_walkthrough)):

| # | NN/G 原文 | 日本語訳 | この質問が捕捉する failure class |
|---|---|---|---|
| **Q1** | Will users try to achieve the right result? | 正しい結果を得ようとするか? | ゴール認知ズレ (例: 「追加」が「activity 追加」と「member 追加」のどちらか不明) |
| **Q2** | Will users notice that the correct action is available? | 正しい操作が利用可能と気づくか? | 操作の発見性 (例: dropdown 内の menu 項目 / 隠れた FAB / off-screen な CTA) |
| **Q3** | Will users associate the correct action with the result they're trying to achieve? | 操作を目的の結果と結びつけられるか? | 用語/動線の認知整合 (例: 「パックから追加」が「活動追加」と結びつかない) |
| **Q4** | After the action is performed, will users see that progress is made toward the goal? | 操作後に進捗が見えるか? | フィードバック欠落 (例: 無反応 / cancel 不能 / 完了表示なし) |

**1 ステップでも No が 1 件出たら fail**。fail した質問は具体的 evidence (screenshot 範囲 or 用語 or 動線) と共に記録する。

---

## 初見ユーザー persona

`customer-voice` skill の 3 persona を walkthrough 文脈で specialize:

### Persona A: 3 歳児の親 (30 代、IT 中)

- **walkthrough context**: 子供を膝に座らせながら片手で操作、認知負荷耐性低い
- **疑似質問**: 「とりあえずタップしてみる」前に Q1-Q2 の答えが出るか
- **典型 failure**: 専門用語 / dropdown 階層 / 認証フリクション

### Persona B: 小学 3 年生の親 (40 代、IT 中-高)

- **walkthrough context**: 夕食後 5 分で活動・ごほうび整備、目的指向
- **疑似質問**: 「○○ を達成したい」→ Q3 (操作と結果の結びつき) を最重視
- **典型 failure**: 用語不統一 / 重複 CTA / 独自 UI 分岐 (#2558 で実証)

### Persona C: 中学 2 年生本人 (14 歳、IT 高)

- **walkthrough context**: 親に見られたくない、ダサさ嫌悪
- **疑似質問**: Q1 (そもそも使う気になるか) + Q4 (進捗フィードバックの質感)
- **典型 failure**: 子供向けっぽい誇張 / 連続誘導 (ADR-0012 Anti-engagement 違反)

**critical flow ごとに 1-2 persona を選んで walkthrough を 1 周する**。全 3 persona で全 flow を網羅する必要はない (Pre-PMF 過剰防衛、ADR-0010)。flow と persona のマッピング推奨:

| critical flow | 主 persona | 補 persona |
|---|---|---|
| 活動を追加する (admin) | B 小 3 親 | A 3 歳親 (簡略性) |
| 子供が活動を記録する (child) | A 3 歳親 | C 中 2 本人 (ダサさ) |
| ごほうびを交換する (child) | C 中 2 本人 | A 3 歳親 |
| 報酬リクエスト承認 (admin) | B 小 3 親 | — |
| チェックリスト import → child 表示 | B 小 3 親 | A 3 歳親 |

---

## AI と人間の担当分担 (重要、CX research §3-1 / §C 整合)

AI (Vision LLM) は **Nielsen heuristics の一部に弱点**がある (GPT-4o 比較研究):

| heuristic | AI 強弱 | 担当 |
|---|---|---|
| **H2** 現実世界との一致 (Match between system and real world) | ⭐⭐⭐ 強 | AI 補助可 |
| **H3** ユーザー制御と自由 (User control and freedom) | ⭐ **弱** | **人間が必ず確認** |
| **H4** 一貫性と標準 (Consistency and standards) | ⭐⭐ 中 | AI 補助 + 人間検証 |
| **H6** 記憶より認識 (Recognition rather than recall) | ⭐ **弱** | **人間が必ず確認** |
| **H8** 美的・最小限デザイン (Aesthetic and minimalist design) | ⭐⭐⭐ 強 | AI 補助可 |
| **H9** エラー回復 (Help users recover from errors) | ⭐ **弱** | **人間が必ず確認** |

→ **H3 / H6 / H9 は AI 評価を主担保にしてはならない** (open-ended AI audit は false-positive 80% / harmful advice 11%、Baymard 2024)。本 skill は **AI が pre-analysis (Q1-Q4 構造化 prompt 適用) → 人間が H3/H6/H9 を重点検証 + AI hallucination 除去**の 2 段構成で運用する。

---

## 構造化 prompt テンプレート (AI 評価者用)

vision LLM (Claude / GPT-4o) に critical flow の screenshot 連番 (`scripts/capture.mjs` 出力) を渡す際の **task-grounded + persona + 4 質問** prompt。研究 §3-3 整合 (false-positive 80% を 23-27% に低減):

```
あなたは初めてこのアプリを触る「{persona 名 + 属性}」です。
目標: この画面で「{具体 task}」(例: 子供に新しい活動を追加する)。
添付は操作中の連続スクリーンショットです。

各スクリーンショットで以下の Cognitive Walkthrough 4 質問に Yes/No + 理由で答えてください:
 Q1 正しい結果を得ようとするか / Q2 正しい操作が利用可能と気づくか /
 Q3 その操作を目的の結果と結びつけられるか / Q4 操作後に進捗が見えるか

加えて Nielsen heuristics のうち H2(現実世界との一致) / H4(一貫性) / H8(簡潔さ)
について、専門用語・経路重複・期待と違う遷移があれば指摘してください。
※ H3 / H6 / H9 は人間が後段で別途検証するため本回答には含めない。

推測で問題をでっち上げず、スクリーンショットに実在する根拠のみ挙げること。
不明な箇所は「不明」と答え、推測しない (hallucination 抑制)。
```

**禁忌**:
- 「この画面の UX を評価して」open-ended 問い (false-positive 80%、harmful advice 11%、Baymard)
- persona / task 指定なしの汎用評価 (research §3-1)
- AI 単独で Ready 化判定 (必ず人間 filter、§3-1 human-in-the-loop)

---

## セッションシート (出力フォーマット)

walkthrough 1 セッション = 1 critical flow × 1 persona。以下を Markdown table で記録し、customer-facing PR の body or EPIC umbrella の「テスト & 安全装置セルフチェック」section に証跡として添付する:

```markdown
### Cognitive Walkthrough session - {flow 名} × {persona}

- **flow**: {例: 活動を追加する (/admin/activities → `+ 追加` menu → marketplace 遷移)}
- **persona**: {例: B 小 3 親}
- **task**: {例: 子供 1 人に活動「歯磨きした」を追加する}
- **評価者**: {人間 / AI + 人間 filter}
- **日時 / SS source**: {例: 2026-05-29、`scripts/capture.mjs --flow ...`}

| ステップ | screenshot | Q1 | Q2 | Q3 | Q4 | 補足 (heuristic 違反) |
|---|---|---|---|---|---|---|
| 1. /admin/activities トップ | ss-step-1.png | Yes | Yes | Yes | — | — |
| 2. `+ 追加` クリック → dropdown | ss-step-2.png | Yes | Yes | **No (Q3)** | — | H4 違反: 「みんなのテンプレートから探す」が `/marketplace` 遷移と気づきにくい |
| 3. /marketplace でパック選択 | ss-step-3.png | Yes | Yes | Yes | Yes | — |
| 4. 取込確認 dialog | ss-step-4.png | Yes | Yes | Yes | **No (Q4)** | H9 違反: 取込中の loading 表示なし、dialog 閉じるまで無反応に見える |

**判定**: 2 件 No → fail。fix 必要箇所:
- ステップ 2: dropdown 項目に「(marketplace 画面へ移動)」補足追加 or icon で遷移先明示
- ステップ 4: 取込実行時に loading spinner + 件数 progress 表示
```

session sheet は `docs/cx-walkthrough-sessions/{YYYY-MM-DD}-{flow-slug}-{persona}.md` に永続保存する案もあるが、Pre-PMF 期は **PR body 添付のみで十分** (過剰永続化を避ける、ADR-0010)。

---

## #2558 4 bug 逆引き表 (本 skill が捕捉する failure class)

本 skill が #2558 で発生した 4 bug をそれぞれ事前に捕捉できることの実証:

| bug | failed 質問 | persona 視点 | walkthrough 検出ステップ |
|---|---|---|---|
| **bug-1** dead-end (取込ボタン無反応・cancel 不能) | **Q4** | B 小 3 親が「追加」押下後、何も起きない・dialog 閉じない → 進捗 visible でない | dialog 内 step、Q4 No → loading or 結果反映が必須 |
| **bug-2** 「一括追加」と「追加」分離 | **Q2 + Q3** | B 親が header の 2 ボタンのどちらを押すべきか判断できない | header step、Q2/Q3 No → 1 つの `+ 追加` menu に集約必須 |
| **bug-3** 「パックから追加」謎用語 | **Q3** | B 親が「パック」を内部語彙と認識せず、活動追加と結びつかない | menu 項目 step、Q3 No → `TEMPLATE_TERMS.userFacing` 等 SSOT 用語へ |
| **bug-4** 独自 UI 分岐 (marketplace に行かない) | **Q3** | B 親が「みんなのテンプレートから探す」を押したら admin 内ブラウズ UI に飛ばされ、`/marketplace` 期待と食違う | menu → 次画面 step、Q3 No → `/marketplace` 遷移一本化 |

→ #2558 4 bug は **全件 walkthrough で事前に捕捉可能** (NN/G「relatively cheap」85% 級 UX 問題 捕捉実例)。

---

## CX-DoR (#2553) との接続

[`tests/CLAUDE.md` §「顧客レビュー前 CX 版 DoR」](../../../tests/CLAUDE.md) **条件 2**「同一 CUJ を Cognitive Walkthrough 4 質問で 1 周し全 Yes」を本 skill で担当。

| CX-DoR cadence | 本 skill の運用 |
|---|---|
| **per-PR (軽量)** | customer-facing PR の Ready 化前に、変更領域の critical flow × 主 persona 1 件で walkthrough 1 セッション。session sheet を PR body に添付 |
| **EPIC-merge / 顧客レビュー gate (重量)** | 全 critical flow × 1-2 persona で walkthrough、全セッション sheet を EPIC umbrella に集約 |

---

## やらないこと (本 skill 範囲外、ADR-0010 過剰防止)

- **AI-vision UX review skill (C-5)**: open-ended audit でなく、本 skill の 4 質問 prompt 経由のみ。general「UX を評価して」prompt は別 POC (C-5 #2553 関連 follow-up Issue) で精度検証中、本 skill では採用しない
- **AI 自律 exploratory agent (C-6)**: dead-end / unreachable button 検出用、別 POC (C-6 follow-up)
- **全画面 walkthrough**: critical flow (`tests/CLAUDE.md` §「CUJ」5 件) のみ
- **moderated user testing 多数招集**: 最初の 5 人は walkthrough 後の深い問題発見に温存 (NN/G 5-user rule、研究 §B-4)
- **multi-agent committee**: F1 0.91 だが API コスト過剰、Pre-PMF 不採用 (research §3-4)

---

## 関連

- 親 EPIC: [#2459 Test Strategy 全体最適化](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2459)
- 基盤: [#2544 機能基盤](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2544) (条件 1/7/8 担当、PR #2556 merge 済)
- 兄弟: [#2553 CX C-1 DoR 明文化](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2553) (本 skill が条件 2 を担当、PR #2619 merge 済) / [#2555 C-3 用語 lint](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2555) (条件 3/4 担当、PR #2587)
- 発展元 skill: [`customer-voice`](../customer-voice/SKILL.md) (3 persona × 5 評価軸の汎用フィードバック)
- research: CX 検証手法研究ノート (主セッション内 `tmp/` 配下、git 管理外。要点は本 SKILL §「NN/G の 4 質問」と §「AI と人間の担当分担」に統合済)

### 外部参照

- NN/G Cognitive Walkthrough: https://www.nngroup.com/articles/cognitive-walkthroughs/
- Wikipedia 4 questions: https://en.wikipedia.org/wiki/Cognitive_walkthrough
- usabilitybok: https://www.usabilitybok.org/cognitive-walkthrough/
- Baymard Institute (AI UX audit false-positive 80% 研究): https://baymard.com/
- NN/G How Many Test Users in a Usability Study: https://www.nngroup.com/articles/how-many-test-users/ (5-user rule)
