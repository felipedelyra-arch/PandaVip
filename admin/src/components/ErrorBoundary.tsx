import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui";

/**
 * Segura erro de renderização de uma página do painel.
 *
 * Sem isto, qualquer exceção durante o render desmonta a árvore React inteira
 * e o dono vê uma tela **branca**, sem menu e sem mensagem — foi o que
 * aconteceu em Configurações com um perfil de admin sem `nome`. Com isto, só a
 * área da página troca por um aviso; o menu continua de pé e dá pra ir pra
 * outra tela.
 *
 * O Layout passa `key={pathname}`: trocar de rota remonta o boundary e limpa o
 * erro, então sair da página quebrada volta a funcionar sem recarregar.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Vai pro console do navegador, que é onde se investiga.
    console.error("[painel] erro ao renderizar a página:", erro, info.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-erro/30 bg-erro/8 p-5 text-sm text-erro-tinta">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={17} className="shrink-0" />
          Esta tela não conseguiu abrir.
        </div>
        <p className="mt-2 text-tinta-2">
          O resto do painel continua funcionando pelo menu. Se o problema
          persistir, recarregue a página.
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Recarregar
        </Button>
        <p className="mt-3 break-all font-mono text-xs text-tinta-3">{this.state.erro.message}</p>
      </div>
    );
  }
}
