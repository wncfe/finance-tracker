package ru.ponedelyam.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Tokens, draft and financial cache are encrypted; backups are disabled in the manifest.
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("companion", Context.MODE_PRIVATE)
    private val key: SecretKey
        get() {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            return (ks.getKey("finance-companion-v1", null) as? SecretKey) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder("finance-companion-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            }.generateKey()
        }
    @Synchronized fun read(): JSONObject {
        val encoded = prefs.getString("state", null) ?: return JSONObject()
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }
    @Synchronized fun update(change: (JSONObject) -> Unit) {
        val state = read().also(change)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        val bytes = cipher.iv + cipher.doFinal(state.toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("state", Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) { "Не удалось сохранить данные на телефоне" }
    }
    fun draft(text: String) = update { it.put("draft", text); if (!it.has("operationId")) it.put("operationId", UUID.randomUUID().toString()) }
    fun clearDraft() = update { it.remove("draft"); it.remove("operationId"); it.remove("frozen") }
}
