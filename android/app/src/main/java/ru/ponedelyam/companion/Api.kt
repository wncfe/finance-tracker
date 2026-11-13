package ru.ponedelyam.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection

class ApiError(val status: Int, message: String) : Exception(message)
class Api(private val store: Store) {
    companion object {
        fun origin(value: String): String {
            val uri = URI(value.trim())
            require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/")) { "Укажите HTTPS-адрес сервера без пути, например https://example.workers.dev" }
            return uri.toString().trimEnd('/')
        }
    }
    suspend fun request(path: String, body: JSONObject? = null, server: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val state = store.read()
        val base = origin(server ?: state.optString("server"))
        val conn = URL("$base/api/companion/$path").openConnection() as HttpsURLConnection
        try {
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.requestMethod = if (body == null) "GET" else "POST"
            if (server == null) conn.setRequestProperty("Authorization", "Bearer ${state.optString("token")}")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val result = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (status !in 200..299) throw ApiError(status, if(status == 401) "Доступ истёк или отозван. Подключите устройство заново." else result.optString("error", "Сервер недоступен ($status). Повторите позже."))
            result
        } finally { conn.disconnect() }
    }
    suspend fun sync() {
        try {
            val result = request("summary")
            store.update { it.put("summary", result); it.remove("syncError") }
        } catch (e: Exception) {
            store.update { it.put("syncError", if(e is ApiError && e.status == 401) "Подключите заново" else "Нет связи") }
            throw e
        }
    }
    suspend fun submit(): JSONObject {
        store.update { it.put("frozen", true) }
        val s = store.read()
        // Once sent, both ID and exact text survive timeouts, process death and reboot.
        return request("submit", JSONObject().put("operationId", s.getString("operationId")).put("text", s.getString("draft")))
    }
}
