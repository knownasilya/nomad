The process is currently a little silly. This file is getting progressively less awful.

## Check the deps installation

Run npm install.

## Make sure to update the desktop versions and release-notes links

## Build

`npm run build`

## Bundle

```sh
# Bump versions, tag, and create changelog
npm run release-version
# Create release files
cd scripts/
npm run release
# Create a release on Github, and upload binaries from /dist folder
```

On MacOS you'll need to supply two env vars:

```
appleId=someemail@example.com
appleIdPassword=somepassword
```

On Windows, these two env vars:

```
$env:CSC_LINK = "\path\to\.pfx"
$env:CSC_KEY_PASSWORD = "somepassword"
```

## It's just that easy

Boy how about that.
