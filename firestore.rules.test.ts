import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Static & structural verification suite for ModShift Firestore security rules
 * covering the Dirty Dozen attack vectors and Eight Pillars invariants.
 */
const rulesSource = fs.readFileSync('firestore.rules', 'utf8');

// Verify Pillar 1-8 gates are present in production rules
assert.ok(rulesSource.includes("rules_version = '2';"), 'Must enforce rules_version 2');
assert.ok(
  rulesSource.includes('match /{document=**} {\n      allow read, write: if false;\n    }'),
  'Must include global default-deny catch-all',
);
assert.ok(
  rulesSource.includes('request.auth.token.email_verified == true'),
  'Must enforce verified email identity',
);
assert.ok(
  rulesSource.includes('shreyasghimire71@gmail.com') &&
    rulesSource.includes('shreyasextra65@gmail.com') &&
    rulesSource.includes('modshiftt@gmaill.com') &&
    rulesSource.includes('request.auth.token.email.lower() in'),
  'Must enforce exact 3-email case-insensitive admin allowlist',
);
assert.ok(
  rulesSource.includes('function isAdmin() {\n      return isVerifiedUser()'),
  'isAdmin() must require verified email',
);
assert.ok(
  rulesSource.includes('incoming().credits == 50') &&
    rulesSource.includes('incoming().credits < existing().credits'),
  'Must enforce starter credits and decrement-only owner credit spending',
);
assert.ok(
  rulesSource.includes('match /creditTransactions/{txId}') &&
    rulesSource.includes('incoming().amount < 0'),
  'Must enforce immutable credit transaction ledger and negative-only owner spend logs',
);
assert.ok(
  rulesSource.includes('isUserNotBanned(userId)'),
  'Must block banned users from writing migrations and mods',
);
assert.ok(
  rulesSource.includes('match /siteConfig/{configId}') &&
    rulesSource.includes('isValidSiteConfig(incoming())'),
  'Must validate SiteConfig writes',
);
assert.ok(
  rulesSource.includes('match /auditLogs/{logId}') &&
    rulesSource.includes('allow update, delete: if false;'),
  'Must make auditLogs immutable',
);
assert.ok(
  rulesSource.includes('resource.data.ownerId == request.auth.uid'),
  'Must enforce query owner constraint in allow list on migrations and mods',
);
assert.ok(
  rulesSource.includes("data.keys().hasAll(['uid', 'displayName', 'email', 'createdAt', 'updatedAt'])") &&
    rulesSource.includes("'credits'") &&
    rulesSource.includes("'isBanned'"),
  'Must enforce strict keys on UserProfile including credits and ban fields',
);
assert.ok(
  rulesSource.includes('isValidTrackedMod(incoming(), userId)'),
  'Must enforce strict validation on TrackedMod',
);
assert.ok(
  rulesSource.includes('incoming().createdAt == request.time'),
  'Must enforce server timestamp integrity on create',
);

console.log('Firestore rules structural & Eight Pillars checks passed.');
