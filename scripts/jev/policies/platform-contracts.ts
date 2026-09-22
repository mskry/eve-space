import type { Questions } from '@typesafe-ai/sdk'

export const platformContractPolicy = {
  deterministic_boundary:
    'Manifest schema validity, identifiers, route wiring, and authorization enforcement remain deterministic responsibilities. This review judges only whether the declared contract and implementation mean the same thing.',
  audience:
    'Member routes expose only member-safe data. HR and director routes may expose progressively narrower administrative or sensitive review capabilities when their declared purpose requires it.',
  permission:
    'A required permission must specifically describe every material read or mutation the route performs. A broad-sounding label does not compensate for a purpose that omits sensitive evidence or state-changing behavior.',
  target:
    'Caller routes act for the authenticated caller, owned-character routes act on a character owned by the caller, managed-account routes act on a reviewed account, and managed-character routes act on one reviewed character.',
  sensitivity:
    'Routes that return private reviewer evidence require a sensitive permission, a sensitive-evidence section and exposure, and the audited reviewer-evidence path. Access-management mutations require an access-management section. Member-safe aggregates and ordinary workspace views must not be described as sensitive reviewer evidence.',
  outcome:
    'High-confidence security mismatches are reportable. Missing evidence, semantic ambiguity, and low-confidence judgments require human review rather than an automated pass.',
} as const

export const platformContractQuestions = {
  purpose_fit: {
    type: 'choice',
    instructions:
      'Compare `contract.permission`, `contract.reviewer_contribution`, the route name and path in `contract.route`, and `implementation.code`. Do the declared purposes accurately describe what the route reads, returns, or changes?',
    criteria: {
      aligned:
        'The permission purpose and optional reviewer description cover the route implementation’s material reads, returned data, and mutations.',
      mismatch:
        'The implementation serves a materially different purpose, returns undeclared evidence, or performs an action omitted by the declarations.',
      unclear: 'The supplied declarations or implementation do not establish the route purpose.',
    },
  },
  audience_fit: {
    type: 'choice',
    instructions:
      'Judge whether the audience declared in `contract.route` is appropriate for the behavior in `implementation.code`, considering the permission purpose, data sensitivity, target, and `policy.audience`.',
    criteria: {
      aligned:
        'The declared audience is no broader than the route behavior and returned data justify.',
      overbroad:
        'The route exposes administrative, cross-member, private reviewer, or similarly restricted behavior to an audience that is too broad.',
      unclear: 'The evidence does not show who should be allowed to use this behavior.',
    },
  },
  permission_fit: {
    type: 'choice',
    instructions:
      'Does `contract.permission` specifically authorize all material behavior in `implementation.code`, including sensitive reads and mutations, rather than merely sounding related?',
    criteria: {
      aligned:
        'The permission key, label, purpose, sensitivity, and route behavior describe the same bounded capability.',
      under_scoped:
        'The route reads materially more sensitive data or performs broader mutations than the required permission purpose authorizes.',
      mismatch:
        'The required permission describes a different capability from the implemented route.',
      unclear:
        'The permission declaration or implementation is insufficient to establish semantic scope.',
    },
  },
  target_fit: {
    type: 'choice',
    instructions:
      'Compare `contract.route.target`, authorization strategy, namespace parameters, reviewer declaration, and the identity used by `implementation.code`. Does the route act on the declared subject?',
    criteria: {
      aligned:
        'The path, loaded context, and implementation all operate on the declared caller, owned character, managed account, or managed character.',
      mismatch:
        'The implementation reads or changes a different subject class, or relies on an identity that contradicts the declared target.',
      unclear: 'The subject acted on cannot be established from the supplied evidence.',
    },
  },
  sensitivity_fit: {
    type: 'choice',
    instructions:
      'Compare the permission sensitivity, section kind, route exposure, reviewer evidence binding, implementation behavior, and `policy.sensitivity`. Is the route classified and audited at the appropriate sensitivity?',
    criteria: {
      aligned:
        'Sensitive reviewer evidence and access-management behavior use the required classifications, while ordinary member-safe or workspace behavior is not misclassified.',
      underclassified:
        'Private reviewer evidence, sensitive cross-member data, or access-management behavior lacks the necessary sensitive or access-management classification and audit path.',
      inconsistent:
        'The permission, section, exposure, reviewer binding, and implementation disagree in a way that is not clearly an underclassification.',
      unclear:
        'The evidence does not establish the route sensitivity or applicable classification.',
    },
  },
} as const satisfies Questions
