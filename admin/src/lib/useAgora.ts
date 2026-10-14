import { useEffect, useState } from "react";

/**
 * Relógio que avança sozinho. Sem ele, uma oferta que vence com o painel aberto
 * continuaria escrita como "no ar": o Firestore não emite nada, porque nada
 * mudou no banco — o que mudou foi a hora. Mesmo tick de 30s do `agoraProvider`
 * do app (app/lib/core/services/services.dart).
 */
export function useAgora(intervaloMs = 30_000): Date {
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);

  return agora;
}
