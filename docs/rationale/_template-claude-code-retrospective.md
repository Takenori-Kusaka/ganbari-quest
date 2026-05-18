# Claude Code 設定 retrospective YYYY-MM

<!-- 命名規則: NN-claude-code-retrospective-YYYY-MM.md (NN は 2 桁連番、YYYY-MM は実施月) -->
<!-- このテンプレートをコピーして使用してください。すべての "##" セクションは必須です -->
<!-- 詳細プロセス: docs/sessions/po-session.md §「タスク 5: Claude Code 設定 6 ヶ月 retrospective プロセス (#2186)」-->

## 1. 実施情報

- **実施日**: YYYY-MM-DD
- **前回 retrospective**: NN-claude-code-retrospective-YYYY-MM.md (なければ「初回」と記載、関連 Issue #2186 と明記)
- **次回 target date**: YYYY-MM-DD (本回 + 6 ヶ月、`docs/sessions/po-session.md` も同値で更新する)
- **実施者 / セッション**: PO + 補佐 (Claude モデル名 + version を記録: 例 Opus 4.7)
- **きっかけ**: 定期 / インシデント起因 / モデル更新起因 のいずれか

## 2. 対象棚卸結果 (現状件数 + 前回比)

| カテゴリ | 対象 | 現状件数 | 前回比 | 主な変化 |
|---|---|---|---|---|
| `CLAUDE.md` 階層 | ルート / docs/ / src/routes/ / .github/ / infra/ / tests/ + 他 | N 件 | (前回 M 件、+/-) | (新規追加 / 統合 / 削除) |
| `.claude/skills/` | 全 Skills | N 件 | (前回 M 件、+/-) | (新規 / retire / rename) |
| `.claude/agents/` | 全 agents | N 件 | (前回 M 件、+/-) | (新規 / retire / 内容刷新) |
| `.claude/settings.json` | hook / permissions / env | N 件 | (前回 M 件、+/-) | (新規 hook / 削除) |
| `.claudeignore` | context exclude | N 件 | (前回 M 件、+/-) | (拡充 / 縮小) |
| `.vscode/settings.json` | 共有設定 | 有/無 | (前回 有/無) | (項目追加 / 削除) |
| `docs/codebase-map.md` | navigation guide | 有/無 | (前回 有/無) | (拡充 / 縮小) |
| ADR active | `docs/decisions/` 直下 | N 件 | (前回 M 件、+/-) | (新規 ADR / archive 移動 / supersede) |
| ADR archive | `docs/decisions/archive/` | N 件 | (前回 M 件、+/-) | (移動元 / 削除) |

## 3. 観点別所見

### 観点 1: 新モデルで不要 / 阻害となる指示の有無

旧モデル制約回避ハック、deprecated tool 名残、文体・冗長指示の刷新候補を列挙。

- [ ] **CLAUDE.md 階層**: ...
- [ ] **`.claude/skills/`**: ...
- [ ] **`.claude/agents/`**: ...
- [ ] **`.claude/settings.json`**: ...
- [ ] **その他**: ...

**改訂候補**: (具体的なファイル + 改訂方針 + 後続 Issue 起票候補)

### 観点 2: 累積 Issue 起票で増えた knowledge の SSOT 化整理

feedback memory の肥大化、CLAUDE.md / Skill / agent への昇格候補。

- [ ] **memory → CLAUDE.md 昇格候補**: ...
- [ ] **memory → Skill 昇格候補**: ...
- [ ] **CLAUDE.md → Skill 移行候補** (長文化箇所): ...
- [ ] **重複 / 矛盾箇所**: ...

**改訂候補**: ...

### 観点 3: Skill / agent の利用頻度 retire 判断

利用頻度 0 件の Skill / agent は retire 対象、稀少利用は archive 候補。

| Skill / agent | 直近 6 ヶ月利用 | 判定 (継続 / archive / retire) | 理由 |
|---|---|---|---|
| (Skill 名) | 0-N 件 | ... | ... |

**改訂候補**: ...

### 観点 4: ADR TOP 10 ルール vs 実態の乖離

`docs/decisions/README.md` TOP 10 ルール (≤ 10 件) + per-ADR 上限 (≤ 150 行 / ≤ 7 セクション)。

- **active 件数**: N 件 / 上限 10 件 (超過 M 件)
- **per-ADR ボリューム違反**: (ADR 番号 + 行数 + セクション数)
- **archive 候補**: ...
- **supersede / 統合候補**: ...
- **1-in-1-out 整備が必要な ADR**: ...

**改訂候補**: ...

### 観点 5: 累積失敗パターンの再発検証 (ADR-0010 §7 連携)

ADR-0010 §7 機能完成度 checklist + 過去 Phase 累積失敗 (Push-3 #2117 / MP-4 #2139 / RS-5 #2154 / MN-4 #2167 / AN-5 #2176 等) が retrospective 時点で:

- 陳腐化していないか (現状仕様 / コード構造と整合しているか)
- 新パターンが追加されていないか (直近 6 ヶ月で連続失敗した Phase / Issue)
- 漏れがないか (現存パターンで救えなかった失敗事例)

| パターン | 該当 Issue | 状態 (有効 / 陳腐化 / 改訂要) | 備考 |
|---|---|---|---|
| Push-3 | #2117 | ... | ... |
| MP-4 | #2139 | ... | ... |
| RS-5 | #2154 | ... | ... |
| MN-4 | #2167 | ... | ... |
| AN-5 | #2176 | ... | ... |
| (新規パターン) | ... | ... | ... |

**改訂候補**: ADR-0010 §7 checklist の追加 / 削除 / 改訂、後続 Issue 起票候補。

## 4. 改善項目サマリ (後続 Issue 候補)

観点 1-5 で抽出した改善項目を後続 Issue 起票候補としてリスト化。本 retrospective rationale 内で実装は完結させない (rationale = 記録、実装は別 PR)。

| 項目 | 担当観点 | 起票テンプレ | priority | Issue # (起票後) |
|---|---|---|---|---|
| (改善項目 1) | 観点 N | `process_ticket.yml` / `dev_ticket.yml` | low/medium/high | #XXXX |

## 5. 次回 retrospective に向けた申し送り

- **次回 target date**: YYYY-MM-DD (本ファイル §1 と同値)
- **継続観測項目**: (本回判断保留、次回に確認したい論点)
- **想定リスク**: (次回までの 6 ヶ月で発生しうる構造変化、Claude モデル更新予定等)

## 6. 関連

- **議論源 Issue / PR**: #2186 (プロセス策定) / 本回 retrospective 該当 Issue #XXXX (あれば)
- **関連 ADR**:
  - [ADR-0003](../decisions/0003-issue-quality-standard.md) (Issue 品質)
  - [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md) (Pre-PMF、§7 機能完成度 checklist)
  - `docs/decisions/README.md` (ADR 棚卸ルール、本 retrospective と同タイミング実施)
- **影響を受ける設計書 / SSOT**:
  - `docs/sessions/po-session.md` (target date 更新)
  - `docs/rationale/01-README.md` (rationale 一覧テーブル更新)
  - `CLAUDE.md` (ルート / 階層、観点 1-2 改訂時)
  - `.claude/skills/` / `.claude/agents/` / `.claude/settings.json` (観点 1-3 改訂時)
