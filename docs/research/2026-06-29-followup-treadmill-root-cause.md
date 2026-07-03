# follow-up treadmill の真因と介入 (deep-research、2026-06-29)

> #3487 の research SSOT。「PR を merge するほど open issue が増える」failure mode の真因分析と Pre-PMF 制約での最善介入。中立 framing で実施 (反証も探索)。

## 観察事実
1 セッションで 19 PR を merge したが open issue は 140→144 と**増加**。**1 PR ≈ 1 follow-up の強い比例**が成立 = follow-up は merge 行為から機械的に生成されている (独立 defect の自然発生では説明不能)。

## 真因 (root generator の寄与度)
- **G2 (無限 adversarial / over-filing) ~40% [支配的]**: `audit-team.md` が「各 adversarial finding を Issue 起票」と規定 = 受容判断ゲートのない無条件起票。`adversarial-reviewer` skill の `must_object_count 3` (echoing 抑止のため 3 件強制) が「反対理由ゼロ」を構造的に禁じ、PR が good-enough でも必ず 3 finding を生産 → 全件 issue 化。Bach 停止ヒューリスティクス (継続価値<コストで止める) の③が無い。ISTQB pesticide-paradox (同レンズ反復で限界価値逓減) / absence-of-errors-fallacy (欠陥ゼロ化の目的化はユーザー価値と乖離)。
- **G3 (tracker のバックログ化) ~30% [支配的]**: follow-up が close されず open 累積 = backlog bankruptcy / severity inflation。YAGNI 観点で「いつかやる refinement」を open 保持するのは reckless 負債。受容した residual は PR 本文/ADR に書けば trail は残り open を汚さない。
- **G1 (band-aid / scope-split) ~25% [第二要因]**: 同一クラス欠陥を instance 単位でパッチ (#3098→#3181→#3474 = TOCTOU 3回)。ISTQB defect-clustering (欠陥は 20% モジュールに集中) が class で潰せと予言。ADR-0061 same-class→guard は正しいが発火が事後 (N 回再発後) で最初の PR で class-lock を強制していない。緩和出荷自体は Fowler deliberate&prudent 負債として正当 → 問題は根治を必ず open issue で残す運用。
- **G4 (真の独立 defect) ~5% [最小]**: 正当に潰すべき issue。1 PR≈1 follow-up の比例が G4 支配を反証 (独立なら merge と無相関のはず)。
- **Lehman Law I/VI**: open 増自体は正常 (成長は不可避)。病理は「減らせない」= 生成あり brake なしの非対称。

## 介入 (Pre-PMF / ADR-0010 制約での優先順位)
- **I2 [第1位、cost 最小・効果最大]**: adversarial finding を起票前に `{blocking / class-lock / accepted-residual}` に強制分類。accepted-residual は Issue 化せず PR 本文に記録 (Google `Nit:` / Shape Up `~nice-to-have` 移植)。「3 件**生産**」と「3 件**起票**」を分離 (must_object_count は維持)。ガード: severity≥high は residual 化禁止。1 PR≈1 follow-up の比例を発生源で断つ。
- **I1 [第2位]**: 2 回再発した root class のみ fitness function/property test で class-lock。発火を「N 回後」→「同 PR/run 内 2 instance 目」へ shift-left。投機的全領域 widen はしない (ADR-0010)。
- **I3 [第3位、I2 とセット]**: severity×Pre-PMF-bucket triage、週次 15 分、Bucket C × low-sev を won't-fix close。I2 で入口を絞った後の少量に対してのみ現実的。
- **I4 [条件付き非推奨]**: 全 PR に根治強制は appetite 破壊・出荷停滞 (Shape Up scope-hammering と矛盾)。緩和出荷の禁止でなく「残りを accepted-residual に落とす」を DoD 化するのが正しい折衷。

## 過剰/必要の線引き (ADR-0010)
- 必要: 3 分類ゲート (既存 skill 拡張、ツール費ゼロ) / 2 回再発クラスのみ class-lock / accepted-residual を PR 本文記録 / severity≥high residual 禁止 / 週次 15 分 triage。
- 過剰: 全 finding 等価 issue 化 (現状) / 投機的 fitness function widen / 全 PR 根治強制 / severity×priority 専用ツール / open ゼロ目標化。

## Sources
- ISTQB 7 原則: https://mastersoftwaretesting.com/testing-fundamentals/software-testing-principles / https://astqb.org/istqb-foundation-level-seven-testing-principles/
- Bach 停止ヒューリスティクス: https://developsense.com/blog/2009/09/when-do-we-stop-test
- Lehman's Laws: https://www.rose-hulman.edu/class/cs/csse375-2007-08/Handouts/LawsOfSoftwareEvolutionRevisited.pdf
- Fowler 技術的負債象限 + YAGNI: https://andrewmurphy.io/stdlib/71f33d24-726e-4945-80b1-87de24b63b88
- Shape Up (appetite / scope hammering / ~nice-to-have): https://basecamp.com/shapeup/1.2-chapter-03 / https://basecamp.com/shapeup/3.5-chapter-14
- Google eng-practices (nit/blocking 分離): https://google.github.io/eng-practices/review/reviewer/standard.html
- Backlog bankruptcy / severity vs priority: https://fullscale.io/blog/managing-the-bug-backlog/ / https://bugreel.io/blog/severity-vs-priority-guide
