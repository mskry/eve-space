export interface ReadAdmissionDenial {
  readonly admitted: false
  readonly status: 401 | 403 | 404 | 409 | 503
  readonly body: {
    readonly code?: string
    readonly message: string
    readonly requiredScope?: string
    readonly reviewDeadline?: string | null
    readonly state?: string
  }
}

export class ReadAdmissionError extends Error {
  constructor(readonly denial: ReadAdmissionDenial) {
    super(denial.body.message)
  }
}

export const assertReadAdmission = (denial: ReadAdmissionDenial | null): void => {
  if (denial) throw new ReadAdmissionError(denial)
}
