package expo.modules.nomadkeyboardinset

import android.content.Context
import android.view.ViewTreeObserver
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// React Native emits keyboardDidShow/Hide only from the activity's root view. A Modal is its own
// Dialog window, and the keyboard opened by an input in it belongs to that window, so JS inside a
// Modal never hears it. The app is edge-to-edge, so the Dialog's adjustResize does nothing either,
// and a bottom sheet's input ends up under the keyboard.
//
// This view reads the keyboard (IME) inset of whatever window it is in, and sends `onInset` with
// `bottom`: how far the keyboard reaches up from the bottom edge of the window, in dp (0 when it
// is closed). Put one inside the Modal; it has no size and draws nothing.
class NomadKeyboardInsetView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onInset by EventDispatcher()
  private var lastBottom = -1f

  // The window's insets reach this view as React Native passes them down the tree untouched. A
  // layout pass follows every insets change too, so read them there as well, in case an ancestor
  // stops the dispatch.
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { readRootInsets() }

  init {
    ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
      report(insets)
      insets
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    readRootInsets()
    ViewCompat.requestApplyInsets(this)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.let { if (it.isAlive) it.removeOnGlobalLayoutListener(layoutListener) }
    lastBottom = -1f
    super.onDetachedFromWindow()
  }

  private fun readRootInsets() {
    ViewCompat.getRootWindowInsets(this)?.let { report(it) }
  }

  private fun report(insets: WindowInsetsCompat) {
    val px = if (insets.isVisible(WindowInsetsCompat.Type.ime())) insets.getInsets(WindowInsetsCompat.Type.ime()).bottom else 0
    val bottom = px / resources.displayMetrics.density
    if (bottom == lastBottom) return
    lastBottom = bottom
    onInset(mapOf("bottom" to bottom))
  }
}
