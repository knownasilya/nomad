import * as rpc from 'pauls-electron-rpc';
import browserManifest from '../../bg/web-apis/manifests/internal/browser';
import fsManifest from '../../bg/web-apis/manifests/external/fs';
import permPromptManifest from '../../bg/rpc-manifests/perm-prompt';

export const beakerBrowser = rpc.importAPI('nomad-browser', browserManifest);
export const fs = rpc.importAPI('fs', fsManifest);
export const permPrompt = rpc.importAPI('background-process-perm-prompt', permPromptManifest);
