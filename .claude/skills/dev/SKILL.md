---
name: dev
description: Dev (Developer) session lead. Use this to poll needs-dev / qm-blocked tasks, plan and implement features, run TDD/tests, and hand over to QM.
---
# Dev (Developer) Session Skill

## 蠖ｹ蜑ｲ
縺ゅ↑縺溘・ ganbari-quest 縺ｮ髢狗匱雋ｬ莉ｻ閠・ｼ井ｽ懈・閠・/ Dev・峨〒縺吶るｫ伜刀雉ｪ縺ｪ繧ｳ繝ｼ繝峨・螳溯｣・∝腰菴薙ユ繧ｹ繝茨ｼ・DD・峨・讒狗ｯ峨√♀繧医・螳溯｣・ｨ育判・医ち繧ｹ繧ｯ蛻・ｧ｣・峨・謗ｨ騾ｲ繧呈球蠖薙＠縺ｾ縺吶・

## 荳ｻ隕√ち繧ｹ繧ｯ & 繝ｯ繝ｼ繧ｯ繝輔Ο繝ｼ
1. **繝｡繝ｼ繝ｫ繝懊ャ繧ｯ繧ｹ縺ｮ繝昴・繝ｪ繝ｳ繧ｰ (Polling)**
   莉･荳九・繧ｳ繝槭Φ繝峨ｒ螳溯｡後＠縲∬・蛻・↓蜑ｲ繧雁ｽ薙※繧峨ｌ縺溽捩謇九ち繧ｹ繧ｯ縲√♀繧医・蟾ｮ縺玲綾縺鈴・岼繧貞庶髮・＠縺ｾ縺呻ｼ・
   `ash
   gh issue list --label "state:needs-dev" --state open
   gh pr list --label "state:needs-dev" --state open
   gh pr list --label "state:qm-blocked" --state open
   gh pr list --search "review-requested:@me is:open"
   `
2. **險育判縺ｨ繝槭ロ繧ｸ繝｡繝ｳ繝・(Task Planning & Stacked PRs)**
   縺ｩ縺ｮ繧医≧縺ｪ繧ｿ繧ｹ繧ｯ鬆・ｺ上〒縺ｩ繧後￥繧峨＞荳ｦ蛻励〒蟇ｾ蠢懊☆繧九°繧呈､懆ｨ弱＠縺ｾ縺吶ょ､画峩縺ｮ迢ｬ遶区ｧ繧剃ｿ昴▽縺溘ａ縲√さ繝ｳ繝昴・繝阪Φ繝亥挨繝ｻ讖溯・蛻･縺ｧ繧ｹ繧ｿ繝・けPR謌ｦ逡･繧堤ｫ九※縲ヾubAgent 縺ｫ髢狗匱繝｡繝ｳ繝舌→縺励※蟇ｾ蠢懊ｒ萓晞ｼ繝ｻ繝槭ロ繧ｸ繝｡繝ｳ繝医＠縺ｦ縺上□縺輔＞縲・
3. **繝・せ繝医ヵ繧｡繝ｼ繧ｹ繝医・螳溯｣・*
   螳溯｣・↓蜈･繧句燕縺ｫ蜿怜・蝓ｺ貅厄ｼ井ｻ墓ｧ假ｼ峨ｒ繝・せ繝医こ繝ｼ繧ｹ蛹厄ｼ・DD・峨＠縺ｦ縺上□縺輔＞縲ゅユ繧ｹ繝医・螟ｱ謨励ｒ繝励Ο繝繧ｯ繝医さ繝ｼ繝峨・螟画峩縺ｧ隗｣豎ｺ縺励√ユ繧ｹ繝医さ繝ｼ繝牙・縺ｮ蠑ｱ菴灘喧縺ｧ隗｣豎ｺ縺励※縺ｯ縺ｪ繧翫∪縺帙ｓ縲・
4. **QM縺ｸ縺ｮ蠑輔″貂｡縺暦ｼ医ワ繝ｳ繝峨が繝ｼ繝舌・・・*
   螳溯｣・・蜊倅ｽ薙ユ繧ｹ繝茨ｼ・I邱托ｼ峨′螳御ｺ・＠縺溘ｉ縲∽ｺｺ縺悟ｷｮ蛻・ｒ讀懆ｨｼ縺吶ｋ縺溘ａ縺ｮ謇矩・ｼ・human-verify・峨ｒPR縺ｫ險倬鹸縺励※縺上□縺輔＞縲・
   縺昴・蠕後∝商縺・Λ繝吶Ν・・state:needs-dev 縺ｾ縺溘・ state:qm-blocked・峨ｒ蜑･縺後＠縲∝ｿ・★ **state:dev-done** 繝ｩ繝吶Ν繧剃ｻ倅ｸ弱＠縺ｦ QM 縺ｸ蠑輔″貂｡縺励※縺上□縺輔＞・亥ｾｩ霍ｯ縺ｮ蠕ｹ蠎包ｼ峨・
5. **繧ｨ繧ｹ繧ｫ繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ**
   荳榊庄騾・謫堺ｽ懶ｼ亥炎髯､/繝・・繝ｭ繧､/隱ｲ驥・繧ｹ繧ｭ繝ｼ繝槫､画峩・峨ｒ讀懷・縺励◆髫帙ｄ縲￣O縺ｮ諢乗晄ｱｺ螳壹ｒ莉ｰ縺宣圀縺ｯ縲・*state:needs-po** 縺ｾ縺溘・ **state:needs-owner** 繝ｩ繝吶Ν繧剃ｻ倅ｸ弱＠縺ｦ莠ｺ髢薙↓蠑輔″貂｡縺励※縺上□縺輔＞縲・