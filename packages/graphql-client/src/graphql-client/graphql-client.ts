import {
  ClientOptions,
  CustomFetchApi,
  GraphQLClient,
  ClientResponse,
  ClientStreamResponse,
  ClientConfig,
  Logger,
  LogContentTypes,
  DataChunk,
} from "./types";
import {
  CLIENT,
  GQL_API_ERROR,
  UNEXPECTED_CONTENT_TYPE_ERROR,
  NO_DATA_OR_ERRORS_ERROR,
  CONTENT_TYPES,
  RETRIABLE_STATUS_CODES,
  RETRY_WAIT_TIME,
  HEADER_SEPARATOR,
  DEFER_OPERATION_REGEX,
  BOUNDARY_HEADER_REGEX,
} from "./constants";
import {
  formatErrorMessage,
  getErrorMessage,
  validateRetries,
  buildDataObjectByPath,
  buildCombinedDataObject,
  getErrorCause,
  getKeyValueIfValid,
} from "./utilities";

export function createGraphQLClient({
  headers,
  url,
  fetchApi = fetch,
  retries = 0,
  logger,
}: ClientOptions): GraphQLClient {
  validateRetries({ client: CLIENT, retries });

  const config: ClientConfig = {
    headers,
    url,
    retries,
  };

  const clientLogger = generateClientLogger(logger);
  const httpFetch = generateHttpFetch(fetchApi, clientLogger);
  const fetch = generateFetch(httpFetch, config);
  const request = generateRequest(fetch);
  const requestStream = generateRequestStream(fetch);

  return {
    config,
    fetch,
    request,
    requestStream,
  };
}

async function sleep(waitTime: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, waitTime));
}

export function generateClientLogger(logger?: Logger): Logger {
  return (logContent: LogContentTypes) => {
    if (logger) {
      logger(logContent);
    }
  };
}

async function processJSONResponse<TData = any>(
  response: any
): Promise<ClientResponse<TData>> {
  const { errors, data, extensions } = await response.json();

  return {
    ...getKeyValueIfValid("data", data),
    ...getKeyValueIfValid("extensions", extensions),
    ...(errors || !data
      ? {
          errors: {
            networkStatusCode: response.status,
            message: formatErrorMessage(
              errors ? GQL_API_ERROR : NO_DATA_OR_ERRORS_ERROR
            ),
            ...getKeyValueIfValid("graphQLErrors", errors),
          },
        }
      : {}),
  };
}

function generateHttpFetch(fetchApi: CustomFetchApi, clientLogger: Logger) {
  const httpFetch = async (
    requestParams: Parameters<CustomFetchApi>,
    count: number,
    maxRetries: number
  ): ReturnType<GraphQLClient["fetch"]> => {
    const nextCount = count + 1;
    const maxTries = maxRetries + 1;
    let response: Response | undefined;

    try {
      response = await fetchApi(...requestParams);

      clientLogger({
        type: "HTTP-Response",
        content: {
          requestParams,
          response,
        },
      });

      if (
        !response.ok &&
        RETRIABLE_STATUS_CODES.includes(response.status) &&
        nextCount <= maxTries
      ) {
        throw new Error();
      }

      return response;
    } catch (error) {
      if (nextCount <= maxTries) {
        await sleep(RETRY_WAIT_TIME);

        clientLogger({
          type: "HTTP-Retry",
          content: {
            requestParams,
            lastResponse: response,
            retryAttempt: count,
            maxRetries,
          },
        });

        return httpFetch(requestParams, nextCount, maxRetries);
      }

      throw new Error(
        formatErrorMessage(
          `${
            maxRetries > 0
              ? `Attempted maximum number of ${maxRetries} network retries. Last message - `
              : ""
          }${getErrorMessage(error)}`
        )
      );
    }
  };

  return httpFetch;
}

