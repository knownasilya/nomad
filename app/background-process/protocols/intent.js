import {protocol} from 'electron'
import path from 'path'
import fs from 'fs'

export function setup () {
  // setup the protocol handler
  protocol.registerStreamProtocol('intent', intentProtocol, err => {
    if (err) throw new Error('Failed to create protocol: intent. ' + err)
  })
}

// internal methods
// =

async function intentProtocol (request, respond) {
  respond({
    statusCode: 302,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    },
    data: fs.createReadStream(path.join(__dirname, 'builtin-pages/intent.html'))
  })
}