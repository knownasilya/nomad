/*
This wrapper provides a Hyperdrive-compatible interface for any URL.
For hyper:// URLs it lazily detects whether the drive is an autobase (collaborative)
or a plain hyperdrive and delegates accordingly.
For non-hyper:// sites it returns a proxy that generates helpful errors.
*/

export function createDrive(url) {
  if (url.startsWith('hyper:')) {
    // Resolve the backing drive asynchronously so isCollaborativeDrive() can run.
    // Every drive method is already awaited by callers, so returning a Proxy whose
    // methods return Promises is transparent to all call sites.
    const backingP = beaker.autobase.isCollaborativeDrive(url)
      .then(isCollab =>
        isCollab
          ? beaker.autobase.collaborativeDrive(url)
          : beaker.hyperdrive.drive(url)
      )
      .catch(() => beaker.hyperdrive.drive(url))

    return new Proxy({}, {
      get(_, k) {
        if (k === 'url') return url
        if (k === 'then') return undefined // not a Promise/thenable itself
        return (...args) => backingP.then(drive => drive[k](...args))
      },
    })
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
