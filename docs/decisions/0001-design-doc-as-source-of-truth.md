# 0001. 設計書は Single Source of Truth

- **Status**: Accepted
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265
- **統合元**: 旧 ADR-0003（本 PR で削除、詳細は git 履歴）

## コンテキスト

> 旧 ADR-0003 を renumber した新採番。ADR 10 枠再構成（#1262）の一環。

スタンプカードの仕様を会話で 4 回繰り返す事態が発生（#607）。原因は、会話で決まった仕様が設計書に反映されず、会話コンパクション時に仕様が消失したこと。

## 決定

設計書（`docs/design/`）を実装の Single Source of Truth とする。会話で確定した機能仕様は、必ずその場で該当する設計書に反映する。Issue 本文に書いて「設計書は後で」と先送りすることは禁止。

## 結果

- PR / Issue 完了の Done 基準に設計書更新が含まれる
- CLAUDE.md に設計書更新ルールを明文化
- PR テンプレートに設計書チェック欄を追加

## 関連

- ADR-0009（labels.ts SSOT）— 本 ADR の labels 領域への具体化
- `docs/CLAUDE.md` の「設計書更新ルール」
