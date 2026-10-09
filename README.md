# Atlassian plugins for Switchboard

Jira, Confluence and Bitbucket integrations for [Switchboard](https://github.com/tader/switchboard). Node 24+ is required. There are no npm dependencies.

| Plugin | Services | Authentication |
|---|---|---|
| `atlassian` | Jira and Confluence | Cloud OAuth, Cloud email/API token, Data Center personal access token |
| `bitbucket` | Bitbucket repositories, pull requests and Cloud pipelines | Cloud OAuth, Cloud email/API token, Data Center personal access token |

Both plugins use Switchboard's built-in `oauth2` and `api-key` dependencies. Each folder is independently installable and contains its own code, icons, type declarations and setup guide. Switchboard supplies the HTTP proxy, credential encryption, token refresh, audit logging and API discovery.

## Install

Enter `tader/switchboard-plugin-atlassian` in **Plugins → Install from GitHub** to install both plugins. To install one, use its folder URL, for example `https://github.com/tader/switchboard-plugin-atlassian/tree/main/plugins/bitbucket`.

For local development, copy the complete `plugins/atlassian` and `plugins/bitbucket` directories into `<Switchboard data>/plugins/`, then reload or restart Switchboard. Use real directories; Switchboard copies each plugin into an isolated runtime directory. No repository-root files are required at runtime.

## Existing Jira and Confluence connections

Install the external `atlassian` plugin before upgrading Switchboard to a version that removes its built-in copy. Installed plugins take precedence over built-ins with the same ID. The move keeps the `atlassian` plugin ID, `jira` and `confluence` service IDs, `oauth`, `api-token` and `pat` method IDs, account IDs, credential/config formats and OAuth settings keys. Existing connections and saved calls continue to use those identities. Do not delete connections or reset settings as part of migration.

Jira and Confluence remain together because splitting them would change the ownership of existing administrator OAuth settings. Their executable logic is unchanged; only type import paths were made local to the installed folder.

[migration/switchboard.patch](migration/switchboard.patch) contains the corresponding built-in removal, README change and service-list test update. After installing this external plugin, apply it from the Switchboard checkout with `git apply ../switchboard-plugin-atlassian/migration/switchboard.patch`.

## Connect

See the [Jira and Confluence guide](plugins/atlassian/docs/setup.md) and [Bitbucket guide](plugins/bitbucket/docs/setup.md). Cloud API discovery uses Atlassian's published specifications. Data Center uses direct HTTP calls; Cloud specifications are disabled there because the APIs differ.

## Development

```sh
npm run check
npm test
SWITCHBOARD_ROOT=../switchboard npm run integration
```

Tests use copied plugins, fixture HTTP responses and snapshots of the actual Switchboard authentication helpers. The optional integration check requires Switchboard's installed dependencies and uses its actual plugin manager and GitHub installer with a temporary database and local archive. It verifies installation, migration, restart and individual-folder installs without accessing a running instance or contacting Atlassian.

CI runs syntax/manifest checks and fixture tests on Node 24. Live authentication and provider writes have not been exercised. OpenAI Codex wrote the new code, tests and documentation at Thomas de Ruiter's request; Jira and Confluence were extracted from Switchboard.

## Releases

Release-please opens version and changelog pull requests from Conventional Commits. Merge the release PR to publish its tag and GitHub release. Plugin manifests are updated with their package versions. Family repositories maintain an independent version for each plugin.
