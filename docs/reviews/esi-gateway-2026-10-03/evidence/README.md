# Reproduction evidence

The three probes assert current defects. They use controlled runtime adapters and perform no network mutations. The original temporary repository test was removed after the run.

To reproduce on the reviewed checkout, copy `adversarial-probe.test.ts.txt` to `api/tests/esi-gateway/architecture-adversarial-probe.test.ts`, then run:

```sh
pnpm --filter @eve-space/api test tests/esi-gateway/architecture-adversarial-probe.test.ts
```

Remove the temporary test after use. Do not overwrite a pre-existing file at that path. Imports intentionally target the original gateway test directory.

`adversarial-probe.log.txt` records the three reproduced failures. `tests.log.txt` records the existing 365 passing gateway tests. Egress and boundary runner logs are empty because successful checks emit no output; the assessment records their observed exit statuses. `index.log.txt` records the failed GitNexus refresh.

These probes demonstrate in-process behavior and two runtimes sharing controlled ports. They do not replace real Redis integration or deployment testing.
