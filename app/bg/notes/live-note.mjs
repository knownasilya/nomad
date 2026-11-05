// One Note open for live editing on this Device (ADR-0041). The session itself is
// shared/note-live-session.mjs, which the phone's backend runs too; this gives it desktop's Yjs.
// Tested in tests/unit/note-live-session.test.js.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { makeLiveNote } from '../../../shared/note-live-session.mjs';

export * from '../../../shared/note-live-session.mjs';

export const { LiveNote, seedUpdate } = makeLiveNote({ Y, syncProtocol, awarenessProtocol, encoding, decoding });
