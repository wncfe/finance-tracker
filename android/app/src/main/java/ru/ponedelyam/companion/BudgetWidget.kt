package ru.ponedelyam.companion

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.*
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.*
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.layout.*
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.*
import androidx.glance.unit.ColorProvider
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

private val Ink = Color(0xFF183F36)
private val Muted = Color(0xFF6C8076)
private fun money(value: Long): String = NumberFormat.getNumberInstance(Locale.forLanguageTag("ru-RU")).apply { maximumFractionDigits=2 }.format(value/100.0)+" ₽"

class BudgetWidget : GlanceAppWidget() {
    override val stateDefinition = PreferencesGlanceStateDefinition
    override val sizeMode = SizeMode.Exact
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val version = currentState<Preferences>()[longPreferencesKey("version")] ?: 0L
            val state = remember(version) { runCatching {context.store().read()}.getOrDefault(JSONObject()) }
            Card(state)
        }
    }
    @Composable private fun Card(state: JSONObject) {
        val size = LocalSize.current
        val wide = size.width >= 260.dp && size.height >= 210.dp
        val showToday = size.height >= 135.dp && size.width >= 125.dp
        val data = state.optJSONObject("summary")
        val amount = if(data == null || data.isNull("remaining")) "— ₽" else money(data.optLong("remaining"))
        val amountSize = minOf(if(wide) 34f else 28f, (size.width.value - 24f) / (amount.length * 0.58f)).coerceAtLeast(12f)
        val textStyle = TextStyle(color=ColorProvider(Ink), fontSize=amountSize.sp, fontWeight=FontWeight.Bold, textAlign=TextAlign.Center)
        Column(GlanceModifier.fillMaxSize().background(Color.White).cornerRadius(24.dp).padding(12.dp), horizontalAlignment=Alignment.CenterHorizontally) {
            Text("ОСТАТОК НЕДЕЛИ",style=TextStyle(color=ColorProvider(Muted),fontSize=10.sp,textAlign=TextAlign.Center),maxLines=1,modifier=GlanceModifier.fillMaxWidth().clickable(actionStartActivity<SetupActivity>()))
            Column(GlanceModifier.fillMaxWidth().defaultWeight(),verticalAlignment=Alignment.CenterVertically,horizontalAlignment=Alignment.CenterHorizontally) {
                Text(amount,style=textStyle,maxLines=1,modifier=GlanceModifier.fillMaxWidth())
                if(showToday && data != null && !data.isNull("daysLeft")) {
                    Spacer(GlanceModifier.height(4.dp))
                    Text("До конца недели: ${data.optInt("daysLeft")} дн.",style=TextStyle(color=ColorProvider(Muted),fontSize=10.sp),maxLines=1)
                }
                if(state.has("syncError") || !state.has("token")) {
                    Text(if(!state.has("token")) "Подключите устройство" else state.optString("syncError"),style=TextStyle(color=ColorProvider(Muted),fontSize=9.sp),maxLines=1,modifier=GlanceModifier.clickable(actionStartActivity<SetupActivity>()))
                }
            }
            if(wide) {
                Row(GlanceModifier.fillMaxWidth()) {
                    val categories = data?.optJSONArray("topCategories")
                    for(i in 0..1) {
                        val c = categories?.optJSONObject(i)
                        Column(GlanceModifier.defaultWeight().background(if(i == 0) Color(0xFFEDF4E9) else Color(0xFFF4EEE7)).cornerRadius(16.dp).padding(8.dp)) {
                            Text(c?.optString("name") ?: "Нет расходов",style=TextStyle(color=ColorProvider(Muted),fontSize=11.sp),maxLines=1)
                            Text(money(c?.optLong("amount") ?: 0),style=TextStyle(color=ColorProvider(Ink),fontSize=16.sp,fontWeight=FontWeight.Bold),maxLines=1)
                        }
                        if(i == 0) Spacer(GlanceModifier.width(8.dp))
                    }
                }
                Spacer(GlanceModifier.height(10.dp))
            }
            Row(GlanceModifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Column(GlanceModifier.defaultWeight()) {
                    if(showToday) {
                        Text("Сегодня",style=TextStyle(color=ColorProvider(Muted),fontSize=10.sp),maxLines=1)
                        Text(if(data == null) "— ₽" else money(data.optLong("todaySpent")),style=TextStyle(color=ColorProvider(Ink),fontSize=15.sp),maxLines=1)
                    }
                }
                Box(GlanceModifier.size(if(showToday) 42.dp else 32.dp).background(Ink).cornerRadius(30.dp).clickable(if(state.has("token")) actionStartActivity<QuickAddActivity>() else actionStartActivity<SetupActivity>()),contentAlignment=Alignment.Center) {
                    Text("+",style=TextStyle(color=ColorProvider(Color.White),fontSize=26.sp),modifier=GlanceModifier.semantics {contentDescription="Добавить расход"})
                }
            }
        }
    }
}
suspend fun refreshWidgets(context: Context) {
    for(id in GlanceAppWidgetManager(context).getGlanceIds(BudgetWidget::class.java)) {
        // Only an invalidation counter enters Glance preferences; finances stay encrypted.
        updateAppWidgetState(context,id) { it[longPreferencesKey("version")] = System.nanoTime() }
        BudgetWidget().update(context,id)
    }
}
class BudgetWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = BudgetWidget()
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context,appWidgetManager,appWidgetIds)
        Sync.schedule(context)
        Sync.now(context)
    }
}
