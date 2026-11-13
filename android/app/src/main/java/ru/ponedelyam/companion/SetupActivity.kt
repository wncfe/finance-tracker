package ru.ponedelyam.companion

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

class SetupActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { CompanionTheme {
            val store = store()
            var server by rememberSaveable { mutableStateOf(store.read().optString("server")) }
            var code by remember { mutableStateOf("") }
            var connected by remember { mutableStateOf(store.read().has("token")) }
            var message by remember { mutableStateOf("") }
            var working by remember { mutableStateOf(false) }
            var disconnect by remember { mutableStateOf(false) }
            val scope = rememberCoroutineScope()
            Surface(Modifier.fillMaxSize()) {
                Column(Modifier.padding(24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("По неделям", style = MaterialTheme.typography.headlineMedium)
                    Text("Компаньон для быстрого ввода расходов")
                    Text("В PWA нажмите значок телефона вверху → «Подключить устройство». Введите адрес сервера и одноразовый код. Пароль аккаунта здесь не нужен.")
                    OutlinedTextField(server, {server=it}, label={Text("HTTPS-адрес сервера")}, singleLine=true, enabled=!working && !connected, keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Uri), modifier=Modifier.fillMaxWidth())
                    OutlinedTextField(code, {code=it.trim()}, label={Text("Одноразовый код")}, singleLine=true, enabled=!working, modifier=Modifier.fillMaxWidth())
                    Button(enabled=!working && code.isNotBlank(), onClick={
                        working=true
                        scope.launch {
                            try {
                                val base=Api.origin(server)
                                val request=JSONObject().put("code",code).put("name",android.os.Build.MODEL)
                                store.read().opt("accountId")?.let { request.put("accountId",it) }
                                val result=Api(store).request("exchange",request,base)
                                store.update { it.put("server",base);it.put("token",result.getString("token"));it.put("deviceId",result.getString("deviceId"));it.put("accountId",result.getInt("accountId"));it.remove("syncError") }
                                connected=true;code="";message="Подключено. Добавьте виджет через меню рабочего стола."
                                Sync.now(this@SetupActivity)
                            } catch(e: Exception) {message=e.message?:"Нет связи. Повторите позже."}
                            finally {working=false}
                        }
                    }) {Text(if(working) "Подключаем…" else if(connected) "Обновить доступ" else "Подключить")}
                    if(connected) {
                        Button(onClick={startActivity(Intent(this@SetupActivity,QuickAddActivity::class.java))}) {Text("Добавить расход")}
                        OutlinedButton(onClick={Sync.now(this@SetupActivity);message="Обновление запрошено"}) {Text("Обновить виджет")}
                        TextButton(onClick={disconnect=true}) {Text("Удалить данные с телефона")}
                    }
                    Text(message)
                    Text("Виджет обновляется примерно раз в 30 минут и после отправки. Энергосбережение Xiaomi может задерживать фоновые задачи. При сбое на виджете появится отметка об отсутствии связи.", style=MaterialTheme.typography.bodySmall)
                    Text("Доступ действует 90 дней. Отозвать его можно в PWA в списке устройств. При обновлении доступа используйте тот же аккаунт: сохранённый запрос относится к нему.", style=MaterialTheme.typography.bodySmall)
                }
            }
            if(disconnect) AlertDialog(onDismissRequest={disconnect=false},title={Text("Удалить локальные данные?")},text={Text("Токен, кэш и несохранённый ввод будут удалены. Если ответ сервера потерялся, сначала проверьте очередь в PWA. Отзовите устройство в PWA, чтобы закрыть его серверный доступ.")},confirmButton={TextButton(onClick={
                store.update { for(key in it.keys().asSequence().toList()) it.remove(key) }
                connected=false;server="";disconnect=false
                scope.launch {refreshWidgets(this@SetupActivity)}
            }){Text("Удалить")}},dismissButton={TextButton(onClick={disconnect=false}){Text("Отмена")}})
        } }
    }
}
