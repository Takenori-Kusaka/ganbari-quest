---
name: Competitive Research
description: Use weekly (not in the daily audit run) to observe competitor products (children's habit-forming / in-home gamification / allowance management apps) for feature, UX, and pricing trends. Produces structured JSON findings with mandatory primary-source URLs (hallucination suppression). Reuses issue-triage prior-art procedure; outputs comparison table + differentiation-gap findings only (thin skill, no custom scoring).
---

> **親 SSOT**: [audit-team.md §3.1 / §3.2](../../../docs/sessions/audit-team.md)（競合調査チームの役割・再利用マップ） / **流用元 Skill**: [Issue Triage 手順 B/C（prior art 調査）](../issue-triage/SKILL.md)
>
> **本 SKILL の位置付け（EPIC #2861 P1/B3、#2866）**: 競合調査チーム（audit-team.md §3.1）の実行手順 SSOT。**薄い WebSearch ベース skill** であり、独自スコアリング機構を持たない。出力は「構造化比較表 + 差別化が弱い箇所の finding（改善 backlog 候補）」に限定する。

# 競合調査フェーズゲート

競合プロダクト（子供向け習慣化 / 家庭内ゲーミフィケーション / お小遣い管理系）の機能・UX・価格動向を **週 1 回**観測し、本プロダクトの監査 finding（改善示唆）として報告するための手順。

audit-team.md §3.1 が定義する「競合調査」role の evidence 形式（structured JSON、一次情報 URL 必須）を満たす finding を生成する。finding の採否（自動棄却含む）の最終判定は audit-manager（orchestrator）が行い、本 skill は **finding 生成までが責務**（ADR-0056 §E の subagent ≠ orchestrator 役割分離を継承、audit-team.md §3.3）。

## 実行頻度（週 1、daily audit run には含めない）— AC6

| 項目 | 値 |
|---|---|
| cadence | **週 1 回**（独立 cadence） |
| daily audit run（#2871）への組込 | **含めない** |

**daily run に含めない理由**:

1. **WebSearch コスト**: 競合調査は competitor ごとに複数回の WebSearch + 一次情報 fetch を要する。これを毎日回すと daily run の固定時間 box（EPIC 失敗シナリオ⑥の無限棄却ループ防止のため box 化）を圧迫する。
2. **情報鮮度**: 競合の機能・価格は日次では実質変動しない。日次観測は同一 finding の重複生成を招くだけで監査価値を増やさない。週 1 cadence で鮮度として十分。

この分離は audit-team.md §3.4（2 段 gate 境界）の「各 run は固定時間 box で完了」原則と整合する。

## 手順（issue-triage 手順 B/C の流用）— AC1

issue-triage skill の **手順 B（OSS 先調査）/ 手順 C（research 添付）** の「検索 → 一次情報確認 → 比較表化」フローを、OSS 調査から**競合プロダクト調査**に転用する。重複再実装はしない（同 skill の検索作法・比較表テンプレートをそのまま使う）。

### ステップ 1: 調査対象の決定

ペルソナ課題（後述 AC3）を起点に、その課題を解決する競合プロダクトを 1〜2 件選ぶ。1 run で **competitor 1〜2 件**に絞る（薄さの維持、issue-triage 手順 B「OSS 最低 2 件」と同じ粒度感）。

### ステップ 2: 一次情報の取得（WebSearch → 一次情報 fetch）

issue-triage 手順 B の「npm / GitHub で既存 OSS を 2 件以上探す」検索作法を競合プロダクトに置換し、以下の**一次情報のみ**を取得する:

- 競合の**公式サイト** / 公式 blog / 公式リリースノート
- **App Store / Google Play** の公開ページ（機能説明 / 価格 / 提供者情報）
- 公式の**価格表** / プラン比較ページ

各取得情報には **取得日（YYYY-MM-DD）** を記録する。

### ステップ 3: 比較表化（issue-triage 手順 B の比較表テンプレート流用）

ペルソナ課題ごとに「競合がどう解決し、本プロダクトがどう差別化するか」を比較表に落とす（AC3 の軸）。

### ステップ 4: finding 抽出 → structured JSON 出力

比較表から「**差別化が弱い箇所**（= 改善 backlog 候補）」のみを finding として抽出する。差別化が成立している箇所は finding 化しない（issue 爆発防止、EPIC 失敗シナリオ②）。

## 幻覚抑制ルール（一次情報 URL 必須）— AC2

WebSearch ベース調査の最大リスクは**幻覚 finding（実在しない競合機能・誤った価格）**（EPIC 失敗シナリオ⑦）。これを構造的に抑制するため、以下を必須とする:

| ルール | 内容 |
|---|---|
| **一次情報 URL 必須** | 各 finding に競合の公式サイト / 公式 blog / App Store / 公式価格表など**一次情報 URL** を必ず添付する。 |
| **URL 欠落 finding は自動棄却** | `source_url` を欠く finding は audit-manager が**自動棄却**する（audit-team.md §3.1 末尾の規定と一致）。本 skill 側でも出力前に URL 欠落 finding を除外する。 |
| **憶測・伝聞の finding 化禁止** | まとめ記事 / 二次情報 / 「〜らしい」等の伝聞は finding の根拠にしない。一次情報で裏が取れない事項は finding 化せず保留する。 |
| **古い情報は取得日明記** | 取得した一次情報には `retrieved_at`（取得日 YYYY-MM-DD）を必ず付す。価格・機能は時点依存のため、取得日なき数値は採用しない。 |

## ペルソナ課題ベースの競合比較軸 — AC3

比較は機能の網羅列挙ではなく、[docs/design/11-ペルソナ定義書.md](../../../docs/design/11-ペルソナ定義書.md) のペルソナ**課題（ペイン）**を軸にする。各ペルソナの「ペイン（課題）」「ゲイン（期待する価値）」セクションを起点に、その課題を競合がどう解決し、本プロダクトがどう差別化するかを比較する。

| 比較軸（ペルソナ課題ベース） | 起点ペルソナ（11-ペルソナ定義書.md） | 観点 |
|---|---|---|
| 子供が自分から動く動機づけが続くか | P1 田中ゆかり（メイン親） | 習慣化の継続性・飽きさせない設計 |
| 親の声かけ負担が減るか | P1 / P2 鈴木大介（サブ親） | 親の見守り負担・自動化 |
| 年齢が上がっても使い続けられるか | C1〜C3（子供）+ 成長段階 | 年齢帯対応・卒業 journey |
| 価格が家庭で継続可能か | P1 / P2 課金意向 | [19-プライシング戦略書.md](../../../docs/design/19-プライシング戦略書.md) と競合価格の相対 |

各軸で「競合の解決策（一次情報 URL 付き）」と「本プロダクトの差別化」を並置し、差別化が弱い軸を finding 化する。

## 出力フォーマット（structured JSON）— AC4

出力は **構造化比較表 + 差別化が弱い箇所の finding** に限定する。**独自スコアリング機構・competitor 順位付けエンジン等は作らない**（薄さの維持）。

```json
{
  "run_date": "2026-06-04",
  "cadence": "weekly",
  "comparison_table": [
    {
      "axis": "子供が自分から動く動機づけが続くか",
      "persona_pain_ref": "11-ペルソナ定義書.md P1 ペイン",
      "competitor": "<競合名>",
      "competitor_solution": "<競合の解決策（一次情報に基づく）>",
      "competitor_source_url": "https://<公式サイト等>",
      "retrieved_at": "2026-06-04",
      "our_differentiation": "<本プロダクトの差別化 or 弱い旨>"
    }
  ],
  "findings": [
    {
      "id": "comp-001",
      "axis": "<比較軸>",
      "summary": "<差別化が弱い箇所の示唆（改善 backlog 候補）>",
      "source_url": "https://<一次情報 URL（必須、欠落時は自動棄却）>",
      "retrieved_at": "2026-06-04",
      "implication_for_product": "<本プロダクトへの示唆>",
      "policy_filter_required": true
    }
  ]
}
```

- `policy_filter_required: true` の finding は、起票前に**ポリシー準拠判定**（audit-team.md §3.1、[pre-pmf-check](../pre-pmf-check/SKILL.md) + [brand-check](../brand-check/SKILL.md) + [adversarial-reviewer](../adversarial-reviewer/SKILL.md) 統合判定）の filter にかける（後述ポリシー準拠判定例参照）。
- `source_url` 欠落 finding は出力に含めない（AC2）。

## サンプル実行（competitor 1〜2 件）— AC5

1 run の最小サンプル。competitor を 1〜2 件に絞り、各 finding に一次情報 URL を付す。

```json
{
  "run_date": "2026-06-04",
  "cadence": "weekly",
  "comparison_table": [
    {
      "axis": "子供が自分から動く動機づけが続くか",
      "persona_pain_ref": "11-ペルソナ定義書.md P1 ペイン（声かけしないと動かない）",
      "competitor": "<お小遣いタスク管理アプリ A（実名は run 時に一次情報で確定）>",
      "competitor_solution": "タスク達成でデジタル通貨を付与しガチャ的演出で動機づけ（公式機能ページ記載）",
      "competitor_source_url": "https://<競合 A 公式 features ページ URL>",
      "retrieved_at": "2026-06-04",
      "our_differentiation": "本プロダクトは滞在時間を価値毀損とみなす設計（ADR-0012）で連続演出を採らない"
    }
  ],
  "findings": [
    {
      "id": "comp-001",
      "axis": "子供が自分から動く動機づけが続くか",
      "summary": "競合 A は射幸性演出（連続ガチャ）で初期 retention を伸ばしている一次情報あり",
      "source_url": "https://<競合 A 公式 features ページ URL>",
      "retrieved_at": "2026-06-04",
      "implication_for_product": "短期 retention 訴求では見劣りに見えるが、本プロダクトのポリシー上は不採用が正（下記ポリシー準拠判定例）",
      "policy_filter_required": true
    }
  ]
}
```

run 実行時は `<競合名>` / `<URL>` を WebSearch で取得した**実在の一次情報**に置換する（プレースホルダのまま finding 化しない）。

## ADR-0012 / ADR-0013 との関係 — ポリシー準拠判定例（1 件）

競合が**射幸性機能で伸びていても**、本プロダクトのポリシー上は不採用となる finding の判定例。competitive gap finding をそのまま改善 backlog にしてはならず、ポリシー準拠判定 filter を通す。

**finding 例**: 「競合 A は連続ガチャ（射幸性演出）で初期 retention を伸ばしている。本プロダクトには同等機能がなく差別化が弱い」（comp-001）

**ポリシー準拠判定**:

| 判定軸 | 結果 |
|---|---|
| [ADR-0012](../../../docs/decisions/0012-anti-engagement-principle.md)（Anti-engagement、滞在時間 = 価値毀損） | 連続ガチャ / サプライズ濫用は明示的に**不採用**。子供 UI は「記録 → 数秒で閉じる」最短経路が設計原則 |
| [ADR-0013](../../../docs/decisions/0013-lp-truth-from-implementation.md)（LP truth） | 実装にない射幸性機能を「あるべき」と LP/訴求に書くことも禁止 |
| **判定** | **棄却（issue 起票しない）**。この gap は「ポリシーであえてそうしている」ケースであり、差別化の弱さではなく**意図的な設計選択**。誤起票防止のため backlog 化しない |

このように、competitive gap finding は「数字上の見劣り」を即改善要求に変換せず、本プロダクトのポリシー（ADR-0012 / ADR-0013 等）と照合してから採否を決める。判定根拠の ADR/docs を finding に残すことで、後続 run での重複起票も防ぐ。

## 禁忌

- **一次情報 URL なき finding を出力する**（幻覚 finding の温床、AC2 違反）
- **二次情報 / まとめ記事 / 伝聞を根拠に finding 化する**（一次情報で裏取りできない事項は保留）
- **独自スコアリング機構・competitor 順位エンジンを実装する**（薄さの維持に反する、AC4 違反）
- **daily audit run に競合調査を組み込む**（WebSearch コスト・情報鮮度の観点で週 1 分離、AC6 違反）
- **competitive gap をポリシー準拠判定なしで改善 backlog 化する**（ADR-0012 / ADR-0013 と矛盾する誤起票）
- **取得日なき価格・機能数値を採用する**（時点依存情報は `retrieved_at` 必須）
