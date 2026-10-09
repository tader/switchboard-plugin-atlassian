import type { AccountInfo, AuthMethod, Connection, Field, PluginContext } from './api.ts';

type Cfg = Record<string, any>;

interface Options {
  id?: string;
  name?: string;
  description?: string;
  unavailable?: string;
  /** Extra fields asked besides the secret(s). */
  fields?: Field[];
  /** Label and help for the secret field. */
  secretLabel?: string;
  secretDescription?: string;
  /** Validates the credentials and tells who they belong to. Throw to reject them. */
  identify?(credentials: Record<string, string>, config: Cfg): Promise<AccountInfo | undefined> | AccountInfo | undefined;
}

export declare function basicAuth(options?: Options & { usernameLabel?: string; usernameDescription?: string }): AuthMethod;
export declare function bearerToken(options?: Options): AuthMethod;
