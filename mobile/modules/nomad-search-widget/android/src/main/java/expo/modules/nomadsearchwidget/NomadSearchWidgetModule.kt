package expo.modules.nomadsearchwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app's side of the home screen search widget: it hands the widget the Spaces to show, and
// asks the launcher to add the widget (Settings → Add the search widget).
class NomadSearchWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NomadSearchWidget")

    // { spaces: [{ id, name, color }], active } as JSON (lib/widgetLinks.ts widgetState).
    Function("setSpaces") { json: String ->
      val context = appContext.reactContext ?: return@Function false
      WidgetState.save(context, json)
      NomadSearchWidgetProvider.updateAll(context)
      true
    }

    // Whether this launcher can add a widget for us (Android 8+, and the launcher supports it).
    Function("canPin") {
      val context = appContext.reactContext ?: return@Function false
      AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported
    }

    // The launcher asks the user where to put it. False when it can't.
    Function("requestPin") {
      val context = appContext.reactContext ?: return@Function false
      val manager = AppWidgetManager.getInstance(context)
      if (!manager.isRequestPinAppWidgetSupported) return@Function false
      manager.requestPinAppWidget(ComponentName(context, NomadSearchWidgetProvider::class.java), null, null)
    }

    // How many search widgets are on the home screen.
    Function("count") {
      val context = appContext.reactContext ?: return@Function 0
      AppWidgetManager.getInstance(context)
        .getAppWidgetIds(ComponentName(context, NomadSearchWidgetProvider::class.java)).size
    }
  }
}
