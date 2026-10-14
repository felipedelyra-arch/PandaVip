import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";

// Inicializa o Admin SDK uma única vez (frio ou reuso de instância).
if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();
export const messaging = getMessaging();
export const storage = getStorage();
