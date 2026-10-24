package io.github.why7726.novastream

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/*
 * NovaStream pour Android
 *
 * La page Nova (l'interface web du serveur choisi) dans une WebView, et un
 * lecteur natif (ExoPlayer, LecteurActivity) pour la vidéo. La page détecte
 * l'application grâce à `window.novaDesktop` — le même objet que l'application
 * Windows — et lui confie la lecture.
 *
 * Sécurité : la page et l'application ne se parlent que par un canal de
 * messages dont l'ORIGINE est vérifiée par la WebView (addWebMessageListener) :
 * seule la page du serveur choisi peut lancer une lecture, et seul l'écran
 * d'accueil livré avec l'application peut changer de serveur.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var racine: FrameLayout
    private var pleinEcranVue: View? = null
    private var choixFichier: ValueCallback<Array<Uri>>? = null

    private val prefs by lazy { getSharedPreferences("nova", MODE_PRIVATE) }
    private val serveur: String? get() = prefs.getString("serveur", null)

    private val assets by lazy {
        WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
    }

    private val ouvrirFichier = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        choixFichier?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        choixFichier = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Plantages.installer(this)
        Plantages.envoyer(this, serveur)   // le plantage précédent, s'il y en a eu un
        racine = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        web = WebView(this).apply { setBackgroundColor(Color.BLACK) }
        racine.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(racine)
        // Android 15 dessine sous les barres système : on garde la page en dehors.
        racine.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString NovaStreamAndroid/${BuildConfigLite.VERSION}"
        }
        CookieManager.getInstance().setAcceptCookie(true)

        installerPasserelle()
        web.webViewClient = Client()
        web.webChromeClient = Chrome()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    pleinEcranVue != null -> (web.webChromeClient as Chrome).onHideCustomView()
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        })

        val s = serveur
        if (s != null) web.loadUrl("$s/") else ouvrirAccueil(null)
        // Pas de réseau et des films sur le téléphone : on va droit à eux.
        if (!Telechargements.enLigne(this) && Telechargements.tous(this).isNotEmpty()) ouvrirTelechargements()
    }

    override fun onResume() {
        super.onResume()
        // Positions de lecture hors ligne → Nova, dès qu'il y a du réseau
        thread { if (Telechargements.enLigne(this)) Telechargements.synchroniser(this) }
    }

    private var listeOuverteLe = 0L
    private fun ouvrirTelechargements() {
        listeOuverteLe = System.currentTimeMillis()
        startActivity(Intent(this, TelechargementsActivity::class.java))
    }

    private fun ouvrirAccueil(message: String?) {
        val q = StringBuilder("?")
        if (message != null) q.append("message=").append(Uri.encode(message)).append('&')
        serveur?.let { q.append("serveur=").append(Uri.encode(it)) }
        web.loadUrl("$ORIGINE_ACCUEIL/assets/accueil.html$q")
    }

    /* ── Passerelle page ↔ application ── */

    private fun installerPasserelle() {
        val origines = mutableSetOf(ORIGINE_ACCUEIL)
        serveur?.let { origines.add(it) }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, PONT_JS, origines)
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(web, "NovaPont", origines) { _, message, origine, principal, reponse ->
            if (!principal) return@addWebMessageListener
            val m = try { JSONObject(message.data ?: "") } catch (_: Exception) { return@addWebMessageListener }
            traiter(m, origine.toString().trimEnd('/'), reponse)
        }
    }

    private fun repondre(reponse: JavaScriptReplyProxy, id: Int, resultat: Any? = null, erreur: String? = null) {
        val o = JSONObject().put("id", id)
        if (erreur != null) o.put("erreur", erreur) else o.put("resultat", resultat ?: JSONObject.NULL)
        runOnUiThread { reponse.postMessage(o.toString()) }
    }

    private fun traiter(m: JSONObject, origine: String, reponse: JavaScriptReplyProxy) {
        val id = m.optInt("id")
        val depuisServeur = serveur != null && origine == serveur
        val depuisAccueil = origine == ORIGINE_ACCUEIL
        when (m.optString("action")) {
            "infos" -> repondre(reponse, id, JSONObject().put("version", BuildConfigLite.VERSION).put("mpv", true).put("serveur", serveur ?: JSONObject.NULL))
            "reglages" -> repondre(reponse, id, JSONObject().put("pleinEcran", true))
            "definir-serveur" -> {
                if (!depuisAccueil) return repondre(reponse, id, erreur = "Refusé")
                val saisie = m.optString("donnees")
                thread {
                    try {
                        val o = verifierServeur(saisie)
                        prefs.edit().putString("serveur", o).apply()
                        repondre(reponse, id, o)
                        // Nouvelle origine autorisée pour la passerelle : on repart de zéro.
                        runOnUiThread { recreate() }
                    } catch (e: Exception) {
                        repondre(reponse, id, erreur = e.message ?: "Erreur")
                    }
                }
            }
            "changer-serveur" -> if (depuisServeur) runOnUiThread { ouvrirAccueil(null) }
            "ouvrir-telechargements" -> if (depuisServeur || depuisAccueil) runOnUiThread { ouvrirTelechargements() }
            "telechargements" -> if (depuisServeur) thread { Telechargements.actualiser(this); repondre(reponse, id, Telechargements.resume(this)) }
            "telecharger" -> {
                if (!depuisServeur) return repondre(reponse, id, erreur = "Refusé")
                val d = m.optJSONObject("donnees") ?: return repondre(reponse, id, erreur = "Refusé")
                val surServeur = { u: String -> try { origineDe(u) == serveur } catch (_: Exception) { false } }
                val mediaId = d.optString("mediaId")
                val qualite = d.optString("qualite")
                val jeton = d.optString("jeton")
                if (!Regex("^[0-9]{1,12}$").matches(mediaId) || qualite !in listOf("original", "1080p", "720p-4", "720p-2", "480p") || jeton.isEmpty() || jeton.length > 4096) {
                    return repondre(reponse, id, erreur = "Refusé")
                }
                // Seules des adresses du serveur choisi (affiche, sous-titres) sont gardées.
                val subs = JSONArray()
                d.optJSONArray("sousTitres")?.let { a -> for (i in 0 until minOf(a.length(), 6)) a.optJSONObject(i)?.takeIf { surServeur(it.optString("url")) }?.let(subs::put) }
                val e = JSONObject()
                    .put("mediaId", mediaId).put("qualite", qualite).put("serveur", serveur).put("jeton", jeton)
                    .put("titre", d.optString("titre").take(200)).put("sousTitre", d.optString("sousTitre").take(200))
                    .put("type", d.optString("type").take(20)).put("dureeMs", d.optLong("dureeMs"))
                    .put("audioStreamId", d.opt("audioStreamId") ?: JSONObject.NULL)
                    .put("aidOriginal", d.optInt("aidOriginal")).put("sidOriginal", d.optInt("sidOriginal"))
                    .put("sousTitres", subs)
                    // Affiche : du serveur, ou de TMDB (jamais une autre adresse)
                    .put("affiche", d.optString("affiche").takeIf { surServeur(it) || it.startsWith("https://image.tmdb.org/") } ?: "")
                    .put("etat", "preparation").put("progression", 0).put("ajouteLe", System.currentTimeMillis())
                thread { Telechargements.ajouter(this, e); repondre(reponse, id, true) }
            }
            "arreter" -> if (depuisServeur) runOnUiThread { Lecture.arretDemande?.invoke() }
            "lire" -> {
                if (!depuisServeur) return repondre(reponse, id, erreur = "Refusé")
                val d = m.optJSONObject("donnees") ?: return repondre(reponse, id, erreur = "Lecture refusée")
                val url = d.optString("url")
                val jeton = d.optString("jeton")
                val surServeur = { u: String -> try { origineDe(u) == serveur } catch (_: Exception) { false } }
                if (!surServeur(url) || jeton.isEmpty() || jeton.length > 4096) return repondre(reponse, id, erreur = "Lecture refusée")
                val subs = mutableListOf<String>()
                d.optJSONArray("sousTitres")?.let { a -> for (i in 0 until minOf(a.length(), 20)) a.optString(i).takeIf(surServeur)?.let(subs::add) }
                Lecture.demande = Demande(
                    url = url, jeton = jeton, titre = d.optString("titre").take(300),
                    debutMs = (d.optDouble("debut", 0.0) * 1000).toLong().coerceAtLeast(0),
                    aid = Lecture.piste(d.opt("aid")), sid = Lecture.piste(d.opt("sid")), sousTitres = subs,
                    aPrecedent = d.optBoolean("aPrecedent"), aSuivant = d.optBoolean("aSuivant"),
                    titreCourt = d.optString("titreCourt").take(200), detail = d.optString("detail").take(200),
                )
                Lecture.surProgression = { p, du, pause ->
                    val o = JSONObject().put("type", "progression").put("donnees", JSONObject().put("position", p).put("duree", du).put("pause", pause))
                    runOnUiThread { reponse.postMessage(o.toString()) }
                }
                Lecture.surFin = { r ->
                    if (r.has("erreur")) repondre(reponse, id, erreur = r.getString("erreur")) else repondre(reponse, id, r)
                }
                runOnUiThread { startActivity(Intent(this, LecteurActivity::class.java)) }
            }
        }
    }

    /** « novastream.exemple.fr » → https://novastream.exemple.fr ; c'est bien un serveur NovaStream ? */
    private fun verifierServeur(saisie: String): String {
        var s = saisie.trim()
        if (s.isEmpty()) throw Exception("Adresse vide")
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(s)) {
            s = (if (Regex("^(localhost|127\\.|192\\.168\\.|10\\.|\\[)").containsMatchIn(s)) "http://" else "https://") + s
        }
        val origine = origineDe(s)
        val texte = try {
            val c = URL("$origine/manifest.webmanifest").openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 8000
            c.inputStream.bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            throw Exception("Aucune réponse de $origine — vérifie l'adresse et que le serveur est allumé.")
        }
        val nom = try { JSONObject(texte).optString("name") } catch (_: Exception) { "" }
        if (!nom.contains("novastream", ignoreCase = true)) throw Exception("$origine répond, mais ce n'est pas un serveur NovaStream.")
        return origine
    }

    private fun origineDe(u: String): String {
        val x = Uri.parse(u)
        val port = if (x.port == -1) "" else ":${x.port}"
        return "${x.scheme}://${x.host}$port"
    }

    /* ── Navigation : uniquement le serveur choisi (et l'accueil local) ── */

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assets.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val o = try { origineDe(request.url.toString()) } catch (_: Exception) { "" }
            if (o == serveur || o == ORIGINE_ACCUEIL) return false
            if (request.url.scheme in listOf("http", "https")) {
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
            }
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && !request.url.toString().startsWith(ORIGINE_ACCUEIL)) {
                ouvrirAccueil("Le serveur ne répond pas (${error.description}).")
                if (Telechargements.tous(this@MainActivity).isNotEmpty() && System.currentTimeMillis() - listeOuverteLe > 10_000) ouvrirTelechargements()
            }
        }
    }

    private inner class Chrome : WebChromeClient() {
        // Avatar : choix d'une image
        override fun onShowFileChooser(view: WebView, rappel: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            choixFichier?.onReceiveValue(null)
            choixFichier = rappel
            return try { ouvrirFichier.launch(params.createIntent()); true } catch (_: Exception) { choixFichier = null; false }
        }

        // Plein écran du lecteur web (séance à plusieurs)
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            pleinEcranVue = view
            racine.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            web.visibility = View.GONE
        }

        override fun onHideCustomView() {
            pleinEcranVue?.let { racine.removeView(it) }
            pleinEcranVue = null
            web.visibility = View.VISIBLE
        }
    }

    companion object {
        /** L'écran d'accueil, servi par l'application elle-même (WebViewAssetLoader). */
        const val ORIGINE_ACCUEIL = "https://appassets.androidplatform.net"

        /* Côté page : `window.novaDesktop`, le même objet que l'application
           Windows, branché sur le canal de messages `NovaPont`. */
        val PONT_JS = """
            (() => {
              if (window.novaDesktop || !window.NovaPont) return;
              const pont = window.NovaPont;
              let n = 0;
              const attente = new Map();
              const abonnes = new Set();
              pont.onmessage = (e) => {
                let m; try { m = JSON.parse(e.data); } catch { return; }
                if (m.type === 'progression') { for (const f of abonnes) { try { f(m.donnees); } catch {} } return; }
                const a = attente.get(m.id); if (!a) return;
                attente.delete(m.id);
                if (m.erreur) a.rej(new Error(m.erreur)); else a.res(m.resultat);
              };
              const appel = (action, donnees) => new Promise((res, rej) => {
                const id = ++n; attente.set(id, { res, rej });
                pont.postMessage(JSON.stringify({ id, action, donnees: donnees === undefined ? null : donnees }));
              });
              window.novaDesktop = {
                plateforme: 'android',
                infos: () => appel('infos'),
                lire: (o) => appel('lire', o),
                arreter: () => appel('arreter'),
                surProgression: (f) => { abonnes.add(f); return () => abonnes.delete(f); },
                reglages: (p) => appel('reglages', p || null),
                changerServeur: () => appel('changer-serveur'),
                definirServeur: (a) => appel('definir-serveur', a),
                telecharger: (o) => appel('telecharger', o),
                telechargements: () => appel('telechargements'),
                ouvrirTelechargements: () => appel('ouvrir-telechargements'),
              };
            })();
        """.trimIndent()
    }
}

/** Version affichée (sans dépendre de la génération de BuildConfig). */
object BuildConfigLite { const val VERSION = "0.3.0" }
