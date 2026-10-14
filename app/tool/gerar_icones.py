"""Gera os ícones do app a partir de assets/logo/panda_logo.png.

Rodar da raiz do repositório (o Python desta máquina só tem Pillow via uv):

    uv run --with pillow python app/tool/gerar_icones.py

O que sai daqui:
  - app/assets/logo/panda_logo_icon.png  (fonte do flutter_launcher_icons:
    iOS + ícone legado do Android)
  - app/web/icons/*.png e app/web/favicon.png (PWA)

Depois de rodar, regerar Android/iOS com:

    cd app && dart run flutter_launcher_icons

Proporções: a arte é o círculo do Tio Panda sobre o laranja da marca. Quanto
menor a fração, mais laranja aparece em volta. Em 20/08/2026 o círculo foi
reduzido de 0,857 para 0,80 (e o maskable de 0,64 para 0,60) a pedido do dono,
para o laranja ficar em destaque. `adaptive_icon_foreground_inset` no
pubspec.yaml acompanha essa mesma proporção — mexer nos dois juntos.
"""

from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]
FONTE = RAIZ / "app/assets/logo/panda_logo.png"
LARANJA = (255, 141, 6, 255)  # #FF8D06, o laranja da placa do Tio Panda

# fração do lado que o círculo ocupa
FRACAO_PADRAO = 0.80
FRACAO_MASKABLE = 0.60  # a máscara do sistema corta as bordas
FRACAO_FAVICON = 0.875  # 32px: margem grande demais some, então quase cheio

SAIDAS = [
    ("app/assets/logo/panda_logo_icon.png", 1024, FRACAO_PADRAO),
    ("app/web/icons/Icon-192.png", 192, FRACAO_PADRAO),
    ("app/web/icons/Icon-512.png", 512, FRACAO_PADRAO),
    ("app/web/icons/Icon-maskable-192.png", 192, FRACAO_MASKABLE),
    ("app/web/icons/Icon-maskable-512.png", 512, FRACAO_MASKABLE),
    ("app/web/favicon.png", 32, FRACAO_FAVICON),
]


def compor(logo: Image.Image, lado: int, fracao: float) -> Image.Image:
    arte = round(lado * fracao)
    canvas = Image.new("RGBA", (lado, lado), LARANJA)
    redimensionada = logo.resize((arte, arte), Image.LANCZOS)
    canto = (lado - arte) // 2
    canvas.alpha_composite(redimensionada, (canto, canto))
    return canvas


def main() -> None:
    logo = Image.open(FONTE).convert("RGBA")
    for caminho, lado, fracao in SAIDAS:
        destino = RAIZ / caminho
        destino.parent.mkdir(parents=True, exist_ok=True)
        compor(logo, lado, fracao).save(destino, "PNG")
        print(f"{caminho}: {lado}px, círculo em {fracao:.0%}")


if __name__ == "__main__":
    main()
