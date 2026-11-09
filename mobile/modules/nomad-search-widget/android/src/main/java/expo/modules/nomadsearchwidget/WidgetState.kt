package expo.modules.nomadsearchwidget

import android.content.Context
import android.graphics.Color
import org.json.JSONObject

// What the widget shows: the user's Spaces and which one is active. The app writes it each time
// they change (lib/searchWidget.ts → NomadSearchWidgetModule.setSpaces); the widget only reads it,
// so it draws the right Spaces even while the app isn't running.
data class WidgetSpace(val id: String, val name: String, val color: Int)

data class WidgetState(val spaces: List<WidgetSpace>, val activeId: String?) {
  val active: WidgetSpace? get() = spaces.firstOrNull { it.id == activeId } ?: spaces.firstOrNull()

  companion object {
    private const val PREFS = "nomad_search_widget"
    private const val KEY = "state"
    private val FALLBACK_COLOR = Color.parseColor("#1d59c7")

    fun load(context: Context): WidgetState =
      parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null))

    fun save(context: Context, json: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    }

    fun parse(json: String?): WidgetState {
      if (json.isNullOrEmpty()) return WidgetState(emptyList(), null)
      return try {
        val obj = JSONObject(json)
        val list = obj.optJSONArray("spaces")
        val spaces = mutableListOf<WidgetSpace>()
        if (list != null) {
          for (i in 0 until list.length()) {
            val sp = list.optJSONObject(i) ?: continue
            val id = sp.optString("id")
            if (id.isEmpty()) continue
            val color = try { Color.parseColor(sp.optString("color")) } catch (_: Exception) { FALLBACK_COLOR }
            spaces.add(WidgetSpace(id, sp.optString("name").ifEmpty { "Space" }, color))
          }
        }
        WidgetState(spaces, obj.optString("active").ifEmpty { null })
      } catch (_: Exception) {
        WidgetState(emptyList(), null)
      }
    }
  }
}
