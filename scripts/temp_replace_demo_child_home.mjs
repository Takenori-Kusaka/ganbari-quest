import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/demo/(child)/[mode]/home/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES , formatStreak } from '$lib/domain/labels';",
  "import { APP_LABELS, DEMO_CHILD_HOME_LABELS, PAGE_TITLES, formatStreak } from '$lib/domain/labels';"
);

// Step 2: Checklist title
c = c.replace(
  '<span class="font-bold">もちものチェック</span>',
  '<span class="font-bold">{DEMO_CHILD_HOME_LABELS.checklistTitle}</span>'
);

// Step 3: Checklist done
c = c.replace(
  '<span class="text-sm font-bold text-[var(--theme-accent)]">✅ かんりょう！</span>',
  '<span class="text-sm font-bold text-[var(--theme-accent)]">{DEMO_CHILD_HOME_LABELS.checklistDone}</span>'
);

// Step 4: Daily mission title
c = c.replace(
  '<span class="font-bold text-sm">きょうのミッション</span>',
  '<span class="font-bold text-sm">{DEMO_CHILD_HOME_LABELS.dailyMissionTitle}</span>'
);

// Step 5: Mission complete with dynamic points
c = c.replace(
  '<span class="text-sm font-bold text-[var(--theme-accent)]">🎉 ミッションコンプリート！ {fmtPts(data.dailyMissions.bonusAwarded)}</span>',
  '<span class="text-sm font-bold text-[var(--theme-accent)]">{DEMO_CHILD_HOME_LABELS.missionComplete(fmtPts(data.dailyMissions.bonusAwarded))}</span>'
);

// Step 6: Activities empty state
c = c.replace(
  '<p class="text-[var(--font-md)]">かつどうがまだありません</p>',
  '<p class="text-[var(--font-md)]">{DEMO_CHILD_HOME_LABELS.activitiesEmpty}</p>'
);

// Step 7: Record button states
c = c.replace(
  "{submitting ? 'きろくちゅう...' : 'きろくする！'}",
  "{submitting ? DEMO_CHILD_HOME_LABELS.recordingLabel : DEMO_CHILD_HOME_LABELS.recordButton}"
);

// Step 8: Result streak suffix (line 211)
c = c.replace(
  '\t\t\t\t{formatStreak(resultData.streakDays)}！',
  '\t\t\t\t{formatStreak(resultData.streakDays)}{DEMO_CHILD_HOME_LABELS.resultStreakSuffix}'
);

// Step 9: Result today count (line 213) - split prefix/suffix around dynamic expression
c = c.replace(
  '\t\t\t<p class="text-xs text-[var(--color-text-muted)] mt-1">きょう {data.todayRecorded.reduce((sum: number, r: { activityId: number; count: number }) => sum + r.count, 0) + 1}かいめ！</p>',
  '\t\t\t<p class="text-xs text-[var(--color-text-muted)] mt-1">{DEMO_CHILD_HOME_LABELS.resultTodayPrefix} {data.todayRecorded.reduce((sum: number, r: { activityId: number; count: number }) => sum + r.count, 0) + 1}{DEMO_CHILD_HOME_LABELS.resultTodaySuffix}</p>'
);

// Step 10: Demo data note (line 215)
c = c.replace(
  '\t\t\t\t（デモモード：データは保存されません）\n\t\t\t</p>',
  '\t\t\t\t{DEMO_CHILD_HOME_LABELS.demoDataNote}\n\t\t\t</p>'
);

// Step 11: Signup CTA link text (line 221)
c = c.replace(
  '\t\t\t\tお子さまの名前で はじめる →\n\t\t\t</a>',
  '\t\t\t\t{DEMO_CHILD_HOME_LABELS.signupCta}\n\t\t\t</a>'
);

// Step 12: Close button (line 229)
c = c.replace(
  '\t\t\t\tとじる\n\t\t\t</Button>',
  '\t\t\t\t{DEMO_CHILD_HOME_LABELS.closeButton}\n\t\t\t</Button>'
);

writeFileSync('src/routes/demo/(child)/[mode]/home/+page.svelte', c, 'utf8');
console.log('Done');
