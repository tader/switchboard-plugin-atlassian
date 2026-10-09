import type { AccountInfo, AuthMethod, Connection, Field, OutgoingRequest, PluginContext } from './api.ts';

type Cfg = Record<string, any>;
type Value<T> = T | ((config: Cfg) => T);

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  idToken?: string;
}

export interface OAuthOptions {
  id?: string;
  name?: string;
  description?: string;
  unavailable?: string;
  fields?: Field[];
  clientId: Value<string | undefined>;
  clientSecret?: Value<string | undefined>;
  tokenUrl: Value<string>;
  scopes?: Value<string[]>;
  scopeSeparator?: string;
  /** How the client authenticates at the token endpoint. Default: "post". */
  tokenAuth?: Value<'post' | 'basic' | undefined>;
  extraTokenHeaders?: Record<string, string>;
  /** Looks up who signed in. */
  identify?(credentials: OAuthCredentials, config: Cfg, raw: any): Promise<AccountInfo | undefined> | AccountInfo | undefined;
  revoke?(credentials: OAuthCredentials, config: Cfg): Promise<void>;
}

export interface AuthorizationCodeOptions extends OAuthOptions {
  authorizeUrl: Value<string>;
  authorizeParams?: Value<Record<string, string>>;
  /** Default: true. */
  pkce?: Value<boolean>;
}

export interface DeviceCodeOptions extends OAuthOptions {
  deviceAuthorizationUrl: Value<string>;
}

export declare function authorizationCode(options: AuthorizationCodeOptions): AuthMethod;
