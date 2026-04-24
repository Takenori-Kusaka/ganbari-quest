import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/routes/auth/invite/[code]/+page.svelte', 'utf8');

// Step 1: Update import
c = c.replace(
  "import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';",
  "import { APP_LABELS, AUTH_INVITE_LABELS, PAGE_TITLES } from '$lib/domain/labels';"
);

// Step 2: App title
c = c.replace(
  '>がんばりクエスト</h1>',
  '>{AUTH_INVITE_LABELS.appTitle}</h1>'
);

// Step 3: Invalid link desc
c = c.replace(
  '<p class="text-sm text-[var(--color-neutral-500)] mb-6">招待した方に新しいリンクを発行してもらってください。</p>',
  '<p class="text-sm text-[var(--color-neutral-500)] mb-6">{AUTH_INVITE_LABELS.invalidLinkDesc}</p>'
);

// Step 4: Login page link (error button)
c = c.replace(
  '">ログインページへ</a>',
  '">{AUTH_INVITE_LABELS.loginPageLink}</a>'
);

// Step 5: Invite message
c = c.replace(
  '\t\t\t\t\t家族グループへの招待が届いています。\n\t\t\t\t</p>',
  '\t\t\t\t\t{AUTH_INVITE_LABELS.inviteMessage}\n\t\t\t\t</p>'
);

// Step 6: Role label
c = c.replace(
  '<span class="text-sm text-[var(--color-neutral-500)]">参加ロール:</span>',
  '<span class="text-sm text-[var(--color-neutral-500)]">{AUTH_INVITE_LABELS.roleLabel}</span>'
);

// Step 7: Signup button
c = c.replace(
  '\t\t\t\t\t新規アカウントを作成して参加\n\t\t\t\t</a>',
  '\t\t\t\t\t{AUTH_INVITE_LABELS.signupButton}\n\t\t\t\t</a>'
);

// Step 8: Login button
c = c.replace(
  '\t\t\t\t\t既存アカウントでログインして参加\n\t\t\t\t</a>',
  '\t\t\t\t\t{AUTH_INVITE_LABELS.loginButton}\n\t\t\t\t</a>'
);

writeFileSync('src/routes/auth/invite/[code]/+page.svelte', c, 'utf8');
console.log('Done');
