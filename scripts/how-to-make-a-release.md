The process is currently a little silly. This file is getting progressively less awful.

## Check the deps installation

Run npm install. Make sure ./app/bg/dat/converter has its node_modules installed.

## Make sure to update the desktop versions and release-notes links

## Build

`npm run build`

## Apply the following patches manually to the scripts/node_modules

`app-builder-lib/out/util/AppFileWalker.js` this one stops electron-bunder from removing ./app/bg/dat/converter/node_modules

```
if (!nodeModulesFilter(file, fileStat)) {
  if (!file.includes('dat')) {
    return false;
  }
}

if (file.endsWith(nodeModulesSystemDependentSuffix)) {
  if (!file.includes('dat')) {
    return false;
  }
}
```

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
appleId=pfrazee@gmail.com
appleIdPassword={be paul to have this}
```

On Windows, these two env vars:

```
$env:CSC_LINK = "\path\to\.pfx"
$env:CSC_KEY_PASSWORD = "{be paul to have this}"
```

## It's just that easy

Boy how about that.
