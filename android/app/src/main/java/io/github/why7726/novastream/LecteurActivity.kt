package io.github.why7726.novastream

import android.app.AlertDialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import io.github.anilbeesetti.nextlib.media3ext.ffdecoder.NextRenderersFactory
import org.json.JSONObject
import java.util.Locale

/*
 * Lecteur natif : ExoPlayer sur le FICHIER d'origine, servi tel quel par le
 * serveur Nova — aucun transcodage. Décodeurs du téléphone d'abord (AV1, HEVC,
 * HDR selon l'appareil), ceux de FFmpeg en secours (AC3, EAC3, DTS, TrueHD…).
 * Le jeton part en en-tête, jamais dans l'adresse.
 *
 * Les commandes sont celles de Nova (comme le lecteur du site), pas celles
 * d'ExoPlayer : retour + titre en haut ; épisode précédent / lecture / épisode
 * suivant au milieu ; temps, barre et choix audio / sous-titres en bas.
 * Double appui à gauche ou à droite : −10 / +10 s.
 */
@UnstableApi
class LecteurActivity : ComponentActivity() {

    private var lecteur: ExoPlayer? = null
    private val minuteur = Handler(Looper.getMainLooper())
    private var fini = false
    private var versSuivant = false
    private var versPrecedent = false
    private var erreur: String? = null
    private var charge = false
    private var pistesAppliquees = false
    private var sousTitresAppliques = false

    // Commandes
    private lateinit var calque: FrameLayout
    private lateinit var boutonLecture: ImageButton
    private lateinit var barre: SeekBar
    private lateinit var tempsEcoule: TextView
    private lateinit var tempsRestant: TextView
    private lateinit var attente: ProgressBar
    private lateinit var retourSaut: TextView
    private var enGlissement = false

    private fun dp(v: Number) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
    private fun teinte(c: Int) = ColorStateList.valueOf(c)

    private val battement = object : Runnable {
        override fun run() {
            lecteur?.let { p -> if (p.duration > 0) Lecture.surProgression?.invoke(p.currentPosition / 1000.0, p.duration / 1000.0, !p.isPlaying) }
            minuteur.postDelayed(this, 5000)
        }
    }
    private val horloge = object : Runnable {
        override fun run() { majTemps(); minuteur.postDelayed(this, 500) }
    }
    private val masquage = Runnable { if (lecteur?.isPlaying == true) afficherCommandes(false) }
    private val cacherSaut = Runnable { if (::retourSaut.isInitialized) retourSaut.visibility = View.GONE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Plantages.installer(this)
        val d = Lecture.demande ?: run { finish(); return }
        // Un problème au démarrage du lecteur ne doit pas fermer toute l'application :
        // on revient sur la page avec le message, et l'erreur part au journal du serveur.
        try {
            demarrer(d)
        } catch (e: Throwable) {
            Plantages.noter(this, e)
            erreur = "Lecture impossible : ${e.javaClass.simpleName}${e.message?.let { m -> " — " + m.take(160) } ?: ""}"
            finish()
        }
    }

