import {OnlineAccessInfo} from '../auth/oauth/types';
import {AuthScopes} from '../auth/scopes';

import {SessionInterface} from './types';

/**
 * Stores App information from logged in merchants so they can make authenticated requests to the Admin API.
 */
export class Session implements SessionInterface {
  public static cloneSession(session: Session, newId: string): Session {
    const newSession = new Session(
      newId,
      session.shop,
      session.state,
      session.isOnline,
    );

    newSession.scope = session.scope;
    newSession.expires = session.expires;
    newSession.accessToken = session.accessToken;
    newSession.onlineAccessInfo = session.onlineAccessInfo;

    return newSession;
  }

  public scope?: string;
  public expires?: Date;
  public accessToken?: string;
  public onlineAccessInfo?: OnlineAccessInfo;

  constructor(
    readonly id: string,
    public shop: string,
    public state: string,
    public isOnline: boolean,
  ) {}

  public isActive(scopes: AuthScopes | string | string[]): boolean {
    const scopesObject =
      scopes instanceof AuthScopes ? scopes : new AuthScopes(scopes);

    const scopesUnchanged = scopesObject.equals(this.scope);
    if (
      scopesUnchanged &&
      this.accessToken &&
      (!this.expires || this.expires >= new Date())
    ) {
      return true;
    }
    return false;
  }
}