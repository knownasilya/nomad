package expo.modules.nomadwebviewinsets

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app is edge-to-edge, and React Native passes the window's insets down the view tree without
// using them up: the browser screen pads itself with react-native-safe-area-context instead. So each
// page WebView is told the status bar and the navigation bar overlap it, though they never do: the
// address bar sits under the status bar and the screen's bottom padding over the navigation bar.
// Android's WebView (M136+) hands those insets to the page as env(safe-area-inset-*), and a site
// that pads its own bars by them (x.com's bottom nav) draws a band of empty space the height of the
// navigation bar. Chrome gives such a page 0, because its page never sits under a system bar.
//
// This module gives every WebView in the window an insets listener that zeroes the system bars and
// the display cutout and keeps the rest (the keyboard), as Android's WebView guide recommends
// rather than consuming them: https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets
// WebViews come and go with tabs, so it looks for new ones after each layout pass.
class NomadWebViewInsetsModule : Module() {
  private var installedOn: View? = null
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { installedOn?.let { fitWebViews(it) } }

  override fun definition() = ModuleDefinition {
    Name("NomadWebViewInsets")

    // Called once by the browser screen. Safe to call again: it moves to the current window.
    // Returns false when there is no window yet; entering the foreground attaches then.
    Function("install") {
      val activity = appContext.currentActivity
      activity?.let { a -> a.runOnUiThread { attach(a) } }
      activity != null
    }

    OnActivityEntersForeground {
      appContext.currentActivity?.let { activity -> activity.runOnUiThread { attach(activity) } }
    }

    OnDestroy {
      detach()
    }
  }

  private fun attach (activity: Activity) {
    val decor = activity.window?.decorView ?: return
    if (installedOn === decor) return
    detach()
    installedOn = decor
    decor.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    fitWebViews(decor)
  }

  private fun detach () {
    installedOn?.viewTreeObserver?.let { if (it.isAlive) it.removeOnGlobalLayoutListener(layoutListener) }
    installedOn = null
  }

  private fun fitWebViews (view: View) {
    if (view is WebView) {
      if (view.getTag(TAG_KEY) == null) {
        view.setTag(TAG_KEY, true)
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
          // The WebView still runs its own handling, with the bars zeroed (not consumed), so the
          // keyboard keeps resizing the page's visual viewport.
          ViewCompat.onApplyWindowInsets(v, withoutBars(insets))
        }
        ViewCompat.requestApplyInsets(view)
      }
      return
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) fitWebViews(view.getChildAt(i))
    }
  }

  private fun withoutBars (insets: WindowInsetsCompat): WindowInsetsCompat {
    val builder = WindowInsetsCompat.Builder(insets)
    for (type in BAR_TYPES) builder.setInsets(type, Insets.NONE)
    return builder.setDisplayCutout(null).build()
  }

  companion object {
    private val TAG_KEY = R.id.nomad_webview_insets
    private val BAR_TYPES = intArrayOf(
      WindowInsetsCompat.Type.statusBars(),
      WindowInsetsCompat.Type.navigationBars(),
      WindowInsetsCompat.Type.captionBar(),
      WindowInsetsCompat.Type.displayCutout(),
      WindowInsetsCompat.Type.tappableElement(),
      WindowInsetsCompat.Type.systemGestures(),
      WindowInsetsCompat.Type.mandatorySystemGestures()
    )
  }
}
