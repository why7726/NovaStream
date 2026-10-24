package io.github.why7726.novastream

import android.app.DownloadManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/*
 * Téléchargements pour regarder hors ligne.
 *
 * Chaque titre passe par trois étapes :
 *   « preparation »    le serveur prépare le fichier (qualité réduite) — TelechargementWorker attend ;
 *   « telechargement » le gestionnaire de téléchargements d'Android le récupère (notification, reprise) ;
 *   « pret »           lisible sans connexion, depuis la mémoire du téléphone.
 *
 * La liste vit dans un petit fichier JSON, privé à l'application. La position
 * de lecture hors ligne est renvoyée à Nova dès que la connexion revient.
 */
object Telechargements {
    private const val FICHIER = "telechargements.json"
    private val verrou = Any()

    fun tous(ctx: Context): List<JSONObject> = synchronized(verrou) {
        val f = File(ctx.filesDir, FICHIER)
        if (!f.exists()) return emptyList()
        return try { JSONArray(f.readText()).let { a -> (0 until a.length()).map { a.getJSONObject(it) } } } catch (_: Exception) { emptyList() }
    }

    private fun ecrire(ctx: Context, liste: List<JSONObject>) {
        synchronized(verrou) {
            val f = File(ctx.filesDir, FICHIER)
            val tmp = File(ctx.filesDir, "$FICHIER.tmp")
            tmp.writeText(JSONArray(liste).toString())
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        }
    }

    fun trouver(ctx: Context, id: String) = tous(ctx).firstOrNull { it.optString("mediaId") == id }

    /** Modifie un titre (lecture → changement → écriture, sous verrou). */
    fun maj(ctx: Context, id: String, f: (JSONObject) -> Unit) {
        synchronized(verrou) {
            val liste = tous(ctx)
            liste.firstOrNull { it.optString("mediaId") == id }?.let(f)
            ecrire(ctx, liste)
        }
    }

    fun ajouter(ctx: Context, e: JSONObject): Unit = synchronized(verrou) {
        val liste = tous(ctx).filter { it.optString("mediaId") != e.optString("mediaId") }.toMutableList()
        liste.add(0, e)
        ecrire(ctx, liste)
        lancerTravail(ctx, e.optString("mediaId"))
    }

    fun supprimer(ctx: Context, id: String): Unit = synchronized(verrou) {
        val e = trouver(ctx, id) ?: return@synchronized
        WorkManager.getInstance(ctx).cancelUniqueWork("telechargement-$id")
        val dl = e.optLong("downloadId", -1)
        if (dl >= 0) (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).remove(dl)
        e.optString("fichier").takeIf { it.isNotEmpty() }?.let { File(it).delete() }
        dossierDe(ctx, id).deleteRecursively()
        ecrire(ctx, tous(ctx).filter { it.optString("mediaId") != id })
    }

    fun dossierDe(ctx: Context, id: String) = File(ctx.filesDir, "nova/$id").apply { mkdirs() }

    fun lancerTravail(ctx: Context, id: String) {
        val travail = OneTimeWorkRequestBuilder<TelechargementWorker>()
            .setInputData(workDataOf("mediaId" to id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.LINEAR, 20, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("telechargement-$id", ExistingWorkPolicy.REPLACE, travail)
    }

    /** Met à jour l'avancement depuis le gestionnaire de téléchargements d'Android. */
    fun actualiser(ctx: Context) {
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        for (e in tous(ctx).filter { it.optString("etat") == "telechargement" }) {
            val id = e.optString("mediaId")
            val dl = e.optLong("downloadId", -1)
            if (dl < 0) continue
            dm.query(DownloadManager.Query().setFilterById(dl))?.use { c ->
                if (!c.moveToFirst()) { maj(ctx, id) { it.put("etat", "erreur").put("erreur", "Téléchargement interrompu") }; return@use }
                val statut = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val fait = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                val local = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
                maj(ctx, id) {
                    when (statut) {
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            it.put("etat", "pret").put("progression", 100)
                            Uri.parse(local ?: "").path?.let { p -> it.put("fichier", p) }
                            if (total > 0) it.put("taille", total)
                        }
                        DownloadManager.STATUS_FAILED -> it.put("etat", "erreur").put("erreur", "Téléchargement échoué")
                        else -> if (total > 0) it.put("progression", (fait * 100 / total).toInt()).put("taille", total)
                    }
                }
            }
        }
    }

    fun enLigne(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Positions de lecture hors ligne → Nova, dès qu'on a du réseau. */
    fun synchroniser(ctx: Context) {
        for (e in tous(ctx).filter { it.optBoolean("aSynchroniser") }) {
            try {
                val corps = JSONObject()
                    .put("mediaId", e.optString("mediaId"))
                    .put("currentTime", e.optLong("positionMs") / 1000.0)
                    .put("duration", e.optLong("dureeMs") / 1000.0)
                    .put("mediaTitle", e.optString("titre"))
                    .put("mediaType", e.optString("type"))
                val c = URL("${e.optString("serveur")}/api/progress").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true
                c.connectTimeout = 8000; c.readTimeout = 8000
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("Authorization", "Bearer ${e.optString("jeton")}")
                c.outputStream.use { it.write(corps.toString().toByteArray()) }
                if (c.responseCode in 200..299) maj(ctx, e.optString("mediaId")) { it.put("aSynchroniser", false) }
            } catch (_: Exception) { /* pas de réseau : la prochaine fois */ }
        }
    }

    /** Résumé pour la page Nova (boutons « déjà téléchargé »). */
    fun resume(ctx: Context): JSONArray = JSONArray().apply {
        for (e in tous(ctx)) put(JSONObject().put("mediaId", e.optString("mediaId")).put("etat", e.optString("etat")).put("progression", e.optInt("progression")))
    }
}
