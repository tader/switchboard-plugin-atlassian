# Authentication helper fixtures

`oauth2.ts` and `api-key.ts` are snapshots of the actual built-in Switchboard helpers from `../switchboard/plugins/`, copied on 2026-10-09. Their runtime code is unchanged. Original type-only paths are erased by Node and are not required at runtime. These fixtures let CI exercise the plugins with the real helper behavior without a sibling checkout. Production always uses `ctx.require()` to obtain the installed Switchboard helpers.
