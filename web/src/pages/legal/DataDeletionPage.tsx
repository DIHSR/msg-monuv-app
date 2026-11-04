import { company } from '../../config'
import { LegalLayout } from './LegalLayout'

export function DataDeletionPage() {
  return (
    <LegalLayout title="Instruções para exclusão de dados">
      <p>
        Você pode solicitar a exclusão de todos os dados associados à sua conta no {company.productName}, incluindo os dados
        obtidos da Meta (identificadores da conta do WhatsApp Business, número de telefone, token de acesso, templates e histórico
        de mensagens).
      </p>

      <h2>Como solicitar</h2>
      <ol>
        <li>
          Envie um e-mail para <strong>{company.privacyEmail}</strong> com o assunto <em>“Exclusão de dados”</em>, a partir do
          e-mail cadastrado na sua conta.
        </li>
        <li>Informe o número de telefone conectado (se houver) para localizarmos a conta.</li>
        <li>Confirmaremos o recebimento em até 2 dias úteis e concluiremos a exclusão em até 30 dias.</li>
      </ol>

      <h2>Remover o acesso do aplicativo na Meta</h2>
      <p>Você também pode revogar a qualquer momento o acesso do nosso aplicativo à sua conta empresarial:</p>
      <ol>
        <li>Acesse o Meta Business Suite → Configurações do negócio.</li>
        <li>Em <em>Integrações → Aplicativos conectados</em> (ou <em>Contas → Contas do WhatsApp → Parceiros</em>), localize o aplicativo Monuv.</li>
        <li>Remova o aplicativo. A partir disso não conseguiremos mais acessar sua conta do WhatsApp Business.</li>
      </ol>

      <h2>O que é excluído</h2>
      <ul>
        <li>Dados de cadastro do usuário (nome, e-mail).</li>
        <li>Token de acesso da Meta e PIN de registro do número.</li>
        <li>Identificadores da WABA e do número, templates sincronizados e histórico de mensagens e status.</li>
      </ul>
      <p>
        Registros que precisemos manter por obrigação legal serão preservados apenas pelo prazo exigido e depois eliminados.
      </p>
    </LegalLayout>
  )
}
