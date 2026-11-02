// nomad.session: a page asks "who are you?" and the browser answers with one of the user's Personas,
// only after the user says yes in the login prompt (ADR-0031).
export default {
  requestLogin: 'promise', // ({ perms?: ['profile', 'modifyDrive'], maxAge?: seconds }) -> Session
  getCurrent: 'promise', // -> Session | null
  revoke: 'promise',
  createEventStream: 'readable', // 'change' { session }
};
