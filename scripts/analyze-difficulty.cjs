// scripts/analyze-difficulty.cjs
// #0090 コンボ・実績の獲得難易度調査用スクリプト
const Database = require('better-sqlite3');
const db = new Database('/app/data/ganbari-quest.db');

console.log('=== コンボ獲得履歴（直近20件）===');
const combos = db
	.prepare(`
  SELECT description, amount, created_at
  FROM point_ledger
  WHERE type = 'combo_bonus'
  ORDER BY created_at DESC
  LIMIT 20
`)
	.all();
combos.forEach((c) => {
	console.log(`${c.created_at} | ${c.description} (+${c.amount})`);
});
console.log(
	'コンボ総件数: ' +
		db.prepare("SELECT COUNT(*) as cnt FROM point_ledger WHERE type = 'combo_bonus'").get().cnt,
);

console.log('\n=== コンボ種別ごとの発生回数 ===');
const comboTypes = db
	.prepare(`
  SELECT
    CASE
      WHEN description LIKE '%パーフェクト%' THEN 'パーフェクト'
      WHEN description LIKE '%スーパーヒーロー%' THEN 'スーパーヒーロー'
      WHEN description LIKE '%さんみいったい%' THEN 'さんみいったい'
      WHEN description LIKE '%にとうりゅう%' THEN 'にとうりゅう'
      WHEN description LIKE '%スーパー%' THEN 'カテゴリ:スーパー'
      WHEN description LIKE '%トリプル%' THEN 'カテゴリ:トリプル'
      WHEN description LIKE '%ダブル%' THEN 'カテゴリ:ダブル'
      ELSE 'その他'
    END as combo_type,
    COUNT(*) as cnt,
    SUM(amount) as total_points
  FROM point_ledger
  WHERE type = 'combo_bonus'
  GROUP BY combo_type
  ORDER BY cnt DESC
`)
	.all();
comboTypes.forEach((c) => {
	console.log(`${c.combo_type}: ${c.cnt}回 (合計${c.total_points}P)`);
});

console.log('\n=== 実績解除状況 ===');
const achs = db
	.prepare(`
  SELECT a.code, a.name, ca.milestone_value, ca.unlocked_at
  FROM child_achievements ca
  JOIN achievements a ON a.id = ca.achievement_id
  ORDER BY ca.unlocked_at DESC
  LIMIT 30
`)
	.all();
achs.forEach((a) => {
	console.log(
		`${a.unlocked_at} | ${a.name}${a.milestone_value ? ' (M=' + a.milestone_value + ')' : ''}`,
	);
});
console.log(
	'実績総件数: ' + db.prepare('SELECT COUNT(*) as cnt FROM child_achievements').get().cnt,
);

console.log('\n=== 実績コード別の解除状況 ===');
const achCodes = db
	.prepare(`
  SELECT a.code, a.name, COUNT(*) as unlock_count
  FROM child_achievements ca
  JOIN achievements a ON a.id = ca.achievement_id
  GROUP BY a.code
  ORDER BY unlock_count DESC
`)
	.all();
achCodes.forEach((a) => {
	console.log(`${a.code} (${a.name}): ${a.unlock_count}回解除`);
});

console.log('\n=== デイリーミッション達成率 ===');
const missions = db
	.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
  FROM daily_missions
`)
	.get();
if (missions.total > 0) {
	console.log(
		`総ミッション数: ${missions.total}, 達成数: ${missions.completed}, 達成率: ${Math.round((missions.completed / missions.total) * 100)}%`,
	);
} else {
	console.log('ミッションデータなし');
}

console.log('\n=== 子供ごとの活動記録数と利用日数 ===');
const kids = db
	.prepare(`
  SELECT c.nickname, c.age,
    COUNT(al.id) as total_records,
    COUNT(DISTINCT date(al.recorded_at)) as active_days
  FROM children c
  LEFT JOIN activity_logs al ON al.child_id = c.id
  GROUP BY c.id
`)
	.all();
kids.forEach((k) => {
	console.log(`${k.nickname} (${k.age}歳): ${k.total_records}回記録, ${k.active_days}日間`);
});

console.log('\n=== 1日あたりの平均活動記録数（子供別）===');
const dailyAvg = db
	.prepare(`
  SELECT c.nickname,
    ROUND(CAST(COUNT(al.id) AS FLOAT) / MAX(1, COUNT(DISTINCT date(al.recorded_at))), 1) as avg_daily
  FROM children c
  LEFT JOIN activity_logs al ON al.child_id = c.id
  GROUP BY c.id
`)
	.all();
dailyAvg.forEach((d) => {
	console.log(`${d.nickname}: ${d.avg_daily}回/日`);
});

db.close();
