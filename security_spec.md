# ModShift Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every `/users/{userId}` document and `/users/{userId}/migrations/{migrationId}`, `/users/{userId}/mods/{modId}`, or `/users/{userId}/creditTransactions/{txId}` subcollection document is private to `userId` (`request.auth.uid == userId`), with administrative oversight strictly restricted to verified allowlisted admin emails.
2. **Verified Admin Allowlist**: Only authenticated users with `request.auth.token.email_verified == true` and email in `['shreyasghimire71@gmail.com', 'shreyasextra65@gmail.com', 'modshiftt@gmaill.com']` pass `isAdmin()`.
3. **Immutable Ownership & Creation Timestamps**: `uid`, `ownerId`, and `createdAt` cannot be modified after creation. `createdAt` and `updatedAt` must equal `request.time`.
4. **Anti-Tamper Credits & Moderation**: New users initialize at exactly `credits == 50` and `isBanned == false`. Owners may only decrement their own credits (`0 <= incoming.credits < existing.credits`, max 200 per operation) and create negative spend receipts; only verified admins may grant/increase credits or set `isBanned`/`banReason`.
5. **Public Site Config Read / Admin-Only Write**: `/siteConfig/global` is readable via single-document `get` so visitors see maintenance notices, news banners, and credit pricing, while listing `/siteConfig` is denied and writes require `isAdmin()`.
6. **Immutable Audit & Credit Ledgers**: `/siteConfig/global/auditLogs/{logId}` and `/users/{userId}/creditTransactions/{txId}` cannot be updated or deleted once created.

## 2. Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write** of `/users/alice` or `/siteConfig/global` write.
2. **Non-admin user listing `/users`** or reading `/users/bob`.
3. **Admin email spoof with `email_verified == false`** attempting to write `/siteConfig/global`.
4. **Non-admin attempting to update `newsEnabled` or `maintenanceMode`** in `/siteConfig/global`.
5. **Self-credit inflation**: Non-admin user updating `/users/alice` with `credits: 9999` or creating `/users/alice` with `credits: 500`.
6. **Self-unban attempt**: Banned user updating `/users/alice` with `isBanned: false` or `banReason: ""`.
7. **Positive credit ledger spoof**: Non-admin user creating `creditTransactions` with `amount: 100`.
8. **Client-forged timestamp** on `/siteConfig/global`, `/users/{uid}`, or `auditLogs`.
9. **Attempting to update or delete an `auditLogs` or `creditTransactions` document**.
10. **Cross-user `migrations`, `mods`, or `creditTransactions` access** by a non-admin user.
11. **Path ID poisoning** (`>128` chars or invalid characters).
12. **Unbounded array injection** on `disabledLoaders` (`size > 4`) or `migrations.items` (`size > 300`).
