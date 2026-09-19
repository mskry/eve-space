interface TrainedSkillsEvidence {
  readonly trainedSkills: {
    readonly snapshot: {
      readonly groups: readonly { readonly skills: readonly unknown[] }[]
    }
  } | null
}

interface AssetEvidence {
  readonly snapshot: { readonly records: readonly unknown[] }
}

interface WalletEvidence {
  readonly balance: object | null
  readonly journal: readonly unknown[]
  readonly transactions: readonly unknown[]
}

interface MailEvidence {
  readonly headers: readonly unknown[]
  readonly contents: readonly unknown[]
}

export function hasTrainedSkillsEvidence(evidence: TrainedSkillsEvidence | null | undefined) {
  return evidence?.trainedSkills?.snapshot.groups.some((group) => group.skills.length > 0) ?? false
}

export function hasAssetEvidence(evidence: AssetEvidence | null | undefined) {
  return (evidence?.snapshot.records.length ?? 0) > 0
}

export function hasWalletEvidence(evidence: WalletEvidence | null | undefined) {
  return Boolean(evidence?.balance || evidence?.journal.length || evidence?.transactions.length)
}

export function hasMailEvidence(evidence: MailEvidence | null | undefined) {
  return Boolean(evidence?.headers.length || evidence?.contents.length)
}
