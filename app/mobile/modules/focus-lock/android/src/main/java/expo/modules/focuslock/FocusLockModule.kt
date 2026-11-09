// JS への窓口（lib/focusLock.ts の NativeFocusLock と同じ形）。見張りは FocusLockService が行う
package expo.modules.focuslock

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// JS の start({ allow, title, back, quit, notice })
class StartOptions : Record {
  @Field val allow: List<String> = emptyList()
  @Field val title: String = "集中中です。続けますか？"
  @Field val back: String = "戻る"
  @Field val quit: String = "集中をやめる"
  @Field val notice: String = "集中中です"
}

class FocusLockModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("no context")

  override fun definition() = ModuleDefinition {
    Name("FocusLock")
    Events("onQuit")

    OnCreate {
      FocusLockService.onQuit = { sendEvent("onQuit", emptyMap<String, Any>()) }
    }

    // JS が作り直された・アプリが閉じた時は、必ず解除する
    OnDestroy {
      FocusLockService.onQuit = null
      appContext.reactContext?.let { FocusLockService.stop(it) }
    }

    Function("hasPermissions") {
      mapOf("usage" to hasUsageAccess(context), "overlay" to Settings.canDrawOverlays(context))
    }

    Function("openUsageSettings") {
      context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("openOverlaySettings") {
      val uri = Uri.parse("package:" + context.packageName)
      context.startActivity(
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    Function("start") { opts: StartOptions ->
      val ctx = context
      // 許可が無い時は始めない（エラーにしない）
      val ok = hasUsageAccess(ctx) && Settings.canDrawOverlays(ctx)
      if (ok) {
        val intent = Intent(ctx, FocusLockService::class.java)
          .putStringArrayListExtra(FocusLockService.EXTRA_ALLOW, ArrayList(opts.allow))
          .putExtra("title", opts.title)
          .putExtra("back", opts.back)
          .putExtra("quit", opts.quit)
          .putExtra("notice", opts.notice)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
      }
      ok
    }

    Function("stop") {
      FocusLockService.stop(context)
    }
  }

  @Suppress("DEPRECATION")
  private fun hasUsageAccess(ctx: Context): Boolean {
    val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    } else {
      ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }
}
