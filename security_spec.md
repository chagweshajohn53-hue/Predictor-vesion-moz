# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Master Parent Ownership**: Every subcollection document under `/users/{userId}/private/{docId}` and `/users/{userId}/simulations/{simulationId}` can only be created when the parent `/users/{userId}` document exists and `request.auth.uid == userId`.
2. **Verified Identity**: All reads and writes require `request.auth != null`, and all writes require `request.auth.token.email_verified == true`.
3. **Strict Schema & No Shadow Fields**: Every document must match `keys().hasAll(...)` and `keys().hasOnly(...)` on create and `diff().affectedKeys().hasOnly(...)` on update.
4. **Immortal Identity & Temporal Integrity**: `uid`, `ownerId`, `id`, and `createdAt` cannot be modified after creation. `createdAt` must equal `request.time` on create, and `updatedAt` must equal `request.time` on both create and update.
5. **Private Key Vault Isolation**: `/users/{userId}/private/vault` contains API keys and personal `ffr_*` bearer tokens. Only `docId == 'vault'` is permitted, and only the verified owner (`request.auth.uid == userId`) can read or write it.
6. **Bounded Payloads**: Strings, arrays, and IDs are length-bounded to prevent 1MB document poisoning or Denial-of-Wallet attacks.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read/Write**: Read or write `/users/u1/private/vault` with `auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Create `/users/u1` with `auth.token.email_verified == false` -> `PERMISSION_DENIED`.
3. **Cross-User Vault Read**: User `u2` reads `/users/u1/private/vault` -> `PERMISSION_DENIED`.
4. **Identity Spoofing on Create**: User `u1` creates `/users/u1/simulations/sim_1` with `ownerId: "u2"` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection**: User `u1` creates `/users/u1` with `{ uid: "u1", ..., isAdmin: true }` -> `PERMISSION_DENIED`.
6. **ID Poisoning**: User `u1` creates `/users/u1/simulations/bad..slash$id` or 200-char ID -> `PERMISSION_DENIED`.
7. **Timestamp Spoofing**: User `u1` creates `/users/u1/private/vault` with client-forged `createdAt` != `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Field Tampering**: User `u1` updates `/users/u1/simulations/sim_1` changing `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
9. **Wrong Vault Subdocument ID**: User `u1` writes `/users/u1/private/other_doc` instead of `vault` -> `PERMISSION_DENIED`.
10. **Invalid Token Format**: User `u1` writes `apiToken: "not_ffr_token"` -> `PERMISSION_DENIED`.
11. **Oversized Array/String**: User `u1` writes `chain` with 31 items or `title` > 200 chars -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: User `u2` lists `/users/u1/simulations` -> `PERMISSION_DENIED`.