function generateFetch(
  httpFetch: ReturnType<typeof generateHttpFetch>,
  { url, headers, retries }: ClientConfig
): GraphQLClient["fetch"] {
  return async (operation, options = {}) => {
    const {
      variables,
      headers: overrideHeaders,
      url: overrideUrl,
      retries: overrideRetries,
    } = options;

    const body = JSON.stringify({
      query: operation,
      variables,
    });

    validateRetries({ client: CLIENT, retries: overrideRetries });

    const fetchParams: Parameters<CustomFetchApi> = [
      overrideUrl ?? url,
      {
        method: "POST",
        headers: {
          ...headers,
          ...overrideHeaders,
        },
        body,
      },
    ];

    return httpFetch(fetchParams, 1, overrideRetries ?? retries);
  };
}

function generateRequest(
  fetch: ReturnType<typeof generateFetch>
): GraphQLClient["request"] {
  return async (...props) => {
    if (DEFER_OPERATION_REGEX.test(props[0])) {
      throw new Error(
        formatErrorMessage(
          "This operation will result in a streamable response - use requestStream() instead."
        )
      );
    }

    try {
      const response = await fetch(...props);
      const { status, statusText } = response;
      const contentType = response.headers.get("content-type") || "";

      if (!response.ok) {
        return {
          errors: {
            networkStatusCode: status,
            message: formatErrorMessage(statusText),
          },
        };
      }

      if (!contentType.includes(CONTENT_TYPES.json)) {
        return {
          errors: {
            networkStatusCode: status,
            message: formatErrorMessage(
              `${UNEXPECTED_CONTENT_TYPE_ERROR} ${contentType}`
            ),
          },
        };
      }

      return processJSONResponse(response);
    } catch (error) {
      return {
        errors: {
          message: getErrorMessage(error),
        },
      };
    }
  };
}

async function* getStreamBodyIterator(
  response: Response
): AsyncIterableIterator<string> {
  if ((response.body as any)![Symbol.asyncIterator]) {
    for await (const chunk of response.body! as any) {
      yield (chunk as Buffer).toString();
    }
  } else {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    let readResult: ReadableStreamReadResult<DataChunk>;
    try {
      while (!(readResult = await reader.read()).done) {
        yield decoder.decode(readResult.value);
      }
    } finally {
      reader.cancel();
    }
  }
}

function readStreamChunk(
  streamBodyIterator: AsyncIterableIterator<string>,
  boundary: string
) {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        let buffer = "";

        for await (const textChunk of streamBodyIterator) {
          buffer += textChunk;

          if (buffer.indexOf(boundary) > -1) {
            const lastBoundaryIndex = buffer.lastIndexOf(boundary);
            const fullResponses = buffer.slice(0, lastBoundaryIndex);

            const chunkBodies = fullResponses
              .split(boundary)
              .filter((chunk) => chunk.trim().length > 0)
              .map((chunk) => {
                const body = chunk
                  .slice(
                    chunk.indexOf(HEADER_SEPARATOR) + HEADER_SEPARATOR.length
                  )
                  .trim();
                return body;
              });

            if (chunkBodies.length > 0) {
              yield chunkBodies;
            }

            buffer = buffer.slice(lastBoundaryIndex + boundary.length);

            if (buffer.trim() === `--`) {
              buffer = "";
            }
          }
        }
      } catch (error) {
        throw new Error(
          `Error occured while processing stream payload - ${getErrorMessage(
            error
          )}`
        );
      }
    },
  };
}

