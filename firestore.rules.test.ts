/**
 * Phase 0 Payload-First Security Test Specification (Dirty Dozen Adversarial Suite)
 * Documents and validates the 12 adversarial cases enforced by firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  targetPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  enforcedBy: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated vault access',
    targetPath: 'users/u1/private/vault',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isSignedIn() checks request.auth != null',
  },
  {
    id: 2,
    name: 'Unverified email profile create',
    targetPath: 'users/u1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isEmailVerified() requires request.auth.token.email_verified == true',
  },
  {
    id: 3,
    name: 'Cross-user vault read',
    targetPath: 'users/u1/private/vault',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isOwner(userId) requires request.auth.uid == userId',
  },
  {
    id: 4,
    name: 'Identity spoofing on simulation create',
    targetPath: 'users/u1/simulations/sim_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidSimulation checks data.ownerId == userId && data.ownerId == request.auth.uid',
  },
  {
    id: 5,
    name: 'Shadow field injection (isAdmin: true)',
    targetPath: 'users/u1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidUserProfile enforces keys().hasOnly([...])',
  },
  {
    id: 6,
    name: 'ID poisoning with invalid characters or length > 128',
    targetPath: 'users/u1/simulations/bad$id',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidId(simulationId) enforces ^[a-zA-Z0-9_\\-]+$ and size <= 128',
  },
  {
    id: 7,
    name: 'Timestamp spoofing on vault create',
    targetPath: 'users/u1/private/vault',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().createdAt == request.time && incoming().updatedAt == request.time',
  },
  {
    id: 8,
    name: 'Immutable ownerId/createdAt tamper on update',
    targetPath: 'users/u1/simulations/sim_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'affectedKeys().hasOnly(...) and incoming().ownerId == existing().ownerId',
  },
  {
    id: 9,
    name: 'Wrong subdocument ID in private collection',
    targetPath: 'users/u1/private/arbitrary',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedBy: "docId == 'vault'",
  },
  {
    id: 10,
    name: 'Malformed relay token prefix',
    targetPath: 'users/u1/private/vault',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    enforcedBy: "data.apiToken.matches('^ffr_[a-zA-Z0-9_\\\\-]+$')",
  },
  {
    id: 11,
    name: 'Oversized chain array or base64 image payload',
    targetPath: 'users/u1/simulations/sim_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidImageMeta rejects base64Data via keys().hasOnly; chain.size() <= 30',
  },
  {
    id: 12,
    name: 'Cross-user list scraping on simulations',
    targetPath: 'users/u1/simulations',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'allow list requires isOwner(userId) && resource.data.ownerId == request.auth.uid',
  },
];
