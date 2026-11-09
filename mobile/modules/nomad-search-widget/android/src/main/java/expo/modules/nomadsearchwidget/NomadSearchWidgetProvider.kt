package expo.modules.nomadsearchwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews

// The home screen search widget: the app's address bar on the home screen. A tap opens Nomad on a
// new tab with the keyboard up; the Space chip opens the Space switcher; the robot opens the AI.
// Two rows tall, it adds a chip for each Space, and a tap searches in that Space.
//
// Every tap opens the app's own activity with a nomad-widget:// link (explicitly, so no other app
// can take it and no other app can send one). The app reads it with Linking (lib/widgetLinks.ts).
class NomadSearchWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) update(context, manager, id)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    update(context, manager, id)
  }

  companion object {
    private const val SCHEME = "nomad-widget"
    // Taller than this (dp), the widget has room for the row of Space chips.
    private const val TALL_DP = 100f
    // Each chip: the chip, its dot, its name, and its name as the active Space's (a second view
    // with the active color in its layout, so no color is set from here: one set from here would
    // stay the old theme's after the phone switches between light and dark).
    private data class Chip(val chip: Int, val dot: Int, val name: Int, val activeName: Int)
    private val CHIPS = listOf(
      Chip(R.id.nomad_widget_chip0, R.id.nomad_widget_chip0_dot, R.id.nomad_widget_chip0_name, R.id.nomad_widget_chip0_name_active),
      Chip(R.id.nomad_widget_chip1, R.id.nomad_widget_chip1_dot, R.id.nomad_widget_chip1_name, R.id.nomad_widget_chip1_name_active),
      Chip(R.id.nomad_widget_chip2, R.id.nomad_widget_chip2_dot, R.id.nomad_widget_chip2_name, R.id.nomad_widget_chip2_name_active),
      Chip(R.id.nomad_widget_chip3, R.id.nomad_widget_chip3_dot, R.id.nomad_widget_chip3_name, R.id.nomad_widget_chip3_name_active)
    )

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, NomadSearchWidgetProvider::class.java))
      for (id in ids) update(context, manager, id)
    }

    fun update(context: Context, manager: AppWidgetManager, id: Int) {
      val state = WidgetState.load(context)
      val views = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // The launcher picks the biggest layout that fits as the widget is resized.
        RemoteViews(mapOf(
          SizeF(180f, 40f) to build(context, state, tall = false),
          SizeF(180f, TALL_DP) to build(context, state, tall = true)
        ))
      } else {
        val height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
        build(context, state, tall = height >= TALL_DP)
      }
      manager.updateAppWidget(id, views)
    }

    private fun build(context: Context, state: WidgetState, tall: Boolean): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.nomad_search_widget)
      views.setOnClickPendingIntent(R.id.nomad_widget_bar, link(context, "search"))
      views.setOnClickPendingIntent(R.id.nomad_widget_ai, link(context, "ai"))

      // The Space a search opens in. In the tall layout the chips below show it instead.
      val active = state.active
      if (active != null && !tall) {
        views.setViewVisibility(R.id.nomad_widget_space, View.VISIBLE)
        views.setInt(R.id.nomad_widget_space_dot, "setColorFilter", active.color)
        views.setTextViewText(R.id.nomad_widget_space_name, active.name)
        views.setContentDescription(R.id.nomad_widget_space, "Space: ${active.name}. Switch space")
        views.setOnClickPendingIntent(R.id.nomad_widget_space, link(context, "spaces"))
      } else {
        views.setViewVisibility(R.id.nomad_widget_space, View.GONE)
      }

      if (!tall || state.spaces.isEmpty()) {
        views.setViewVisibility(R.id.nomad_widget_chips, View.GONE)
        return views
      }
      views.setViewVisibility(R.id.nomad_widget_chips, View.VISIBLE)
      // Four chips fit; with more Spaces the last one opens the switcher.
      val overflow = state.spaces.size > CHIPS.size
      val shown = if (overflow) state.spaces.take(CHIPS.size - 1) else state.spaces
      CHIPS.forEachIndexed { i, c ->
        val sp = shown.getOrNull(i)
        when {
          sp != null -> {
            val isActive = sp.id == active?.id
            views.setViewVisibility(c.chip, View.VISIBLE)
            views.setViewVisibility(c.dot, View.VISIBLE)
            views.setInt(c.dot, "setColorFilter", sp.color)
            views.setTextViewText(c.name, sp.name)
            views.setTextViewText(c.activeName, sp.name)
            views.setViewVisibility(c.name, if (isActive) View.GONE else View.VISIBLE)
            views.setViewVisibility(c.activeName, if (isActive) View.VISIBLE else View.GONE)
            views.setInt(c.chip, "setBackgroundResource", if (isActive) R.drawable.nomad_widget_chip_active else R.drawable.nomad_widget_chip)
            views.setContentDescription(c.chip, "Search in ${sp.name}")
            views.setOnClickPendingIntent(c.chip, link(context, "search", sp.id))
          }
          overflow && i == CHIPS.size - 1 -> {
            views.setViewVisibility(c.chip, View.VISIBLE)
            views.setViewVisibility(c.dot, View.GONE)
            views.setTextViewText(c.name, context.getString(R.string.nomad_widget_more))
            views.setViewVisibility(c.name, View.VISIBLE)
            views.setViewVisibility(c.activeName, View.GONE)
            views.setInt(c.chip, "setBackgroundResource", R.drawable.nomad_widget_chip)
            views.setContentDescription(c.chip, context.getString(R.string.nomad_widget_switch_space))
            views.setOnClickPendingIntent(c.chip, link(context, "spaces"))
          }
          // An unused chip takes no room, so the others can show their whole names.
          else -> views.setViewVisibility(c.chip, View.GONE)
        }
      }
      return views
    }

    // nomad-widget://search, nomad-widget://search?space=<id>, nomad-widget://ai, nomad-widget://spaces
    private fun link(context: Context, action: String, space: String? = null): PendingIntent {
      val uri = Uri.Builder().scheme(SCHEME).authority(action).apply {
        if (space != null) appendQueryParameter("space", space)
      }.build()
      val intent = (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent())
        .setAction(Intent.ACTION_VIEW)
        .setData(uri)
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      intent.removeCategory(Intent.CATEGORY_LAUNCHER)
      return PendingIntent.getActivity(
        context,
        uri.toString().hashCode(),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    }
  }
}