function generateRequestStream(
  fetch: ReturnType<typeof generateFetch>
): GraphQLClient["requestStream"] {
  return async (...props) => {
    if (!DEFER_OPERATION_REGEX.test(props[0])) {
      throw new Error(
        formatErrorMessage(
          "This operation does not result in a streamable response - use request() instead."
        )
      );
    }

    try {
      const response = await fetch(...props);

      const { status, statusText } = response;

      if (!response.ok) {
        throw new Error(statusText, { cause: response });
      }

      const responseContentType = response.headers.get("content-type") || "";
      const isNotSupportedContentType = Object.values(CONTENT_TYPES).every(
        (type) => !responseContentType.includes(type)
      );

      if (isNotSupportedContentType) {
        throw new Error(
          `${UNEXPECTED_CONTENT_TYPE_ERROR} ${responseContentType}`,
          { cause: response }
        );
      }

      if (responseContentType.includes(CONTENT_TYPES.json)) {
        return {
          async *[Symbol.asyncIterator]() {
            const processedResponse = await processJSONResponse(response);

            yield {
              ...processedResponse,
              hasNext: false,
            };
          },
        };
      }

      const boundaryHeader = (responseContentType ?? "").match(
        BOUNDARY_HEADER_REGEX
      );
      const boundary = `--${boundaryHeader ? boundaryHeader[1] : "-"}`;

      if (
        !response.body?.getReader &&
        !(response.body as any)![Symbol.asyncIterator]
      ) {
        throw new Error(
          "API multipart response did not return an iterable body",
          { cause: response }
        );
      }

      const streamBodyIterator = getStreamBodyIterator(response);

      let combinedData: { [key: string]: any } = {};
      let responseExtensions: { [key: string]: any } | undefined;

      const iteratorResponse: ClientStreamResponse = {
        async *[Symbol.asyncIterator]() {
          try {
            let streamHasNext = true;

            for await (const chunkBodies of readStreamChunk(
              streamBodyIterator,
              boundary
            )) {
              const dataArray: {
                data: any;
                errors?: any;
                extensions?: any;
                hasNext: boolean;
              }[] = chunkBodies
                .map((value) => {
                  try {
                    return JSON.parse(value);
                  } catch (error) {
                    throw new Error(
                      `Error in parsing multipart response - ${getErrorMessage(
                        error
                      )}`
                    );
                  }
                })
                .map((payload) => {
                  const { data, path, hasNext, extensions, errors } = payload;

                  const payloadData =
                    data && path
                      ? buildDataObjectByPath(path, data)
                      : data || {};

                  return {
                    data: payloadData,
                    ...getKeyValueIfValid("errors", errors),
                    ...getKeyValueIfValid("extensions", extensions),
                    hasNext,
                  };
                });

              responseExtensions =
                dataArray.find((datum) => datum.extensions)?.extensions ??
                responseExtensions;

              const responseErrors = dataArray
                .map(({ errors }) => errors)
                .filter((errors) => errors && errors.length > 0)
                .flat();

              combinedData = buildCombinedDataObject([
                combinedData,
                ...dataArray.map(({ data }) => data),
              ]);

              streamHasNext = dataArray.slice(-1)[0].hasNext;

              if (responseErrors.length > 0) {
                throw new Error(GQL_API_ERROR, {
                  cause: {
                    graphQLErrors: responseErrors,
                  },
                });
              }

              if (Object.keys(combinedData).length === 0) {
                throw new Error(NO_DATA_OR_ERRORS_ERROR);
              }

              yield {
                ...getKeyValueIfValid("data", combinedData),
                ...getKeyValueIfValid("extensions", responseExtensions),
                hasNext: streamHasNext,
              };
            }

            if (streamHasNext) {
              throw new Error(`Response stream terminated unexpectedly`);
            }
          } catch (error) {
            const cause = getErrorCause(error);

            yield {
              ...getKeyValueIfValid("data", combinedData),
              ...getKeyValueIfValid("extensions", responseExtensions),
              errors: {
                networkStatusCode: status,
                message: formatErrorMessage(getErrorMessage(error)),
                ...getKeyValueIfValid("graphQLErrors", cause.graphQLErrors),
              },
              hasNext: false,
            };
          }
        },
      };

      return iteratorResponse;
    } catch (error) {
      return {
        async *[Symbol.asyncIterator]() {
          const cause = getErrorCause(error);

          yield {
            errors: {
              ...getKeyValueIfValid("networkStatusCode", cause.status),
              message: formatErrorMessage(getErrorMessage(error)),
            },
            hasNext: false,
          };
        },
      };
    }
  };
}
