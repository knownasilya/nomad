/*
This wrapper provides a Hyperdrive-compatible interface for any URL.
For hyper:// URLs it delegates to nomad.fs, which auto-detects whether the drive
is an autobase (collaborative) or a plain hyperdrive and dispatches accordingly.
For non-hyper:// sites it returns a proxy that generates helpful errors.
*/

export function createDrive(url) {
  if (url.startsWith('hyper:')) {
    return nomad.fs.drive(url);
  }
  return new Proxy(
    {},
    {
      get(obj, k) {
        if (k === 'url') return url;
        if (k === 'stat') {
          return () => {
            // fake response to just let stat() callers pass through
            return {
              isUnsupportedProtocol: true,
              isDirectory: () => true,
              isFile: () => true,
            };
          };
        }
        return () => {
          let urlp = new URL(url);
          throw new Error(`${urlp.protocol} does not support this command`);
        };
      },
    }
  );
}
