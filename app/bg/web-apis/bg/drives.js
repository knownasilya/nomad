// @ts-nocheck
import hyper from '../../hyper/index';
import * as drives from '../../hyper/drives';
import * as archivesDb from '../../dbs/archives';
import {
  listDrives,
  listDrivesForSpace,
  configDrive,
  configDriveForSpace,
  removeDrive,
  removeDriveForSpace,
  getDriveIdent,
} from '../../filesystem/index';
import { findTab } from '../../ui/tabs/manager';
import * as filesystem from '../../filesystem/index';
import * as trash from '../../filesystem/trash';

function getSenderSpaceId(sender) {
  return findTab(sender)?.spaceId ?? filesystem.getSpaceIdForWebContents(sender?.id);
}

// exported api
// =

export default {
  async get(key) {
    key = await drives.fromURLToKey(key, true);
    const spaceId = getSenderSpaceId(this.sender);
    const drivesList = await listDrivesForSpace(spaceId);
    var drive = drivesList.find((d) => d.key === key);
    var info = await drives
      .getDriveInfo(key, { onlyCache: true })
      .catch((e) => ({}));
    var url = `hyper://${key}/`;
    var ident = getDriveIdent(url);
    return {
      key,
      url,
      info,
      saved: !!drive,
      forkOf: drive ? drive.forkOf : undefined,
      ident,
    };
  },

  async list(opts) {
    const spaceId = getSenderSpaceId(this.sender);
    return assembleRecords(await listDrivesForSpace(spaceId, opts));
  },

  async getForks(key) {
    key = await drives.fromURLToKey(key, true);
    const spaceId = getSenderSpaceId(this.sender);
    var drivesList = await listDrivesForSpace(spaceId);
    var rootDrive = drivesList.find((drive) => drive.key === key);
    if (!rootDrive) return assembleRecords([{ key }]);

    // find root of the tree
    var seenKeys = new Set(); // used to break cycles
    while (
      rootDrive &&
      rootDrive.forkOf &&
      rootDrive.forkOf.key &&
      !seenKeys.has(rootDrive.forkOf.key)
    ) {
      seenKeys.add(rootDrive.key);
      rootDrive = drivesList.find(
        (drive2) => drive2.key === rootDrive.forkOf.key
      );
    }
    if (!rootDrive) return [];

    // build the tree
    var forks = [];
    function addForksOf(drive) {
      if (forks.includes(drive)) return; // cycle
      forks.push(drive);
      for (let drive2 of drivesList) {
        if (drive2.forkOf && drive2.forkOf.key === drive.key) {
          addForksOf(drive2);
        }
      }
    }
    addForksOf(rootDrive);

    return assembleRecords(forks);
  },

  async configure(key, opts) {
    const spaceId = getSenderSpaceId(this.sender);
    return configDriveForSpace(key, opts, spaceId);
  },

  async remove(key) {
    const spaceId = getSenderSpaceId(this.sender);
    return removeDriveForSpace(key, spaceId);
  },

  async collectTrash() {
    return trash.collect({ olderThan: 0 });
  },

  async delete(url) {
    // TODO
    // var drive = await drives.getOrLoadDrive(url)
    // assertDriveDeletable(drive.key)
    // await datLibrary.configureDrive(drive, {isSaved: false})
    // await drives.unloadDrive(drive.key)
    // var bytes = await archivesDb.deleteArchive(drive.key)
    // return {bytes}
  },

  async touch(key, timeVar, value) {
    return archivesDb.touch(key, timeVar, value);
  },

  async clearFileCache(url) {
    return drives.clearFileCache(await drives.fromURLToKey(url, true));
  },

  clearDnsCache() {
    hyper.dns.flushCache();
  },

  createEventStream() {
    return drives.createEventStream();
  },

  getDebugLog(key) {
    return drives.getDebugLog(key);
  },

  createDebugStream() {
    // TODO: debug streams removed in v11 stack
    const { EventEmitter } = require('events');
    return new EventEmitter();
  },
};

// internal methods
// =

async function assembleRecords(drivesList) {
  var records = [];
  for (let drive of drivesList) {
    let url = `hyper://${drive.key}/`;
    let ident = getDriveIdent(url);
    records.push({
      key: drive.key,
      url,
      tags: drive.tags || [],
      info: await drives.getDriveInfo(drive.key, { onlyCache: true }),
      saved: true,
      forkOf: drive ? drive.forkOf : undefined,
      ident,
    });
  }
  return records;
}
