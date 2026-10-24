package io.github.why7726.novastream

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/*
 * Étape « préparation » : demande le fichier au serveur dans la qualité choisie,
 * et revient (WorkManager, toutes les 20 s, même application fermée) tant qu'il
 * n'est pas prêt. Ensuite : affiche + sous-titres, puis le gros fichier confié
 * au gestionnaire de téléchargements d'Android (notification, reprise).
 */
class TelechargementWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        val id = inputData.getString("mediaId") ?: return Result.success()
        val e = Telechargements.trouver(ctx, id) ?: return Result.success()
        if (e.optString("etat") != "preparation") return Result.success()
        val serveur = e.optString("serveur")
        val jeton = e.optString("jeton")

        // 1. Le serveur : prêt ? (la demande est sans effet si elle est déjà faite)
        val r: JSONObject
        try {
            val c = URL("$serveur/api/telechargements").openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.doOutput = true
            c.connectTimeout = 15000; c.readTimeout = 30000
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("Authorization", "Bearer $jeton")
            val corps = JSONObject().put("mediaId", id).put("qualite", e.optString("qualite"))
            if (e.has("audioStreamId") && !e.isNull("audioStreamId")) corps.put("audioStreamId", e.get("audioStreamId"))
            c.outputStream.use { it.write(corps.toString().toByteArray()) }
            val code = c.responseCode
            val texte = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code == 401) return echec(id, "Session expirée — reconnecte-toi dans l'application")
            if (code !in 200..299) return echec(id, try { JSONObject(texte).optString("error") } catch (_: Exception) { "" }.ifEmpty { "Refusé par le serveur ($code)" })
            r = JSONObject(texte)
        } catch (_: Exception) {
            return Result.retry()   // réseau : on réessaiera
        }
        when (r.optString("etat")) {
            "erreur" -> return echec(id, r.optString("erreur").ifEmpty { "Préparation impossible" })
            "pret" -> {}
            else -> {
                Telechargements.maj(ctx, id) { it.put("progression", r.optInt("progression")) }
                return Result.retry()
            }
        }

        // 2. Les petits fichiers : affiche et sous-titres
        val dossier = Telechargements.dossierDe(ctx, id)
        e.optString("affiche").takeIf { it.isNotEmpty() }?.let { u ->
            recuperer(u, if (u.startsWith("$serveur/")) jeton else null, File(dossier, "affiche.jpg"))?.let { f -> Telechargements.maj(ctx, id) { it.put("afficheLocale", f.path) } }
        }
        val subs = e.optJSONArray("sousTitres")
        if (subs != null) {
            val locaux = org.json.JSONArray()
            for (i in 0 until subs.length()) {
                val s = subs.getJSONObject(i)
                val f = recuperer(s.optString("url"), jeton, File(dossier, "st-${i + 1}.vtt"), 120_000) ?: continue
                locaux.put(JSONObject().put("chemin", f.path).put("langue", s.optString("langue")).put("defaut", s.optBoolean("defaut")))
            }
            Telechargements.maj(ctx, id) { it.put("sousTitresLocaux", locaux) }
        }

        // 3. Le fichier : gestionnaire de téléchargements d'Android
        val original = r.optBoolean("original")
        val ext = if (original) (r.optString("conteneur").ifEmpty { "mkv" }) else "mp4"
        val demande = DownloadManager.Request(Uri.parse(serveur + r.optString("url")))
            .addRequestHeader("Authorization", "Bearer $jeton")
            .setTitle(e.optString("titre"))
            .setDescription("NovaStream")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_MOVIES, "nova-$id.$ext")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
        val dl = (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(demande)
        Telechargements.maj(ctx, id) {
            it.put("etat", "telechargement").put("downloadId", dl).put("progression", 0)
                .put("original", original)
            if (r.has("taille") && !r.isNull("taille")) it.put("taille", r.optLong("taille"))
        }
        return Result.success()
    }

    private fun echec(id: String, message: String): Result {
        Telechargements.maj(applicationContext, id) { it.put("etat", "erreur").put("erreur", message) }
        return Result.success()
    }

    /** Le jeton ne part QUE vers le serveur Nova (null pour TMDB). */
    private fun recuperer(url: String, jeton: String?, dest: File, delai: Int = 20_000): File? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15000; c.readTimeout = delai
        if (jeton != null) c.setRequestProperty("Authorization", "Bearer $jeton")
        if (c.responseCode in 200..299) { c.inputStream.use { i -> dest.outputStream().use { o -> i.copyTo(o) } }; dest } else null
    } catch (_: Exception) { null }
}
