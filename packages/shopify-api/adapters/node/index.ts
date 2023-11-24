import crypto from 'crypto';

import fetch from 'node-fetch';

import {
  setAbstractFetchFunc,
  setAbstractConvertRequestFunc,
  setAbstractConvertIncomingResponseFunc,
  setAbstractConvertResponseFunc,
  setAbstractConvertHeadersFunc,
  setAbstractRuntimeString,
  setCrypto,
  AbstractFetchFunc,
} from '../../runtime';

import {
  nodeConvertRequest,
  nodeConvertIncomingResponse,
  nodeConvertAndSendResponse,
  nodeConvertAndSetHeaders,
  nodeRuntimeString,
} from './adapter';

// eslint-disable-next-line no-warning-comments
// TODO Figure out a way to align the interfaces
setAbstractFetchFunc(fetch as any as AbstractFetchFunc);
setAbstractConvertRequestFunc(nodeConvertRequest);
setAbstractConvertIncomingResponseFunc(nodeConvertIncomingResponse);
setAbstractConvertResponseFunc(nodeConvertAndSendResponse);
setAbstractConvertHeadersFunc(nodeConvertAndSetHeaders);
setAbstractRuntimeString(nodeRuntimeString);
setCrypto(crypto as any);
