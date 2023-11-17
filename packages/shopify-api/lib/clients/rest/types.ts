import {ApiVersion} from '../../types';
import {Session} from '../../session/session';
import {RequestReturn, QueryParams, HeaderParams} from '../http_client/types';

export interface PageInfoParams {
  path: string;
  query: {[key: string]: QueryParams};
}

export interface PageInfo {
  limit: string;
  fields?: string[];
  previousPageUrl?: string;
  nextPageUrl?: string;
  prevPage?: PageInfoParams;
  nextPage?: PageInfoParams;
}

export type RestRequestReturn<T = unknown> = RequestReturn<T> & {
  pageInfo?: PageInfo;
};

export interface RestClientParams {
  session: Session;
  apiVersion?: ApiVersion;
}

interface RestRequestOptions {
  data?: {[key: string]: unknown} | string;
  query?: {[key: string]: QueryParams};
  headers?: HeaderParams;
  tries?: number;
}
interface RestRequestOptionsWithData extends RestRequestOptions {
  data: NonNullable<RestRequestOptions['data']>;
}

export interface RestClient {
  get: <T = unknown>(
    path: string,
    params?: RestRequestOptions,
  ) => Promise<RestRequestReturn<T>>;
  post: <T = unknown>(
    path: string,
    params: RestRequestOptionsWithData,
  ) => Promise<RestRequestReturn<T>>;
  put: <T = unknown>(
    path: string,
    params: RestRequestOptionsWithData,
  ) => Promise<RestRequestReturn<T>>;
  delete: <T = unknown>(
    path: string,
    params?: RestRequestOptions,
  ) => Promise<RestRequestReturn<T>>;
}
