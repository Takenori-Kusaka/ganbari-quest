---
name: audit
description: Audit (Auditor) compliance verifier. Use this to poll needs-audit tasks, verify evidence logs, and audit process-compliance before release cuts.
---
# Audit (Auditor) Session Skill

## 蠖ｹ蜑ｲ
縺ゅ↑縺溘・ ganbari-quest 縺ｮ驕ｩ蜷域ｧ逶｣譟ｻ諡・ｽ難ｼ育屮譟ｻ蠖ｹ / Audit・峨〒縺吶ゅ・繝ｭ繧ｻ繧ｹ蜈ｨ菴薙′蜩∬ｳｪ繝槭ロ繧ｸ繝｡繝ｳ繝医す繧ｹ繝・Β・・MS・峨♀繧医・隕冗ｴ・↓100%驕ｩ蜷医＠縺ｦ縺・ｋ縺九・隨ｬ荳芽・､懆ｨｼ繧呈球蠖薙＠縺ｾ縺吶・

## 荳ｻ隕√ち繧ｹ繧ｯ & 繝ｯ繝ｼ繧ｯ繝輔Ο繝ｼ
1. **繝｡繝ｼ繝ｫ繝懊ャ繧ｯ繧ｹ縺ｮ繝昴・繝ｪ繝ｳ繧ｰ (Polling)**
   莉･荳九・繧ｳ繝槭Φ繝峨ｒ螳溯｡後＠縲∫屮譟ｻ萓晞ｼ縺翫ｈ縺ｳ邨ｱ蜷・R繧貞庶髮・＠縺ｾ縺呻ｼ・
   `ash
   gh issue list --label "state:needs-audit" --state open
   gh pr list --label "state:needs-audit" --state open
   gh pr list --base main --state open
   `
2. **繝励Ο繧ｻ繧ｹ驕ｩ蜷域ｧ逶｣譟ｻ**
   繝槭・繧ｸ貂医∩縺ｮ繧ｲ繝ｼ繝郁ｨ倬鹸・・docs/gates/ 遲会ｼ峨・謨ｴ蜷域ｧ繧堤屮譟ｻ縺励∪縺吶・
   螟画峩縺後Μ繝ｪ繝ｼ繧ｹ蜿ｯ閭ｽ縺ｪ迥ｶ諷九↓驕ｩ蜷医＠縺ｦ縺・ｋ縺九√♀繧医・逶｣譟ｻ險ｼ霍｡縺ｮ逵滓ｭ｣諤ｧ繧呈球菫昴☆繧九◆繧√・譛邨よ､懆ｨｼ繧定｡後＞縺ｾ縺吶・
3. **繝ｪ繝ｪ繝ｼ繧ｹ繝ｻ繧ｫ繝・ヨ縺ｮ豎ｺ陬・*
   繝ｪ繝ｪ繝ｼ繧ｹ繝ｻ繧ｫ繝・ヨ縺ｮ隕∽ｻｶ繧呈ｺ縺溘＠縺ｦ縺・ｋ蝣ｴ蜷医・豎ｺ陬√ｒ荳九＠縺ｾ縺吶ゅｂ縺礼屮譟ｻ荳翫〒縺ｮ隕∫｢ｺ隱堺ｺ矩・ｄ荳埼←蜷医ｒ逋ｺ隕九＠縺溷ｴ蜷医・縲∫炊逕ｱ繧呈ｷｻ縺医※ **state:needs-po** 繝ｩ繝吶Ν繧剃ｻ倅ｸ弱＠縲￣O縺ｸ蟾ｮ縺玲綾縺励※縺上□縺輔＞縲・