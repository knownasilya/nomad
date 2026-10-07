// Some OpenAI-compatible servers (MTPLX) refuse a turn with HTTP 200 and a normal SSE
// chunk: finish_reason "error" plus a top-level `error` object, then close the stream.
// Treating that as an empty completion hides the reason (usually out of memory).

export function completionStreamError(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const err = parsed.error;
  const finish = parsed.choices && parsed.choices[0] && parsed.choices[0].finish_reason;
  if (!err && finish !== 'error') return null;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const message = err.message || err.code;
    if (message) return String(message);
  }
  return 'The AI runtime stopped this reply before it produced text.';
}
