package expo.modules.nomadkeyboardinset

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// A view that tells JS how far the keyboard reaches up the screen, inside a Modal too.
// See NomadKeyboardInsetView for why React Native's Keyboard events aren't enough.
class NomadKeyboardInsetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NomadKeyboardInset")

    View(NomadKeyboardInsetView::class) {
      Events("onInset")
    }
  }
}
