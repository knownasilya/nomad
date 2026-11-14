// What the terminal says when a command fails: the error in plain words, and what to do next.
// Pure (strings in, { message, tip } out), so tests/unit/webterm.test.js runs it. A tip may be a
// string or something the terminal renders (a command can set err.tip).

export function friendlyError(err, { cwd = '' } = {}) {
  if (!err) return { message: 'Something went wrong' };
  if (typeof err === 'string') err = new Error(err);
  let message = cleanMessage(err.message || String(err));
  let tip = err.tip || '';
  const name = err.name || '';
  const all = `${name} ${message}`;

  if (!tip) {
    if (/NotFoundError|ENOENT|not found|No such file|does not exist/i.test(all)) {
      if (/^NotFoundError:?\s*/i.test(message) || /File not found/i.test(message)) {
        message = message.replace(/^NotFoundError:?\s*/i, '') || 'No such file or folder';
      }
      tip = 'Check the name with ls, or press Tab to complete it.';
    } else if (/PermissionsError|not writable|ArchiveNotWritable|read[- ]?only|can.?t (write|edit)|not allowed to write|EACCES/i.test(all)) {
      message = "You can't change this drive";
      tip = /^hyper:\/\/private\//.test(cwd)
        ? 'This part of your private drive is kept by Nomad.'
        : 'It is read only for you. Ask its owner to let you edit (site info → Editors), or cd into a drive you own (mkdrive makes one).';
    } else if (/UserDeniedError|denied/i.test(all)) {
      message = 'Not allowed: the request was turned down';
    } else if (/UnsupportedProtocol|does not support this command/i.test(all)) {
      tip = 'The terminal works on Nomad drives (hyper://). cd into one, like cd ~';
    } else if (/timed? ?out/i.test(all)) {
      tip = 'The drive may be offline. Try again when one of its peers is online.';
    } else if (/No AI|no model|AI Runtime|AI Device|not configured|ECONNREFUSED/i.test(all)) {
      tip = 'Set up the AI on nomad://ai/setup, then ask again.';
    }
  }
  return { message, tip };
}

// "Error invoking remote method 'x': Error: NotFoundError: File not found" → "File not found".
export function cleanMessage(msg) {
  let m = String(msg || '').trim();
  m = m.replace(/^Error invoking remote method '[^']*':\s*/i, '');
  for (let i = 0; i < 3; i++) m = m.replace(/^(Error|TypeError|RangeError):\s*/, '');
  return m || 'Something went wrong';
}
