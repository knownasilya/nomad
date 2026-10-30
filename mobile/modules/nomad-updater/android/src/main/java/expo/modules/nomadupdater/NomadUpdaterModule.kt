package expo.modules.nomadupdater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// Installs a new Nomad APK in place with Android's PackageInstaller (the same way pearbell updates
// itself). The JS side (mobile/lib/updater.ts) finds the release on GitHub and decides when to
// install; this module downloads the APK into an install session and reports back through
// onProgress / onStatus. An update installs only when it is signed with the same key as this app.
class NomadUpdaterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NomadUpdater")

    Events("onProgress", "onStatus")

    OnCreate {
      Installs.emit = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      Installs.emit = null
    }

    // The versionName of the installed build (CI sets it from the release tag).
    Function("currentVersion") {
      context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
    }

    // Android 12+ installs without a prompt when this app installed itself last time.
    Function("canInstallSilently") {
      if (Build.VERSION.SDK_INT < 31) return@Function false
      val source = context.packageManager.getInstallSourceInfo(context.packageName)
      source.installingPackageName == context.packageName
    }

    // Whether the user has let Nomad install apps ("Install unknown apps").
    Function("canRequestInstalls") {
      context.packageManager.canRequestPackageInstalls()
    }

    Function("openInstallSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    // Opens Android's install prompt again, when it could not open on its own (the app was in the
    // background when the download finished). False when no install is waiting on the user.
    Function("confirmInstall") {
      val confirm = Installs.pendingConfirm ?: return@Function false
      context.startActivity(confirm)
      true
    }

    // Resolves once the APK is downloaded and handed to Android; the result arrives as onStatus.
    AsyncFunction("install") { url: String, version: String, size: Double, promise: Promise ->
      if (Installs.busy) {
        promise.reject("ERR_UPDATE_BUSY", "An update is already installing", null)
        return@AsyncFunction
      }
      Installs.busy = true
      Installs.pendingConfirm = null
      val app = context.applicationContext
      thread(name = "nomad-update-install") {
        try {
          download(app, url, version, size.toLong())
          promise.resolve(null)
        } catch (e: Exception) {
          Log.w(TAG, "Update install failed", e)
          Installs.busy = false
          promise.reject("ERR_UPDATE_INSTALL", e.message ?: "Download failed", e)
        }
      }
    }
  }

  private fun download(app: Context, url: String, version: String, size: Long) {
    val installer = app.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(app.packageName)
      if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    val id = installer.createSession(params)

    try {
      installer.openSession(id).use { session ->
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        val total = conn.contentLengthLong.takeIf { it > 0 } ?: size

        conn.inputStream.use { input ->
          session.openWrite("nomad.apk", 0, total).use { out ->
            val buf = ByteArray(64 * 1024)
            var done = 0L
            var lastShown = 0.0
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              done += n
              val p = if (total > 0) done.toDouble() / total else 0.0
              if (p - lastShown >= 0.02) {
                lastShown = p
                Installs.emit?.invoke("onProgress", Bundle().apply { putDouble("progress", p) })
              }
            }
            session.fsync(out)
          }
        }

        val intent = Intent(app, UpdateReceiver::class.java).putExtra(UpdateReceiver.EXTRA_VERSION, version)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        session.commit(PendingIntent.getBroadcast(app, id, intent, flags).intentSender)
      }
    } catch (e: Exception) {
      try {
        installer.abandonSession(id)
      } catch (_: Exception) {}
      throw e
    }
  }

  companion object {
    const val TAG = "nomad-update"
  }
}

// State shared by the module and the install receiver, which Android creates on its own.
internal object Installs {
  @Volatile var busy = false
  @Volatile var pendingConfirm: Intent? = null
  @Volatile var emit: ((String, Bundle) -> Unit)? = null
}
