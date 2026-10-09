---
title: Connecting Jira and Confluence
services: [jira, confluence]
---

# Connecting Jira and Confluence

Choose Jira or Confluence in **Connections → Add connection**.

## Cloud API token

Choose **API token**, enter your Atlassian email address, API token and site. The site accepts `yourteam`, `yourteam.atlassian.net` or a full site URL. Create the token at [Atlassian account security](https://id.atlassian.com/manage-profile/security/api-tokens). This retained method calls your site directly; tokens requiring a scoped API gateway URL are not supported by this method. Authentication checks your current account before storing the connection.

## Sign in with Atlassian

An administrator must create an [Atlassian OAuth 2.0 (3LO) app](https://developer.atlassian.com/console/myapps/), register `{{callbackUrl}}` as its callback URL, and configure its client ID and secret in **Plugins → Atlassian → Settings**. Configure Jira/Confluence permissions in the app to match the selected method's advanced **Scopes** field.

Choose **Sign in with Atlassian** and complete consent. If your account has several sites, supply the desired site; otherwise the first accessible site is selected. Switchboard stores and refreshes OAuth credentials using its built-in OAuth helper.

## Data Center and Server

Choose **Personal access token**, enter the server URL (including a context path if used) and a token created in your profile. Switchboard validates it against the product's current-user endpoint. Use direct REST paths appropriate to your server version; the Cloud API description is not attached to these connections.

## Moving from the built-in plugin

Install this plugin before removing Switchboard's built-in Atlassian plugin. Existing connection IDs, account IDs, credentials and administrator OAuth settings remain valid. No reconnection is needed solely because the plugin moved.
