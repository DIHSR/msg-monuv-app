import { company } from '../../config'
import { LegalLayout } from './LegalLayout'

export function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidade">
      <p>
        Esta política descreve como o {company.productName}, operado por {company.legalName} (“Monuv”, “nós”), coleta, usa,
        armazena e compartilha dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD)
        e com os Termos da Plataforma da Meta.
      </p>

      <h2>1. Dados que coletamos</h2>
      <ul>
        <li><strong>Dados da conta:</strong> nome, e-mail e senha (armazenada de forma criptografada) dos usuários do painel.</li>
        <li>
          <strong>Dados da WhatsApp Business Platform</strong>, obtidos com sua autorização pelo cadastro incorporado (Embedded
          Signup) da Meta: identificadores da conta empresarial (Business ID, WABA ID), número de telefone e seu identificador,
          nome verificado, classificação de qualidade e um token de acesso concedido ao nosso aplicativo.
        </li>
        <li><strong>Templates de mensagem</strong> criados ou sincronizados da sua WABA.</li>
        <li>
          <strong>Dados de mensagens:</strong> número de telefone do destinatário, conteúdo das variáveis do template, identificador
          da mensagem na Meta e status de entrega/leitura recebidos por webhook.
        </li>
        <li><strong>Registros técnicos:</strong> data e hora de acesso e de chamadas à API, para segurança e auditoria.</li>
      </ul>

      <h2>2. Como usamos os dados</h2>
      <ul>
        <li>Conectar seu número ao WhatsApp Business Platform e operar o envio de mensagens solicitadas por você.</li>
        <li>Criar, listar e acompanhar a aprovação de templates na sua conta.</li>
        <li>Exibir o status de entrega e leitura das mensagens enviadas.</li>
        <li>Garantir a segurança do serviço, prevenir abuso e cumprir obrigações legais.</li>
      </ul>
      <p>Não vendemos dados pessoais e não usamos dados obtidos da Meta para publicidade ou para criar perfis de usuários.</p>

      <h2>3. Compartilhamento</h2>
      <ul>
        <li><strong>Meta Platforms</strong>, para o envio das mensagens pelo WhatsApp Business Platform.</li>
        <li>
          <strong>Provedores de infraestrutura</strong> que atuam como operadores sob contrato (hospedagem e banco de dados), apenas
          na medida necessária para a prestação do serviço.
        </li>
        <li>Autoridades, quando exigido por lei ou ordem judicial.</li>
      </ul>

      <h2>4. Armazenamento e segurança</h2>
      <p>
        Os dados são armazenados em banco de dados com controle de acesso por usuário. Tokens de acesso da Meta são guardados em
        cofre criptografado e nunca são expostos ao navegador. Toda comunicação utiliza HTTPS. Webhooks recebidos da Meta têm a
        assinatura (X-Hub-Signature-256) validada antes de qualquer processamento.
      </p>

      <h2>5. Retenção</h2>
      <p>
        Mantemos os dados enquanto a conta estiver ativa ou pelo tempo necessário para cumprir obrigações legais. Após a exclusão
        da conta, os dados são apagados em até 30 dias, exceto quando a lei exigir a guarda.
      </p>

      <h2>6. Seus direitos (LGPD)</h2>
      <p>
        Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação e informações
        sobre compartilhamento, além de revogar o consentimento. Envie o pedido para <strong>{company.privacyEmail}</strong>.
      </p>

      <h2>7. Exclusão de dados</h2>
      <p>
        Veja as instruções em <a className="text-brand-700 underline" href="/exclusao-de-dados">Exclusão de dados</a>.
      </p>

      <h2>8. Contato</h2>
      <p>
        Encarregado de dados (DPO): <strong>{company.privacyEmail}</strong>. Contato geral: {company.contactEmail}.
      </p>
    </LegalLayout>
  )
}
