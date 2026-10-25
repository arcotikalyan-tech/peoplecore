package peoplecore.boldtext

import android.content.res.Configuration
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android's Bold text setting (Settings › Display › Bold text, Android 12+) as the weight it adds to fonts: 300 when
// on, 0 when off. React Native doesn't measure text with it, so the app adds it to every text's weight (src/text.tsx).
class BoldTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PeopleCoreBoldText")

    Function("adjustment") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function 0
      val adjustment = appContext.reactContext?.resources?.configuration?.fontWeightAdjustment ?: 0
      if (adjustment == Configuration.FONT_WEIGHT_ADJUSTMENT_UNDEFINED) 0 else adjustment
    }
  }
}