    private fun demarrer(d: Demande) {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("NovaStream Android")
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(30000)
        if (d.jeton.isNotEmpty()) http.setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${d.jeton}"))
        val sources = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http))
        val rendus = NextRenderersFactory(this).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

        val p = ExoPlayer.Builder(this, rendus)
            .setMediaSourceFactory(sources)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        lecteur = p

        // ── L'image et les sous-titres (sans les commandes d'ExoPlayer) ──
        val vue = PlayerView(this).apply {
            player = p
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            keepScreenOn = true
            // Sous-titres comme sur le site : blanc, contour noir, sans fond — lisibles partout.
            subtitleView?.apply {
                setApplyEmbeddedStyles(false)
                setApplyEmbeddedFontSizes(false)
                setFractionalTextSize(0.058f)
                setBottomPaddingFraction(0.06f)
                setStyle(CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT,
                    CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, Typeface.create("sans-serif-medium", Typeface.BOLD)))
            }
        }
        val racine = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        racine.addView(vue, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        construireCommandes(racine, d, p)
        setContentView(racine)
        // APRÈS setContentView : avant, la fenêtre n'a pas encore de vue racine et
        // Android plante (NullPointerException sur getWindowInsetsController).
        masquerBarres()

        // ── Le fichier ──
        val sousTitres = d.sousTitres.map { u ->
            MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(u))
                .setMimeType(when {
                    u.contains("vtt", true) -> MimeTypes.TEXT_VTT
                    u.contains(".ass", true) || u.contains(".ssa", true) -> MimeTypes.TEXT_SSA
                    else -> MimeTypes.APPLICATION_SUBRIP
                })
                .build()
        }
        val element = MediaItem.Builder()
            .setUri(d.url)
            .setSubtitleConfigurations(sousTitres)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(d.titre).build())
            .build()
        if (d.sid == 0) p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()

        p.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) = appliquerPistes(d, tracks)
            override fun onIsPlayingChanged(enLecture: Boolean) {
                boutonLecture.setImageResource(if (enLecture) R.drawable.ic_pause else R.drawable.ic_lecture)
                if (enLecture) programmerMasquage() else afficherCommandes(true)
            }
            override fun onPlaybackStateChanged(etat: Int) {
                attente.visibility = if (etat == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
                if (etat == Player.STATE_READY) charge = true
                if (etat == Player.STATE_ENDED) { fini = true; finish() }
            }
            override fun onPlayerError(e: PlaybackException) {
                // Avant le démarrage : une vraie erreur pour la page. Pendant : une
                // coupure réseau, ExoPlayer réessaie.
                if (!charge) {
                    Plantages.noter(this@LecteurActivity, e)
                    erreur = "Lecture impossible : ${e.errorCodeName}${(e.cause?.message ?: e.message)?.let { m -> " — " + m.take(160) } ?: ""}"
                    finish()
                } else { p.prepare(); p.play() }
            }
        })

        Lecture.arretDemande = { finish() }
        p.setMediaItem(element, d.debutMs)
        p.prepare()
        p.playWhenReady = true
        minuteur.postDelayed(battement, 5000)
        minuteur.post(horloge)
        afficherCommandes(true)
    }

    /* ── Commandes Nova ── */

    private fun icone(res: Int, tailleDp: Int, fond: Int = Color.TRANSPARENT, action: () -> Unit) = ImageButton(this).apply {
        setImageResource(res)
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(fond) }
        scaleType = ImageView.ScaleType.FIT_CENTER
        val m = dp(tailleDp / 4)
        setPadding(m, m, m, m)
        setOnClickListener { action(); programmerMasquage() }
    }

    private fun construireCommandes(racine: FrameLayout, d: Demande, p: ExoPlayer) {
        calque = FrameLayout(this)
        racine.addView(calque, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // Voile : dégradé haut et bas, pour que tout reste lisible sur une image claire
        calque.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.argb(170, 0, 0, 0), Color.argb(30, 0, 0, 0), Color.argb(30, 0, 0, 0), Color.argb(190, 0, 0, 0)))
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // Haut : retour + titre
        val haut = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(16), dp(14), dp(28), 0) }
        haut.addView(icone(R.drawable.ic_retour, 46) { finish() }, LinearLayout.LayoutParams(dp(46), dp(46)))
        val titres = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), 0, 0, 0) }
        titres.addView(TextView(this).apply {
            text = d.titreCourt.ifEmpty { d.titre }; setTextColor(Color.WHITE); textSize = 17f; typeface = Typeface.DEFAULT_BOLD; maxLines = 1
        })
        if (d.detail.isNotEmpty()) titres.addView(TextView(this).apply { text = d.detail; setTextColor(Color.argb(150, 255, 255, 255)); textSize = 13f; maxLines = 1 })
        haut.addView(titres, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        calque.addView(haut, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        // Milieu : épisode précédent · lecture · épisode suivant
        val milieu = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val precedent = icone(R.drawable.ic_precedent, 52) { if (d.aPrecedent) { versPrecedent = true; finish() } }
        val suivant = icone(R.drawable.ic_suivant, 52) { if (d.aSuivant) { versSuivant = true; finish() } }
        precedent.visibility = if (d.aPrecedent) View.VISIBLE else View.INVISIBLE
        suivant.visibility = if (d.aSuivant) View.VISIBLE else View.INVISIBLE
        boutonLecture = icone(R.drawable.ic_pause, 76, Color.argb(40, 255, 255, 255)) { if (p.isPlaying) p.pause() else p.play() }
        milieu.addView(precedent, LinearLayout.LayoutParams(dp(52), dp(52)))
        milieu.addView(boutonLecture, LinearLayout.LayoutParams(dp(76), dp(76)).apply { marginStart = dp(48); marginEnd = dp(48) })
        milieu.addView(suivant, LinearLayout.LayoutParams(dp(52), dp(52)))
        calque.addView(milieu, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        // Bas : temps · barre · temps restant · audio et sous-titres
        val bas = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(24), 0, dp(16), dp(18)) }
        tempsEcoule = TextView(this).apply { setTextColor(Color.WHITE); textSize = 12.5f; text = "0:00" }
        tempsRestant = TextView(this).apply { setTextColor(Color.argb(160, 255, 255, 255)); textSize = 12.5f; text = "−0:00" }
        barre = SeekBar(this).apply {
            max = 1000
            progressTintList = teinte(Color.WHITE)
            progressBackgroundTintList = teinte(Color.argb(90, 255, 255, 255))
            secondaryProgressTintList = teinte(Color.argb(140, 255, 255, 255))
            thumbTintList = teinte(Color.WHITE)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar, v: Int, parUtilisateur: Boolean) {
                    if (parUtilisateur && p.duration > 0) tempsEcoule.text = format(p.duration * v / 1000)
                }
                override fun onStartTrackingTouch(s: SeekBar) { enGlissement = true; minuteur.removeCallbacks(masquage) }
                override fun onStopTrackingTouch(s: SeekBar) {
                    enGlissement = false
                    if (p.duration > 0) p.seekTo(p.duration * s.progress / 1000)
                    programmerMasquage()
                }
            })
        }
        bas.addView(tempsEcoule)
        bas.addView(barre, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(8); marginEnd = dp(8) })
        bas.addView(tempsRestant)
        bas.addView(icone(R.drawable.ic_langues, 46) { choisirPistes(p) }, LinearLayout.LayoutParams(dp(46), dp(46)).apply { marginStart = dp(10) })
        calque.addView(bas, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))

        // Chargement, et retour visuel du double appui
        attente = ProgressBar(this).apply { indeterminateTintList = teinte(Color.WHITE); visibility = View.GONE }
        racine.addView(attente, FrameLayout.LayoutParams(dp(54), dp(54), Gravity.CENTER))
        retourSaut = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 15f; typeface = Typeface.DEFAULT_BOLD; visibility = View.GONE
            setPadding(dp(16), dp(8), dp(16), dp(8))
            background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.argb(120, 0, 0, 0)) }
        }
        racine.addView(retourSaut, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_VERTICAL))

        // Appui simple : commandes ; double appui à gauche / à droite : −10 / +10 s
        val gestes = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onSingleTapConfirmed(e: MotionEvent): Boolean { afficherCommandes(calque.visibility != View.VISIBLE); return true }
            override fun onDoubleTap(e: MotionEvent): Boolean {
                val droite = e.x > racine.width / 2f
                p.seekTo((p.currentPosition + if (droite) 10_000 else -10_000).coerceIn(0, maxOf(0L, p.duration)))
                retourSaut.text = if (droite) "+10 s" else "−10 s"
                (retourSaut.layoutParams as FrameLayout.LayoutParams).apply {
                    gravity = Gravity.CENTER_VERTICAL or (if (droite) Gravity.END else Gravity.START)
                    marginStart = dp(56); marginEnd = dp(56)
                }
                retourSaut.requestLayout()
                retourSaut.visibility = View.VISIBLE
                minuteur.removeCallbacks(cacherSaut); minuteur.postDelayed(cacherSaut, 700)
                majTemps()
                return true
            }
        })
        @Suppress("ClickableViewAccessibility")
        racine.setOnTouchListener { _, ev -> gestes.onTouchEvent(ev); true }
        @Suppress("ClickableViewAccessibility")
        calque.setOnTouchListener { _, ev -> gestes.onTouchEvent(ev); true }
    }

    private fun afficherCommandes(oui: Boolean) {
        if (!::calque.isInitialized) return
        calque.animate().cancel()
        if (oui) {
            calque.visibility = View.VISIBLE
            calque.animate().alpha(1f).setDuration(160).start()
            programmerMasquage()
        } else {
            calque.animate().alpha(0f).setDuration(220).withEndAction { calque.visibility = View.GONE }.start()
        }
    }

    private fun programmerMasquage() {
        minuteur.removeCallbacks(masquage)
        minuteur.postDelayed(masquage, 3500)
    }

    private fun majTemps() {
        val p = lecteur ?: return
        if (!::barre.isInitialized || enGlissement) return
        val duree = p.duration.takeIf { it > 0 } ?: return
        barre.progress = (p.currentPosition * 1000 / duree).toInt()
        barre.secondaryProgress = (p.bufferedPosition * 1000 / duree).toInt()
        tempsEcoule.text = format(p.currentPosition)
        tempsRestant.text = "−" + format(duree - p.currentPosition)
    }

    private fun format(ms: Long): String {
        val s = (ms / 1000).coerceAtLeast(0)
        return if (s >= 3600) String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
        else String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60)
    }

    /** Audio et sous-titres : une liste simple, comme le menu du site. */
    private fun choisirPistes(p: ExoPlayer) {
        val groupes = p.currentTracks.groups
        val audios = groupes.filter { it.type == C.TRACK_TYPE_AUDIO }
        val textes = groupes.filter { it.type == C.TRACK_TYPE_TEXT }
        val libelle = { g: Tracks.Group, n: Int ->
            val f = g.getTrackFormat(0)
            val langue = f.language?.takeIf { it.isNotEmpty() && it != "und" }?.let {
                Locale.forLanguageTag(it).getDisplayLanguage(Locale.FRENCH).replaceFirstChar { c -> c.uppercase() }
            }
            listOfNotNull(f.label, langue).distinct().joinToString(" · ").ifEmpty { "Piste $n" }
        }
        val noms = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()
        audios.forEachIndexed { i, g ->
            noms.add((if (g.isSelected) "✓   " else "      ") + "Audio · " + libelle(g, i + 1))
            actions.add { p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0)).build() }
        }
        noms.add((if (textes.none { it.isSelected }) "✓   " else "      ") + "Sans sous-titres")
        actions.add { p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build() }
        textes.forEachIndexed { i, g ->
            noms.add((if (g.isSelected) "✓   " else "      ") + "Sous-titres · " + libelle(g, i + 1))
            actions.add {
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                    .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0)).build()
            }
        }
        minuteur.removeCallbacks(masquage)
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Audio et sous-titres")
            .setItems(noms.toTypedArray()) { _, i -> actions[i](); programmerMasquage() }
            .setOnDismissListener { masquerBarres(); programmerMasquage() }
            .show()
    }

    /** Pistes choisies par Nova : n° d'ordre par type, à partir de 1 (comme mpv). */
    private fun appliquerPistes(d: Demande, tracks: Tracks) {
        val p = lecteur ?: return
        val audios = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        val textes = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        var params = p.trackSelectionParameters.buildUpon()
        var change = false
        if (!pistesAppliquees && audios.isNotEmpty()) {
            pistesAppliquees = true
            val n = d.aid
            if (n != null && n in 1..audios.size) { params = params.setOverrideForType(TrackSelectionOverride(audios[n - 1].mediaTrackGroup, 0)); change = true }
        }
        val s = d.sid
        if (!sousTitresAppliques && s != null && s > 0 && textes.size >= s) {
            sousTitresAppliques = true
            params = params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(TrackSelectionOverride(textes[s - 1].mediaTrackGroup, 0)); change = true
        }
        if (change) p.trackSelectionParameters = params.build()
    }

    private fun masquerBarres() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
        }
    }

    override fun onWindowFocusChanged(focus: Boolean) {
        super.onWindowFocusChanged(focus)
        if (focus && window.peekDecorView() != null) masquerBarres()
    }

    override fun onStop() {
        super.onStop()
        lecteur?.pause()   // écran éteint ou application quittée : pause (la position est gardée)
    }

    override fun onDestroy() {
        minuteur.removeCallbacksAndMessages(null)
        val p = lecteur
        val r = JSONObject()
        if (erreur != null) r.put("erreur", erreur)
        else {
            val duree = if (p != null && p.duration > 0) p.duration / 1000.0 else 0.0
            val pos = p?.currentPosition?.div(1000.0) ?: 0.0
            r.put("position", pos).put("duree", duree).put("fini", fini || (duree > 0 && pos >= duree - 3))
                .put("suivant", versSuivant).put("precedent", versPrecedent)
        }
        p?.release()
        lecteur = null
        super.onDestroy()
        if (isFinishing) Lecture.terminer(r)
    }
}
