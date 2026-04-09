#!/usr/bin/env node
/**
 * Tailwind hardcoded color → CSS token migration script
 * Issue #651: routes/ 配下の Tailwind ハードコード色を CSS トークンに一括移行
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ============================================================
// Mapping: Tailwind class → CSS token class
// ============================================================
const REPLACEMENTS = [
  // ---- Gray → Surface/Text/Border tokens ----
  ['bg-gray-50', 'bg-[var(--color-surface-muted)]'],
  ['bg-gray-100', 'bg-[var(--color-surface-secondary)]'],
  ['bg-gray-200', 'bg-[var(--color-surface-tertiary)]'],
  ['bg-gray-300', 'bg-[var(--color-border-strong)]'],
  ['text-gray-800', 'text-[var(--color-text)]'],
  ['text-gray-700', 'text-[var(--color-text-primary)]'],
  ['text-gray-600', 'text-[var(--color-text-secondary)]'],
  ['text-gray-500', 'text-[var(--color-text-muted)]'],
  ['text-gray-400', 'text-[var(--color-text-tertiary)]'],
  ['text-gray-300', 'text-[var(--color-text-disabled)]'],
  ['border-gray-300', 'border-[var(--color-border-strong)]'],
  ['border-gray-200', 'border-[var(--color-border)]'],
  ['border-gray-100', 'border-[var(--color-border-light)]'],
  ['border-gray-50', 'border-[var(--color-surface-muted)]'],
  ['hover:bg-gray-50', 'hover:bg-[var(--color-surface-muted)]'],
  ['hover:bg-gray-100', 'hover:bg-[var(--color-surface-secondary)]'],
  ['hover:bg-gray-200', 'hover:bg-[var(--color-surface-tertiary)]'],
  ['hover:text-gray-700', 'hover:text-[var(--color-text-primary)]'],
  ['hover:text-gray-600', 'hover:text-[var(--color-text-secondary)]'],

  // ---- Blue → Info feedback / stat tokens ----
  ['bg-blue-50', 'bg-[var(--color-feedback-info-bg)]'],
  ['bg-blue-100', 'bg-[var(--color-feedback-info-bg-strong)]'],
  ['bg-blue-300', 'bg-[var(--color-feedback-info-border)]'],
  ['bg-blue-400', 'bg-[var(--color-feedback-info-border)]'],
  ['bg-blue-500', 'bg-[var(--color-stat-blue)]'],
  ['text-blue-500', 'text-[var(--color-feedback-info-text)]'],
  ['text-blue-600', 'text-[var(--color-feedback-info-text)]'],
  ['text-blue-700', 'text-[var(--color-feedback-info-text)]'],
  ['text-blue-800', 'text-[var(--color-feedback-info-text)]'],
  ['border-blue-200', 'border-[var(--color-feedback-info-border)]'],
  ['border-blue-300', 'border-[var(--color-feedback-info-border)]'],
  ['border-blue-400', 'border-[var(--color-feedback-info-border)]'],
  ['border-blue-500', 'border-[var(--color-feedback-info-text)]'],
  ['ring-blue-300', 'ring-[var(--color-feedback-info-border)]'],
  ['ring-blue-400', 'ring-[var(--color-border-focus)]'],
  ['ring-blue-500', 'ring-[var(--color-border-focus)]'],
  ['hover:bg-blue-50', 'hover:bg-[var(--color-feedback-info-bg)]'],
  ['hover:bg-blue-100', 'hover:bg-[var(--color-feedback-info-bg-strong)]'],
  ['hover:bg-blue-600', 'hover:bg-[var(--color-action-primary-hover)]'],
  ['hover:text-blue-500', 'hover:text-[var(--color-feedback-info-text)]'],
  ['hover:text-blue-700', 'hover:text-[var(--color-feedback-info-text)]'],
  ['hover:text-blue-800', 'hover:text-[var(--color-feedback-info-text)]'],
  ['hover:text-blue-600', 'hover:text-[var(--color-feedback-info-text)]'],

  // ---- Green → Success feedback / stat tokens ----
  ['bg-green-50', 'bg-[var(--color-feedback-success-bg)]'],
  ['bg-green-100', 'bg-[var(--color-feedback-success-bg-strong)]'],
  ['bg-green-400', 'bg-[var(--color-feedback-success-border)]'],
  ['bg-green-500', 'bg-[var(--color-stat-green)]'],
  ['text-green-500', 'text-[var(--color-feedback-success-text)]'],
  ['text-green-600', 'text-[var(--color-feedback-success-text)]'],
  ['text-green-700', 'text-[var(--color-feedback-success-text)]'],
  ['border-green-100', 'border-[var(--color-feedback-success-bg-strong)]'],
  ['border-green-200', 'border-[var(--color-feedback-success-border)]'],

  // ---- Red → Error feedback tokens ----
  ['bg-red-50', 'bg-[var(--color-feedback-error-bg)]'],
  ['bg-red-100', 'bg-[var(--color-feedback-error-bg-strong)]'],
  ['bg-red-500', 'bg-[var(--color-stat-red)]'],
  ['text-red-400', 'text-[var(--color-feedback-error-text)]'],
  ['text-red-500', 'text-[var(--color-feedback-error-text)]'],
  ['text-red-600', 'text-[var(--color-feedback-error-text)]'],
  ['text-red-700', 'text-[var(--color-feedback-error-text)]'],
  ['text-red-800', 'text-[var(--color-feedback-error-text)]'],
  ['border-red-100', 'border-[var(--color-feedback-error-bg-strong)]'],
  ['border-red-200', 'border-[var(--color-feedback-error-border)]'],
  ['border-red-300', 'border-[var(--color-feedback-error-border)]'],
  ['hover:bg-red-100', 'hover:bg-[var(--color-feedback-error-bg-strong)]'],
  ['hover:text-red-500', 'hover:text-[var(--color-feedback-error-text)]'],
  ['hover:text-red-600', 'hover:text-[var(--color-feedback-error-text)]'],

  // ---- Amber/Yellow → Warning feedback / stat tokens ----
  ['bg-amber-50', 'bg-[var(--color-feedback-warning-bg)]'],
  ['bg-amber-100', 'bg-[var(--color-feedback-warning-bg-strong)]'],
  ['bg-amber-500', 'bg-[var(--color-stat-amber)]'],
  ['bg-yellow-50', 'bg-[var(--color-feedback-warning-bg)]'],
  ['bg-yellow-100', 'bg-[var(--color-feedback-warning-bg-strong)]'],
  ['text-amber-500', 'text-[var(--color-feedback-warning-text)]'],
  ['text-amber-600', 'text-[var(--color-feedback-warning-text)]'],
  ['text-amber-700', 'text-[var(--color-feedback-warning-text)]'],
  ['text-amber-800', 'text-[var(--color-feedback-warning-text)]'],
  ['text-yellow-600', 'text-[var(--color-feedback-warning-text)]'],
  ['text-yellow-700', 'text-[var(--color-feedback-warning-text)]'],
  ['text-yellow-800', 'text-[var(--color-feedback-warning-text)]'],
  ['border-amber-100', 'border-[var(--color-feedback-warning-bg-strong)]'],
  ['border-amber-200', 'border-[var(--color-feedback-warning-border)]'],
  ['border-amber-300', 'border-[var(--color-feedback-warning-border)]'],
  ['border-yellow-200', 'border-[var(--color-feedback-warning-border)]'],
  ['border-yellow-300', 'border-[var(--color-feedback-warning-border)]'],
  ['hover:bg-amber-600', 'hover:bg-[var(--color-stat-amber)]'],

  // ---- Purple → Premium / stat tokens ----
  ['bg-purple-50', 'bg-[var(--color-stat-purple-bg)]'],
  ['bg-purple-300', 'bg-[var(--color-stat-purple)]'],
  ['text-purple-600', 'text-[var(--color-stat-purple)]'],
  ['text-purple-700', 'text-[var(--color-stat-purple)]'],
  ['hover:bg-purple-100', 'hover:bg-[var(--color-premium-100)]'],

  // ---- Indigo → stat tokens ----
  ['bg-indigo-50', 'bg-[var(--color-stat-indigo-bg)]'],
  ['text-indigo-500', 'text-[var(--color-stat-indigo)]'],
  ['text-indigo-600', 'text-[var(--color-stat-indigo)]'],
  ['text-indigo-700', 'text-[var(--color-stat-indigo)]'],

  // ---- Pink → Premium tokens ----
  ['bg-pink-50', 'bg-[var(--color-premium-50)]'],
  ['bg-pink-500', 'bg-[var(--color-premium)]'],
  ['border-pink-400', 'border-[var(--color-premium)]'],
  ['ring-pink-400', 'ring-[var(--color-premium)]'],
];

// Sort by longest match first to avoid partial replacements
REPLACEMENTS.sort((a, b) => b[0].length - a[0].length);

// Find all .svelte files in src/routes/
const files = execSync(
  'find src/routes -name "*.svelte" -type f',
  { encoding: 'utf-8', cwd: process.cwd() }
).trim().split('\n').filter(Boolean);

let totalReplacements = 0;
const fileChanges = [];

for (const file of files) {
  let content = readFileSync(file, 'utf-8');
  let original = content;
  let fileReplacements = 0;

  for (const [from, to] of REPLACEMENTS) {
    // Use word boundary matching to avoid partial replacements
    // Match the class as a complete token (preceded by space, quote, or start; followed by space, quote, or end)
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<=[\\s"'\`{])${escaped}(?=[\\s"'\`}])`, 'g');
    const matches = content.match(regex);
    if (matches) {
      content = content.replace(regex, to);
      fileReplacements += matches.length;
    }
  }

  if (content !== original) {
    writeFileSync(file, content, 'utf-8');
    totalReplacements += fileReplacements;
    fileChanges.push({ file, count: fileReplacements });
  }
}

console.log(`\n=== Migration Complete ===`);
console.log(`Files modified: ${fileChanges.length}`);
console.log(`Total replacements: ${totalReplacements}`);
console.log(`\nPer-file breakdown:`);
for (const { file, count } of fileChanges.sort((a, b) => b.count - a.count)) {
  console.log(`  ${count.toString().padStart(4)} ${file}`);
}

// Check remaining violations
const remaining = execSync(
  `grep -rn --include="*.svelte" -E "\\b(bg|text|border|ring)-(red|green|blue|gray|yellow|pink|purple|indigo|emerald|amber|slate|zinc|white|black)-(50|100|200|300|400|500|600|700|800|900)\\b" src/routes/ || true`,
  { encoding: 'utf-8', cwd: process.cwd(), env: { ...process.env, LC_ALL: 'C' } }
).trim();

const remainingLines = remaining ? remaining.split('\n').length : 0;
console.log(`\nRemaining violations: ${remainingLines}`);
if (remaining) {
  console.log(remaining);
}
