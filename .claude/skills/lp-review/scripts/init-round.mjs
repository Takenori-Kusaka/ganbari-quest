#!/usr/bin/env node
/**
 * LP review ラウンド初期化スクリプト
 *
 * 使用法:
 *   node .claude/skills/lp-review/scripts/init-round.mjs --round 2026-06-01
 *
 * 動作:
 *   1. tmp/reviews/lp-YYYY-MM-DD/ が無ければ作成
 *   2. .claude/skills/lp-review/templates/ を tmp/reviews/lp-YYYY-MM-DD/ に再帰コピー
 *   3. ステップ手順は SKILL.md 参照
 *
 * SSOT: .claude/skills/lp-review/SKILL.md
 */

import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(SKILL_ROOT, 'templates');
const REPO_ROOT = join(SKILL_ROOT, '..', '..', '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let round = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--round' && i + 1 < args.length) {
      round = args[i + 1];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`使用法: node ${relative(REPO_ROOT, fileURLToPath(import.meta.url))} --round YYYY-MM-DD`);
      console.log('');
      console.log('LP review ラウンド初期化:');
      console.log('  - tmp/reviews/lp-YYYY-MM-DD/ にテンプレを再帰コピー');
      console.log('  - 詳細手順は .claude/skills/lp-review/SKILL.md 参照');
      process.exit(0);
    }
  }
  if (!round) {
    console.error('エラー: --round YYYY-MM-DD が必須です');
    console.error('使用法: --help で詳細');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(round)) {
    console.error(`エラー: --round は YYYY-MM-DD 形式（例: 2026-06-01）。受信: ${round}`);
    process.exit(1);
  }
  return { round };
}

async function copyRecursive(src, dst) {
  const stats = await stat(src);
  if (stats.isDirectory()) {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src);
    for (const entry of entries) {
      await copyRecursive(join(src, entry), join(dst, entry));
    }
  } else {
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
}

async function main() {
  const { round } = parseArgs();
  const targetDir = join(REPO_ROOT, 'tmp', 'reviews', `lp-${round}`);

  if (existsSync(targetDir)) {
    console.warn(`警告: ${relative(REPO_ROOT, targetDir)} は既に存在します。上書きせず既存ファイルは維持します。`);
  }

  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, 'screenshots'), { recursive: true });

  // テンプレ再帰コピー (existsSync で既存ファイルは skip)
  const entries = await readdir(TEMPLATES_DIR);
  let copied = 0;
  let skipped = 0;
  for (const entry of entries) {
    const src = join(TEMPLATES_DIR, entry);
    const dst = join(targetDir, entry);
    if (existsSync(dst)) {
      skipped++;
      continue;
    }
    await copyRecursive(src, dst);
    copied++;
  }

  console.log(`✓ LP review round lp-${round} 初期化完了`);
  console.log(`  出力先: ${relative(REPO_ROOT, targetDir)}`);
  console.log(`  コピー: ${copied} ファイル/ディレクトリ / skip: ${skipped}`);
  console.log('');
  console.log('次の手順:');
  console.log('  1. PO スクショを screenshots/ に配置');
  console.log('  2. .claude/skills/lp-review/SKILL.md の Step 1-6 を実行');
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
