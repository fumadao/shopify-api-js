import {
  HTTPResponseLog,
  HTTPRetryLog,
  LogContent,
} from '@shopify/graphql-client';
import {createAdminApiClient} from '@shopify/admin-api-client';
import {createStorefrontApiClient} from '@shopify/storefront-api-client';

import {logger} from '../logger';
import {ConfigInterface} from '../base-types';
import {LIBRARY_NAME} from '../types';
import {SHOPIFY_API_LIBRARY_VERSION} from '../version';
import {abstractFetch, abstractRuntimeString} from '../../runtime';

import {httpClientClass} from './http_client/http_client';
import {createRestClientFactory, restClientClass} from './rest/rest_client';
import {graphqlClientClass} from './graphql/graphql_client';
import {storefrontClientClass} from './graphql/storefront_client';
import {graphqlProxy} from './graphql/graphql_proxy';
import {ClientArgs, ShopifyClients} from './types';

export {ShopifyClients} from './types';

export function clientClasses<Config extends ConfigInterface>(
  config: Config,
): ShopifyClients<Config['future']> {
  if (config.future?.unstable_graphqlClients) {
    return {
      admin: {
        rest: createRestClientFactory({config}),
        graphql: adminGraphqlClient(config),
      },
      storefront: storefrontGraphqlClient(config),
      graphqlProxy: graphqlProxy(config),
    } as ShopifyClients<Config['future']>;
  } else {
    const HttpClient = httpClientClass(config);
    return {
      // We don't pass in the HttpClient because the RestClient inherits from it, and goes through the same setup process
      Rest: restClientClass({config}),
      Graphql: graphqlClientClass({config, HttpClient}),
      Storefront: storefrontClientClass({config, HttpClient}),
      graphqlProxy: graphqlProxy(config),
    } as ShopifyClients<Config['future']>;
  }
}

function adminGraphqlClient(config: ConfigInterface) {
  return ({session, apiVersion, retries}: ClientArgs) => {
    return createAdminApiClient({
      storeDomain: session.shop,
      accessToken: session.accessToken!,
      apiVersion: apiVersion ?? config.apiVersion,
      customFetchApi: abstractFetch,
      logger: clientLoggerFactory(config),
      retries,
      userAgentPrefix: getUserAgent(config),
    });
  };
}

function storefrontGraphqlClient(config: ConfigInterface) {
  return ({session, apiVersion, retries}: ClientArgs) => {
    return createStorefrontApiClient({
      storeDomain: session.shop,
      privateAccessToken: session.accessToken!,
      apiVersion: apiVersion ?? config.apiVersion,
      customFetchApi: abstractFetch,
      logger: clientLoggerFactory(config),
      retries,
      clientName: getUserAgent(config),
    });
  };
}

function getUserAgent(config: ConfigInterface): string {
  let userAgentPrefix = `${LIBRARY_NAME} v${SHOPIFY_API_LIBRARY_VERSION} | ${abstractRuntimeString()}`;
  if (config.userAgentPrefix) {
    userAgentPrefix = `${config.userAgentPrefix} | ${userAgentPrefix}`;
  }

  return userAgentPrefix;
}

function clientLoggerFactory(config: ConfigInterface) {
  return (logContent: LogContent) => {
    if (config.logger.httpRequests) {
      switch (logContent.type) {
        case 'HTTP-Response': {
          const responseLog: HTTPResponseLog['content'] = logContent.content;
          logger(config).debug('Received response for HTTP request', {
            requestParams: JSON.stringify(responseLog.requestParams),
            response: JSON.stringify(responseLog.response),
          });
          break;
        }
        case 'HTTP-Retry': {
          const responseLog: HTTPRetryLog['content'] = logContent.content;
          logger(config).debug('Retrying HTTP request', {
            requestParams: JSON.stringify(responseLog.requestParams),
            retryAttempt: responseLog.retryAttempt,
            maxRetries: responseLog.maxRetries,
            response: JSON.stringify(responseLog.lastResponse),
          });
          break;
        }
        default: {
          logger(config).debug(`HTTP request event: ${logContent.content}`);
          break;
        }
      }
    }
  };
}
