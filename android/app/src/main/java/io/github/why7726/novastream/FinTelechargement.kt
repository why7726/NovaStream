package io.github.why7726.novastream

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/** Android a fini (ou raté) un téléchargement : on relit l'état de la liste. */
class FinTelechargement : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val fin = goAsync()
        thread { try { Telechargements.actualiser(ctx.applicationContext) } finally { fin.finish() } }
    }
}
