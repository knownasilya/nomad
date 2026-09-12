// Internal API for the WebMCP inspector app (nomad://webmcp). nomad:// only.
export default {
  list: 'promise', // [{ wcId, url, origin, title, tools, permission }]
  invoke: 'promise', // (wcId, name, argsJson) -> { ok, result|error, ms }
  getLog: 'promise', // recent InvokeLogEntry[]
  watch: 'readable', // 'change' | 'invoke'(entry) | 'result'(entry)
};
