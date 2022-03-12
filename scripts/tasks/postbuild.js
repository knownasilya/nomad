const gulp = require('gulp');
const jetpack = require('fs-jetpack');

gulp.task(
  'postbuild',
  gulp.series(function () {
    // for some reason, electron-builder is spitting out 'Nomad-{version}{ext}'
    // but the auto updater expects 'nomad-{version}{ext}'
    // couldnt figure out how to reconfig the builder, so just rename the output assets

    const cwd = jetpack.cwd('../dist');
    const names = cwd.list();

    names.forEach(function (name) {
      // windows assets:
      if (name.indexOf('Nomad Setup') === 0 && name.indexOf('.exe') !== -1) {
        let newName = 'nomad-setup-' + name.slice('Nomad Setup '.length);
        return cwd.move(name, newName);
      }

      // osx assets:
      if (
        name.indexOf('Nomad') === 0 &&
        (name.indexOf('.dmg') !== -1 || name.indexOf('-mac.zip') !== -1)
      ) {
        let newName = 'nomad' + name.slice('Nomad'.length);
        return cwd.move(name, newName);
      }
    });

    return Promise.resolve(true);
  })
);
