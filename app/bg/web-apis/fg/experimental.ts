import errors from 'beaker-error-constants';
import experimentalGlobalFetchManifest from '../manifests/external/experimental/global-fetch';
import experimentalCapturePageManifest from '../manifests/external/experimental/capture-page';

export const setup = function (rpc) {
  const experimental: any = {};
  const opts = { timeout: false, errors };

  // hyperdrive or internal only
  if (['nomad:', 'hyper:'].includes(window.location.protocol)) {
    const globalFetchRPC = rpc.importAPI(
      'experimental-global-fetch',
      experimentalGlobalFetchManifest,
      opts
    );
    const capturePageRPC = rpc.importAPI(
      'experimental-capture-page',
      experimentalCapturePageManifest,
      opts
    );
    // experimental.globalFetch
    experimental.globalFetch = async function globalFetch(input, init) {
      var request = new Request(input, init);
      if (request.method !== 'HEAD' && request.method !== 'GET') {
        throw new Error('Only HEAD and GET requests are currently supported by globalFetch()');
      }
      try {
        var responseData = await globalFetchRPC.fetch({
          method: request.method,
          url: request.url,
          headers: request.headers,
        });
        return new Response(responseData.body, responseData);
      } catch (e) {
        if (
          e.message === 'Can only send requests to http or https URLs' &&
          request.url.startsWith('hyper://')
        ) {
          // we can just use `fetch` for hyper:// URLs, because hyper:// does not enforce CORS
          return fetch(input, init);
        }
        throw e;
      }
    };

    // experimental.capturePage
    experimental.capturePage = capturePageRPC.capturePage;
  }

  return experimental;
};
