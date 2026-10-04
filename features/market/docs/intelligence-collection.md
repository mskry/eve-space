# Market intelligence collection

Intelligence collection is a deployment-administrator opt-in on the existing enabled
full-region public profile. Installing or enabling Market does not enable collection.
The existing four-profile, single enabled full-region, watched-type, station, order-page,
and order-concurrency bounds remain in force.

Administrators read or replace policy through
`/api/modules/market/profiles/:profileId/intelligence`. Replacement requires the current
profile revision and policy revision. Policy starts disabled with these 22 ignored
market-group IDs:

`150, 1954, 3630, 204, 209, 1041, 1338, 2157, 2158, 1663, 20, 22, 23, 2801, 1846, 492, 614, 751, 754, 1109, 2480, 1396`.

An ignored group excludes its descendants. Overlapping exclusions count each type once.
Unknown or repeated group IDs reject replacement. Policies allow at most 256 ignored
groups. Catalogue browsing and explicit selected-item history demands remain separate
from broad eligibility; excluding an item does not hide it from the catalogue.

The background resource reads a complete group tree and type search index from the same
committed catalogue revision. It selects published, market-assigned types even when they
have no visible current orders. Replacement requires at most 4,000 groups and 32,000
types. Batches stage at most 1,000 types within the platform persistence byte ceiling;
only a complete, current profile/policy generation becomes active. Interrupted staging
can be replayed without duplicating targets. A catalogue race or invalid replacement
leaves the previous valid universe identifiable with its original revision.

Regional PLEX is removed from the broad universe. Global PLEX uses only type 44992 in
region 19000001 through its separately configured watched-type profile, without a station
filter. Its evidence and totals remain separate from every regional profile.

History always describes regional trades. A station filter narrows the associated order
book; it does not turn regional history into station-level trades or demand. Consumers
must retain the independent history and book scopes when comparing them.
