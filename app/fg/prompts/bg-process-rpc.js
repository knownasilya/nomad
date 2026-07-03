import * as rpc from 'pauls-electron-rpc';
import promptsManifest from '../../bg/rpc-manifests/prompts';
import fsManifest from '../../bg/web-apis/manifests/external/fs';

export const prompts = rpc.importAPI('background-process-prompts', promptsManifest);
export const fs = rpc.importAPI('fs', fsManifest);
