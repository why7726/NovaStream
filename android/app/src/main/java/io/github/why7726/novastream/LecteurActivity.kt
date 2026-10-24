package io.github.why7726.novastream

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
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
import androidx.media3.ui.PlayerView
import io.github.anilbeesetti.nextlib.media3ext.ffdecoder.NextRenderersFactory
import org.json.JSONObject

/*
 * Lecteur natif : ExoPlayer sur le FICHIER d'origine, servi tel quel par le
 * serveur Nova — aucun transcodage. Les décodeurs du téléphone d'abord
 * (carte graphique : HEVC, AV1, HDR selon l'appareil), ceux de FFmpeg en
 * secours (AC3, EAC3, DTS, TrueHD…). Le jeton part en en-tête, jamais dans
 * l'adresse. La page Nova, derrière, enregistre la progression.
 */
@UnstableApi
class LecteurActivity : ComponentActivity() {

    private var lecteur: ExoPlayer? = null
    private val minuteur = Handler(Looper.getMainLooper())
    private var fini = false
    private var erreur: String? = null
    private var charge = false
    private var pistesAppliquees = false
    private var sousTitresAppliques = false

    private val battement = object : Runnable {
        override fun run() {
            lecteur?.let { p ->
                if (p.duration > 0) Lecture.surProgression?.invoke(p.currentPosition / 1000.0, p.duration / 1000.0, !p.isPlaying)
            }
            minuteur.postDelayed(this, 5000)
        }
    }

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
        masquerBarres()

        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("NovaStream Android")
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${d.jeton}"))
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(30000)
        val sources = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http))
        val rendus = NextRenderersFactory(this).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

        val p = ExoPlayer.Builder(this, rendus)
            .setMediaSourceFactory(sources)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
        lecteur = p

        val vue = PlayerView(this).apply {
            player = p
            setShowSubtitleButton(true)
            setShowNextButton(false)
            setShowPreviousButton(false)
            keepScreenOn = true
        }
        setContentView(vue)

        val sousTitres = d.sousTitres.map { u ->
            MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(u))
                .setMimeType(when {
                    u.contains(".vtt", true) || u.contains("vtt", true) -> MimeTypes.TEXT_VTT
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

        // Aucun sous-titre demandé : on les coupe d'emblée.
        if (d.sid == 0) p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()

        p.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) = appliquerPistes(d, tracks)

            override fun onPlaybackStateChanged(etat: Int) {
                if (etat == Player.STATE_READY) charge = true
                if (etat == Player.STATE_ENDED) { fini = true; finish() }
            }

            override fun onPlayerError(e: PlaybackException) {
                // Pendant la lecture, une coupure réseau : on laisse ExoPlayer réessayer
                // une fois ; avant le démarrage, c'est une vraie erreur pour la page.
                if (!charge) {
                    Plantages.noter(this@LecteurActivity, e)
                    erreur = "Lecture impossible : ${e.errorCodeName}${(e.cause?.message ?: e.message)?.let { m -> " — " + m.take(160) } ?: ""}"
                    finish()
                }
                else { p.prepare(); p.play() }
            }
        })

        Lecture.arretDemande = { finish() }
        p.setMediaItem(element, d.debutMs)
        p.prepare()
        p.playWhenReady = true
        minuteur.postDelayed(battement, 5000)
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
            if (n != null && n in 1..audios.size) {
                params = params.setOverrideForType(TrackSelectionOverride(audios[n - 1].mediaTrackGroup, 0)); change = true
            }
        }
        val s = d.sid
        if (!sousTitresAppliques && s != null && s > 0 && textes.size >= s) {
            sousTitresAppliques = true
            params = params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(textes[s - 1].mediaTrackGroup, 0)); change = true
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
        if (focus) masquerBarres()
    }

    override fun onStop() {
        super.onStop()
        // Écran éteint ou application quittée : pause (la position est gardée).
        lecteur?.pause()
    }

    override fun onDestroy() {
        minuteur.removeCallbacks(battement)
        val p = lecteur
        val r = JSONObject()
        if (erreur != null) r.put("erreur", erreur)
        else {
            val duree = if (p != null && p.duration > 0) p.duration / 1000.0 else 0.0
            val pos = p?.currentPosition?.div(1000.0) ?: 0.0
            r.put("position", pos).put("duree", duree).put("fini", fini || (duree > 0 && pos >= duree - 3)).put("suivant", false)
        }
        p?.release()
        lecteur = null
        super.onDestroy()
        if (isFinishing) Lecture.terminer(r)
    }
}
