import {createAdminApiClient} from '@shopify/admin-api-client';
import {createStorefrontApiClient} from '@shopify/storefront-api-client';

import {Session} from '../session/session';
import {FeatureEnabled, FutureFlagOptions} from '../../future/flags';
import {ApiVersion} from '../types';

import {GraphqlClient} from './graphql/graphql_client';
import {StorefrontClient} from './graphql/storefront_client';
import {GraphqlProxy} from './graphql/types';
import {RestClient, RestClientParams} from './rest/types';
import {RestClient as RestClientClass} from './rest/rest_client';

export * from './http_client/types';
export * from './rest/types';
export * from './graphql/types';

export interface ClientArgs {
  session: Session;
  apiVersion?: ApiVersion;
  retries?: number;
}

export interface ShopifyLegacyClients {
  Rest: typeof RestClientClass;
  Graphql: typeof GraphqlClient;
  Storefront: typeof StorefrontClient;
  graphqlProxy: GraphqlProxy;
}

export type ShopifyClients<
  Future extends FutureFlagOptions = FutureFlagOptions,
> = FeatureEnabled<Future, 'unstable_graphqlClients'> extends true
  ? {
      admin: {
        rest: (params: RestClientParams) => RestClient;
        // eslint-disable-next-line no-warning-comments
        // TODO ensure these types are correct
        graphql: (args: ClientArgs) => ReturnType<typeof createAdminApiClient>;
      };
      storefront: (
        args: ClientArgs,
      ) => ReturnType<typeof createStorefrontApiClient>;
      graphqlProxy: GraphqlProxy;
    }
  : ShopifyLegacyClients;
