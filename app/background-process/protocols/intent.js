import {protocol} from 'electron'

export function setup () {
  // setup the protocol handler
  protocol.registerStreamProtocol('intent', intentProtocol, err => {
    if (err) throw new Error('Failed to create protocol: intent. ' + err)
  })
}

// internal methods
// =

async function intentProtocol (request, respond) {
  debugger;
}