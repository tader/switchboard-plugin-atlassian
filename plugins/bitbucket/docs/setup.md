---
title: Connecting Bitbucket
services: [bitbucket]
---

# Connecting Bitbucket

Choose **Bitbucket** in **Connections → Add connection**.

## Cloud API token

Choose **API token**, enter your Atlassian email and a scoped Bitbucket API token. Include `read:user:bitbucket` for account validation, plus the permissions needed by your calls. For read-only repository/PR access add `read:repository:bitbucket` and `read:pullrequest:bitbucket`; add `read:pipeline:bitbucket` to read pipelines. Write permissions must be selected separately. See [Atlassian's authentication reference](https://developer.atlassian.com/cloud/bitbucket/rest/intro/).

## Cloud OAuth

An administrator creates a Bitbucket workspace OAuth consumer and registers `{{callbackUrl}}`. Enter its key and secret in **Plugins → Bitbucket → Settings**. Select Account read for account validation and the repository, pull-request or pipeline permissions required by users. Bitbucket permissions are configured on the consumer. Choose **Sign in with Bitbucket** and complete consent. Switchboard refreshes tokens using the built-in OAuth helper.

Cloud requests use `https://api.bitbucket.org/2.0`. For example, request `/repositories/{workspace}/{repo_slug}/pullrequests` or `/repositories/{workspace}/{repo_slug}/pipelines/`. Follow the returned pagination links. Switchboard exposes the published Cloud API specification. API host permissions are restricted to `api.bitbucket.org`.

## Data Center and Server

Choose **Personal access token**, enter the server URL (including any context path), a personal HTTP token with repository read permission and an optional account label. Validation reads one page of the authenticated pull-request inbox. It does not infer your identity from public user records, so the account label is user-supplied rather than a verified user name. Repository/project automation tokens are not supported by this personal-token method.

Use paths such as `/rest/api/1.0/projects` and `/rest/api/1.0/projects/{projectKey}/repos/{repositorySlug}/pull-requests`. The Cloud API description is disabled for these connections. See the [Data Center REST reference](https://developer.atlassian.com/server/bitbucket/rest/).
