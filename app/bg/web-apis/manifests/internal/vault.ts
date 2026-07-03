export default {
  // status & listing
  getStatus: 'promise', // { hasVault, thisDevice, deviceCount }
  getThisDevice: 'promise',
  listDevices: 'promise',
  listSpaces: 'promise',

  // adding devices (member side)
  createInvite: 'promise', // -> { code }
  listPendingRequests: 'promise',
  watchPendingRequests: 'readable',
  approveDevice: 'promise',
  denyDevice: 'promise',

  // joining (candidate side)
  submitInvite: 'promise',

  // managing
  renameDevice: 'promise',
  removeDevice: 'promise',
};
