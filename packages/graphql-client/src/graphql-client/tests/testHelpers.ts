import { TextEncoder, TextDecoder } from "util";
import { Readable } from "stream";

import { ReadableStream } from "web-streams-polyfill/es2018";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

const responseConfig = {
  status: 200,
  ok: true,
  headers: new Headers({
    "Content-Type": "multipart/mixed; boundary=graphql",
  }),
};

function createReadableStream(
  responseArray: string[],
  stringEncoder?: (str: any) => Uint8Array
) {
  return new ReadableStream({
    start(controller) {
      let index = 0;
      queueData();
      function queueData() {
        const chunk = responseArray[index];
        const string = stringEncoder ? stringEncoder(chunk) : chunk;

        // Add the string to the stream
        controller.enqueue(string);

        index++;

        if (index > responseArray.length - 1) {
          controller.close();
        } else {
          return queueData();
        }
        return {};
      }
    },
  });
}

export function createReaderStreamResponse(responseArray: string[]) {
  const encoder = new TextEncoder();
  const stream = createReadableStream(responseArray, (str) => {
    return encoder.encode(str);
  });

  return {
    ...responseConfig,
    body: {
      getReader: () => stream.getReader(),
    },
  } as any;
}

export function createIterableResponse(responseArray: string[]) {
  const stream = createReadableStream(responseArray);

  return new Response(Readable.from(stream) as any, responseConfig);
}
