import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/setup/questionnaire/+page.svelte', 'utf8');

// Step 1: Add import
c = c.replace(
  "import { enhance } from '$app/forms';",
  "import { enhance } from '$app/forms';\nimport { SETUP_QUESTIONNAIRE_LABELS } from '$lib/domain/labels';"
);

// Step 2: Page title
c = c.replace(
  '\t📋 かんたんアンケート\n</h2>',
  '\t{SETUP_QUESTIONNAIRE_LABELS.pageTitle}\n</h2>'
);

// Step 3: Page desc
c = c.replace(
  '\tお子さまに合った設定を自動でご用意します\n</p>',
  '\t{SETUP_QUESTIONNAIRE_LABELS.pageDesc}\n</p>'
);

// Step 4: Q1 legend
c = c.replace(
  '\t\t\tQ1. お子さまの課題は？（いくつでも）\n\t\t</legend>',
  '\t\t\t{SETUP_QUESTIONNAIRE_LABELS.q1Legend}\n\t\t</legend>'
);

// Step 5: Q2 legend
c = c.replace(
  '\t\t\tQ2. 1にちに どれくらい きろくする？\n\t\t</legend>',
  '\t\t\t{SETUP_QUESTIONNAIRE_LABELS.q2Legend}\n\t\t</legend>'
);

// Step 6: Recommended badge in Q2
c = c.replace(
  '\t\t\t\t\t\t\tおすすめ\n\t\t\t\t\t\t</span>',
  '\t\t\t\t\t\t\t{SETUP_QUESTIONNAIRE_LABELS.recommendedBadge}\n\t\t\t\t\t\t</span>'
);

// Step 7: Q3 legend
c = c.replace(
  '\t\t\tQ3. チェックリストを自動作成する？\n\t\t</legend>',
  '\t\t\t{SETUP_QUESTIONNAIRE_LABELS.q3Legend}\n\t\t</legend>'
);

// Step 8: Q3 hint
c = c.replace(
  '\t\t\tえらんだリストが自動で作成されます（あとから変更できます）\n\t\t</p>',
  '\t\t\t{SETUP_QUESTIONNAIRE_LABELS.q3Hint}\n\t\t</p>'
);

// Step 9: Submit button states
c = c.replace(
  "\t\t\t{submitting ? 'せっていちゅう...' : 'この設定ではじめる！'}\n\t\t</Button>",
  '\t\t\t{submitting ? SETUP_QUESTIONNAIRE_LABELS.submittingLabel : SETUP_QUESTIONNAIRE_LABELS.startButton}\n\t\t</Button>'
);

// Step 10: Skip button
c = c.replace(
  '\t\t\tあとで設定する（スキップ）\n\t\t</Button>',
  '\t\t\t{SETUP_QUESTIONNAIRE_LABELS.skipButton}\n\t\t</Button>'
);

writeFileSync('src/routes/setup/questionnaire/+page.svelte', c, 'utf8');
console.log('Done');
