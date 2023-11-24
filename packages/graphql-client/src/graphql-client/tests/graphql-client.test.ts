import fetchMock from "jest-fetch-mock";

import { createGraphQLClient } from "../graphql-client";
import {
  GraphQLClient,
  RequestOptions,
  ClientStreamResponseIteratorObject,
} from "../types";

import {
  clientConfig,
  getValidClient,
  createIterableResponse,
  createReaderStreamResponse,
} from "./testHelpers";

const operation = `
query {
  shop {
    name
  }
}
`;

const variables = {};

describe("GraphQL Client", () => {
  let mockLogger: jest.Mock;

  fetchMock.enableMocks();

  beforeEach(() => {
    jest
      .spyOn(global, "setTimeout")
      .mockImplementation(jest.fn((resolve) => resolve() as any));
    fetchMock.mockResponse(() => Promise.resolve(JSON.stringify({ data: {} })));
    mockLogger = jest.fn();
  });

  afterEach(() => {
    fetchMock.resetMocks();
    jest.restoreAllMocks();
  });

  describe("createGraphQLClient()", () => {
    describe("client initialization", () => {
      it("returns a client object that contains a config object and request and fetch function", () => {
        const client = getValidClient();
        expect(client).toHaveProperty("config");
        expect(client).toMatchObject({
          request: expect.any(Function),
          fetch: expect.any(Function),
        });
      });

      it("throws an error when the retries config value is less than 0", () => {
        const retries = -1;
        expect(() => getValidClient({ retries })).toThrowError(
          `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
        );
      });

      it("throws an error when the retries config value is greater than 3", () => {
        const retries = 4;
        expect(() => getValidClient({ retries })).toThrowError(
          `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
        );
      });
    });

    describe("config object", () => {
      it("returns a config object that includes the url", () => {
        const client = getValidClient();
        expect(client.config.url).toBe(clientConfig.url);
      });

      it("returns a config object that includes the headers", () => {
        const client = getValidClient();
        expect(client.config.headers).toBe(clientConfig.headers);
      });

      it("returns a config object that includes the default retries value when it is not provided at initialization", () => {
        const client = getValidClient();
        expect(client.config.retries).toBe(0);
      });

      it("returns a config object that includes the provided retries value", () => {
        const retries = 3;
        const client = getValidClient({ retries });
        expect(client.config.retries).toBe(retries);
      });
    });

    describe("fetch()", () => {
      it("uses the global fetch when a custom fetch API is not provided at initialization ", () => {
        const client = getValidClient();

        client.fetch(operation, {
          variables,
        });

        expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
          method: "POST",
          headers: clientConfig.headers,
          body: JSON.stringify({
            query: operation,
            variables,
          }),
        });
      });

      it("uses the provided custom fetch when a custom fetch API is provided at initialization ", () => {
        const customFetchApi = jest
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ data: {} }))) as any;

        const client = createGraphQLClient({
          ...clientConfig,
          fetchApi: customFetchApi,
        });

        const props: [string, RequestOptions] = [
          operation,
          {
            variables,
          },
        ];

        client.fetch(...props);

        expect(customFetchApi).toHaveBeenCalledWith(clientConfig.url, {
          method: "POST",
          headers: clientConfig.headers,
          body: JSON.stringify({
            query: operation,
            variables,
          }),
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      describe("calling the function", () => {
        let client: GraphQLClient;

        beforeEach(() => {
          client = getValidClient();
        });

        it("returns the HTTP response", async () => {
          const response = await client.fetch(operation);
          expect(response.status).toBe(200);
        });

        it("logs the request and response info if a logger is provided", async () => {
          const client = getValidClient({ logger: mockLogger });

          const response = await client.fetch(operation);
          expect(response.status).toBe(200);
          expect(mockLogger).toBeCalledWith({
            type: "HTTP-Response",
            content: {
              response,
              requestParams: [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ],
            },
          });
        });

        describe("fetch parameters", () => {
          it("calls fetch API with provided operation", async () => {
            await client.fetch(operation);
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
              }),
            });
          });

          it("calls fetch API with provided variables", async () => {
            await client.fetch(operation, { variables });
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
                variables,
              }),
            });
          });

          it("calls fetch API with provided url override", async () => {
            const url =
              "http://test-store.myshopify.com/api/2023-07/graphql.json";
            await client.fetch(operation, { url });
            expect(fetchMock).toHaveBeenCalledWith(url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
              }),
            });
          });

          it("calls fetch API with provided headers override", async () => {
            const headers = {
              "Content-Type": "application/graphql",
              "custom-header": "custom-headers",
            };

            await client.fetch(operation, { headers });
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: { ...clientConfig.headers, ...headers },
              body: JSON.stringify({
                query: operation,
              }),
            });
          });
        });

        describe("retries", () => {
          describe("Aborted fetch responses", () => {
            it("calls the global fetch 1 time and throws a plain error when the client retries value is 0", async () => {
              fetchMock.mockAbort();

              await expect(async () => {
                await client.fetch(operation);
              }).rejects.toThrow(new RegExp(/^GraphQL Client: /));
              expect(fetchMock).toHaveBeenCalledTimes(1);
            });

            it("calls the global fetch 2 times and throws a retry error when the client was initialized with 1 retries and all fetches were aborted", async () => {
              fetchMock.mockAbort();

              const client = getValidClient({ retries: 1 });

              await expect(async () => {
                await client.fetch(operation);
              }).rejects.toThrow(
                new RegExp(
                  /^GraphQL Client: Attempted maximum number of 1 network retries. Last message - /
                )
              );
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("calls the global fetch 3 times and throws a retry error when the function is provided with 2 retries and all fetches were aborted", async () => {
              fetchMock.mockAbort();

              await expect(async () => {
                await client.fetch(operation, { retries: 2 });
              }).rejects.toThrow(
                new RegExp(
                  /^GraphQL Client: Attempted maximum number of 2 network retries. Last message - /
                )
              );

              expect(fetchMock).toHaveBeenCalledTimes(3);
            });

            it("returns a valid http response after an aborted fetch and the next response is valid", async () => {
              fetchMock.mockAbortOnce();

              const response = await client.fetch(operation, { retries: 2 });

              expect(response.status).toBe(200);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("delays a retry by 1000ms", async () => {
              const client = getValidClient({ retries: 1 });
              fetchMock.mockAbort();

              await expect(async () => {
                await client.fetch(operation);
              }).rejects.toThrow();

              expect(setTimeout).toHaveBeenCalledTimes(1);
              expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                1000
              );
            });

            it("logs each retry attempt if a logger is provided", async () => {
              const client = getValidClient({ retries: 2, logger: mockLogger });
              fetchMock.mockAbort();

              await expect(async () => {
                await client.fetch(operation);
              }).rejects.toThrow();

              const requestParams = [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ];

              expect(mockLogger).toHaveBeenCalledTimes(2);
              expect(mockLogger).toHaveBeenNthCalledWith(1, {
                type: "HTTP-Retry",
                content: {
                  requestParams,
                  lastResponse: undefined,
                  retryAttempt: 1,
                  maxRetries: 2,
                },
              });

              expect(mockLogger).toHaveBeenNthCalledWith(2, {
                type: "HTTP-Retry",
                content: {
                  requestParams,
                  lastResponse: undefined,
                  retryAttempt: 2,
                  maxRetries: 2,
                },
              });
            });
          });

          describe.each([
            [429, "Too Many Requests"],
            [503, "Service Unavailable"],
          ])("%i responses", (status, statusText) => {
            const mockedFailedResponse = new Response(JSON.stringify({}), {
              status,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            });

            it("calls the global fetch 1 time and returns the failed http response when the client default retries value is 0", async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const response = await client.fetch(operation);

              expect(response.status).toBe(status);
              expect(fetchMock).toHaveBeenCalledTimes(1);
            });

            it(`calls the global fetch 2 times and returns the failed http response when the client was initialized with 1 retries and all fetches returned ${status} responses`, async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const client = getValidClient({ retries: 1 });

              const response = await client.fetch(operation);

              expect(response.status).toBe(status);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it(`calls the global fetch 3 times and returns the failed http response when the function is provided with 2 retries and all fetches returned ${status}  responses`, async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const response = await client.fetch(operation, { retries: 2 });

              expect(response.status).toBe(status);
              expect(fetchMock).toHaveBeenCalledTimes(3);
            });

            it(`returns a valid response after an a failed ${status} fetch response and the next response is valid`, async () => {
              const mockedSuccessData = { data: {} };
              fetchMock.mockResponses(
                ["", { status }],
                [JSON.stringify(mockedSuccessData), { status: 200 }]
              );

              const response = await client.fetch(operation, { retries: 2 });

              expect(response.status).toBe(200);
              expect(await response.json()).toEqual(mockedSuccessData);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it(`returns a failed non 429/503 response after an a failed ${status} fetch response and the next response has failed`, async () => {
              const mockedSuccessData = { data: {} };
              fetchMock.mockResponses(
                ["", { status }],
                [JSON.stringify(mockedSuccessData), { status: 500 }]
              );

              const response = await client.fetch(operation, { retries: 2 });

              expect(response.status).toBe(500);
              expect(await response.json()).toEqual(mockedSuccessData);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("delays a retry by 1000ms", async () => {
              const client = getValidClient({ retries: 1 });
              fetchMock.mockResolvedValue(mockedFailedResponse);

              const response = await client.request(operation);

              expect(response.errors?.networkStatusCode).toBe(status);

              expect(setTimeout).toHaveBeenCalledTimes(1);
              expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                1000
              );
            });

            it("logs each retry attempt if a logger is provided", async () => {
              const client = getValidClient({ retries: 2, logger: mockLogger });
              fetchMock.mockResolvedValue(mockedFailedResponse);
              await client.fetch(operation);

              const retryLogs = mockLogger.mock.calls.filter(
                (args) => args[0].type === "HTTP-Retry"
              );

              expect(retryLogs.length).toBe(2);

              const requestParams = [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ];

              const firstLogContent = retryLogs[0][0].content;
              expect(firstLogContent.requestParams).toEqual(requestParams);
              expect(firstLogContent.lastResponse.status).toBe(status);
              expect(firstLogContent.retryAttempt).toBe(1);
              expect(firstLogContent.maxRetries).toBe(2);

              const secondLogContent = retryLogs[1][0].content;
              expect(secondLogContent.requestParams).toEqual(requestParams);
              expect(secondLogContent.lastResponse.status).toBe(status);
              expect(secondLogContent.retryAttempt).toBe(2);
              expect(secondLogContent.maxRetries).toBe(2);
            });
          });

          it("does not retry additional network requests if the initial response is successful", async () => {
            const mockedSuccessResponse = new Response(
              JSON.stringify({ data: {} }),
              {
                status: 200,
                headers: new Headers({
                  "Content-Type": "application/json",
                }),
              }
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);
            const response = await client.fetch(operation);

            expect(response.status).toBe(200);
            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          it("does not retry additional network requests on a failed response that is not a 429 or 503", async () => {
            const mockedFailedResponse = new Response(
              JSON.stringify({ data: {} }),
              {
                status: 500,
                headers: new Headers({
                  "Content-Type": "application/json",
                }),
              }
            );

            fetchMock.mockResolvedValue(mockedFailedResponse);
            const response = await client.fetch(operation);

            expect(response.status).toBe(500);
            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          it("throws an error when the retries config value is less than 0", async () => {
            const retries = -1;
            await expect(async () => {
              await client.fetch(operation, { retries });
            }).rejects.toThrow(
              `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
            );
          });

          it("throws an error when the retries config value is greater than 3", async () => {
            const retries = 4;
            await expect(async () => {
              await client.fetch(operation, { retries });
            }).rejects.toThrow(
              `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
            );
          });
        });
      });
    });

    describe("request()", () => {
      it("uses the global fetch when a custom fetch API is not provided at initialization", () => {
        const client = getValidClient();

        client.request(operation, {
          variables,
        });

        expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
          method: "POST",
          headers: clientConfig.headers,
          body: JSON.stringify({
            query: operation,
            variables,
          }),
        });
      });

      it("uses the provided custom fetch when a custom fetch API is provided at initialization", () => {
        const customFetchApi = jest
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ data: {} }))) as any;

        const client = createGraphQLClient({
          ...clientConfig,
          fetchApi: customFetchApi,
        });

        const props: [string, RequestOptions] = [
          operation,
          {
            variables,
          },
        ];

        client.request(...props);

        expect(customFetchApi).toHaveBeenCalledWith(clientConfig.url, {
          method: "POST",
          headers: clientConfig.headers,
          body: JSON.stringify({
            query: operation,
            variables,
          }),
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      describe("calling the function", () => {
        let client: GraphQLClient;

        beforeEach(() => {
          client = getValidClient();
        });

        describe("fetch parameters", () => {
          it("calls fetch API with provided operation", async () => {
            await client.request(operation);
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
              }),
            });
          });

          it("calls fetch API with provided variables", async () => {
            await client.request(operation, { variables });
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
                variables,
              }),
            });
          });

          it("calls fetch API with provided url override", async () => {
            const url =
              "http://test-store.myshopify.com/api/2023-07/graphql.json";
            await client.request(operation, { url });
            expect(fetchMock).toHaveBeenCalledWith(url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
              }),
            });
          });

          it("calls fetch API with provided headers override", async () => {
            const headers = {
              "Content-Type": "application/graphql",
              "custom-header": "custom-headers",
            };

            await client.request(operation, { headers });
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: { ...clientConfig.headers, ...headers },
              body: JSON.stringify({
                query: operation,
              }),
            });
          });
        });

        describe("returned object", () => {
          it("includes a data object if the data object is included in the response", async () => {
            const mockResponseData = { data: { shop: { name: "Test shop" } } };
            const mockedSuccessResponse = new Response(
              JSON.stringify(mockResponseData),
              {
                status: 200,
                headers: new Headers({
                  "Content-Type": "application/json",
                }),
              }
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);

            const response = await client.request(operation, { variables });
            expect(response).toHaveProperty("data", mockResponseData.data);
          });

          it("includes an API extensions object if it is included in the response", async () => {
            const extensions = {
              context: {
                country: "JP",
                language: "ja",
              },
            };

            const mockedSuccessResponse = new Response(
              JSON.stringify({ data: {}, extensions }),
              {
                status: 200,
                headers: new Headers({
                  "Content-Type": "application/json",
                }),
              }
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);

            const response = await client.request(operation, { variables });
            expect(response).toHaveProperty("extensions", extensions);
            expect(response).not.toHaveProperty("errors");
          });

          it("includes an error object if the response is not ok", async () => {
            const responseConfig = {
              status: 400,
              statusText: "Bad request",
              ok: false,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            };

            const mockedSuccessResponse = new Response("", responseConfig);

            fetchMock.mockResolvedValue(mockedSuccessResponse);

            const response = await client.request(operation, { variables });
            expect(response).toHaveProperty("errors", {
              networkStatusCode: responseConfig.status,
              message: `GraphQL Client: ${responseConfig.statusText}`,
            });
          });

          it("includes an error object if the fetch promise fails", async () => {
            const errorMessage = "Async error message";

            fetchMock.mockRejectedValue(new Error(errorMessage));

            const response = await client.request(operation, { variables });
            expect(response).toHaveProperty("errors", {
              message: `GraphQL Client: ${errorMessage}`,
            });
          });

          it("includes an error object if the response content type is not application/json", async () => {
            const contentType = "multipart/mixed";
            const responseConfig = {
              status: 200,
              headers: new Headers({
                "Content-Type": contentType,
              }),
            };

            const mockedSuccessResponse = new Response(
              JSON.stringify({ data: {} }),
              responseConfig
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);

            const response = await client.request(operation, { variables });
            expect(response).toHaveProperty("errors", {
              networkStatusCode: responseConfig.status,
              message: `GraphQL Client: Response returned unexpected Content-Type: ${contentType}`,
            });
          });

          it("includes an error object if the API response contains errors", async () => {
            const gqlError = ["GQL error"];
            const responseConfig = {
              status: 200,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            };

            const mockedSuccessResponse = new Response(
              JSON.stringify({ errors: gqlError }),
              responseConfig
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);

            const response = await client.request(operation, { variables });
            expect(response).toHaveProperty("errors", {
              networkStatusCode: responseConfig.status,
              message:
                "GraphQL Client: An error occurred while fetching from the API. Review 'graphQLErrors' for details.",
              graphQLErrors: gqlError,
            });
          });

          it("includes an error object if the API does not throw or return an error and does not include a data object in its response", async () => {
            const responseConfig = {
              status: 200,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            };

            const mockedSuccessResponse = new Response(
              JSON.stringify({}),
              responseConfig
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);
            const response = await client.request(operation, { variables });
            expect(response).toHaveProperty("errors", {
              networkStatusCode: mockedSuccessResponse.status,
              message:
                "GraphQL Client: An unknown error has occurred. The API did not return a data object or any errors in its response.",
            });
          });

          it("includes an error object and a data object if the API returns both errors and data in the response", async () => {
            const gqlError = ["GQL error"];
            const data = { product: { title: "product title" } };

            const responseConfig = {
              status: 200,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            };

            const mockedSuccessResponse = new Response(
              JSON.stringify({ errors: gqlError, data }),
              responseConfig
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);
            const response = await client.request(operation, { variables });

            expect(response).toHaveProperty("data", data);
            expect(response).toHaveProperty("errors", {
              networkStatusCode: responseConfig.status,
              message:
                "GraphQL Client: An error occurred while fetching from the API. Review 'graphQLErrors' for details.",
              graphQLErrors: gqlError,
            });
          });
        });

        describe("retries", () => {
          describe("Aborted fetch responses", () => {
            it("calls the global fetch 1 time and returns a response object with a plain error when the client default retries value is 0 ", async () => {
              fetchMock.mockAbort();

              const { errors } = await client.request(operation);

              expect(errors?.message?.startsWith("GraphQL Client: ")).toBe(
                true
              );
              expect(fetchMock).toHaveBeenCalledTimes(1);
            });

            it("calls the global fetch 2 times and returns a response object with an error when the client was initialized with 1 retries and all fetches were aborted", async () => {
              fetchMock.mockAbort();

              const client = getValidClient({ retries: 1 });

              const { errors } = await client.request(operation);

              expect(
                errors?.message?.startsWith(
                  "GraphQL Client: Attempted maximum number of 1 network retries. Last message - "
                )
              ).toBe(true);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("calls the global fetch 3 times and returns a response object with an error when the function is provided with 2 retries and all fetches were aborted", async () => {
              fetchMock.mockAbort();

              const { errors } = await client.request(operation, {
                retries: 2,
              });

              expect(
                errors?.message?.startsWith(
                  "GraphQL Client: Attempted maximum number of 2 network retries. Last message - "
                )
              ).toBe(true);
              expect(fetchMock).toHaveBeenCalledTimes(3);
            });

            it("returns a valid response object without an error property after an aborted fetch and the next response is valid", async () => {
              const mockResponseData = {
                data: { shop: { name: "Test shop" } },
              };
              const mockedSuccessResponse = new Response(
                JSON.stringify(mockResponseData),
                {
                  status: 200,
                  headers: new Headers({
                    "Content-Type": "application/json",
                  }),
                }
              );

              fetchMock.mockAbortOnce();
              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const response = await client.request(operation, { retries: 2 });

              expect(response.errors).toBeUndefined();
              expect(response.data).toEqual(mockResponseData.data);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("delays a retry by 1000ms", async () => {
              const client = getValidClient({ retries: 1 });
              fetchMock.mockAbort();

              await client.request(operation);

              expect(setTimeout).toHaveBeenCalledTimes(1);
              expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                1000
              );
            });

            it("logs each retry attempt if a logger is provided", async () => {
              const client = getValidClient({ retries: 2, logger: mockLogger });
              fetchMock.mockAbort();

              await client.request(operation);

              const requestParams = [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ];

              expect(mockLogger).toHaveBeenCalledTimes(2);
              expect(mockLogger).toHaveBeenNthCalledWith(1, {
                type: "HTTP-Retry",
                content: {
                  requestParams,
                  lastResponse: undefined,
                  retryAttempt: 1,
                  maxRetries: 2,
                },
              });

              expect(mockLogger).toHaveBeenNthCalledWith(2, {
                type: "HTTP-Retry",
                content: {
                  requestParams,
                  lastResponse: undefined,
                  retryAttempt: 2,
                  maxRetries: 2,
                },
              });
            });
          });

          describe.each([
            [429, "Too Many Requests"],
            [503, "Service Unavailable"],
          ])("%i responses", (status, statusText) => {
            const mockedFailedResponse = new Response(JSON.stringify({}), {
              status,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            });

            it("calls the global fetch 1 time and returns a response object with an error when the client default retries value is 0", async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const response = await client.request(operation);

              expect(response.errors?.message).toBe(
                `GraphQL Client: ${statusText}`
              );
              expect(response.errors?.networkStatusCode).toBe(status);
              expect(fetchMock).toHaveBeenCalledTimes(1);
            });

            it(`calls the global fetch 2 times and returns a response object with an error when the client was initialized with 1 retries and all fetches returned ${status} responses`, async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const client = getValidClient({ retries: 1 });

              const response = await client.request(operation);

              expect(response.errors?.message).toBe(
                `GraphQL Client: ${statusText}`
              );
              expect(response.errors?.networkStatusCode).toBe(status);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it(`calls the global fetch 3 times and returns a response object with an error when the function is provided with 2 retries and all fetches returned ${status} responses`, async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const response = await client.request(operation, { retries: 2 });

              expect(response.errors?.message).toBe(
                `GraphQL Client: ${statusText}`
              );
              expect(response.errors?.networkStatusCode).toBe(status);
              expect(fetchMock).toHaveBeenCalledTimes(3);
            });

            it(`returns a valid response after an a failed ${status} fetch response and the next response is valid`, async () => {
              const mockedSuccessData = { data: { shop: { name: "shop1" } } };
              fetchMock.mockResponses(
                ["", { status }],
                [
                  JSON.stringify(mockedSuccessData),
                  {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                  },
                ]
              );

              const response = await client.request(operation, { retries: 2 });

              expect(response.data).toEqual(mockedSuccessData.data);
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it(`returns a failed non 429/503 response after an a failed ${status} fetch response and the next response has failed`, async () => {
              fetchMock.mockResponses(["", { status }], ["", { status: 500 }]);

              const response = await client.request(operation, { retries: 2 });

              expect(response.errors?.networkStatusCode).toBe(500);
              expect(response.errors?.message).toEqual(
                "GraphQL Client: Internal Server Error"
              );
              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("delays a retry by 1000ms", async () => {
              const client = getValidClient({ retries: 1 });
              fetchMock.mockResolvedValue(mockedFailedResponse);

              const response = await client.request(operation);

              expect(response.errors?.networkStatusCode).toBe(status);

              expect(setTimeout).toHaveBeenCalledTimes(1);
              expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                1000
              );
            });

            it("logs each retry attempt if a logger is provided", async () => {
              const client = getValidClient({ retries: 2, logger: mockLogger });
              fetchMock.mockResolvedValue(mockedFailedResponse);
              await client.request(operation);

              const retryLogs = mockLogger.mock.calls.filter(
                (args) => args[0].type === "HTTP-Retry"
              );

              expect(retryLogs.length).toBe(2);

              const requestParams = [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ];

              const firstLogContent = retryLogs[0][0].content;
              expect(firstLogContent.requestParams).toEqual(requestParams);
              expect(firstLogContent.lastResponse.status).toBe(status);
              expect(firstLogContent.retryAttempt).toBe(1);
              expect(firstLogContent.maxRetries).toBe(2);

              const secondLogContent = retryLogs[1][0].content;
              expect(secondLogContent.requestParams).toEqual(requestParams);
              expect(secondLogContent.lastResponse.status).toBe(status);
              expect(secondLogContent.retryAttempt).toBe(2);
              expect(secondLogContent.maxRetries).toBe(2);
            });
          });

          it("does not retry additional network requests if the initial response is successful", async () => {
            const mockedSuccessData = { data: { shop: { name: "shop1" } } };
            const mockedSuccessResponse = new Response(
              JSON.stringify(mockedSuccessData),
              {
                status: 200,
                headers: new Headers({
                  "Content-Type": "application/json",
                }),
              }
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);
            const response = await client.request(operation);

            expect(response.data).toEqual(mockedSuccessData.data);
            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          it("does not retry additional network requests on a failed response that is not a 429 or 503", async () => {
            const mockedFailedResponse = new Response(
              JSON.stringify({ data: {} }),
              {
                status: 500,
                headers: new Headers({
                  "Content-Type": "application/json",
                }),
              }
            );

            fetchMock.mockResolvedValue(mockedFailedResponse);
            const response = await client.request(operation);

            expect(response.errors?.networkStatusCode).toBe(500);
            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          it("returns a response object with an error when the retries config value is less than 0", async () => {
            const retries = -1;

            const response = await client.request(operation, { retries });

            expect(response.errors?.message).toEqual(
              `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
            );
          });

          it("returns a response object with an error when the retries config value is greater than 3", async () => {
            const retries = 4;
            const response = await client.request(operation, { retries });

            expect(response.errors?.message).toEqual(
              `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
            );
          });
        });

        it("logs the request and response info if a logger is provided", async () => {
          const mockResponseData = { data: { shop: { name: "Test shop" } } };
          const mockedSuccessResponse = new Response(
            JSON.stringify(mockResponseData),
            {
              status: 200,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            }
          );

          fetchMock.mockResolvedValue(mockedSuccessResponse);

          const client = getValidClient({ logger: mockLogger });

          await client.request(operation);

          expect(mockLogger).toBeCalledWith({
            type: "HTTP-Response",
            content: {
              response: mockedSuccessResponse,
              requestParams: [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ],
            },
          });
        });

        it("throws an error when the operation includes a @defer directive", async () => {
          const customOperation = `
          query {
            shop {
              id
              ... @defer {
                name
              }
            }
          }
        `;

          await expect(() => client.request(customOperation)).rejects.toThrow(
            new Error(
              "GraphQL Client: This operation will result in a streamable response - use requestStream() instead."
            )
          );
        });
      });
    });

    describe("requestStream()", () => {
      const operation = `
        query shop($country: CountryCode, $language: LanguageCode) @inContext(country: $country, language: $language) {
          shop {
            id
            ... @defer {
              name
              description
            }
          }
        }
      `;

      const variables = {
        language: "EN",
        country: "JP",
      };

      const id = "gid://shopify/Shop/1";
      const name = "Shop 1";
      const description = "Test shop description";

      it("uses the global fetch when a custom fetch API is not provided at initialization", () => {
        const client = getValidClient();

        client.requestStream(operation, {
          variables,
        });

        expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
          method: "POST",
          headers: clientConfig.headers,
          body: JSON.stringify({
            query: operation,
            variables,
          }),
        });
      });

      it("uses the provided custom fetch when a custom fetch API is provided at initialization", () => {
        const customFetchApi = jest
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ data: {} }))) as any;

        const client = createGraphQLClient({
          ...clientConfig,
          fetchApi: customFetchApi,
        });

        const props: [string, RequestOptions] = [
          operation,
          {
            variables,
          },
        ];

        client.requestStream(...props);

        expect(customFetchApi).toHaveBeenCalledWith(clientConfig.url, {
          method: "POST",
          headers: clientConfig.headers,
          body: JSON.stringify({
            query: operation,
            variables,
          }),
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      describe("calling the function", () => {
        let client: GraphQLClient;

        beforeEach(() => {
          client = getValidClient();
        });

        describe("fetch parameters", () => {
          it("calls fetch API with provided operation", async () => {
            await client.requestStream(operation);
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
              }),
            });
          });

          it("calls fetch API with provided variables", async () => {
            await client.requestStream(operation, { variables });
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
                variables,
              }),
            });
          });

          it("calls fetch API with provided url override", async () => {
            const url =
              "http://test-store.myshopify.com/api/2023-07/graphql.json";
            await client.requestStream(operation, { url });
            expect(fetchMock).toHaveBeenCalledWith(url, {
              method: "POST",
              headers: clientConfig.headers,
              body: JSON.stringify({
                query: operation,
              }),
            });
          });

          it("calls fetch API with provided headers override", async () => {
            const headers = {
              "Content-Type": "application/graphql",
              "custom-header": "custom-headers",
            };

            await client.requestStream(operation, { headers });
            expect(fetchMock).toHaveBeenCalledWith(clientConfig.url, {
              method: "POST",
              headers: { ...clientConfig.headers, ...headers },
              body: JSON.stringify({
                query: operation,
              }),
            });
          });
        });

        describe("returned async iterator", () => {
          it("returns an async iterator that returns an object that includes an error object if the response is not ok", async () => {
            const responseConfig = {
              status: 400,
              statusText: "Bad request",
              ok: false,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
              json: jest.fn(),
            };

            const mockedFailedResponse = new Response("", responseConfig);

            fetchMock.mockResolvedValue(mockedFailedResponse);

            const responseStream = await client.requestStream(operation, {
              variables,
            });

            for await (const response of responseStream) {
              expect(response).toHaveProperty("errors", {
                networkStatusCode: responseConfig.status,
                message: `GraphQL Client: ${responseConfig.statusText}`,
              });
            }
          });

          it("returns an async iterator that returns an object that includes an error object if the fetch promise fails", async () => {
            const errorMessage = "Async error message";

            fetchMock.mockRejectedValue(new Error(errorMessage));

            const responseStream = await client.requestStream(operation, {
              variables,
            });

            for await (const response of responseStream) {
              expect(response).toHaveProperty("errors", {
                message: `GraphQL Client: ${errorMessage}`,
              });
            }
          });

          describe("response is unexpected Content-Type", () => {
            it("returns an async iterator that returns an object with an error object if the content type is not JSON or Multipart", async () => {
              const contentType = "text/html";

              const responseConfig = {
                status: 200,
                ok: true,
                headers: new Headers({
                  "Content-Type": contentType,
                }),
                json: jest.fn(),
              };

              const mockedSuccessResponse = new Response("", responseConfig);

              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                variables,
              });

              for await (const response of responseStream) {
                expect(response).toHaveProperty("errors", {
                  networkStatusCode: mockedSuccessResponse.status,
                  message: `GraphQL Client: Response returned unexpected Content-Type: ${contentType}`,
                });
              }
            });
          });

          describe("response is Content-Type: application/json", () => {
            const headers = new Headers({
              "Content-Type": "application/json",
            });

            it("returns an async iterator that returns an object that includes the response data object", async () => {
              const mockResponseData = {
                data: { shop: { name: "Test shop" } },
              };

              const responseConfig = {
                status: 200,
                ok: true,
                headers,
              };

              const mockedSuccessResponse = new Response(
                JSON.stringify(mockResponseData),
                responseConfig
              );

              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                variables,
              });

              for await (const response of responseStream) {
                expect(response).toHaveProperty("data", mockResponseData.data);
              }
            });

            it("returns an async iterator that returns an object that includes the response extensions object", async () => {
              const extensions = {
                context: {
                  country: "JP",
                  language: "ja",
                },
              };

              const responseConfig = {
                status: 200,
                ok: true,
                headers,
              };

              const mockedSuccessResponse = new Response(
                JSON.stringify({ data: {}, extensions }),
                responseConfig
              );

              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                variables,
              });

              for await (const response of responseStream) {
                expect(response).toHaveProperty("extensions", extensions);
              }
            });

            it('returns an async iterator that returns an object that includes a "hasNext: false" field', async () => {
              const responseConfig = {
                status: 200,
                ok: true,
                headers,
              };

              const mockedSuccessResponse = new Response(
                JSON.stringify({ data: {} }),
                responseConfig
              );

              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                variables,
              });
              for await (const response of responseStream) {
                expect(response).toHaveProperty("hasNext", false);
              }
            });

            it("returns an async iterator that returns an object that includes an error object if the API response contains errors", async () => {
              const gqlError = ["GQL error"];

              const responseConfig = {
                status: 200,
                ok: true,
                headers,
              };

              const mockedSuccessResponse = new Response(
                JSON.stringify({ errors: gqlError }),
                responseConfig
              );

              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                variables,
              });

              for await (const response of responseStream) {
                expect(response).toHaveProperty("errors", {
                  networkStatusCode: responseConfig.status,
                  message:
                    "GraphQL Client: An error occurred while fetching from the API. Review 'graphQLErrors' for details.",
                  graphQLErrors: gqlError,
                });
              }
            });

            it("returns an async iterator that returns an object that includes an error object if the API does not throw or return an error and does not include a data object in its response", async () => {
              const responseConfig = {
                status: 200,
                ok: true,
                headers,
              };

              const mockedSuccessResponse = new Response(
                JSON.stringify({}),
                responseConfig
              );

              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                variables,
              });

              for await (const response of responseStream) {
                expect(response).toHaveProperty("errors", {
                  networkStatusCode: mockedSuccessResponse.status,
                  message:
                    "GraphQL Client: An unknown error has occurred. The API did not return a data object or any errors in its response.",
                });
              }
            });
          });

          describe("response is Content-Type: multipart/mixed", () => {
            describe.each([
              ["Readable Stream", createReaderStreamResponse],
              ["Async Iterator", createIterableResponse],
            ])("Server responded with a %s", (_name, responseGenerator) => {
              const streamCompleteDataChunks: [string, string[]] = [
                "stream multiple, complete data chunk",
                [
                  `
                --graphql
                Content-Type: application/json
                Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}},"extensions":{"context": {"country": "${variables.country}", "language": "${variables.language}"}},"hasNext":true}
                --graphql

                `,
                  `
                Content-Type: application/json
                Content-Length: 77\r\n\r\n{"path":["shop"],"data":{"name":"${name}","description":"${description}"},"hasNext":false,"errors":[]}

                --graphql--`,
                ],
              ];

              const streamIncompleteDataChunks: [string, string[]] = [
                "stream multiple, incomplete data chunk",
                [
                  `
                    --graphql
                    Content-Type: app`,
                  `lication/json
                    Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"`,
                  `${id}"}},"exte`,
                  `nsions":{"context":{"country":"`,
                  `${variables.country}","language":"${variables.language}"}},"hasNext":true}
                    --graphql

                    `,
                  `
                    Content-Type: appli`,
                  `cation/json
                    Content-Length: 77\r\n`,
                  `\r\n{"path":["shop"],"data":{"name":"${name}","descripti`,
                  `on":"${description}"},"hasNext":false,"errors":[]}

                    --graphql--`,
                ],
              ];

              describe.each([
                streamCompleteDataChunks,
                streamIncompleteDataChunks,
              ])("%s", (_name, multipleResponsesArray) => {
                let results: any;
                let responseStream: any;

                beforeAll(async () => {
                  const mockedSuccessResponse = responseGenerator(
                    multipleResponsesArray
                  );

                  fetchMock.mockResolvedValue(mockedSuccessResponse);

                  responseStream = await client.requestStream(operation, {
                    variables,
                  });

                  results = [];

                  for await (const response of responseStream) {
                    results.push(response);
                  }
                });

                afterAll(() => {
                  jest.resetAllMocks();
                });

                it("returns an async iterator and the iterator returned 2 response objects", () => {
                  expect(responseStream[Symbol.asyncIterator]).toBeDefined();
                  expect(results.length).toBe(2);
                });

                describe("response objects returned by iterator", () => {
                  let response: ClientStreamResponseIteratorObject;

                  describe("Initial response object", () => {
                    beforeAll(() => {
                      response = results[0];
                    });

                    it("contains a data object that is the first chunk of data", () => {
                      expect(response.data).toEqual({
                        shop: {
                          id,
                        },
                      });
                    });

                    it("contains the extensions object", () => {
                      expect(response.extensions).toEqual({
                        context: {
                          language: variables.language,
                          country: variables.country,
                        },
                      });
                    });

                    it("contains a true hasNext flag", () => {
                      expect(response.hasNext).toBe(true);
                    });
                  });

                  describe("last response object", () => {
                    beforeAll(() => {
                      response = results[1];
                    });

                    it("contains a data object that is a combination of all the data chunks", () => {
                      expect(response.data).toEqual({
                        shop: {
                          id,
                          name,
                          description,
                        },
                      });
                    });

                    it("contains the extensions object", () => {
                      expect(response.extensions).toEqual({
                        context: {
                          language: variables.language,
                          country: variables.country,
                        },
                      });
                    });

                    it("contains a false hasNext flag", () => {
                      expect(response.hasNext).toBe(false);
                    });
                  });
                });
              });

              describe("stream a single completed data chunk", () => {
                const multipleResponsesArray = [
                  `
                    --graphql
                    Content-Type: application/json
                    Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}},"extensions":{"context":{"country":"${variables.country}","language":"${variables.language}"}},"hasNext":true}
                    --graphql

                    Content-Type: application/json
                    Content-Length: 77\r\n\r\n{"path":["shop"],"data":{"name":"${name}","description":"${description}"},"hasNext":false, "errors":[]}

                    --graphql--`,
                ];

                let results: any;
                let responseStream: any;

                beforeAll(async () => {
                  const mockedSuccessResponse = responseGenerator(
                    multipleResponsesArray
                  );

                  fetchMock.mockResolvedValue(mockedSuccessResponse);

                  responseStream = await client.requestStream(operation, {
                    variables,
                  });

                  results = [];

                  for await (const response of responseStream) {
                    results.push(response);
                  }
                });

                afterAll(() => {
                  jest.resetAllMocks();
                });

                it("returns an async iterator and the iterator returned 1 response object", () => {
                  expect(responseStream[Symbol.asyncIterator]).toBeDefined();
                  expect(results.length).toBe(1);
                });

                describe("single response object returned by iterator", () => {
                  let response: ClientStreamResponseIteratorObject;

                  beforeAll(() => {
                    response = results[0];
                  });

                  it("contains a data object that is the combination of all chunk data", () => {
                    expect(response.data).toEqual({
                      shop: {
                        id,
                        name,
                        description,
                      },
                    });
                  });

                  it("contains the extensions object", () => {
                    expect(response.extensions).toEqual({
                      context: {
                        language: variables.language,
                        country: variables.country,
                      },
                    });
                  });

                  it("contains a false hasNext flag", () => {
                    expect(response.hasNext).toBe(false);
                  });
                });
              });

              describe("no extensions", () => {
                const multipleResponsesArray = [
                  `
                    --graphql
                    Content-Type: application/json
                    Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}}, "hasNext":true}
                    --graphql

                    `,
                  `
                    Content-Type: application/json
                    Content-Length: 77\r\n\r\n{"path":["shop"],"data":{"name":"${name}","description":"${description}"},"hasNext":false}

                    --graphql--`,
                ];

                let results: any;
                let responseStream: any;

                beforeAll(async () => {
                  const mockedSuccessResponse = responseGenerator(
                    multipleResponsesArray
                  );

                  fetchMock.mockResolvedValue(mockedSuccessResponse);

                  responseStream = await client.requestStream(operation);

                  results = [];

                  for await (const response of responseStream) {
                    results.push(response);
                  }
                });

                afterAll(() => {
                  jest.resetAllMocks();
                });

                describe("response objects returned by iterator", () => {
                  describe("Initial response object", () => {
                    it("does not contain the extensions object", () => {
                      expect(results[0].extensions).toBeUndefined();
                    });
                  });

                  describe("last response object", () => {
                    it("does not contain the extensions object", () => {
                      expect(results[1].extensions).toBeUndefined();
                    });
                  });
                });
              });

              describe("errors while processing stream data", () => {
                describe("unexpected or premature termination of stream data", () => {
                  it("returns an async iterator that returns a response object with no data field and an incomplete data error when the stream ends prematurely", async () => {
                    const multipleResponsesArray = [
                      `
                        --graphql
                        Content-Type: application/json
                        Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}},
                        `,
                    ];

                    const mockedSuccessResponse = responseGenerator(
                      multipleResponsesArray
                    );

                    fetchMock.mockResolvedValue(mockedSuccessResponse);

                    const responseStream = await client.requestStream(
                      operation
                    );

                    const results: any = [];

                    for await (const response of responseStream) {
                      results.push(response);
                    }

                    expect(results[0].errors).toEqual({
                      networkStatusCode: 200,
                      message:
                        "GraphQL Client: Response stream terminated unexpectedly",
                    });

                    expect(results[0].data).toBeUndefined();
                  });

                  it("returns an async iterator that returns a response object with partial data and an incomplete data error when the stream ends before all deferred chunks are returned", async () => {
                    const multipleResponsesArray = [
                      `
                      --graphql
                      Content-Type: application/json
                      Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}},"extensions":{"context": {"country": "${variables.country}", "language": "${variables.language}"}},"hasNext":true}
                      --graphql

                      `,
                    ];

                    const mockedSuccessResponse = responseGenerator(
                      multipleResponsesArray
                    );

                    fetchMock.mockResolvedValue(mockedSuccessResponse);

                    const responseStream = await client.requestStream(
                      operation,
                      {
                        variables,
                      }
                    );

                    const results: any = [];

                    for await (const response of responseStream) {
                      results.push(response);
                    }

                    const lastResponse = results.slice(-1)[0];
                    expect(lastResponse.data).toEqual({
                      shop: { id },
                    });

                    expect(lastResponse.errors).toEqual({
                      networkStatusCode: 200,
                      message:
                        "GraphQL Client: Response stream terminated unexpectedly",
                    });
                  });
                });

                it("returns an async iterator that returns a response object with no data value and a JSON parsing error if the returned data is a malformed JSON", async () => {
                  const multipleResponsesArray = [
                    `
                    --graphql
                    Content-Type: application/json
                    Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}}},"extensions":{"context": {"country": "${variables.country}", "language": "${variables.language}"}},"hasNext":false}
                    --graphql--
                    `,
                  ];

                  const mockedSuccessResponse = responseGenerator(
                    multipleResponsesArray
                  );

                  fetchMock.mockResolvedValue(mockedSuccessResponse);

                  const responseStream = await client.requestStream(operation, {
                    variables,
                  });

                  const results: any = [];

                  for await (const response of responseStream) {
                    results.push(response);
                  }

                  const response = results[0];
                  const errors = response.errors;
                  expect(errors.networkStatusCode).toBe(200);
                  expect(errors.message).toMatch(
                    new RegExp(
                      /^GraphQL Client: Error in parsing multipart response - /
                    )
                  );

                  expect(response.data).toBeUndefined();
                });

                it("returns an async iterator that returns a response object with no data value and a GQL error if the returned response payload contains only an errors field with values", async () => {
                  const errors = [
                    {
                      message: "Field 'test' doesn't exist on type 'Shop'",
                      locations: [{ line: 5, column: 11 }],
                      path: ["query shop", "shop", "test"],
                      extensions: {
                        code: "undefinedField",
                        typeName: "Shop",
                        fieldName: "test",
                      },
                    },
                  ];

                  const multipleResponsesArray = [
                    `
                    --graphql
                    Content-Type: application/json
                    Content-Length: 120\r\n\r\n{"errors":${JSON.stringify(
                      errors
                    )},"hasNext":false}
                    --graphql--
                    `,
                  ];

                  const mockedSuccessResponse = responseGenerator(
                    multipleResponsesArray
                  );

                  fetchMock.mockResolvedValue(mockedSuccessResponse);

                  const responseStream = await client.requestStream(operation, {
                    variables,
                  });

                  const results: any = [];

                  for await (const response of responseStream) {
                    results.push(response);
                  }

                  expect(results[0].errors).toEqual({
                    networkStatusCode: 200,
                    message:
                      "GraphQL Client: An error occurred while fetching from the API. Review 'graphQLErrors' for details.",
                    graphQLErrors: errors,
                  });

                  expect(results[0].data).toBeUndefined();
                });

                it("returns an async iterator that returns a response object with partial data and a GQL error if the returned response payload contains both data and error values", async () => {
                  const errors = [
                    {
                      message: "Field 'test' doesn't exist on type 'Shop'",
                      locations: [{ line: 5, column: 11 }],
                      path: ["query shop", "shop", "test"],
                      extensions: {
                        code: "undefinedField",
                        typeName: "Shop",
                        fieldName: "test",
                      },
                    },
                  ];

                  const multipleResponsesArray = [
                    `
                    --graphql
                    Content-Type: application/json
                    Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}},"errors":${JSON.stringify(
                      errors
                    )},"hasNext":false}
                    --graphql--
                    `,
                  ];

                  const mockedSuccessResponse = responseGenerator(
                    multipleResponsesArray
                  );

                  fetchMock.mockResolvedValue(mockedSuccessResponse);

                  const responseStream = await client.requestStream(operation);

                  const results: any = [];

                  for await (const response of responseStream) {
                    results.push(response);
                  }

                  const response = results[0];
                  expect(response.data).toEqual({
                    shop: {
                      id,
                    },
                  });

                  expect(response.errors).toEqual({
                    networkStatusCode: 200,
                    message:
                      "GraphQL Client: An error occurred while fetching from the API. Review 'graphQLErrors' for details.",
                    graphQLErrors: errors,
                  });
                });

                it("returns an async iterator that returns a response object with a no data returned error if the returned payload does not have an errors and data fields", async () => {
                  const multipleResponsesArray = [
                    `
                    --graphql
                    Content-Type: application/json
                    Content-Length: 120\r\n\r\n{"extensions":{"context": {"country": "${variables.country}", "language": "${variables.language}"}},"hasNext":false}
                    --graphql--
                    `,
                  ];

                  const mockedSuccessResponse = responseGenerator(
                    multipleResponsesArray
                  );

                  fetchMock.mockResolvedValue(mockedSuccessResponse);

                  const responseStream = await client.requestStream(operation, {
                    variables,
                  });

                  const results: any = [];

                  for await (const response of responseStream) {
                    results.push(response);
                  }

                  expect(results[0].data).toBeUndefined();
                  expect(results[0].errors).toEqual({
                    networkStatusCode: 200,
                    message:
                      "GraphQL Client: An unknown error has occurred. The API did not return a data object or any errors in its response.",
                  });
                });
              });
            });
          });
        });

        describe("retries", () => {
          const multipleResponsesArray = [
            `
            --graphql
            Content-Type: application/json
            Content-Length: 120\r\n\r\n{"data":{"shop":{"id":"${id}"}},"hasNext":true}
            --graphql

            `,
            `
            Content-Type: application/json
            Content-Length: 77\r\n\r\n{"path":["shop"],"data":{"name":"${name}","description":"${description}"},"hasNext":false,"errors":[]}

            --graphql--`,
          ];

          describe("Aborted fetch responses", () => {
            it("calls the global fetch 1 time and the async iterator returns a response object with a plain error when the client default retries value is 0 ", async () => {
              fetchMock.mockAbort();

              const responseStream = await client.requestStream(operation);

              for await (const response of responseStream) {
                expect(
                  response.errors?.message?.startsWith("GraphQL Client: ")
                ).toBe(true);
              }

              expect(fetchMock).toHaveBeenCalledTimes(1);
            });

            it("calls the global fetch 2 times and the async iterator returns a response object with an error when the client was initialized with 1 retries and all fetches were aborted", async () => {
              fetchMock.mockAbort();

              const client = getValidClient({ retries: 1 });

              const responseStream = await client.requestStream(operation);

              for await (const response of responseStream) {
                expect(
                  response.errors?.message?.startsWith(
                    "GraphQL Client: Attempted maximum number of 1 network retries. Last message - "
                  )
                ).toBe(true);
              }

              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("calls the global fetch 3 times and the async iterator returns a response object with an error when the function is provided with 2 retries and all fetches were aborted", async () => {
              fetchMock.mockAbort();

              const responseStream = await client.requestStream(operation, {
                retries: 2,
              });

              for await (const response of responseStream) {
                expect(
                  response.errors?.message?.startsWith(
                    "GraphQL Client: Attempted maximum number of 2 network retries. Last message - "
                  )
                ).toBe(true);
              }

              expect(fetchMock).toHaveBeenCalledTimes(3);
            });

            it("returns a async iterator that returns valid response objects without an error property after an aborted fetch and the next response is valid", async () => {
              const mockedSuccessResponse = createReaderStreamResponse(
                multipleResponsesArray
              );

              fetchMock.mockAbortOnce();
              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                retries: 2,
              });

              for await (const response of responseStream) {
                expect(response.errors).toBeUndefined();
                expect(response.data).toBeDefined();
              }

              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("delays a retry by 1000ms", async () => {
              const client = getValidClient({ retries: 1 });
              fetchMock.mockAbort();

              await client.requestStream(operation);

              expect(setTimeout).toHaveBeenCalledTimes(1);
              expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                1000
              );
            });

            it("logs each retry attempt if a logger is provided", async () => {
              const client = getValidClient({ retries: 2, logger: mockLogger });
              fetchMock.mockAbort();

              await client.requestStream(operation);

              const requestParams = [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ];

              expect(mockLogger).toHaveBeenCalledTimes(2);
              expect(mockLogger).toHaveBeenNthCalledWith(1, {
                type: "HTTP-Retry",
                content: {
                  requestParams,
                  lastResponse: undefined,
                  retryAttempt: 1,
                  maxRetries: 2,
                },
              });

              expect(mockLogger).toHaveBeenNthCalledWith(2, {
                type: "HTTP-Retry",
                content: {
                  requestParams,
                  lastResponse: undefined,
                  retryAttempt: 2,
                  maxRetries: 2,
                },
              });
            });
          });

          describe.each([
            [429, "Too Many Requests"],
            [503, "Service Unavailable"],
          ])("%i responses", (status, statusText) => {
            const mockedFailedResponse = new Response(JSON.stringify({}), {
              status,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            });

            it("calls the global fetch 1 time and the async iterator returns a response object with an error when the client default retries value is 0", async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const responseStream = await client.requestStream(operation);

              for await (const response of responseStream) {
                expect(response.errors?.message).toBe(
                  `GraphQL Client: ${statusText}`
                );
                expect(response.errors?.networkStatusCode).toBe(status);
              }

              expect(fetchMock).toHaveBeenCalledTimes(1);
            });

            it(`calls the global fetch 2 times and the async iterator returns a response object with an error when the client was initialized with 1 retries and all fetches returned ${status} responses`, async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const client = getValidClient({ retries: 1 });

              const responseStream = await client.requestStream(operation);

              for await (const response of responseStream) {
                expect(response.errors?.message).toBe(
                  `GraphQL Client: ${statusText}`
                );
                expect(response.errors?.networkStatusCode).toBe(status);
              }

              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it(`calls the global fetch 3 times and the async iterator returns a response object with an error when the function is provided with 2 retries and all fetches returned ${status} responses`, async () => {
              fetchMock.mockResolvedValue(mockedFailedResponse);
              const responseStream = await client.requestStream(operation, {
                retries: 2,
              });

              for await (const response of responseStream) {
                expect(response.errors?.message).toBe(
                  `GraphQL Client: ${statusText}`
                );
                expect(response.errors?.networkStatusCode).toBe(status);
              }

              expect(fetchMock).toHaveBeenCalledTimes(3);
            });

            it(`returns a async iterator that returns valid response objects without an error property after a failed ${status} response and the next response is valid`, async () => {
              const mockedSuccessResponse = createReaderStreamResponse(
                multipleResponsesArray
              );

              fetchMock.mockResolvedValueOnce(mockedFailedResponse);
              fetchMock.mockResolvedValue(mockedSuccessResponse);

              const responseStream = await client.requestStream(operation, {
                retries: 2,
              });

              for await (const response of responseStream) {
                expect(response.errors).toBeUndefined();
                expect(response.data).toBeDefined();
              }

              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("returns a failed non 429/503 response after an a failed 429 fetch response and the next response has failed", async () => {
              const mockedFailed500Response = new Response(JSON.stringify({}), {
                status: 500,
                headers: new Headers({
                  "Content-Type": "application/json",
                }),
              });

              fetchMock.mockResolvedValueOnce(mockedFailedResponse);
              fetchMock.mockResolvedValue(mockedFailed500Response);

              const responseStream = await client.requestStream(operation, {
                retries: 2,
              });

              for await (const response of responseStream) {
                expect(response.errors?.networkStatusCode).toBe(500);
                expect(response.errors?.message).toEqual(
                  "GraphQL Client: Internal Server Error"
                );
              }

              expect(fetchMock).toHaveBeenCalledTimes(2);
            });

            it("delays a retry by 1000ms", async () => {
              const client = getValidClient({ retries: 1 });
              fetchMock.mockResolvedValue(mockedFailedResponse);

              const responseStream = await client.requestStream(operation);

              for await (const response of responseStream) {
                expect(response.errors?.networkStatusCode).toBe(status);
              }

              expect(setTimeout).toHaveBeenCalledTimes(1);
              expect(setTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                1000
              );
            });

            it("logs each retry attempt if a logger is provided", async () => {
              const client = getValidClient({ retries: 2, logger: mockLogger });
              fetchMock.mockResolvedValue(mockedFailedResponse);
              await client.requestStream(operation);

              const retryLogs = mockLogger.mock.calls.filter(
                (args) => args[0].type === "HTTP-Retry"
              );

              expect(retryLogs.length).toBe(2);

              const requestParams = [
                clientConfig.url,
                {
                  method: "POST",
                  body: JSON.stringify({ query: operation }),
                  headers: clientConfig.headers,
                },
              ];

              const firstLogContent = retryLogs[0][0].content;
              expect(firstLogContent.requestParams).toEqual(requestParams);
              expect(firstLogContent.lastResponse.status).toBe(status);
              expect(firstLogContent.retryAttempt).toBe(1);
              expect(firstLogContent.maxRetries).toBe(2);

              const secondLogContent = retryLogs[1][0].content;
              expect(secondLogContent.requestParams).toEqual(requestParams);
              expect(secondLogContent.lastResponse.status).toBe(status);
              expect(secondLogContent.retryAttempt).toBe(2);
              expect(secondLogContent.maxRetries).toBe(2);
            });
          });

          it("does not retry additional network requests if the initial response is successful", async () => {
            const mockedSuccessResponse = createReaderStreamResponse(
              multipleResponsesArray
            );

            fetchMock.mockResolvedValue(mockedSuccessResponse);

            const responseStream = await client.requestStream(operation, {
              retries: 2,
            });

            for await (const response of responseStream) {
              expect(response.data).toBeDefined();
            }

            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          it("does not retry additional network requests on a failed response that is not a 429 or 503", async () => {
            const mockedFailedResponse = new Response(JSON.stringify({}), {
              status: 500,
              headers: new Headers({
                "Content-Type": "application/json",
              }),
            });

            fetchMock.mockResolvedValueOnce(mockedFailedResponse);

            const responseStream = await client.requestStream(operation, {
              retries: 2,
            });

            for await (const response of responseStream) {
              expect(response.errors?.networkStatusCode).toBe(500);
              expect(response.errors?.message).toEqual(
                "GraphQL Client: Internal Server Error"
              );
            }
            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          it("returns a response object with an error when the retries config value is less than 0", async () => {
            const retries = -1;

            const responseStream = await client.requestStream(operation, {
              retries,
            });

            for await (const response of responseStream) {
              expect(response.errors?.message).toEqual(
                `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
              );
            }
          });

          it("returns a response object with an error when the retries config value is greater than 3", async () => {
            const retries = 4;
            const responseStream = await client.requestStream(operation, {
              retries,
            });

            for await (const response of responseStream) {
              expect(response.errors?.message).toEqual(
                `GraphQL Client: The provided "retries" value (${retries}) is invalid - it cannot be less than 0 or greater than 3`
              );
            }
          });
        });

        it("throws an error if the operation does not include the defer directive", async () => {
          const customOperation = `
            query {
              shop {
                name
              }
            }
          `;

          await expect(() =>
            client.requestStream(customOperation)
          ).rejects.toThrow(
            new Error(
              "GraphQL Client: This operation does not result in a streamable response - use request() instead."
            )
          );
        });
      });
    });
  });
});
