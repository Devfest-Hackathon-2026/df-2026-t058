// 集中の間だけ動く見張り（前面のサービス）。1 秒ごとに前面のアプリを見て、通すアプリ以外なら小さな画面を重ねる。
// 閉じ込めない: 重ねる画面は端まで覆わず、キー入力も奪わない（ホーム・戻る・通知は使える）。「戻る」「集中をやめる」は常に押せる。
// 解除: stop・アプリのタスクを消した時・サービスが落ちた時（START_NOT_STICKY＝自動で再起動しない）。
package expo.modules.focuslock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.telecom.TelecomManager
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

class FocusLockService : Service() {
  companion object {
    const val EXTRA_ALLOW = "allow"
    private const val CHANNEL = "focus_lock"
    private const val NOTIFICATION_ID = 3001
    private const val TICK_MS = 1000L

    @Volatile var onQuit: (() -> Unit)? = null

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, FocusLockService::class.java))
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var allow: Set<String> = emptySet()
  private var lastForeground: String? = null
  private var overlay: View? = null
  private var title = "集中中です。続けますか？"
  private var back = "戻る"
  private var quit = "集中をやめる"
  private var notice = "集中中です"

  private val tick = object : Runnable {
    override fun run() {
      try {
        check()
      } catch (e: Exception) {
        hideOverlay() // 見張りが失敗したら、重ねない側に倒す
      }
      handler.postDelayed(this, TICK_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // システムによる再起動（intent が null）では動かない＝残さない
    if (intent == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    intent.getStringExtra("title")?.let { title = it }
    intent.getStringExtra("back")?.let { back = it }
    intent.getStringExtra("quit")?.let { quit = it }
    intent.getStringExtra("notice")?.let { notice = it }
    allow = (intent.getStringArrayListExtra(EXTRA_ALLOW) ?: arrayListOf()).toSet() + alwaysAllowed()
    startForegroundCompat()
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_NOT_STICKY
  }

  // 一覧に無い機種でも通す: 自分・既定の電話・既定のホーム
  private fun alwaysAllowed(): Set<String> {
    val out = mutableSetOf(packageName, "com.android.systemui")
    try {
      (getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)?.defaultDialerPackage?.let { out.add(it) }
    } catch (e: Exception) {
    }
    val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.let { out.add(it) }
    return out
  }

  // アプリのタスクを消した（強制終了・最近のアプリから払った）時は解除
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    hideOverlay()
    super.onDestroy()
  }

  private fun check() {
    val pkg = currentForeground() ?: return
    if (pkg in allow) hideOverlay() else showOverlay()
  }

  // 直近 10 秒の「前に出た」記録のうち最後のもの。記録が無ければ前回の値
  // MOVE_TO_FOREGROUND は API 29 で ACTIVITY_RESUMED に名前が変わった（値は同じ 1）
  @Suppress("DEPRECATION")
  private fun currentForeground(): String? {
    val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now = System.currentTimeMillis()
    val events = usm.queryEvents(now - 10_000, now)
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      if (e.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) lastForeground = e.packageName
    }
    return lastForeground
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  @Suppress("DEPRECATION")
  private fun showOverlay() {
    if (overlay != null) return
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(24), dp(24), dp(24), dp(24))
      background = GradientDrawable().apply {
        setColor(0xFFFFFFFF.toInt())
        cornerRadius = dp(20).toFloat()
      }
    }
    val img = resources.getIdentifier("focus_lock_mascot", "drawable", packageName)
    card.addView(ImageView(this).apply {
      setImageResource(if (img != 0) img else applicationInfo.icon)
      adjustViewBounds = true
    }, LinearLayout.LayoutParams(dp(96), dp(96)))
    card.addView(TextView(this).apply {
      text = title
      textSize = 18f
      setTextColor(0xFF222222.toInt())
      gravity = Gravity.CENTER
      setPadding(0, dp(12), 0, dp(16))
    })
    card.addView(Button(this).apply {
      text = back
      setOnClickListener { backToApp() }
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    card.addView(Button(this).apply {
      text = quit
      setOnClickListener { quitFocus() }
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      WindowManager.LayoutParams.TYPE_PHONE
    }
    // 画面の幅の 85%・中央・高さは中身なり。NOT_FOCUSABLE でキー（ホーム・戻る）を奪わない
    val lp = WindowManager.LayoutParams(
      (resources.displayMetrics.widthPixels * 0.85).toInt(),
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_DIM_BEHIND,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.CENTER
      dimAmount = 0.5f
    }
    try {
      wm.addView(card, lp)
      overlay = card
    } catch (e: Exception) {
      overlay = null // 重ねられない（許可を外した等）時は何もしない
    }
  }

  private fun hideOverlay() {
    val v = overlay ?: return
    overlay = null
    try {
      (getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(v)
    } catch (e: Exception) {
    }
  }

  private fun openApp() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    try {
      startActivity(launch)
    } catch (e: Exception) {
    }
  }

  // 「戻る」: モル塔を前に出す（見張りは続ける）
  private fun backToApp() {
    hideOverlay()
    lastForeground = packageName
    openApp()
  }

  // 「集中をやめる」: 見張りを止め、モル塔を前に出して「終える」の確かめへ
  private fun quitFocus() {
    hideOverlay()
    onQuit?.invoke()
    openApp()
    stopSelf()
  }

  @Suppress("DEPRECATION")
  private fun startForegroundCompat() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, notice, NotificationManager.IMPORTANCE_LOW))
      Notification.Builder(this, CHANNEL)
    } else {
      Notification.Builder(this)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val tap = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE) }
    val n = builder
      .setContentTitle(notice)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .apply { if (tap != null) setContentIntent(tap) }
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, n)
    }
  }
}
