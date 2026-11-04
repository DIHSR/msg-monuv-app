import { company } from '../../config'
import { LegalLayout } from './LegalLayout'

export function TermsPage() {
  return (
    <LegalLayout title="Termos de Uso">
      <p>
        Ao acessar o {company.productName} você concorda com estes Termos. Se não concordar, não utilize o serviço.
      </p>

      <h2>1. O serviço</h2>
      <p>
        O {company.productName} é um painel que permite a empresas conectar seu número ao WhatsApp Business Platform da Meta,
        gerenciar templates de mensagem e enviar mensagens a seus clientes.
      </p>

      <h2>2. Responsabilidades do cliente</h2>
      <ul>
        <li>Enviar mensagens apenas a pessoas que deram consentimento (opt-in) para recebê-las no WhatsApp.</li>
        <li>
          Cumprir a Política Comercial do WhatsApp, a Política do WhatsApp Business e os Termos da Meta, além da legislação
          aplicável, incluindo a LGPD e o Código de Defesa do Consumidor.
        </li>
        <li>Manter a confidencialidade das suas credenciais de acesso.</li>
        <li>Não utilizar o serviço para spam, conteúdo ilícito, fraudulento ou que viole direitos de terceiros.</li>
      </ul>

      <h2>3. Cobrança da Meta</h2>
      <p>
        Conversas e mensagens no WhatsApp Business Platform podem ser cobradas pela Meta diretamente na conta do cliente, conforme a
        tabela de preços vigente da Meta.
      </p>

      <h2>4. Disponibilidade</h2>
      <p>
        Empregamos esforços razoáveis para manter o serviço disponível, mas ele depende de serviços de terceiros (incluindo a Meta)
        e pode sofrer interrupções.
      </p>

      <h2>5. Suspensão</h2>
      <p>
        Podemos suspender o acesso em caso de violação destes Termos, das políticas da Meta ou de uso que coloque em risco o serviço
        ou terceiros.
      </p>

      <h2>6. Privacidade</h2>
      <p>
        O tratamento de dados pessoais segue a nossa <a className="text-brand-700 underline" href="/privacidade">Política de Privacidade</a>.
      </p>

      <h2>7. Foro</h2>
      <p>Fica eleito o foro da comarca da sede da {company.legalName}, com renúncia a qualquer outro.</p>
    </LegalLayout>
  )
}
