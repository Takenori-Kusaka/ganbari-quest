# Research 05: Push 通知 UX 整備 — Bug fix + 透明性 UX + 再発防止策の 5 軸研究

> **methodology**: `docs/reference/deep-research-request-methodology.md` §4.2 「中規模 (Issue Tree + Rust RFC Alternatives + Prior art 抜粋)」
>
> **対象 EPIC**: #2114 (通知 UX 整備 EPIC、NotificationPermissionBanner Bug fix + 透明性 UX + 再発防止策統括)
>
> **対象子 Issue**: #2115 (Push-1) / #2116 (Push-2) / #2117 (Push-3)
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-14 (commit 化: 2026-05-18、EPIC AC1)
>
> **本 research の SSOT 化**: 本ドキュメントは `tmp/research/05-research-push-notification-ux.md` を `docs/reference/` 配下に正本化した EPIC #2114 AC1 の成果物。子 Issue 3 件の意思決定根拠はすべて本書に集約される。

---

## 1. 調査目的

PO 報告 (2026-05-14):

> NotificationPermissionBanner で「通知を受け取る」をクリックした後の UI 状態変化なし。許可されたのか、失敗したのかが分からない。

の構造的根本解消を目的に、(1) Bug fix + (2) 透明性 UX + (3) 再発防止策の 3 系統で EPIC #2114 を起票するための事前調査。

過去 #293 / #1593 / #1666 / #1689 で server-side 構造防御は完了 (ADR-0012 細則表整備済) だが、UI UX 補完が未完了で 1 ヶ月以上放置されている状態が背景。

軸:

- **軸 A**: 構造的根本原因の特定 (なぜ 1 ヶ月以上放置されたか)
- **軸 B**: UX prior art (informed consent + state feedback + settings fallback)
- **軸 C**: 子供向け SaaS の親 informed consent UX (法務整合)
- **軸 D**: 再発防止策の選定 (Issue Template / ADR / 共通 primitive)
- **軸 E**: 起票単位 (EPIC + 3 子 Issue / EPIC + 4 子 Issue / 1 Issue 統合)

---

## 2. 軸 A: 構造的根本原因 (3 要因連動)

### 2.1 A-1: AC 粒度抽象度

