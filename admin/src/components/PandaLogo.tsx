import logoUrl from "../assets/logo.png";

/**
 * Logo oficial do Tio Panda / PandaVip. A arte é quadrada (512×512) e já
 * traz o círculo + o texto "TioPanda" dentro, então o tamanho é um lado só.
 */
export function PandaLogo({ size = 44 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      alt="PandaVip"
      width={size}
      height={size}
      className="shrink-0 select-none object-contain"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
