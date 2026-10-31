package expo.modules.nomadwebviewwindows

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

// A window a page opened: a full-screen WebView over the tab, with a bar that names the site and a
// close button. The WebView is the one Chromium asked for (WebViewTransport), so window.opener,
// postMessage between the two, window.close() and the opener's popup.closed all work as in a browser.
//
// When the window comes from a tap on a target="_blank" link, it waits for the first address: if
// that is the link, the link opens in a new tab instead, and this window never shows.
internal class PopupWindow (
  private val activity: Activity,
  private val opener: WebView,
  private val tappedLink: String?,
  private val module: NomadWebViewWindowsModule
) {
  private val dark = (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
  // mobile/lib/theme.ts: bg, surface, border, text, textMuted, accent, danger.
  private val bar = if (dark) 0xFF1F1F1F.toInt() else 0xFFF5F5F5.toInt()
  private val surface = if (dark) 0xFF2B2B2B.toInt() else 0xFFFFFFFF.toInt()
  private val border = if (dark) 0xFF3A3A3A.toInt() else 0xFFE0E0E0.toInt()
  private val text = if (dark) 0xFFEEEEEE.toInt() else 0xFF222222.toInt()
  private val textMuted = if (dark) 0xFF8F8F8F.toInt() else 0xFF888891.toInt()
  private val accent = if (dark) 0xFF5D80FF.toInt() else 0xFF1D59C7.toInt()
  private val danger = if (dark) 0xFFFF6B6B.toInt() else 0xFFD11A1A.toInt()

  val web = WebView(activity)
  private val titleView = TextView(activity)
  private val hostView = TextView(activity)
  private val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal)
  private var dialog: Dialog? = null
  private var decided = tappedLink == null
  private var closed = false
  private val main = Handler(Looper.getMainLooper())

  fun open (resultMsg: Message) {
    configure()
    (resultMsg.obj as WebView.WebViewTransport).webView = web
    resultMsg.sendToTarget()
    if (decided) show()
    // A link whose page never loads an address (it writes its own): show what it made.
    else main.postDelayed({ if (!decided && !closed) { decided = true; show() } }, 1500)
  }

  fun close () {
    if (closed) return
    closed = true
    module.closed(this)
    dialog?.let { if (it.isShowing) it.dismiss() }
    dialog = null
    // Not inside the WebView's own callback (window.close() lands here from onCloseWindow).
    main.post {
      web.stopLoading()
      (web.parent as? ViewGroup)?.removeView(web)
      web.destroy()
    }
  }

  private fun configure () {
    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      setSupportMultipleWindows(true)
      builtInZoomControls = true
      displayZoomControls = false
      allowFileAccess = false
      allowContentAccess = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      // The tab's user agent (already Chrome's); a WebView without one gets Chrome's here.
      userAgentString = opener.settings.userAgentString
        ?.takeUnless { it.contains("; wv)") }
        ?: NomadWebViewWindowsModule.browserUserAgent(activity)
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
      WebSettingsCompat.setRequestedWithHeaderOriginAllowList(web.settings, emptySet())
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
    web.setBackgroundColor(surface)

    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading (view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        return route(request.url.toString())
      }

      override fun onPageStarted (view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        if (url != null && url != "about:blank" && !decided && firstAddress(url)) return
        showAddress(url)
      }

      override fun onPageFinished (view: WebView, url: String?) {
        showAddress(url)
      }
    }

    web.webChromeClient = object : WebChromeClient() {
      override fun onCreateWindow (view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean =
        module.openWindow(view, resultMsg)

      override fun onCloseWindow (window: WebView) {
        close()
      }

      override fun onReceivedTitle (view: WebView, title: String?) {
        if (!title.isNullOrBlank() && !title.startsWith("http")) titleView.text = title
      }

      override fun onProgressChanged (view: WebView, newProgress: Int) {
        progress.progress = newProgress
        progress.visibility = if (newProgress >= 100) View.INVISIBLE else View.VISIBLE
      }
    }

    // A feed goes to Reader; anything else this window downloads opens in a tab, which saves it.
    web.setDownloadListener { url, _, _, mimetype, _ ->
      if (NomadWebViewWindowsModule.isFeed(url, mimetype)) module.feed(url) else module.openTab(url)
      if (web.url.isNullOrEmpty() || web.url == "about:blank") close()
    }
  }

  // Where a link in this window goes. true when the window doesn't load it itself.
  private fun route (url: String): Boolean {
    val uri = Uri.parse(url)
    val scheme = uri.scheme?.lowercase() ?: return false
    when (scheme) {
      "http", "https" -> return !decided && firstAddress(url)
      "about", "data", "blob", "javascript" -> return false
      "feed", "feeds" -> {
        module.feed(url)
        if (web.url.isNullOrEmpty() || web.url == "about:blank") close()
        return true
      }
      "hyper" -> {
        module.openTab(url)
        close()
        return true
      }
      "intent" -> {
        // A link that names a web page ("open this in Chrome") loads here.
        val intent = try { Intent.parseUri(url, Intent.URI_INTENT_SCHEME) } catch (e: Exception) { null }
        val data = intent?.dataString
        if (data != null && NomadWebViewWindowsModule.isWebScheme(intent.data?.scheme)) {
          web.loadUrl(data)
          return true
        }
        if (!module.openExternal(url)) {
          intent?.getStringExtra("browser_fallback_url")
            ?.takeIf { NomadWebViewWindowsModule.isWebScheme(Uri.parse(it).scheme) }
            ?.let { web.loadUrl(it) }
        }
        return true
      }
      else -> {
        module.openExternal(url)
        return true
      }
    }
  }

  // The window's first address. true when it is the tapped link, which becomes a tab instead.
  private fun firstAddress (url: String): Boolean {
    decided = true
    val link = tappedLink
    if (link != null && sameUrl(url, link)) {
      module.openTab(url)
      close()
      return true
    }
    show()
    return false
  }

  private fun show () {
    if (closed || dialog != null) return
    val d = object : Dialog(activity, if (dark) android.R.style.Theme_Material_NoActionBar else android.R.style.Theme_Material_Light_NoActionBar) {
      @Deprecated("Deprecated in Java")
      override fun onBackPressed () {
        if (web.canGoBack()) web.goBack() else close()
      }
    }
    d.setContentView(layout())
    d.setOnDismissListener { close() }
    d.window?.let { w ->
      w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      w.setWindowAnimations(android.R.style.Animation_InputMethod)
      w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
      w.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(bar))
      // Edge to edge, like the app: the layout pads itself by the bars and the keyboard.
      WindowCompat.setDecorFitsSystemWindows(w, false)
      @Suppress("DEPRECATION")
      w.statusBarColor = Color.TRANSPARENT
      @Suppress("DEPRECATION")
      w.navigationBarColor = Color.TRANSPARENT
      WindowCompat.getInsetsController(w, w.decorView).apply {
        isAppearanceLightStatusBars = !dark
        isAppearanceLightNavigationBars = !dark
      }
    }
    dialog = d
    d.show()
  }

  private fun layout (): View {
    val root = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(bar)
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      v.setPadding(b.left, b.top, b.right, b.bottom)
      WindowInsetsCompat.CONSUMED
    }

    val header = LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(4), 0, dp(16), 0)
    }
    val closeBtn = ImageButton(activity).apply {
      setImageResource(R.drawable.nomad_window_close)
      imageTintList = ColorStateList.valueOf(text)
      contentDescription = "Close"
      background = TypedValue().let { tv ->
        activity.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true)
        activity.getDrawable(tv.resourceId)
      }
      setOnClickListener { close() }
    }
    header.addView(closeBtn, LinearLayout.LayoutParams(dp(48), dp(48)))

    val texts = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(8), 0, 0, 0)
    }
    titleView.apply {
      setTextColor(text)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      isSingleLine = true
      ellipsize = TextUtils.TruncateAt.END
    }
    hostView.apply {
      setTextColor(textMuted)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      isSingleLine = true
      ellipsize = TextUtils.TruncateAt.MIDDLE
    }
    texts.addView(titleView)
    texts.addView(hostView)
    header.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    root.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)))

    progress.apply {
      max = 100
      progressTintList = ColorStateList.valueOf(accent)
      progressBackgroundTintList = ColorStateList.valueOf(border)
    }
    root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)))

    (web.parent as? ViewGroup)?.removeView(web)
    root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    showAddress(web.url)
    return root
  }

  // The bar names the site the window is on, so the user can see where they are signing in.
  private fun showAddress (url: String?) {
    val uri = url?.let { Uri.parse(it) }
    val host = uri?.host
    if (host.isNullOrEmpty()) return
    if (titleView.text.isNullOrEmpty()) titleView.text = host
    if (uri.scheme.equals("https", ignoreCase = true)) {
      hostView.setTextColor(textMuted)
      hostView.text = host
    } else {
      hostView.setTextColor(danger)
      hostView.text = "Not secure · $host"
    }
  }

  private fun dp (v: Int): Int = (v * activity.resources.displayMetrics.density).toInt()

  companion object {
    private fun sameUrl (a: String, b: String): Boolean = a.trimEnd('/') == b.trimEnd('/')
  }
}
