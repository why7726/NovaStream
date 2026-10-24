package io.github.why7726.novastream

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/*
 * Rapport de plantage : si l'application s'arrête net, l'erreur est notée dans
 * un fichier ; au lancement suivant, elle part dans le journal du serveur Nova
 * (/api/client-error, le même que le site). Aucune donnée personnelle : la
 * pile d'appels, le modèle du téléphone et la version d'Android.
 */
object Plantages {
    private const val FICHIER = "plantage.txt"

    /** Note une erreur rattrapée (lecteur qui refuse de démarrer…) pour le serveur. */
    fun noter(ctx: Context, e: Throwable) {
        try {
            File(ctx.applicationContext.filesDir, FICHIER).writeText(
                "NovaStream Android ${BuildConfigLite.VERSION} · ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\n" +
                    "erreur rattrapée\n" + e.stackTraceToString().take(6000)
            )
        } catch (_: Exception) {}
    }

    @Volatile private var installe = false
    fun installer(ctx: Context) {
        if (installe) return
        installe = true
        val app = ctx.applicationContext
        val precedent = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { fil, e ->
            try {
                File(app.filesDir, FICHIER).writeText(
                    "NovaStream Android ${BuildConfigLite.VERSION} · ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\n" +
                        "fil : ${fil.name}\n" + e.stackTraceToString().take(6000)
                )
            } catch (_: Exception) {}
            precedent?.uncaughtException(fil, e)
        }
    }

    /** Envoie le dernier plantage au serveur, puis l'oublie. */
    fun envoyer(ctx: Context, serveur: String?) {
        val f = File(ctx.filesDir, FICHIER)
        if (serveur == null || !f.exists()) return
        thread {
            try {
                val texte = f.readText()
                val corps = JSONObject()
                    .put("message", "[Android] " + texte.lineSequence().drop(2).firstOrNull().orEmpty().take(280))
                    .put("stack", texte)
                    .put("url", "app-android")
                    .put("userAgent", "NovaStreamAndroid/${BuildConfigLite.VERSION}")
                val c = URL("$serveur/api/client-error").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true
                c.connectTimeout = 8000; c.readTimeout = 8000
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(corps.toString().toByteArray()) }
                if (c.responseCode in 200..299) f.delete()
            } catch (_: Exception) { /* pas de réseau : la prochaine fois */ }
        }
    }
}
