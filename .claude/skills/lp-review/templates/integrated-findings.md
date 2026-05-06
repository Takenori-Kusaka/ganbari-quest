# Integrated Findings — PO 統合

3 専門 Agent（UI/UX / Consultant / PM）の findings を統合し、4 決定論点 + Issue 起票計画を立てる。

## 入力サマリー

| Agent | Critical | Major/High | Minor/Medium | 合計 |
|---|---:|---:|---:|---:|
| UI/UX | | | | |
| Consultant | | | | |
| PM | | | | |
| **合計** | | | | |

## 4 決定論点（PO 確認必要）

3 Agent の指摘から、PO の方針判断が必要な論点を 4 件以下に集約する。各論点は「採用 / 不採用」「優先度」の判断をもたらす。

### 論点 1: <!-- タイトル -->

- **背景**: <!-- どの finding から派生したか -->
- **選択肢**:
  - A: <!-- 案 A -->
  - B: <!-- 案 B -->
- **PO 判断推奨**: <!-- A / B / 未決 -->
- **判断根拠**: <!-- ADR / 事業計画 / V2MOM 整合 -->

### 論点 2-4: <!-- 同上のフォーマット -->

## Issue 起票計画

決定論点を Issue に分解する。`process_ticket.yml` (#1859) 経由で起票。

| ID | タイトル草案 | kind | priority | phase | 該当 finding |
|---|---|---|---|---|---|
| <!-- I-1 --> | <!-- ... --> | <!-- lp-content --> | <!-- medium --> | <!-- P5 --> | <!-- finding-uiux-1, finding-pm-3 --> |
| <!-- I-2 --> | <!-- ... --> | | | | |

## no-touch-zones 整合確認

各 Issue 計画が `materials/no-touch-zones.md` の A-E 節 + 当ラウンド固有項目を侵犯していないか確認する。違反する場合は **Issue 起票しない**（PO 判断で no-touch-zones を緩和する場合は ADR supersede が先）。

## SSOT 引用確認

各 Issue 計画が `materials/po-direct-findings.md` の PO 指摘 ID を 1 行リンクで参照しているか確認する（画像物理パスの二重貼り禁止）。
