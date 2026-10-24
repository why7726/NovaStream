package io.github.why7726.novastream

import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/*
 * « Téléchargements » : la liste des titres enregistrés sur le téléphone.
 * Écran natif (pas la page web) : il fonctionne SANS connexion.
 */
class TelechargementsActivity : ComponentActivity() {

    private lateinit var liste: LinearLayout
    private lateinit var entete: TextView
    private val minuteur = Handler(Looper.getMainLooper())
    private val rafraichir = object : Runnable {
        override fun run() { afficher(); minuteur.postDelayed(this, 2500) }
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val racine = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            setPadding(dp(18), dp(14), dp(18), dp(10))
        }
        racine.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(dp(18) + b.left, dp(14) + b.top, dp(18) + b.right, dp(10) + b.bottom)
            }
            insets
        }
        val barre = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        barre.addView(TextView(this).apply {
            text = "Téléchargements"; setTextColor(Color.WHITE); textSize = 24f; typeface = Typeface.DEFAULT_BOLD
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        barre.addView(bouton("Nova", plein = false) { retourNova() })
        racine.addView(barre)
        entete = TextView(this).apply { setTextColor(Color.argb(120, 255, 255, 255)); textSize = 13f; setPadding(0, dp(4), 0, dp(14)) }
        racine.addView(entete)
        liste = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        racine.addView(ScrollView(this).apply { addView(liste) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(racine)
    }

    override fun onResume() {
        super.onResume()
        thread { Telechargements.actualiser(this); if (Telechargements.enLigne(this)) Telechargements.synchroniser(this) }
        minuteur.post(rafraichir)
    }

    override fun onPause() { super.onPause(); minuteur.removeCallbacks(rafraichir) }

    private fun retourNova() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }

    private fun afficher() {
        thread { Telechargements.actualiser(this) }
        val tous = Telechargements.tous(this)
        entete.text = (if (Telechargements.enLigne(this)) "En ligne" else "Hors ligne — tes téléchargements restent lisibles") +
            (if (tous.isNotEmpty()) " · ${tous.size} titre${if (tous.size > 1) "s" else ""}" else "")
        liste.removeAllViews()
        if (tous.isEmpty()) {
            liste.addView(TextView(this).apply {
                text = "Rien de téléchargé pour l'instant.\n\nSur la fiche d'un film ou d'un épisode, touche l'icône de téléchargement et choisis la qualité."
                setTextColor(Color.argb(150, 255, 255, 255)); textSize = 14.5f; setPadding(0, dp(30), 0, 0)
            })
            return
        }
        for (e in tous) liste.addView(ligne(e))
    }

    private fun ligne(e: JSONObject): View {
        val id = e.optString("mediaId")
        val etat = e.optString("etat")
        val l = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, dp(10))
            gravity = Gravity.CENTER_VERTICAL
        }
        val image = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(Color.rgb(28, 28, 30)) }
            clipToOutline = true
            e.optString("afficheLocale").takeIf { it.isNotEmpty() && File(it).exists() }?.let { setImageBitmap(BitmapFactory.decodeFile(it)) }
        }
        l.addView(image, LinearLayout.LayoutParams(dp(62), dp(92)))

        val textes = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, dp(8), 0) }
        textes.addView(TextView(this).apply { text = e.optString("titre"); setTextColor(Color.WHITE); textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD; maxLines = 2 })
        e.optString("sousTitre").takeIf { it.isNotEmpty() }?.let { s ->
            textes.addView(TextView(this).apply { text = s; setTextColor(Color.argb(140, 255, 255, 255)); textSize = 12.5f })
        }
        val taille = e.optLong("taille", 0)
        val detail = when (etat) {
            "preparation" -> "Préparation sur le serveur… ${e.optInt("progression")} %"
            "telechargement" -> "Téléchargement… ${e.optInt("progression")} %"
            "pret" -> listOfNotNull(libelleQualite(e.optString("qualite")), taille.takeIf { it > 0 }?.let { enGo(it) },
                e.optLong("positionMs").takeIf { it > 0 }?.let { "repris à ${minutes(it)}" }).joinToString(" · ")
            else -> e.optString("erreur").ifEmpty { "Erreur" }
        }
        textes.addView(TextView(this).apply {
            text = detail; textSize = 12.5f; setPadding(0, dp(4), 0, 0)
            setTextColor(if (etat == "erreur") Color.rgb(252, 165, 165) else Color.argb(120, 255, 255, 255))
        })
        if (etat == "preparation" || etat == "telechargement") {
            textes.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 100; progress = e.optInt("progression"); setPadding(0, dp(6), 0, 0)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(14)))
        }
        l.addView(textes, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
        if (etat == "pret") actions.addView(bouton("Lire", plein = true) { lire(e) })
        if (etat == "erreur") actions.addView(bouton("Réessayer", plein = true) {
            Telechargements.maj(this, id) { it.put("etat", "preparation").put("erreur", "").put("progression", 0) }
            Telechargements.lancerTravail(this, id); afficher()
        })
        actions.addView(bouton("Supprimer", plein = false) { thread { Telechargements.supprimer(this, id); runOnUiThread { afficher() } } })
        l.addView(actions)
        return l
    }

    private fun lire(e: JSONObject) {
        val fichier = File(e.optString("fichier"))
        if (!fichier.exists()) {
            Telechargements.maj(this, e.optString("mediaId")) { it.put("etat", "erreur").put("erreur", "Fichier introuvable sur le téléphone") }
            afficher(); return
        }
        val original = e.optBoolean("original")
        val locaux = e.optJSONArray("sousTitresLocaux")
        val subs = mutableListOf<String>()
        var sid = 0
        if (locaux != null) for (i in 0 until locaux.length()) {
            val s = locaux.getJSONObject(i)
            val f = File(s.optString("chemin"))
            if (!f.exists()) continue
            subs.add(Uri.fromFile(f).toString())
            if (s.optBoolean("defaut") && sid == 0) sid = subs.size
        }
        Lecture.demande = Demande(
            url = Uri.fromFile(fichier).toString(), jeton = "", titre = e.optString("titre"),
            debutMs = e.optLong("positionMs").takeIf { it < e.optLong("dureeMs") - 30_000 } ?: 0,
            aid = if (original) e.optInt("aidOriginal").takeIf { it > 0 } else null,
            sid = if (original) e.optInt("sidOriginal") else sid,
            sousTitres = subs,
        )
        val id = e.optString("mediaId")
        Lecture.surProgression = { p, d, _ -> Telechargements.maj(this, id) { it.put("positionMs", (p * 1000).toLong()).put("dureeMs", (d * 1000).toLong()).put("aSynchroniser", true) } }
        Lecture.surFin = { r ->
            if (!r.has("erreur")) {
                val pos = if (r.optBoolean("fini")) (r.optDouble("duree") * 1000).toLong() else (r.optDouble("position") * 1000).toLong()
                Telechargements.maj(this, id) { it.put("positionMs", pos).put("aSynchroniser", true) }
                thread { if (Telechargements.enLigne(this)) Telechargements.synchroniser(this) }
            }
        }
        startActivity(Intent(this, LecteurActivity::class.java))
    }

    private fun bouton(texte: String, plein: Boolean, action: () -> Unit) = Button(this).apply {
        text = texte; isAllCaps = false; textSize = 13f
        setTextColor(if (plein) Color.BLACK else Color.WHITE)
        background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(if (plein) Color.WHITE else Color.argb(30, 255, 255, 255)) }
        minHeight = dp(36); minimumHeight = dp(36); setPadding(dp(14), 0, dp(14), 0)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36)).apply { topMargin = dp(4) }
        setOnClickListener { action() }
    }

    private fun libelleQualite(q: String) = when (q) { "original" -> "Originale"; "1080p" -> "1080p"; "720p-4" -> "720p 4 Mbps"; "720p-2" -> "720p 2 Mbps"; "480p" -> "480p"; else -> null }
    private fun enGo(o: Long) = if (o >= 1_000_000_000) String.format("%.1f Go", o / 1e9).replace('.', ',') else "${o / 1_000_000} Mo"
    private fun minutes(ms: Long) = "${ms / 60000} min"
}
