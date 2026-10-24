package io.github.why7726.novastream

import org.json.JSONObject

/** Une demande de lecture venue de la page Nova, et la façon de lui répondre. */
data class Demande(
    val url: String,
    val jeton: String,
    val titre: String,
    val debutMs: Long,
    val aid: Int?,          // n° de piste audio (1, 2…) ; null = celle du fichier
    val sid: Int?,          // n° de sous-titre ; 0 = aucun, null = celui du fichier
    val sousTitres: List<String>,
    val aPrecedent: Boolean = false,   // épisode avant / après : boutons du lecteur
    val aSuivant: Boolean = false,
)

/**
 * Lien entre la page (MainActivity) et le lecteur (LecteurActivity), dans le
 * même processus : une seule lecture à la fois.
 */
object Lecture {
    @Volatile var demande: Demande? = null
    var surProgression: ((positionS: Double, dureeS: Double, pause: Boolean) -> Unit)? = null
    var surFin: ((JSONObject) -> Unit)? = null
    var arretDemande: (() -> Unit)? = null

    /** Appelé une seule fois par lecture, à la fermeture du lecteur. */
    fun terminer(resultat: JSONObject) {
        val f = surFin
        surFin = null
        surProgression = null
        arretDemande = null
        demande = null
        f?.invoke(resultat)
    }

    fun piste(v: Any?): Int? = when (v) {
        is Number -> v.toInt()
        "no" -> 0
        else -> null
    }
}