| 項目 | 内容 |
|---|---|
| 過去 Issue | #293 「Push 通知基盤整備」 G6 「設定UI + 通知許可UX (最低限)」 |
| 問題 | 1 行で 4 項目 (loading / failure / informed consent / 状態フィードバック) が明示されず、Dev 着手時に「最低限」の解釈が分かれた |
| 教訓 | UX を AC に書く際は機能毎に分割粒度を担保 (補助機能 UX 完成度 checklist 化が #2117 で対応) |

### 2.2 A-2: Scope 分割の盲点

| 項目 | 内容 |
|---|---|
| 過去 Issue | #1593 「anti-engagement 適合化」、server-side 構造防御に scope 限定 |
| 問題 | UI 補完の follow-up Issue 起票なし、後段の責任所在が曖昧化 |
| 教訓 | Scope 限定 Issue は必ず「scope 外 part の follow-up Issue 番号」を本文に記載 (#2117 で対応) |

### 2.3 A-3: Web Push 特殊性認知漏れ

| 項目 | 内容 |
|---|---|
| 過去 PR | #1689 (DynamoDB 本実装) |
| 問題 | Web Push の SW / 非同期 subscribe / VAPID 鍵 / async permission など複数 failure point に対する UI handling 認知漏れ |
| 教訓 | OSS / 業界 prior art の UX prior art を調査済か AC に必須化 (#2117 で ADR-0010 §7 拡張) |

### 2.4 軸 A 結論

3 要因の連動: AC 粒度抽象度 (A-1) + Scope 分割の盲点 (A-2) + Web Push 特殊性認知漏れ (A-3) → 同型 bug が将来別の「補助機能」(Notification API / Geolocation API / Camera API 等) 追加時に再発する構造。

**対策**: Push-3 (#2117) で Issue Template に「補助機能 UX 完成度 checklist」追加 + ADR-0010 §7 を OSS/UX prior art 先調査に拡張。

---

## 3. 軸 B: UX prior art (informed consent + state feedback + settings fallback)

### 3.1 候補 B-1: Slack (Web Push 通知許可 UX のデファクト)

| 項目 | 内容 |
|---|---|
| UI | 設定画面 → 通知種別細分化 (DM / Channel / Mention / Thread) → 種別ごと on/off + Quiet hours 設定 |
| 採用要素 | 種別 / 頻度 / 親端末限定 / quiet hours の 2 段階開示 |
| 関連 | Push-2 (#2116) で適用 |

### 3.2 候補 B-2: Linear (タスク管理 SaaS の Web Push UX)

| 項目 | 内容 |
|---|---|
| UI | 通知許可 → Toast 表示 (成功時) / エラー UI + 設定画面誘導 (失敗時) |
| 採用要素 | 成功時の Toast / 失敗時の fallback UI |
| 関連 | Push-1 (#2115) で適用 |

### 3.3 候補 B-3: Notion (ノート SaaS の Web Push UX)

| 項目 | 内容 |
|---|---|
| UI | 通知許可 → 設定画面に 「通知が許可されています / 拒否されています」表示 |
| 採用要素 | 設定画面 fallback (許可状態の透明な可視化) |
| 関連 | Push-1 (#2115) で適用 |

### 3.4 候補 B-4: 子供向け SaaS (Khan Academy Kids / Habitica / みてね) 通知 UX

| 項目 | 内容 |
|---|---|
| UI | 親 informed consent (子供の活動通知の頻度 / 種別 / 時間帯を親が事前確認) |
| 採用要素 | 親端末限定 + quiet hours + 子供向け文脈の説明文 |
| 関連 | Push-2 (#2116) で適用 |

### 3.5 軸 B 結論

Slack / Linear / Notion 型の「2 段階開示 + Toast フィードバック + 設定画面 fallback」+ 子供向け SaaS の「親 informed consent + quiet hours」の組合せが本プロジェクトの Push 通知 UX prior art。

---

## 4. 軸 C: 子供向け SaaS の親 informed consent UX (法務整合)

### 4.1 法的要件

| 法 / 規則 | 要件 | 適用 |
|---|---|---|
| COPPA (米) | 13 歳未満は親 informed consent 必須 | 海外向け配信時必須、本プロジェクトは現在国内のみ |
| 改正個人情報保護法 (日本、2022) | 子供の個人情報取扱いは特別配慮 | 通知許可は個人情報取扱いに該当する可能性、informed consent 推奨 |
| GDPR Article 8 (EU) | 16 歳未満は親 consent 必須 | EU 向け配信時必須、本プロジェクトは現在国内のみ |

### 4.2 採用方針

- 国内 Pre-PMF stage では COPPA / GDPR は対象外
- 改正個人情報保護法整合のため通知種別 / 頻度 / 親端末限定 / quiet hours を informed consent UI で開示 (Push-2 #2116)

---

## 5. 軸 D: 再発防止策の選定 (3 候補比較 + 1 ADR 拡張案)

### 5.1 D-1: Issue Template に「補助機能 UX 完成度 checklist」追加

| 項目 | 内容 |
|---|---|
| 概要 | `.github/ISSUE_TEMPLATE/{dev_ticket,process_ticket,feature_request}.yml` に新 textarea `auxiliary-feature-ux-checklist` を追加し、起票時に 5 項目 (Loading / Failure / Informed consent / State feedback / Settings fallback) の検討状況を必須化 |
| メリット | 起票時の 機械強制、AC 粒度抽象度の根本解消 |
| デメリット | textarea required: false 場合は強制力弱い |
| 採用 | **採用、Push-3 (#2117) で実装** |

### 5.2 D-2: 機能完成度 ADR 新規策定 (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | ADR-NN「補助機能 UX 完成度原則」を新規起票 |
| メリット | 根拠が明確化 |
| デメリット | ADR 10 枠抵触、Pre-PMF 段階で新規 ADR 起票は重い |
| 採用 | **棄却 (D-4 ADR-0010 §7 拡張で代替)** |

### 5.3 D-3: 共通 primitive 化 (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | `Web Push UX 標準コンポーネント` を `$lib/ui/primitives/` 配下に作成 |
| メリット | 将来の Notification API / Geolocation API / Camera API 等で再利用可能 |
| デメリット | Pre-PMF 過剰、他 permission API の計画次第で再評価 |
| 採用 | **棄却 (Pre-PMF 過剰、PMF 確認後の再評価対象)** |

### 5.4 D-4: ADR-0010 §7 拡張 (採用)

| 項目 | 内容 |
|---|---|
| 概要 | 既存 ADR-0010 §7「OSS 先調査」を「OSS / UX prior art 先調査」に拡張、補助機能 UX 検討を AC 必須化 |
| メリット | ADR 10 枠抵触回避、既存 ADR の自然拡張 |
| デメリット | ADR-0010 §7 が肥大化 |
| 採用 | **採用、Push-3 (#2117) で実装** |

### 5.5 軸 D 結論

D-1 (Template checklist) + D-4 (ADR-0010 §7 拡張) 併用が首位推奨、D-2 (新 ADR) と D-3 (共通 primitive) は不採用。

---

## 6. 軸 E: 起票単位 (4 候補比較)

### 6.1 E-α: EPIC + 4 子 Issue (Bug fix + 透明性 UX + 再発防止 + ADR-0012 整合補強)

| 項目 | 内容 |
|---|---|
| メリット | 全要素を独立 Issue 化、AC 明確 |
| デメリット | ADR-0012 整合は #1593 で完了済、重複起票 |
| 採用判定 | **棄却 (重複)** |

### 6.2 E-β: EPIC + 3 子 Issue (Bug fix + 透明性 UX + 再発防止)

| 項目 | 内容 |
|---|---|
| メリット | bundle 独断回避、AC 複雑化防止、PR 単位明確化 |
| デメリット | EPIC 起票で 3 子 Issue 管理コスト |
| 採用判定 | **採用、EPIC #2114 + Push-1 (#2115) + Push-2 (#2116) + Push-3 (#2117) で起票** |

### 6.3 E-γ: 1 Issue 統合

| 項目 | 内容 |
|---|---|
| メリット | 起票コスト最小 |
| デメリット | AC 複雑化リスク (4 項目 × Bug fix / UX / 再発防止 = 12+ AC) |
| 採用判定 | **棄却** |

### 6.4 E-δ: Bug fix + 透明性 UX のみ、再発防止策別 EPIC

| 項目 | 内容 |
|---|---|
| メリット | scope 最小 |
| デメリット | 再発リスク放置 (構造的問題で本 EPIC が起票された経緯と矛盾) |
| 採用判定 | **棄却** |

### 6.5 軸 E 結論

E-β (EPIC + 3 子 Issue) を採用、EPIC #2114 + Push-1 + Push-2 + Push-3 の構造で起票。

---

## 7. 統合採用結論

| 軸 | 採用候補 | 担当 Issue / PR |
|---|---|---|
| A 根本原因 | 3 要因連動 (AC 粒度 + Scope 分割盲点 + Web Push 特殊性認知漏れ) | EPIC #2114 で対策統括 |
| B UX prior art | Slack / Linear / Notion + 子供向け SaaS の組合せ | Push-1 + Push-2 |
| C 法務整合 | 改正個人情報保護法整合の informed consent UI | Push-2 |
| D 再発防止 | Template checklist (D-1) + ADR-0010 §7 拡張 (D-4) | Push-3 |
| E 起票単位 | EPIC + 3 子 Issue (β) | EPIC #2114 + Push-1/2/3 |

---

## 8. ADR / Pre-PMF 整合確認

### 8.1 ADR-0010 (Pre-PMF Bucket)

| 項目 | バケット | 根拠 |
|---|---|---|
| Push-1 Bug fix | Bucket A (サインアップ離脱直結) | 通知許可後 UI 変化なしは新規ユーザー離脱要因 |
| Push-2 透明性 UX | Bucket A (法務リスク回避) | informed consent 不足は改正個人情報保護法リスク |
| Push-3 再発防止 | Bucket A (再発防止) | 同型 bug の将来再発を構造的に防止 |

### 8.2 ADR-0012 (Anti-engagement)

- #1593 で server-side 構造防御完了済 (subscriber_role / 親端末限定 / 1 日 3 通 cap / quiet hours)
- 本 EPIC は UI 層補完のみ、ADR-0012 既存細則表の修正なし

### 8.3 ADR-0014 (OSS 先調査)

- Slack / Linear / Notion / Khan Academy Kids / Habitica / みてね の 6 件 prior art 確認済 (軸 B § 3)
- 独自実装ゼロ、業界 prior art パターンを採用

---

## 9. 関連 Issue / ADR / 過去経緯

### 9.1 関連 Issue (closed)

| Issue | 完了内容 | 未完了 (本 EPIC scope) |
|---|---|---|
| #293 (closed) | G1 DB / G2 Service / G3 SW / G4 API / G5 Hook / G6 設定UI + 通知許可UX (最低限) / G7 テスト | G6 詳細粒度 (failure handling / informed consent / 状態フィードバック) |
| #1593 (closed) | schema `subscriber_role` 追加 / 子端末送信 skip / ADR-0012 細則表整備 | UI 層補完 (明示的に scope 外) |
| #1666 (closed) | DynamoDB migration | — |
| #1689 (closed) | DynamoDB 本実装 | — |

### 9.2 関連 ADR

- ADR-0010 (Pre-PMF)
- ADR-0012 (Anti-engagement)
- ADR-0014 (OSS 先調査)
- ADR-0023 archive (anti-engagement 監査起点)

### 9.3 関連 memory

- `feedback_anti_engagement_principle.md`
- `feedback_quality_process.md`
- `feedback_oss_first_principle.md`

---

## 10. 次の研究課題 (本書 scope 外)

- 通知種別の細分化 (custom on/off per type) — 業界 prior art あるが Pre-PMF 過剰、Push-2 完了後の retrospective で再評価
- 「機能完成度 ADR」新規策定 — Push-3 で Issue Template + ADR-0010 拡張で代替、ADR 10 枠抵触回避
- 「Web Push UX 標準コンポーネント共通化」— Pre-PMF 過剰、他 permission API 計画次第で再評価
- 過去 closed Issue (#293 / #1593) の retroactive 再対応 — 本 EPIC で補完対応のため retroactive 不要

---

## 11. 改訂履歴

| 日付 | 改訂 | 理由 |
|---|---|---|
| 2026-05-14 | 初版作成 (tmp/research/) | PO 報告対応の補佐 deep research |
| 2026-05-18 | docs/reference/ に正本化 (EPIC #2114 AC1) | EPIC + 3 子 Issue 起票後の SSOT 化 |
