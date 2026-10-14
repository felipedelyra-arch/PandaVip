package com.tiopanda.pandavip

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Canal de notificação do app.
 *
 * Sem um canal nosso, o FCM cai no `fcm_fallback_notification_channel`: o aviso
 * aparece como "Diversos" nas configurações do aparelho e sem prioridade alta —
 * ou seja, "seu pedido saiu para entrega" chega sem aparecer na tela.
 *
 * O id tem que ser o mesmo do `default_notification_channel_id` do
 * AndroidManifest. Criar aqui, e não no Flutter, evita uma dependência só pra
 * isso; o canal nasce antes de qualquer aviso porque o app precisa abrir ao
 * menos uma vez pra registrar o token.
 *
 * Canal já existente não é recriado pelo sistema — mudar nome ou importância
 * aqui não afeta quem já instalou; isso exigiria um id novo.
 */
class MainActivity : FlutterFragmentActivity() {
    /**
     * FLAG_SECURE enquanto a tela de cartão está aberta: bloqueia print,
     * gravação de tela e a miniatura em "recentes". O Flutter liga/desliga pelo
     * canal `pandavip/seguranca`.
     */
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "pandavip/seguranca")
            .setMethodCallHandler { call, result ->
                if (call.method == "telaSegura") {
                    if (call.arguments == true) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }
                    result.success(null)
                } else {
                    result.notImplemented()
                }
            }
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        // Ponta a ponta também abaixo do Android 15 (recomendação do Play
        // Console). Por isso a classe é FlutterFragmentActivity: o
        // `enableEdgeToEdge` é do ComponentActivity, que a FlutterActivity não é.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(
                "pandavip_avisos",
                "Avisos do clube",
                NotificationManager.IMPORTANCE_HIGH,
            )
            canal.description = "Promoções, prêmios e o andamento dos seus pedidos."
            getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
        }
    }
}
