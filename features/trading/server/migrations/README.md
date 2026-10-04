# Trading migrations

Trading currently declares no database migrations. This directory is packaged through
the `./migrations/*` export required by the platform server-package contract.

Inventory persistence belongs to core and the Member Audit provider. Any future
Trading-owned migrations must be declared in Trading's manifest.
