import {Headers as FetchHeaders} from 'node-fetch';

import {
  AbstractFetchFunc,
  AdapterArgs,
  AdapterHeaders,
  canonicalizeHeaders,
  Headers,
  NormalizedRequest,
  NormalizedResponse,
} from '../../runtime/http';

import {mockTestRequests} from './mock_test_requests';

interface MockAdapterArgs extends AdapterArgs {
  rawRequest: NormalizedRequest;
}

export async function mockConvertRequest(
  adapterArgs: MockAdapterArgs,
): Promise<NormalizedRequest> {
  return Promise.resolve(adapterArgs.rawRequest);
}

export async function mockConvertResponse(
  response: NormalizedResponse,
  _adapterArgs: MockAdapterArgs,
): Promise<NormalizedResponse> {
  return Promise.resolve(response);
}

export async function mockConvertHeaders(
  headers: Headers,
  _adapterArgs: MockAdapterArgs,
): Promise<AdapterHeaders> {
  return Promise.resolve(headers);
}

export const mockFetch: AbstractFetchFunc = async (url, init) => {
  const request = new Request(url, init);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());

  mockTestRequests.requestList.push({
    url: request.url,
    method: request.method,
    headers: canonicalizeHeaders(headers),
    body: await request.json(),
  });

  const next = mockTestRequests.responseList.shift()!;
  if (!next) {
    throw new Error(
      `Missing mock for ${request.method} to ${url}, have you queued all required responses?`,
    );
  }
  if (next instanceof Error) {
    throw next;
  }

  const responseHeaders = new FetchHeaders();
  Object.entries(next.headers ?? {}).forEach(([key, value]) => {
    responseHeaders.set(
      key,
      typeof value === 'string' ? value : value.join(', '),
    );
  });

  return new Response(next.body, {
    status: next.statusCode,
    headers: responseHeaders as any,
  });
};

export function mockRuntimeString() {
  return 'Mock adapter';
}
