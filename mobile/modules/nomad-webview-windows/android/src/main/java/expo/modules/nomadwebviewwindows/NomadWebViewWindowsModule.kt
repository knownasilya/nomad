package expo.modules.nomadwebviewwindows

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Message
import android.util.Log
import android.webkit.WebSettings
import android.webkit.WebView
import com.reactnativecommunity.webview.RNCWebViewHooks
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// A page's new windows stay in Nomad. react-native-webview gave every window.open() and
// target="_blank" link to another app (Chrome), so "Sign in with Google" left Nomad, and the page
// that started it never got the result. mobile/patches/react-native-webview+*.patch adds
// RNCWebViewHooks, and this module answers it:
//
// - A window a script opens (a sign-in popup) is a real WebView window, shown over the tab
//   (PopupWindow). It keeps window.opener, so the popup can post its result back, and the page
//   sees popup.closed when it goes.
// - A tap on a target="_blank" link opens a new tab, as in Chrome. Browsers treat such a link as
//   noopener, so nothing waits on it.
// - An RSS or Atom feed the page tries to download goes to Reader instead of Downloads.
//
// Google refuses sign-in in a WebView that says so. browserUserAgent() is the WebView's own user
// agent without the "; wv" and "Version/4.0" marks, which is Chrome's; the patch also drops the
// X-Requested-With header. Popups get the same.
class NomadWebViewWindowsModule : Module() {
  private val popups = mutableListOf<PopupWindow>()

  private val hooks = object : RNCWebViewHooks.Hooks {
    override fun onCreateWindow (view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean =
      openWindow(view, resultMsg)

    override fun onDownloadStart (view: WebView, url: String?, userAgent: String?, contentDisposition: String?, mimetype: String?, contentLength: Long): Boolean {
      if (url == null || !isFeed(url, mimetype)) return false
      feed(url)
      return true
    }
  }

  override fun definition () = ModuleDefinition {
    Name("NomadWebViewWindows")

    Events("onOpenTab", "onFeed")

    OnCreate {
      RNCWebViewHooks.hooks = hooks
    }

    OnDestroy {
      if (RNCWebViewHooks.hooks === hooks) RNCWebViewHooks.hooks = null
      popups.toList().forEach { it.close() }
    }

    Function("browserUserAgent") {
      val context = appContext.reactContext ?: return@Function null
      browserUserAgent(context)
    }

    AsyncFunction("openExternal") { url: String ->
      openExternal(url)
    }
  }

  // A window the page opens (window.open, target="_blank"), from a tab or from another popup.
  internal fun openWindow (opener: WebView, resultMsg: Message): Boolean {
    val activity = appContext.currentActivity ?: return false
    val popup = PopupWindow(activity, opener, tappedLink(opener), this)
    popups.add(popup)
    popup.open(resultMsg)
    return true
  }

  internal fun closed (popup: PopupWindow) {
    popups.remove(popup)
  }

  internal fun openTab (url: String) {
    sendEvent("onOpenTab", mapOf("url" to url))
  }

  internal fun feed (url: String) {
    sendEvent("onFeed", mapOf("url" to url))
  }

  // Hands a link to the app that handles it. Like Chrome, a page may only start a browsable
  // activity, never a named component, and a web page never leaves Nomad this way.
  internal fun openExternal (url: String): Boolean {
    val context: Context = appContext.currentActivity ?: appContext.reactContext ?: return false
    val intent = try {
      if (url.startsWith("intent:", ignoreCase = true)) Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
      else Intent(Intent.ACTION_VIEW, Uri.parse(url))
    } catch (e: Exception) {
      return false
    }
    if (isWebScheme(intent.data?.scheme)) return false
    intent.addCategory(Intent.CATEGORY_BROWSABLE)
    intent.component = null
    intent.selector = null
    if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      Log.w(TAG, "Couldn't open $url", e)
      false
    }
  }

  companion object {
    private const val TAG = "NomadWebViewWindows"

    private val FEED_TYPES = Regex("^application/(rss|atom|rdf)\\+xml", RegexOption.IGNORE_CASE)
    private val XML_TYPES = Regex("^(application|text)/xml", RegexOption.IGNORE_CASE)
    private val FEED_PATH = Regex("(rss|atom|feed)", RegexOption.IGNORE_CASE)

    // An RSS or Atom document. A plain XML type counts when the address says feed.
    internal fun isFeed (url: String, mimetype: String?): Boolean {
      val type = mimetype?.trim() ?: return false
      if (FEED_TYPES.containsMatchIn(type)) return true
      return XML_TYPES.containsMatchIn(type) && FEED_PATH.containsMatchIn(Uri.parse(url).path ?: "")
    }

    internal fun isWebScheme (scheme: String?): Boolean =
      scheme.equals("http", ignoreCase = true) || scheme.equals("https", ignoreCase = true)

    // The link the user just tapped, when the new window comes from a tap on one.
    private fun tappedLink (view: WebView): String? {
      val hit = view.hitTestResult
      if (hit.type != WebView.HitTestResult.SRC_ANCHOR_TYPE) return null
      val href = hit.extra ?: return null
      return if (isWebScheme(Uri.parse(href).scheme)) href else null
    }

    // "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36
    // (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36" becomes
    // "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko)
    // Chrome/120.0.6099.230 Mobile Safari/537.36".
    internal fun browserUserAgent (context: Context): String =
      WebSettings.getDefaultUserAgent(context)
        .replace(Regex(";\\s*wv\\)"), ")")
        .replace(Regex("\\s+Build/[^;)]+"), "")
        .replace(Regex("\\s+Version/[\\d.]+"), "")
  }
}
