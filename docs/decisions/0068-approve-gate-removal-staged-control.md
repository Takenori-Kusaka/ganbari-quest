# 0068. QM approve の物理遮断 (gate-approve hook) を立ち上げ期は外す — 統制は段階的に戻す

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-08-13 |
| 起票者 | Dev Session Agent |
| 関連 Issue | #4571 (オーナー判断 A) / #4292 (TTL wontfix) / #4171 |
| 関連 ADR | [ADR-0056](0056-qm-drift-prevention-by-structural-agent-constraint.md) (本 ADR が置き換える) / [ADR-0010](0010-pre-pmf-scope-judgment.md) / [ADR-0022](0022-admin-bypass-disable-qm-approve.md) |

## コンテキスト

ADR-0056 は QM Orchestrator の role drift (33 日で 42 回観測) に対し、**agent の自覚に依存しない構造的遮断**として PreToolUse hook `.claude/hooks/gate-approve.mjs` を導入した。hook は `gh pr merge` / `gh pr review --approve` を検出し、`tmp/adversarial-evidence/<PR>.json` の存在・schema・**30 分 TTL** を満たさなければ `exit 2` で物理 block する。

運用の結果、遮断そのものが merge を止める事象が発生した (#4571)。同じ構造は過去にも 2 回上がっている:

- #4292「30 分 TTL が『重い指摘ほど罰する』構造になっている」(第 20 回統合で 2 回抵触) — 2026-08-05 に `wontfix` で close。**TTL の妥当性を否定したのではなく、憲章ルール 7 (装置改善は Issue にせずその場で PR) を理由に受け渡し方をやめただけ**で、観察された構造はそのまま残った
- #4171 監査 run の待ち時間 (`adversarial TTL 切れ`)

**経過時間は「独立した判断を経たか」の代理指標として弱い。** 所見を深く書くほど、また CI 待ちが長いほど evidence が失効する。つまり遮断は、防ぎたい行動 (雑な approve) より防ぎたくない行動 (丁寧なレビュー) を強く罰していた。

## 検討した選択肢

ADR-0056 が採った「独自 hook による物理遮断」の代替として、確立された統制機構 2 件と運用対処を比較した。

### 選択肢 A: hook を外し、ロール定義と憲章の遵守で保つ (採用)

- 概要: `.claude/settings.json` の `PreToolUse` から `gate-approve.mjs` の呼び出しを外す。hook 本体・test・skill は残す
- メリット: 維持費 (evidence 生成 + TTL 管理) が消える。立ち上げ期の速度を落とさない
- デメリット: evidence 無しで merge できる。role drift の再発を機械検出する経路が無くなる
- Pre-PMF コスト: 実質ゼロ (削除ではなく呼び出しを外すだけ)

### 選択肢 B: GitHub 標準機構 (branch protection / CODEOWNERS required review) に寄せる

- 概要: 独自 hook をやめ、保護対象ブランチの required review + CODEOWNERS で承認を強制する (GitHub 標準、確立パターン)
- メリット: 独自装置を持たない。ローカル環境に依存せずサーバ側で効く
- デメリット: **今の運用は agent-led / autonomous** であり、承認者も agent。required review は「誰が押したか」しか見ず「独立した判断を経たか」は見ないため、ADR-0056 が防ごうとした drift には効かない
- 判断: **いま入れても目的を満たさない。ブランチ戦略を変える段階で採る** (下記「戻す条件と段階」の第 2 段階)

### 選択肢 C: hook を残し TTL を緩める / 運用手順の問題として扱う

- 概要: #4571 の PO 見立て B / C。TTL を延ばす、または evidence を作ってから merge する運用に寄せる
- メリット: ADR-0056 の統制水準を保てる
- デメリット: **維持費の問題は残る**。TTL を延ばすほど「独立判断の代理指標」としての意味は薄れ、遮断は形式だけが残る
- 判断: 不採用 (オーナー判断)

## 決定

**選択肢 A を採る。** `.claude/settings.json` の `PreToolUse` から `gate-approve.mjs` の呼び出しを外す。

**外す根拠は「drift が起きない」ではない。** ADR-0056 が観測した 42 回の drift は有効な観測として残す。根拠は**費用と段階**である — 立ち上げ期に統制を厚くすると、統制の維持費が統制が防ぐ損失を上回る。本件はその実例だった。

**hook 本体は消さない** (`.claude/hooks/gate-approve.mjs` と `tests/unit/hooks/gate-approve*.test.ts` は現状のまま維持)。段階的に戻す前提であり、戻すときに書き直すのは無駄だからである。呼び出しを外すだけにする。

`tmp/adversarial-evidence/` も廃止しない。**adversarial-reviewer skill は PO 決裁ブリーフ ③ の生成元として現役**であり (`.claude/skills/dev-open-pr/templates/po-decision-brief.md`)、`scripts/audit-approve-evidence.mjs` / `scripts/verify-adversarial-output.mjs` による手動検証も残る。変わるのは「**merge の前提条件ではなくなる**」ことだけである。

## 受容するリスク

| # | リスク | なぜ受容するか |
|---|--------|--------------|
| 1 | evidence 無しで approve / merge できる | 立ち上げ期の速度を優先する。統制はロール定義 (`docs/sessions/qm-session.md`) と憲章の遵守で保つ |
| 2 | role drift の再発を機械検出する経路が無くなる | 再発は「防げなくなる」のではなく「自動では気づけなくなる」。気づく経路は統合 PR の外部品質監査 (ADR-0022 / audit-team) に残る |
| 3 | ADR-0056 の 42 回という観測が「解決済み」と誤読される | 本 ADR がそう読まれないための記録である。ADR-0056 本文は残し、ステータスだけを置き換えにする |

## 戻す条件と段階

「いつか厳しくする」では戻らないため、段階と条件を明記する。**統制はブランチ戦略と紐づけて戻す** ([branch-strategy.md](../sessions/branch-strategy.md))。

| 段階 | 統制の水準 | 移行条件 |
|---|---|---|
| **いま (立ち上げ期)** | hook による物理遮断なし。ロール定義と憲章の遵守で保つ | — |
| 次 | ブランチ保護 + 保護対象ブランチでの approve 要求 (選択肢 B) | **PMF 到達、または承認者に人間が入る運用へ移行したとき** |
| その先 | 対象を絞った物理遮断の再導入 (evidence gate の復活を含む) | 上記の下で、**独立判断を経ない approve が実際に観測されたとき**。復活時は TTL を代理指標にしない設計に改める |

## 結果

- QM / 外部監査チームは evidence を作らずに merge できる。**evidence を作ること自体は禁止されないし、価値も変わらない** — merge の前提条件から外れるだけ
- `tests/unit/hooks/command-execution-tools.test.ts` は「gate-approve が全ツール経路を覆う」という assert を持てなくなるため、**全 PreToolUse entry が SSOT 全ツールを覆う**という、より広い不変条件に置き換える (#4001 の bypass 防止は維持される)
- hook を再登録したら上記 test が「未登録である」assert で落ちる。**再登録は本 ADR の改訂とセットでしかできない** (silent な復活を防ぐ)
