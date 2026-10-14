import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db, messaging } from "./admin";

/**
 * Avisa um sócio: guarda na central do app e toca o celular.
 *
 * Falha aqui só vai pro log: quem chama já fez o que importava (mudou o
 * pedido, liberou o mês), e o app mostra o estado novo mesmo sem o push.
 */
export async function avisarSocio(
  userId: unknown,
  texto: { titulo: string; corpo: string },
  tipo: string,
  rota: string
) {
  if (typeof userId !== "string" || !userId) return;
  try {
    const perfil = db.doc(`users/${userId}`);
    await perfil.collection("notifications").add({
      ...texto,
      tipo,
      lida: false,
      criadoEm: FieldValue.serverTimestamp(),
    });
    const token = (await perfil.get()).get("fcmToken");
    if (typeof token !== "string" || !token) return;
    await messaging.send({
      token,
      notification: { title: texto.titulo, body: texto.corpo },
      data: { rota },
      android: { priority: "high" },
    });
  } catch (err) {
    logger.warn("Não deu pra avisar o sócio.", { userId, tipo, err });
  }
}
