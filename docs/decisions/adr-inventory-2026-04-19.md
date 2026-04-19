# ADR 棚卸レポート (2026-04-19)

ADR-0040（実行モード × ライセンス統括アーキテクチャ）起票に先立って、0001〜0039 の累積 39 件を棚卸した結果。

## サマリ

| 区分 | 件数 | 備考 |
|------|------|------|
| active-primary（現在も能動的に参照） | 12 | CI / PR レビュー / 設計ポリシーで毎週以上使用 |
| active-background（背景知識として残す） | 21 | 主要判断の補助。改訂不要 |
| superseded-already（既に後継あり） | 2 | ADR-0002, ADR-0027 |
| **新たに supersede / deprecate 対象** | **3** | ADR-0008, ADR-0009, ADR-0016 ← 本棚卸で変更 |
| 移管なし | 1 | ADR-0039（本タスクの前身）は active-primary |

## ステータス変更（本日実施）

### ADR-0008（年齢モード5重複の変更リスク管理）→ **superseded**

- ADR-0008 自身が「#567 の統合完了後、本 ADR は superseded に変更する」と記載
- 検証: `src/routes/(child)/[uiMode=uiMode]/` にパラメータルート統合済み（5 重複ディレクトリは存在しない）
- 代替: ADR-0035（設計ポリシー先行確認フロー）+ 統合済みルート構造自体が重複を物理的に不可能化
- 実施内容: ADR-0008 ヘッダに `superseded` / 統合完了日追記、README 一覧と docs/CLAUDE.md 取り消し線

### ADR-0009（server→client 型契約の安全性確保）→ **superseded**

- 「短期（#567 統合前）」のガードルール中心だが、#567 は統合完了
- 「中期」施策（共通型定義ファイル）は `src/lib/domain/` の既存型で運用済み
- `as Record<string, unknown>` + 個別キャストパターンは Svelte 5 Runes 移行 + ADR-0037（labels SSOT）で実質解消
- 代替: 個別の strict-type ガード + ADR-0037（labels SSOT）/ ADR-0031（スキーマ変更時互換性テスト）が後継
- 実施内容: `superseded` に変更

### ADR-0016（ダイアログ/オーバーレイの状態管理方針）→ **superseded by ADR-0019**

- ADR-0019（ダイアログ管理は FSM でスクラップ＆ビルド）冒頭に「置き換え | ADR-0002」と記載
- ADR-0016 は ADR-0002 の中間版で、`OverlaysSection` キュー実装を推奨
- ADR-0019 は「`OverlaysSection.svelte` の内部キュー（queue, activeOverlay, enqueueOverlay, dequeueOverlay）を廃止する」と明記
- したがって ADR-0016 の指針は ADR-0019 で完全に上書きされている
- 実施内容: `superseded by ADR-0019`、README 一覧・docs/CLAUDE.md 取り消し線

## ADR-0040 起票で直接参照する ADR（トップ5）

| ADR | 役割 | ADR-0040 でどう使うか |
|-----|------|---------------------|
| [0024] プラン解決 (resolvePlanTier) の責務分離パターン | 現行のプラン解決ロジックの正典 | EvaluationContext の `plan` フィールドの解決ソース |
| [0025] License ↔ Stripe Subscription 因果関係 | プラン状態の真実源 | RuntimeMode × LicenseState の依存関係マトリクス |
| [0026] ライセンスキーアーキテクチャ | NUC 本番モード特有のライセンス検証 | `mode=nuc-prod` の EvaluationContext に license-key を注入 |
| [0029] Safety Assertion Erosion Ban | Typed env での required-env 強制 | `src/lib/runtime/env.ts` の Zod `.required()` 追加時の遵守基盤 |
| [0034] Pre-PMF セキュリティ最小化方針 | スコープ制御 | ADR-0040 で「やらない」ことを宣言する根拠 |

## active-primary ADR（毎週以上参照）

0003 (設計書 SSOT) / 0005 (Critical 修正品質ゲート) / 0006 (PR レビュー文書化) / 0010 (Issue 起票・クローズ品質) / 0017 (テスト品質 ratchet) / 0018 (Issue 根本原因必須) / 0020 (テスト ratchet 強制) / 0029 (Safety Assertion Erosion Ban) / 0032 (静的解析ツール tier) / 0035 (設計ポリシー先行確認) / 0037 (labels SSOT) / 0038 (AC 検証エビデンス)

これらは PR ゲート / CI / セッションエージェントで毎日機械参照されるため **改訂不要**。

## 今後の運用

- 次回棚卸は ADR 番号が 0060 に達した時点（概ね 6 ヶ月後）
- 「新 ADR 追加 → 同じ番号の CLAUDE.md / README.md / `.github/copilot-instructions.md` 3 点更新」は ADR-0003 に記載済み
- superseded ADR も **物理削除禁止**（ADR README 命名規則 §45）
