# 0031. ADR-0023 廃案 + sub-Issue 7 件帰属マップ

> **archived (2026-05-28)**: 本 ADR の役割 (旧 ADR-0023 sub-Issue 7 件の帰属再構成) は完了済 (sub-Issue 全件 CLOSED + 帰属 comment 配布完了 + 帰属先 ADR 0010 / 0012 / 0013 / 0025 / 0028 に統合済)。現場の常時参照ルールではなく historical record として archive へ移動。
>
> archive 理由: README.md §2026-05-27 棚卸の P1 課題「ADR-0031 の archive 判断 (内容が完全に統合済かの確認後)」を 1-in-1-out 履行で消化 (ADR-0056 起票と引き換え)。新規参照は ADR-0010 / 0012 / 0013 / 0025 / 0028 + 本 archive の帰属マップを SSOT として参照する。

- **Status**: Accepted (archived 2026-05-28)
- **Date**: 2026-05-01
- **Related Issue**: #1780
- **Supersedes**: ADR-0023 (LP マーケティングポリシー Pre-PMF / LP SSOT 注入機構 第 2 世代)
- **Related ADRs**: ADR-0010 / ADR-0011 / ADR-0012 / ADR-0013 / ADR-0016 / ADR-0025 / ADR-0028

## コンテキスト

ADR-0023 は当初「LP マーケティングポリシー Pre-PMF」として起票された。その後 PR #1699 で「LP SSOT 注入機構 (innerHTML + DOMPurify)」へ実質的にリネーム（第 2 世代提案）され、配下に sub-Issue 7 件（#1591 / #1597 / #1593 / #1600 / #1602 / #1603 / #1595）が紐付いた。

しかし以下の 3 つの構造的問題が顕在化した:

1. **責務肥大**: 1 ADR が「Pre-PMF Issue 優先度 / LP マーケポリシー / LP SSOT 注入機構 / PMF 判定 / アナリティクス / 解約・卒業 / sub-Issue 群」という 7 領域に跨る巨大化
2. **重複ガバナンス**: ADR-0010 (Pre-PMF スコープ判断) / ADR-0012 (Anti-engagement) / ADR-0013 (LP truth) / ADR-0025 (LP SSOT 注入機構) / ADR-0028 (founder 動線) との論点重複
3. **将来 ADR 起票判断の不能**: 「ADR-0023 にもう一つ §IXX を生やす vs 別 ADR を立てる」を分岐する基準が無い

ADR ガバナンスの将来判断のため、ADR-0023 を **Deprecated** にし、sub-Issue 7 件は既存 ADR (0010 / 0011 / 0012 / 0013 / 0016) に **分割帰属** させる必要がある。

## 検討した選択肢

### 選択肢 A: ADR-0023 を archive 化 + sub-Issue を既存 ADR に分割帰属（**採用**）

- 概要: ADR-0023 を Deprecated 化し、sub-Issue 7 件は内容に応じて ADR-0010 / 0011 / 0012 / 0013 / 0016 に帰属させる帰属マップを本 ADR に残す
- メリット: ADR の責務境界が回復、将来の ADR 起票判断が「論点が ADR-0010 / 0012 / 0013 のどれに該当するか」で判断可能に
- デメリット: 既存ドキュメント・コード内の `ADR-0023` 参照（>100 ファイル）が一気に陳腐化 → 一括書換コストが発生
- Pre-PMF コスト: 新 ADR 1 件 + archive ファイル 1 件 + 主要訂正 5 箇所 + sub-Issue comment 7 件で完遂可能（ADR-0010 整合）

### 選択肢 B: ADR-0023 を更に分割（ADR-0023a / 0023b ...）して論点ごとに新規 ADR を生やす

- 概要: ADR-0023 §I1〜§I13 を全部別 ADR として起票
- メリット: 履歴の対応が機械的に明確
- デメリット: ADR 件数が一気に 7+ 件増える → ADR 棚卸（10 active 上限ルール）と矛盾。ADR-0010 / 0012 / 0013 と重複 ADR を新規追加することにもなる
- Pre-PMF コスト: 新 ADR 7+ 件 + 棚卸再実施 → 過剰スコープ

### 選択肢 C: ADR-0023 をそのまま温存し、論点が来るたびに既存 ADR にぶら下げる

- 概要: 廃案宣言せず、実質的に dead reference の状態を放置
- メリット: 一見コストゼロ
- デメリット: ガバナンスが曖昧なまま将来 ADR 起票判断ができない（PO 提起の本来の課題が未解決）。`ADR-0023` 参照の「現役か旧か」が判別不能
- Pre-PMF コスト: 一見ゼロだが、ガバナンス債務が積み上がり、**将来の ADR 棚卸（ADR-0010 §6 棚卸ルール）の度に同じ議論が再発**する

**選定**: A を採用。ADR 件数を増やさず、既存 ADR の責務境界に再帰属させることで Pre-PMF ガバナンスを最小コストで回復する。

## 決定

### 1. ADR-0023 を Deprecated 化

