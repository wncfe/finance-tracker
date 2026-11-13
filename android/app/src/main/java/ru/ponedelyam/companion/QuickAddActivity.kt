package ru.ponedelyam.companion

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Green = Color(0xFF183F36)
@Composable fun CompanionTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = lightColorScheme(primary = Green, surface = Color.White, background = Color(0xFFE8EEE8)), content = content)

class QuickAddActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        setContent {
            CompanionTheme {
                val store = store()
                var text by remember { mutableStateOf(store.read().optString("draft")) }
                var frozen by remember { mutableStateOf(store.read().optBoolean("frozen")) }
                var sending by remember { mutableStateOf(false) }
                var error by remember { mutableStateOf("") }
                val scope = rememberCoroutineScope()
                val focus = remember { FocusRequester() }
                val keyboard = LocalSoftwareKeyboardController.current
                val connected = store.read().has("token")
                fun submit() {
                    if(sending || text.isBlank() || !connected) return
                    sending = true
                    error = ""
                    scope.launch {
                        try {
                            store.draft(text)
                            frozen = true
                            val result = Api(store).submit()
                            val summary = result.optJSONObject("summary")
                            if(summary != null) store.update { it.put("summary",summary);it.remove("syncError") }
                            store.clearDraft()
                            // Saving succeeded; a widget refresh failure must never turn this into a new submission.
                            runCatching { Sync.now(this@QuickAddActivity);refreshWidgets(this@QuickAddActivity) }
                            Toast.makeText(this@QuickAddActivity, if(result.optString("status") == "confirmed") "Расход добавлен" else "Этот запрос уже был отправлен в старую очередь", Toast.LENGTH_SHORT).show()
                            finish()
                        } catch(e: Exception) {
                            if(e is kotlinx.coroutines.CancellationException) throw e
                            error = if(e is ApiError) e.message.orEmpty() else "Нет связи. Текст сохранён. Повторите отправку — дубликата не будет."
                            if(e is ApiError && e.status == 400) {
                                store.update { it.remove("frozen"); it.remove("operationId") }
                                frozen = false
                            }
                        } finally { sending = false }
                    }
                }
                Surface(shape = RoundedCornerShape(28.dp)) {
                    Column(Modifier.padding(22.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Записать расход", style = MaterialTheme.typography.titleLarge)
                        OutlinedTextField(value = text, onValueChange = { if(it.length <= 4000) {text = it; store.draft(it)} },
                            label = { Text("Кофе 250; такси 430") }, readOnly = frozen, enabled = !sending,
                            modifier = Modifier.fillMaxWidth().focusRequester(focus), maxLines = 4,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { submit() }))
                        Text("Сохранится сразу. Несколько расходов — через точку с запятой. Неизвестная категория попадёт в «Другое».", style = MaterialTheme.typography.bodySmall)
                        if(frozen) Text("Проверяем отправку. Текст закреплён до получения ответа.", style = MaterialTheme.typography.bodySmall)
                        if(error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
                        if(!connected || error.contains("Подключите")) TextButton(onClick = {startActivity(Intent(this@QuickAddActivity, SetupActivity::class.java));finish()}) {Text("Подключить устройство")}
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { finish() }) { Text("Закрыть") }
                            Button(onClick = { submit() }, enabled = connected && text.isNotBlank() && !sending) {
                                if(sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                                else Text(if(frozen) "Повторить" else "Добавить")
                            }
                        }
                    }
                }
                LaunchedEffect(Unit) { delay(150); if(!frozen) {focus.requestFocus(); keyboard?.show()} }
            }
        }
    }
}
