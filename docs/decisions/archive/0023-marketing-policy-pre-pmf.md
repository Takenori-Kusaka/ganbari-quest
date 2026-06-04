# 0023. (Deprecated) LP マーケティングポリシー Pre-PMF / LP SSOT 注入機構

> **Deprecated (2026-05-01, #1780)**: 本 ADR は廃案。当 ADR-0023 で議論されてきた論点（Pre-PMF Issue 優先度判断 / LP SSOT 注入機構 / 派生 sub-Issue 群）はすべて他 ADR に分割帰属させた。**新規参照は [ADR-0031: ADR-0023 廃案 + 帰属マップ](../0031-adr-0023-deprecation-and-attribution-map.md) を参照のこと**。本ファイルは history 保持のため archive に残置。

## 改訂履歴 (要約)

| 日付 | バージョン | 変更内容 |
|------|----------|---------|
| 当初 | 1.0 | LP マーケティングポリシー Pre-PMF として起票（Pre-PMF Issue 優先度判断基準 + LP/PMF アンケート + アナリティクス + 解約/卒業フロー / sub-Issue 群定義 §I1〜§I13） |
| 2026-04-20 | 2.0 | ADR 10 枠再構成 (#1262) で **ADR-0010「Pre-PMF スコープ判断」** に Pre-PMF 優先度判断箇所が統合され、当 ADR-0023 は移行 |
| 2026-04-30 | 2.1 | §I8 (founder 1:1 ヒアリング動線) は **ADR-0028「Pre-PMF 期 founder 直対応動線は LP 不要」** で supersede |
| 2026-04-30 | 2.2 | LP SSOT 注入機構の innerHTML + DOMPurify 化提案は **ADR-0025「LP SSOT 注入機構 + XSS 設計」** で正規化（PR #1683 で 693 件全件 SSOT 完遂） |
| 2026-05-01 | **3.0 Deprecated** | **ADR-0031「ADR-0023 廃案 + sub-Issue 帰属マップ」(#1780) で全面廃案。** sub-Issue 7 件 (#1591/#1597/#1593/#1600/#1602/#1603/#1595) は既存 ADR (0010 / 0011 / 0012 / 0013 / 0016) に分割帰属。詳細は ADR-0031 §帰属マップを参照 |

## 廃案理由 (#1780)

ADR-0023 は時代変遷で「Pre-PMF Issue 優先度 + LP マーケポリシー + LP SSOT 注入機構 + sub-Issue 群定義 + PMF 判定 + アナリティクス + 解約/卒業」という多重責務を抱え込み、以下の 3 課題が顕在化した:

1. **責務肥大**: 1 ADR が 7 領域に跨り、ADR の境界が壊れた（ADR-0001 設計書 SSOT 原則と整合しない）
2. **重複ガバナンス**: ADR-0010 (Pre-PMF) / ADR-0012 (Anti-engagement) / ADR-0013 (LP truth) / ADR-0025 (LP SSOT 注入) / ADR-0028 (founder 動線) と論点重複
3. **将来 ADR 起票判断が不能**: 「ADR-0023 にもう一つ §IXX を生やすか / 別 ADR を立てるか」の判断軸が消失

ADR-0031 で sub-Issue 7 件の帰属先を確定し、ADR-0023 を Deprecated とすることで、**ガバナンスの境界を ADR-0010 / 0011 / 0012 / 0013 / 0016 に再帰属**させる。

## 後方参照ガイド

`grep -rn "ADR-0023" docs/ CLAUDE.md` で広範に残存する参照は、設計書 (06-UI設計書 / 07-API設計書 / 08-DB設計書 / 13-AWS / 14-セキュリティ / 19-プライシング / 26-ゲーミフィケーション / 42-獲得戦略 / lp-content-map / parallel-implementations / plan-change-flow / push-subscription-role-migration runbook) 等の history 記述である。本 PR (#1780) は **新規参照を ADR-0031 に向けるべき** ことを明示するに留め、既存 history 記述の機械的一括書換は行わない（git blame による経緯追跡を保つため）。

新規ドキュメント / コード追加時に ADR-0023 を参照しようとした場合は、ADR-0031 §帰属マップの該当行で帰属先 ADR を確認すること。

## 関連 ADR

- [ADR-0031: ADR-0023 廃案 + sub-Issue 帰属マップ](../0031-adr-0023-deprecation-and-attribution-map.md) — 本 ADR を Deprecated 化する SSOT
- [ADR-0010: Pre-PMF スコープ判断](../0010-pre-pmf-scope-judgment.md) — 旧 ADR-0023 Pre-PMF 優先度の統合先
- [ADR-0012: Anti-engagement 原則](../0012-anti-engagement-principle.md) — 旧 ADR-0023 マーケポリシーの原則継承先
- [ADR-0013: LP は実装の事実を SSOT とする](../0013-lp-truth-from-implementation.md) — 旧 ADR-0023 LP 訴求論点の帰属先
- [ADR-0025: LP SSOT 注入機構 + XSS 設計](../0025-lp-ssot-html-injection-with-xss-protection.md) — 旧 ADR-0023 第 2 世代「LP SSOT 注入機構」の正規化先
- 旧 ADR-0028: Pre-PMF 期 founder 直対応動線は LP 不要 (git 履歴、#2898 で削除) — 旧 ADR-0023 §I8 supersede 先
