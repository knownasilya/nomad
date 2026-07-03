// Config plugin: pin the Gradle wrapper to a version compatible with the
// Android Gradle Plugin this project resolves (AGP 8.12, which supports Gradle
// 8.13–8.14 but NOT Gradle 9 — Gradle 9 removed JvmVendorSpec.IBM_SEMERU, which
// AGP 8.12 still references). Without this, `expo prebuild` regenerates the
// wrapper at Gradle 9.0.0 and the Android build fails during configuration.
const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const GRADLE_VERSION = '8.14.3'

module.exports = function withGradleVersion (config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      )
      if (fs.existsSync(file)) {
        const contents = fs
          .readFileSync(file, 'utf8')
          .replace(/gradle-[\d.]+-(bin|all)\.zip/, `gradle-${GRADLE_VERSION}-bin.zip`)
        fs.writeFileSync(file, contents)
      }
      return cfg
    }
  ])
}
