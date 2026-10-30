package expo.modules.nomadupdater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Bundle
import android.util.Log

// The result of an install session. Android needs the user's OK the first time (and before
// Android 12 every time): open its prompt, and tell JS so the banner can reopen it if that fails.
class UpdateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val version = intent.getStringExtra(EXTRA_VERSION) ?: ""
    when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        @Suppress("DEPRECATION")
        val confirm = (if (Build.VERSION.SDK_INT >= 33) {
          intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
          intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }) ?: return
        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        Installs.pendingConfirm = confirm
        emit("pending", version, null)
        // Works while the app is open; from the background the banner's Install button does it.
        try {
          context.startActivity(confirm)
        } catch (e: Exception) {
          Log.w(NomadUpdaterModule.TAG, "Could not open the install prompt", e)
        }
      }
      PackageInstaller.STATUS_SUCCESS -> {
        Installs.busy = false
        Installs.pendingConfirm = null
        emit("success", version, null)
      }
      else -> {
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val why = when (status) {
          PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
            "This build is signed with a different key. Uninstall Nomad, then install the new APK by hand."
          PackageInstaller.STATUS_FAILURE_ABORTED -> "The update was cancelled"
          else -> message ?: "Install failed ($status)"
        }
        Installs.busy = false
        Installs.pendingConfirm = null
        emit("failed", version, why)
      }
    }
  }

  private fun emit(status: String, version: String, error: String?) {
    Installs.emit?.invoke(
      "onStatus",
      Bundle().apply {
        putString("status", status)
        putString("version", version)
        if (error != null) putString("error", error)
      }
    )
  }

  companion object {
    const val EXTRA_VERSION = "version"
  }
}
