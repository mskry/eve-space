# Trading inventory experience

The optional `/trading` page starts with all attached characters. Selecting “All attached characters” preserves that default as the roster changes; turning it off selects an explicit subset, including an intentionally empty set. Personal inventory needs no organization or Member Audit admission. Generated authenticated dashboard navigation exposes Trading while the module is enabled.

The corporation selector offers all current managed corporations after live HR/director admission with the exact Trading and Member Audit assets permissions. These reviewer roles and permissions apply across the whole managed organization, including every current member corporation in an alliance. Opening a corporation still requires full core subject admission for that selected corporation. Each request reads one corporation. EVE-16 deployment acceptance remains an independent corporation release gate.

## Reading holdings

Type, group, category and physical-location filters apply to item groups, not coverage. The page shows at most 50 groups, holders or coverage subjects per connection page. “Next” replaces the current bounded page; refresh returns to the first page. Group rows identify blueprint distinction, physical-root state and key, and separate exact current and readable stale quantities. Unknown and restricted roots remain explicit rather than prompting additional private-location requests.

Holder buttons show permitted character contributions and their observation, validation, freshness and readability clocks. Holder access remains subordinate to the original inventory scope. Sources are independently observed; the page does not claim a simultaneous snapshot, reserved stock, transfer commitments or authority to move another character's possessions.

Coverage counts describe the complete selected scope even when filters remove every item group. Complete observations with no matching holdings are distinguished from authorization, missing, unavailable, incomplete, retention and conflict gaps. Missing holdings remain unknown. Conflicts exclude disputed items while unaffected quantities remain visible. Personal authorization gaps direct the owner to their Characters page; corporation gaps do not offer another member's authorization flow. Supported-limit refusal clears totals and asks for a narrower personal scope.

## Admission and restart

Protected operations start only after client mount and live session/scope admission. The page uses the platform aggregate query surface and generated GraphQL operations. Inventory values and cursors stay in component memory; they never enter Colada persistence, browser storage or SSR payloads. Switching owner, scope or applied filters clears the previous presentation immediately.

Admission renews on session/roster/organization revisions, focus, reconnect and a 45-second renewal timer. A successful verdict admits presentation for at most 60 seconds. During verification or an unavailable verdict, retained values stay hidden. Known denial, module/section disablement, changed authority fingerprint, logout or owner change clears affected values. Request generations and cancellation prevent superseded reads or admissions from restoring them, including transports that finish after cancellation. Unmount cancels requests, disposes retained values and removes browser listeners and timers.

Source or authority changes during continuation discard the old page and cursor. “Restart inventory” loads first pages under fresh admission. Group, coverage and holder results must share the full source-view fingerprint; incompatible responses are never combined. The browser learns remote changes through refresh and admission, not instantaneous push revocation. Server release gates remain authoritative for every read.

## Accessibility

The route has a distinct document title and uses the application skip link and route announcer. Scope, character and filter controls use labelled native select, checkbox and input semantics. Tables have column and row headers; the horizontal table container is keyboard focusable. Actions are ordinary keyboard buttons with visible theme focus rings. Freshness, missing coverage, conflicts and failures are stated in text.

The labelled inventory status output stays visible. Nuxt's polite announcer announces asynchronous changes; the visible output disables its own live announcement to avoid duplicates. Validation errors are announced as alerts. Dates use explicit UTC ISO values in native time elements, without independent server/client locale formatting.

## Verification

Focused platform lifecycle tests exercise unavailable-verdict suspension and recovery, known invalidation, changed full fingerprints, owner mismatch, expiry, and late reads/admissions. Mounted API tests cover metadata-only admission, before-release binding changes and exact reviewer discovery without asset evidence. A PostgreSQL fixture exercises current-version/current-corporation selection and the 250-corporation selector bound without truncation.

Production browser journeys exercise protected SSR exclusion, hydration, default multiple-character totals, explicit empty/subset selection, keyboard filters and holders, delayed scope switching, source restart, unavailable verification, reviewer/session denial, coverage gaps, complete empty observations, limits and absence of inventory contents in persisted browser cache. These are local source and fixture checks; representative deployment capacity, runtime probes and corporation release acceptance remain Group 7 work.
