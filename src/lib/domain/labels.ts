// src/lib/domain/labels.ts — labels 層 (compound、ADR-0045) の import 入口 (#4965)。
// 利用側は `$lib/domain/labels` から import する。宣言はここに書かない。
// namespace は src/lib/domain/labels/<file>.ts に置く。どのファイルに置くかは docs/DESIGN.md §6 の配置規則で決まる。
// ファイルを足したら、下の export * に 1 行足す (名前順)。
// biome-ignore-all lint/performance/noBarrelFile: labels 層の唯一の import 入口 (ADR-0045 / #4965)
export * from './labels/admin-activities';
export * from './labels/admin-certificates';
export * from './labels/admin-challenges';
export * from './labels/admin-checklists';
export * from './labels/admin-cheer';
export * from './labels/admin-children';
export * from './labels/admin-growth-book';
export * from './labels/admin-home';
export * from './labels/admin-points';
export * from './labels/admin-reports';
export * from './labels/admin-rewards';
export * from './labels/admin-settings';
export * from './labels/admin-shared';
export * from './labels/admin-status';
export * from './labels/age-tier';
export * from './labels/auth';
export * from './labels/billing';
export * from './labels/child-battle';
export * from './labels/child-challenges';
export * from './labels/child-checklist';
export * from './labels/child-home';
export * from './labels/child-milestone';
export * from './labels/child-record';
export * from './labels/child-shop';
export * from './labels/child-status';
export * from './labels/common';
export * from './labels/demo';
export * from './labels/errors';
export * from './labels/features';
export * from './labels/format';
export * from './labels/inquiry';
export * from './labels/lp';
export * from './labels/marketplace';
export * from './labels/members';
export * from './labels/nav';
export * from './labels/ops';
export * from './labels/outbound';
export * from './labels/oyakagi';
export * from './labels/page-guide';
export * from './labels/plan';
export * from './labels/setup';
export * from './labels/storybook';
export * from './labels/survey';
export * from './labels/switch';
export * from './labels/theme';
export * from './labels/tutorial';
export * from './labels/ui';
