type CloneResourceStatus = 'ready' | 'loading' | 'authorization' | 'error'

export interface CloneResourceState {
  status: CloneResourceStatus
  message: string
  authorizeUrl: string
}

export interface CloneSkillArchive {
  readonly groups: ReadonlyArray<{
    readonly skills: ReadonlyArray<{
      readonly typeId: number
      readonly trainedLevel?: number
      readonly activeLevel?: number
    }>
  }>
}

export interface CloneImplantView {
  readonly typeId: number
  readonly name: string
  readonly slot?: number | null
  readonly bonuses?: ReadonlyArray<{ readonly attribute: string; readonly value: number }>
}

export interface CloneImplantCollection {
  readonly implants: readonly CloneImplantView[]
  readonly stale: boolean
  readonly validatedAt: string
}