- `docs/decisions/0023-marketing-policy-pre-pmf.md` は git 履歴上も実体ファイルとしては存在しないが（既に archive プロセスで削除されたため）、本 PR (#1780) で `docs/decisions/archive/0023-marketing-policy-pre-pmf.md` をプレースホルダとして新規作成し、冒頭に **Deprecated バナー + 帰属先案内** を記載する
- 旧 ADR-0023 の論点は本 ADR-0031 と帰属先 ADR (0010 / 0012 / 0013 / 0025 / 0028) を SSOT として参照する

### 2. sub-Issue 7 件の帰属マップ

| sub-Issue | タイトル | 帰属先 ADR | 帰属理由 |
|-----------|---------|----------|---------|
| **#1591** | infra: ADR-0023 I2 — DynamoDB analytics provider 有効化 + umami/Sentry プロバイダ削除 | **ADR-0013 (LP truth)** + 補完: ADR-0010 (Pre-PMF) | 外部 SaaS analytics を採用しないと LP で訴求する以上、LP 訴求の事実根拠（実装で外部送信ゼロ）を担保する。Pre-PMF コスト最小化（ADR-0010）と整合 |
| **#1597** | marketing: ADR-0023 I5 — LP「アナログ vs デジタル」優位訴求改善（離脱要因 #1 対応） | **ADR-0013 (LP truth)** | LP 訴求の事実整合（自動集計 / 3-18 歳継続 / 卒業設計 / 場所自由は実装で確認可能）と LP 訴求改善は ADR-0013 の Committed 区分の責務 |
| **#1593** | fix: ADR-0023 I6 — Web Push 通知の対象監査（親/子端末特定 + Anti-engagement 適合化） | **ADR-0010 (Pre-PMF)** + 補完: ADR-0012 (Anti-engagement) | 子供端末への通知配信を機構レベルで遮断する設計判断。Pre-PMF セキュリティ最小化（ADR-0010 §2）+ Anti-engagement 原則（子供 UI に侵襲的演出を持ち込まない）の二重根拠 |
| **#1600** | feat: ADR-0023 I9 — 初月「価値プレビュー」体験設計（マイルストーン演出 + 30日後プレビュー） | **ADR-0013 (LP truth)** + 補完: ADR-0012 (Anti-engagement) | 初月価値プレビューは LP「30 日で○○の差」訴求の事実根拠（ADR-0013 Committed）。同時に滞在時間延伸を目的としない設計（ADR-0012）が必要 |
| **#1602** | feat: ADR-0023 I13 — ops dashboard に setup プリセット選択分布の可視化追加 | **ADR-0010 (Pre-PMF)** | 内部運営の判断材料拡充。LP 訴求と切り離された ops 専用機能で、Pre-PMF スコープ判断（バケット A: 実装、LP 訴求なし）の典型 |
| **#1603** | feat: ADR-0023 I10 — 卒業フロー実装（ポイント還元提案 + 感謝演出 + 事例公開承諾） | **ADR-0013 (LP truth)** + 補完: ADR-0011 (3-18 歳コアターゲット) | 「卒業 = ポジティブな解約」を LP 訴求するための実装根拠（ADR-0013）。3-18 歳でいずれ卒業するコアターゲット定義（ADR-0011）の終端として整合 |
| **#1595** | research: ADR-0023 I12 — 育児メディア/ママ友コミュニティ/SEO 獲得戦略 Discovery | **ADR-0010 (Pre-PMF)** + 補完: ADR-0013 (LP truth) | 獲得戦略の Discovery は Pre-PMF スコープ判断（ADR-0010 バケット A/B）の入力。実行段階では LP 訴求が伴うため ADR-0013 を併用 |

### 3. 既存ドキュメントの参照訂正範囲

本 PR (#1780) では **Issue 本文で明示された 5 箇所のみ** 参照訂正する:

| ファイル | 行 | 訂正内容 |
|---------|---|---------|
| `docs/design/06-UI設計書.md` | L653 | 解約理由ヒアリングフォーム — `ADR-0023 §3.8 / I3` → `ADR-0013 (LP truth) / ADR-0031 帰属マップ` 併記 |
| `docs/design/06-UI設計書.md` | L686 | 卒業フロー専用ページ — 同上 (#1603 帰属マップ参照) |
| `docs/decisions/archive/0042-marketplace-gender-variant-policy.md` | L10 | 関連 ADR の `ADR-0023 (Pre-PMF Issue 優先度)` → `ADR-0010 (Pre-PMF スコープ判断、旧 ADR-0023 統合先)` |
| `docs/decisions/0028-pre-pmf-founder-inquiry-removal.md` | L42 | `ADR-0023 ファイル自体は archive 済み` → `ADR-0023 は ADR-0031 で Deprecated 化、archive ファイルあり` |

### 4. 大量散在する `ADR-0023` 参照の扱い（明示スコープ外）

`grep -rn "ADR-0023" docs/ CLAUDE.md` は本 PR 時点で 100+ ファイルを検出する。これらは設計書 (06-UI設計書 / 07-API設計書 / 08-DB設計書 / 13-AWS / 14-セキュリティ / 19-プライシング / 26-ゲーミフィケーション / 42-獲得戦略 / lp-content-map / parallel-implementations / plan-change-flow / push-subscription-role-migration runbook) 等の **history 記述（過去経緯の記録）** である。

これらを機械的に一括書換すると:

- git blame で「いつ何のために追加されたか」が辿れなくなる
- 設計書改訂履歴の意味が失われる
- 過剰スコープになり PR レビュー困難（ADR-0010 Pre-PMF コスト判断）

そのため本 PR では:

- **新規追加されるドキュメント / コードでは ADR-0023 を新規参照しない**（必ず ADR-0031 帰属マップ経由で帰属先 ADR を参照）
- **既存 history 記述は git blame 観点で温存**（破壊的書換を避ける）
- 例外として Issue #1780 が明示した 5 箇所のみ訂正

### 5. sub-Issue 7 件への帰属先 ADR 明示

#1591 / #1597 / #1593 / #1600 / #1602 / #1603 / #1595 は全て CLOSED 済みのため、Issue 本文編集ではなく **comment 追加** で帰属先 ADR を明示する。本 PR の作業として `gh issue comment` を実行し、各 Issue 末尾に「ADR-0031 帰属マップ §2 により、本 Issue は ADR-XXXX に帰属」という案内を残す。

## 影響

### Positive

- **ADR ガバナンスの境界回復**: 1 ADR = 1 論点の原則に戻る。将来の ADR 起票判断は ADR-0010 / 0012 / 0013 のいずれに該当するかで判断可能
- **将来参照の一意化**: 新規ドキュメントは ADR-0031 帰属マップで帰属先を確認できる
- **Pre-PMF コスト最小**: ADR 件数を増やさず、新 ADR 1 件 + archive 1 件 + 訂正 5 箇所 + comment 7 件で完遂

### Negative / Risk

- **既存 100+ 参照は陳腐化**: 「新規参照は禁止」運用ルールに依存するため、新規 PR レビュー時に「ADR-0023 を新規参照していないか」を確認する必要がある（CI 機械化は Pre-PMF コスト超過のため見送り）
- **archive ファイルの新規作成**: ADR-0023 は git 履歴上も実体ファイルとして存在しないため、archive プレースホルダを新規作成する。これは history 連続性を犠牲にした合理的判断（PO 承認 #1780）

## 検証

- [x] `docs/decisions/archive/0023-marketing-policy-pre-pmf.md` が Deprecated バナー + 帰属先案内付きで存在
- [x] `docs/decisions/0031-adr-0023-deprecation-and-attribution-map.md` (本 ADR) が Accepted ステータスで存在
- [x] `docs/design/06-UI設計書.md` L653 / L686 の `ADR-0023` 参照に ADR-0031 帰属マップ併記
- [x] `docs/decisions/archive/0042-marketplace-gender-variant-policy.md` L10 の関連 ADR に ADR-0010 を併記
- [x] `docs/decisions/0028-pre-pmf-founder-inquiry-removal.md` L42 で ADR-0031 への誘導追加
- [x] `CLAUDE.md` / `docs/CLAUDE.md` の ADR 一覧に ADR-0031 を追加
- [x] sub-Issue 7 件 (#1591 / #1597 / #1593 / #1600 / #1602 / #1603 / #1595) に帰属先 ADR を明示する comment 追加

## 関連 ADR

- [ADR-0010: Pre-PMF スコープ判断](0010-pre-pmf-scope-judgment.md) — 旧 ADR-0023 Pre-PMF 優先度の統合先（#1593 / #1602 / #1595 帰属）
- [ADR-0011: 0-2 歳 baby モードは「親の準備モード」](0011-baby-mode-as-parent-preparation.md) — コアターゲット 3-18 歳定義（#1603 帰属補完）
- [ADR-0012: Anti-engagement 原則](0012-anti-engagement-principle.md) — 旧 ADR-0023 マーケポリシーの原則継承先（#1593 / #1600 帰属補完）
- [ADR-0013: LP は実装の事実を SSOT とする](0013-lp-truth-from-implementation.md) — 旧 ADR-0023 LP 訴求論点の帰属先（#1591 / #1597 / #1600 / #1603 帰属）
- [ADR-0016: 日本語テキスト折り返し方針](0016-japanese-text-wrap.md) — 帰属マップ参考（LP 表示品質）
- [ADR-0025: LP SSOT 注入機構 + XSS 設計](0025-lp-ssot-html-injection-with-xss-protection.md) — 旧 ADR-0023 第 2 世代「LP SSOT 注入機構」の正規化先
- 旧 ADR-0028: Pre-PMF 期 founder 直対応動線は LP 不要 (git 履歴、#2898 で削除) — 旧 ADR-0023 §I8 supersede 先
- [ADR-0023 (archive)](archive/0023-marketing-policy-pre-pmf.md) — 廃案対象（history 保持のため archive）
