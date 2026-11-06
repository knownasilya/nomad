# A family album in a shared Space

**Status: Accepted.** 2026-11-06.

A household wants one place for its photos: the kids' school play, the pumpkins on the step, the
holiday. Each person adds from their own phone; everyone sees all of them; nobody has to set up a
drive, share it, and grant every phone a writer key first.

## Decision

1. **The album lives in the Space Library.** A shared Space (ADR-0029) already has an Autobase
   that every member replicates and every editor writes. A photo is three entries there: a small
   record `/photos/items/<id>.json` (`nomad/photo`: when it was taken, who added it, size, caption)
   and two files, the photo and a thumbnail. The files are **blobs** in the adding writer's own blob
   core (the fs-core format, `FS_FORMAT_VERSION 1`, no change), so the oplog carries only pointers
   and a member fetches the bytes over the swarm when they look. A Space that isn't shared has no
   album: it is for the people you live with, and a person's own photos are on their phone already.

2. **Every Device scales a photo the same way before it goes in:** 2560 px on the long side and a
   480 px thumbnail, both JPEG (`shared/photos.mjs` `MAX_SIDE`, `THUMB_SIDE`). The phone uses
   `expo-image-manipulator` (`mobile/lib/pickImages.ts` `scaleAlbumPhoto`), desktop a canvas
   (`app/userland/photos/js/main.js`). A file over 8 MB is refused, never cut. The time taken comes
   from EXIF, else the file's time.

3. **Who may remove one:** the person who added it, or the Space's owner (`canDelete`). Editors add
   and caption; viewers look.

4. **UI.** Desktop is `nomad://photos` (internal `nomad.vault.listPhotos`/`photoData`/`addPhoto`/
   `setPhotoCaption`/`deletePhoto`, `app/bg/web-apis/bg/photos.ts`): photos by month, a viewer, add
   by button or by dropping files. The phone is `mobile/components/Photos.tsx` over `RPC_APPS`
   `photos` (`mobile/backend/lib/photos.mjs`, which writes blobs through the drive manager's
   `putBlobFor` and reads with `readFileOf`): a grid by month, Add from the gallery or the camera, a
   viewer with a caption.

## Consequences

- No page API and no AI capability reads the album.
- Photos are added by hand. Adding new camera photos by themselves needs a media-library
  permission and a background task on the phone; that is a later step.
- Every member's Devices replicate the records, and fetch a photo's bytes when they show it. A
  Home Peer (ADR-0038) that keeps the Space Library keeps the album reachable when phones sleep.
