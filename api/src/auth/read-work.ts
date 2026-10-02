export interface ReadAdmissionWork {
  run<Result>(read: (slot?: ReadAdmissionWork) => Promise<Result>): Promise<Result>
}

export const immediateReadWork: ReadAdmissionWork = Object.freeze<ReadAdmissionWork>({
  run: (read) => read(immediateReadWork),
})
